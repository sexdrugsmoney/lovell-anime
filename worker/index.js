// LOVELL — Cloudflare Workers sürümü.
// Statik dosyalar (dist/) Workers Static Assets ile, /api/* uçları bu betikle sunulur.
// TMDB ve görseller Cloudflare üzerinden çekildiği için ziyaretçinin DNS'i önemli değildir.
import {configure, browse, search, home, detail, episodes, GENRES, genresFor, dataErrors} from '../lib/catalog-core.js';
import offlineEpisodes from '../src/data/offline-episodes.js';
import {buildEmbeds, fetchRemoteSources, normalizeSources, fetchTrArchive, fetchTurkishSubs} from '../lib/providers.js';
import trArchiveIndex from '../src/data/tr-archive-index.js';

const ALLOWED_IMG_HOSTS = new Set(['s4.anilist.co', 's3.anilist.co', 'img.anili.st']);

// ---- CloseLoad (filmmakinesi.to) — Worker üzerinden TR Dublaj HLS ----
function packedUnpack(packed) {
  try {
    const m = packed.match(/\(function\(p,a,c,k,e,(?:d|r)\)\{([\s\S]+?)\}\('([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)/);
    if (!m) return packed;
    let [,, p,, a, k] = m;
    a = parseInt(a, 10);
    k = k.split('|');
    const e = (c) => c ? (c < a ? '' : e(Math.floor(c / a))) + ((c %= a) > 35 ? String.fromCharCode(c + 29) : c.toString(36)) : c;
    for (let i = k.length - 1; i >= 0; i--) {
      if (k[i]) p = p.replace(new RegExp(`\\b${e(i)}\\b`, 'g'), k[i]);
    }
    return p;
  } catch { return packed; }
}

function closeloadDecode(b64) {
  try {
    // decode → reverse bytes → decode → split("|")[1]
    const buf1 = atob(b64);
    const reversed = buf1.split('').reverse().join('');
    const buf2 = atob(reversed);
    return buf2.split('|')[1] || null;
  } catch { return null; }
}

async function fetchCloseLoad(tmdbId, env) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  const FM_BASE = 'https://filmmakinesi.to';
  const CL_BASE = 'https://closeload.filmmakinesi.to';

  // 1. filmmakinesi.to'dan film sayfasını ara — lema/v1 API
  const searchRes = await fetch(`${FM_BASE}/lema/v1/search?tmdb=${tmdbId}&type=movie`, {
    signal: AbortSignal.timeout(8000),
    headers: {'User-Agent': UA, 'Accept': 'application/json', 'Referer': FM_BASE + '/'},
    cf: {cacheTtl: 3600, cacheEverything: false},
  });

  let videoId = null;
  if (searchRes.ok) {
    const data = await searchRes.json().catch(() => null);
    videoId = data?.closeload_id || data?.video_id || data?.embed_id
      || data?.data?.[0]?.closeload_id || data?.results?.[0]?.closeload_id
      || data?.film?.closeload_id;
  }

  // Eğer lema/v1 API çalışmıyorsa film sayfasından videoId çek
  if (!videoId) {
    // TMDB'den Türkçe adı al
    const tmdbRes = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=500330721680edb6d5f7f12ba7cd9023&language=tr-TR`,
      {signal: AbortSignal.timeout(6000), cf: {cacheTtl: 3600, cacheEverything: true}}
    );
    if (!tmdbRes.ok) return [];
    const tmdbData = await tmdbRes.json();
    const title = (tmdbData.title || tmdbData.original_title || '').toLowerCase()
      .replace(/[ığüşöçİĞÜŞÖÇ]/g, c => ({'i':'i','ı':'i','ğ':'g','ü':'u','ş':'s','ö':'o','ç':'c','İ':'i','Ğ':'g','Ü':'u','Ş':'s','Ö':'o','Ç':'c'}[c]||c))
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const year = (tmdbData.release_date || '').slice(0,4);

    // filmmakinesi.to'da slug tahmin et: {title}-izle-{year}-fm{id}
    // Önce arama sayfasını dene
    const fmSearchRes = await fetch(`${FM_BASE}/?s=${encodeURIComponent(tmdbData.title || '')}`, {
      signal: AbortSignal.timeout(8000),
      headers: {'User-Agent': UA, 'Referer': FM_BASE + '/'},
    });
    if (fmSearchRes.ok) {
      const html = await fmSearchRes.text();
      // closeload embed URL'sini doğrudan HTML'den çıkar
      const clMatch = html.match(/closeload\.filmmakinesi\.to\/video\/embed\/([A-Za-z0-9]+)/);
      if (clMatch) videoId = clMatch[1];
    }
  }

  if (!videoId) return [];

  // 2. CloseLoad embed sayfasını GET ile çek
  const embedUrl = `${CL_BASE}/video/embed/${videoId}/ah/`;
  const getRes = await fetch(embedUrl, {
    signal: AbortSignal.timeout(8000),
    headers: {
      'User-Agent': UA,
      'Referer': FM_BASE + '/',
      'Accept': 'text/html',
      'sec-fetch-dest': 'iframe',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-site',
    },
  });
  if (!getRes.ok) return [];
  const getHtml = await getRes.text();

  // 3. Hash çıkar
  const hashMatch = getHtml.match(/var\s+\w+\s*=\s*["']([a-f0-9]{32})["']/i)
    || getHtml.match(/["']([a-f0-9]{32})["']/);
  if (!hashMatch) return [];
  const hash = hashMatch[1];

  // 4. POST → packed JS
  const postRes = await fetch(embedUrl, {
    signal: AbortSignal.timeout(8000),
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Origin': CL_BASE,
      'Referer': embedUrl,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'same-origin',
      'sec-fetch-site': 'same-origin',
    },
    body: `hash=${hash}`,
  });
  if (!postRes.ok) return [];
  const postHtml = await postRes.text();

  // 5. Packed JS unpack
  const scriptMatch = postHtml.match(/eval\(function\(p,a,c,k,e,(?:d|r)\)[\s\S]+?\)\)/);
  if (!scriptMatch) return [];
  const unpacked = packedUnpack(scriptMatch[0]);

  // 6. Base64 data çıkar ve decode et
  const dataMatch = unpacked.match(/return result\}[^(]*\(["']([A-Za-z0-9+/=]{20,})["']\)/)
    || unpacked.match(/\(["']([A-Za-z0-9+/=]{20,})["']\)/);
  if (!dataMatch) return [];

  const m3u8Url = closeloadDecode(dataMatch[1]);
  if (!m3u8Url || !m3u8Url.startsWith('http')) return [];

  return [{
    name: 'FilmMakinesi (TR Dublaj)',
    origin: 'closeload',
    url: m3u8Url,
    type: 'hls',
    subtitles: [],
  }];
}

let configured = false;
let authProblem = null;
let lastOk = null;

const json = (data, status = 200, maxAge = 0) => new Response(JSON.stringify(data), {
  status,
  headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store'},
});
const int = (v, d = 1) => (/^\d{1,4}$/.test(v || '') ? Number(v) : d);
const esc = s => String(s).replace(/[<>&"']/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'}[c]));

async function fallbackTmdb(env, endpoint, params) {
  if (!env.TMDB_FALLBACK_URL) throw Error('TMDB anahtarı tanımlı değil (Worker secret: TMDB_READ_TOKEN)');
  let upstream;
  try { upstream = new URL(env.TMDB_FALLBACK_URL); } catch { throw Error('TMDB yedek adresi geçersiz'); }
  if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.port) throw Error('TMDB yedek adresi güvenli değil');
  upstream.searchParams.set('endpoint', '/' + String(endpoint).replace(/^\/+/, ''));
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') upstream.searchParams.set(key, value); });
  const res = await fetch(upstream, {headers: {accept: 'application/json'}, signal: AbortSignal.timeout(9000), cf: {cacheTtl: 600, cacheEverything: true}});
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw Object.assign(Error(`TMDB yedek kaynağı HTTP ${res.status}`), {status: res.status});
  authProblem = null;
  lastOk = {at: new Date().toISOString(), route: 'Cloudflare yedek kataloğu'};
  return body;
}

// Worker'a video adresleri gömülmez. MEDIA_SOURCES KV bağlamasında her bölüm
// "tv:127532:1:1" gibi kendi anahtarıyla tutulur. Küçük kataloglar için
// MEDIA_SOURCES_JSON, ayrı bir yetkili servis için MEDIA_SOURCE_API kullanılabilir.
const mediaKey = (kind, id, season, episode) => `${kind}:${id}:${season}:${episode}`;
const mediaType = (url, declared) => declared === 'hls' || /\.m3u8(?:$|[?#])/i.test(url) ? 'hls' : 'video';
function safeSources(value) {
  const list = Array.isArray(value) ? value : value?.sources;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 50).flatMap((item, i) => {
    if (!item || typeof item.url !== 'string') return [];
    let url;
    try { url = new URL(item.url); } catch { return []; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return [];
    const subtitles = Array.isArray(item.subtitles) ? item.subtitles.slice(0, 8).flatMap(subtitle => {
      if (!subtitle || typeof subtitle.url !== 'string') return [];
      try {
        const subUrl = new URL(subtitle.url);
        if (subUrl.protocol !== 'https:' || subUrl.username || subUrl.password || subUrl.port) return [];
        return [{label: String(subtitle.label || subtitle.lang || 'Altyazı').slice(0, 60), lang: String(subtitle.lang || 'tr').slice(0, 12), url: subUrl.href}];
      } catch { return []; }
    }) : [];
    const declared = String(item.type || '').toLowerCase();
    const type = declared === 'dash' ? 'dash' : mediaType(url.href, declared);
    return [{name: String(item.name || `Kaynak ${i + 1}`).slice(0, 90), url: url.href, type, subtitles}];
  });
}
async function cloudSources(env, key) {
  let entry = null;
  if (env.MEDIA_SOURCES?.get) entry = await env.MEDIA_SOURCES.get(key, {type: 'json'}).catch(() => null);
  if (!entry && env.MEDIA_SOURCES_JSON) { try { entry = JSON.parse(env.MEDIA_SOURCES_JSON)[key]; } catch {} }
  if (!entry && env.MEDIA_SOURCE_API) {
    const headers = {accept: 'application/json'};
    if (env.MEDIA_SOURCE_TOKEN) headers.authorization = `Bearer ${env.MEDIA_SOURCE_TOKEN}`;
    const base = env.MEDIA_SOURCE_API.replace(/\/$/, '');
    const res = await fetch(`${base}/${encodeURIComponent(key)}`, {headers, signal: AbortSignal.timeout(8000)});
    if (res.ok) entry = await res.json().catch(() => null);
  }
  return safeSources(entry);
}

function setup(env) {
  if (configured) return;
  configured = true;
  configure({
    offlineEpisodes,
    region: env.WATCH_REGION || 'TR',
    localPosters: true,
    async tmdbJson(endpoint, params = {}) {
      const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      const headers = {accept: 'application/json'};
      if (env.TMDB_READ_TOKEN) headers.authorization = `Bearer ${env.TMDB_READ_TOKEN}`;
      else if (env.TMDB_API_KEY) q.set('api_key', env.TMDB_API_KEY);
      else return fallbackTmdb(env, endpoint, params);
      try {
        const res = await fetch(`https://api.themoviedb.org/3/${endpoint}?${q}`, {headers, signal: AbortSignal.timeout(9000), cf: {cacheTtl: 600, cacheEverything: true}});
        const body = await res.json().catch(() => null);
        if (res.status === 401) {
          authProblem = {at: new Date().toISOString(), message: body?.status_message || 'API anahtarı reddedildi'};
          throw Object.assign(Error('TMDB API anahtarı geçersiz'), {status: 401});
        }
        if (!res.ok || !body) throw Object.assign(Error(body?.status_message || `TMDB HTTP ${res.status}`), {status: res.status});
        authProblem = null;
        lastOk = {at: new Date().toISOString(), route: 'Cloudflare Worker'};
        return body;
      } catch (error) {
        if (!env.TMDB_FALLBACK_URL) throw error;
        return fallbackTmdb(env, endpoint, params);
      }
    },
  });
}

function placeholder(title = '') {
  const t = esc(title.slice(0, 32));
  return new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513" viewBox="0 0 342 513"><rect width="342" height="513" fill="#1c2140"/><path d="M0 400 342 300V513H0Z" fill="#232951"/><g transform="translate(139 190)" fill="none" stroke="#3a4280" stroke-width="6"><rect x="0" y="0" width="64" height="64" rx="14"/><path d="M26 20v24l18-12z" fill="#3a4280" stroke="none"/></g><text x="171" y="310" text-anchor="middle" fill="#aab0d6" font-family="system-ui,sans-serif" font-size="17">${t}</text></svg>`, {headers: {'content-type': 'image/svg+xml', 'cache-control': 'no-store'}});
}

async function image(url) {
  const p = url.searchParams.get('p');
  const remote = url.searchParams.get('u');
  let target;
  if (p) {
    if (!/^\/t\/p\/(w\d{2,4}|original)\/[\w-]+\.(jpg|png|webp|svg)$/.test(p)) return json({error: 'Geçersiz görsel yolu'}, 400);
    target = 'https://image.tmdb.org' + p;
  } else if (remote) {
    let u;
    try { u = new URL(remote); } catch {}
    if (!u || u.protocol !== 'https:' || !ALLOWED_IMG_HOSTS.has(u.hostname) || u.port || u.username) return json({error: 'Bu görsel sunucusuna izin verilmiyor'}, 400);
    target = u.href;
  } else return placeholder(url.searchParams.get('t') || '');
  try {
    const res = await fetch(target, {cf: {cacheTtl: 604800, cacheEverything: true}, signal: AbortSignal.timeout(9000)});
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) throw Error('görsel yok');
    return new Response(res.body, {headers: {'content-type': type, 'cache-control': 'public, max-age=604800, immutable'}});
  } catch {
    return placeholder(url.searchParams.get('t') || '');
  }
}

async function api(url, env) {
  setup(env);
  const q = url.searchParams;
  const path = url.pathname;
  if (path === '/api/status') return json({mode: 'cloud', tmdb: authProblem ? 'anahtar geçersiz' : lastOk ? 'bağlı' : 'henüz denenmedi', authProblem, lastSuccess: lastOk, auth: env.TMDB_READ_TOKEN ? 'okuma jetonu (v4)' : env.TMDB_API_KEY ? 'API anahtarı' : 'yok', dataErrors, library: 0, subs: !!env.WYZIE_API_KEY});
  if (path === '/api/genres') return json(genresFor(q.get('section')), 200, 86400);
  if (path === '/api/home') return json(await home(q.get('section')), 200, 300);
  if (path === '/api/browse') return json(await browse({kind: q.get('kind'), genre: q.get('genre') || '', sort: q.get('sort') || 'popular', page: int(q.get('page')), q: q.get('q') || '', section: q.get('section')}), 200, 300);
  if (path === '/api/search') return json(await search(q.get('q'), q.get('section')), 200, 300);
  let m = path.match(/^\/api\/title\/(tv|movie|al)\/(\d{1,9})$/);
  if (m) {
    const titleData = await detail(m[1], m[2]);

    // OMDb ile zenginleştir (sadece film/dizi, anime değil)
    if (m[1] !== 'al' && env.OMDB_API_KEY) {
      try {
        if (!titleData.imdb) throw Error('imdb id yok');
        const omdbUrl = `https://www.omdbapi.com/?i=${encodeURIComponent(titleData.imdb)}&apikey=${env.OMDB_API_KEY}&plot=short`;
        const omdbRes = await fetch(omdbUrl, {signal: AbortSignal.timeout(4000), cf: {cacheTtl: 3600, cacheEverything: true}});
        if (omdbRes.ok) {
          const omdb = await omdbRes.json().catch(() => ({}));
          if (omdb.Response === 'True') {
            titleData.ratings = titleData.ratings || [];
            if (omdb.imdbRating && omdb.imdbRating !== 'N/A') titleData.imdbRating = omdb.imdbRating;
            if (omdb.Metascore && omdb.Metascore !== 'N/A') titleData.metascore = omdb.Metascore;
            if (omdb.Ratings) {
              const rt = omdb.Ratings.find(r => r.Source === 'Rotten Tomatoes');
              if (rt) titleData.rottenTomatoes = rt.Value;
            }
            if (omdb.Awards && omdb.Awards !== 'N/A') titleData.awards = omdb.Awards;
            if (omdb.BoxOffice && omdb.BoxOffice !== 'N/A') titleData.boxOffice = omdb.BoxOffice;
          }
        }
      } catch { /* OMDb timeout — orijinal data ile devam */ }
    }

    return json(titleData, 200, 600);
  }
  m = path.match(/^\/api\/episodes\/(tv|movie|al)\/(\d{1,9})$/);
  if (m) return json(await episodes(m[1], m[2], int(q.get('season'))), 200, 600);
  m = path.match(/^\/api\/play\/(tv|movie|al)\/(\d{1,9})$/);
  if (m) {
    const season = int(q.get('s'));
    const episode = int(q.get('e'));
    const alId = /^\d{1,9}$/.test(q.get('alId') || '') ? Number(q.get('alId')) : null;
    const malId = /^\d{1,9}$/.test(q.get('malId') || '') ? Number(q.get('malId')) : null;
    const animeEpisode = /^\d{1,5}$/.test(q.get('aep') || '') ? Number(q.get('aep')) : null;
    const kind = m[1];
    const id = m[2];
    // phase=fast: KV kaynakları + embed adresleri (anında). phase=remote: doğrudan akış bulan servisler.
    const phase = q.get('phase');
    const out = {folder: `${kind}-${id}`, cloud: true};
    if (phase !== 'remote') {
      out.sources = await cloudSources(env, mediaKey(kind, id, season, episode));
      // Türkçe fansub arşivi (anime) en başta; arşive ulaşılamazsa 2,5 sn'de vazgeçilir
      const arcAl = kind === 'al' ? Number(id) : alId;
      const trEmbeds = arcAl ? await fetchTrArchive({index: trArchiveIndex, alId: arcAl, episode: animeEpisode || episode}).catch(() => []) : [];
      out.embeds = [...trEmbeds, ...buildEmbeds(kind, id, alId, season, episode, {brand: (env.VIDRIFT_BRAND || 'LOVELL').slice(0, 28), brandColor: env.VIDRIFT_COLOR || 'e4202b', brandLogo: env.VIDRIFT_LOGO || '', malId, animeEpisode})];
      out.vidrift = out.embeds.find(e => e.id === 'vidrift')?.url || null;
    }
    if (phase !== 'fast') {
      const info = kind === 'al' ? null : await Promise.race([detail(kind, id).catch(() => null), new Promise(r => setTimeout(r, 4000))]);
      const hint = info ? {title: info.title, original: info.original, year: info.year, imdb: info.imdb} : null;
      const remote = await fetchRemoteSources({kind, id, alId, season, episode, hint}, {
        anthologyUrl: env.ANTHOLOGY_SCRAPER_URL,
        vidrockUrl: env.VIDROCK_RESOLVER_URL,
        cineproUrl: env.CINEPRO_URL,
        deadline: /^\d{4,5}$/.test(q.get('budget') || '') ? Math.min(20000, Math.max(2500, Number(q.get('budget')))) : 14000,
        // CloseLoad yalnızca filmlerde; Worker içinde çalışır
        extra: kind === 'movie' ? [{id: 'closeload', run: async () => normalizeSources(await fetchCloseLoad(id, env), 'closeload')}] : [],
      });
      out.sources = [...(out.sources || []), ...remote.sources];
      out.report = remote.report;
      out.timedOut = remote.timedOut;
    }
    return json(out);
  }
  m = path.match(/^\/api\/subs\/(tv|movie)\/(\d{1,9})$/);
  if (m) return json({subtitles: await fetchTurkishSubs({kind: m[1], id: m[2], season: int(q.get('s')), episode: int(q.get('e')), key: env.WYZIE_API_KEY})}, 200, 3600);
  if (path === '/api/library' || path === '/api/rescan') return json({items: []});
  if (path === '/api/img') return image(url);
  return json({error: 'Bilinmeyen uç nokta'}, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) return json({error: 'Desteklenmeyen istek'}, 405);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(url, env);
      } catch (e) {
        return json({error: e.message || 'İstek başarısız', details: e.details}, e.status === 400 ? 400 : 503);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
