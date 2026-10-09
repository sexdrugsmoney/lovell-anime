// LOVELL — Cloudflare Workers sürümü.
// Statik dosyalar (dist/) Workers Static Assets ile, /api/* uçları bu betikle sunulur.
// TMDB ve görseller Cloudflare üzerinden çekildiği için ziyaretçinin DNS'i önemli değildir.
import {configure, browse, search, home, detail, episodes, GENRES, genresFor, dataErrors} from '../lib/catalog-core.js';
import offlineEpisodes from '../src/data/offline-episodes.js';

const ALLOWED_IMG_HOSTS = new Set(['s4.anilist.co', 's3.anilist.co', 'img.anili.st']);

// ---- Embed sağlayıcıları (iframe — kurulum gerektirmez) ----
function buildEmbeds(kind, id, alId, season, episode, opts = {}) {
  const color = (opts.brandColor || 'e4202b').replace('#', '');
  const brand = (opts.brand || 'LOVELL').slice(0, 28);
  const brandLogo = opts.brandLogo || '';
  const list = [];
  const add = (embedId, name, url) => { if (url) list.push({id: embedId, name, url, kind: 'embed', origin: 'embed'}); };

  // VidRift — TMDB (tv/movie)
  if (kind !== 'al') {
    const vBase = kind === 'movie'
      ? `https://embed.vidrift.net/embed/movie/${id}`
      : `https://embed.vidrift.net/embed/tv/${id}/${season}/${episode}`;
    const vp = new URLSearchParams();
    if (brand) vp.set('brand', brand);
    vp.set('brandColor', color);
    if (brandLogo) vp.set('brandLogo', brandLogo);
    vp.set('exit', '1');
    add('vidrift', 'VidRift', `${vBase}?${vp}`);
  }

  // VidPlus — TMDB (tv/movie) + AniList (anime)
  if (kind === 'al' && alId) {
    add('vidplus', 'VidPlus', `https://player.vidplus.to/embed/anime/${alId}/${episode}?primarycolor=${color}&autonext=true&autoplay=true`);
  } else if (kind === 'movie') {
    add('vidplus', 'VidPlus', `https://player.vidplus.to/embed/movie/${id}?primarycolor=${color}&autoplay=true`);
  } else if (kind === 'tv') {
    add('vidplus', 'VidPlus', `https://player.vidplus.to/embed/tv/${id}/${season}/${episode}?primarycolor=${color}&autonext=true&autoplay=true`);
  }

  // Vidy.st — TMDB + AniList, postMessage progress
  if (kind === 'al' && alId) {
    add('vidy', 'Vidy', `https://vidy.st/anime/${alId}/${episode}?color=${color}&episodeSelector=true&autoplayNextEpisode=true`);
  } else if (kind === 'movie') {
    add('vidy', 'Vidy', `https://vidy.st/movie/${id}?color=${color}&autoplay=true`);
  } else if (kind === 'tv') {
    add('vidy', 'Vidy', `https://vidy.st/tv/${id}/${season}/${episode}?color=${color}&nextEpisode=true&episodeSelector=true&autoplayNextEpisode=true`);
  }

  // VidSrc — TMDB
  if (kind !== 'al') {
    const vsBase = kind === 'movie'
      ? `https://vidsrc.buzz/embed/movie/${id}`
      : `https://vidsrc.buzz/embed/tv/${id}/${season}/${episode}`;
    add('vidsrc', 'VidSrc', `${vsBase}?autoplay=true`);
  }

  // VidRock — TMDB
  if (kind !== 'al') {
    const vrBase = kind === 'movie'
      ? `https://vidrock.to/embed/movie/${id}`
      : `https://vidrock.to/embed/tv/${id}/${season}/${episode}`;
    add('vidrock', 'VidRock', vrBase);
  }

  // VidSrc.io — TMDB
  if (kind !== 'al') {
    const vsioBase = kind === 'movie'
      ? `https://vidsrc.io/embed/movie/${id}`
      : `https://vidsrc.io/embed/tv/${id}/${season}/${episode}`;
    add('vidsrcio', 'VidSrc.io', vsioBase);
  }

  // VidSrc.to — TMDB
  if (kind !== 'al') {
    const vstoBase = kind === 'movie'
      ? `https://vidsrc.to/embed/movie/${id}`
      : `https://vidsrc.to/embed/tv/${id}/${season}/${episode}`;
    add('vidsrcto', 'VidSrc.to', vstoBase);
  }

  // VidSrc.mov — TMDB
  if (kind !== 'al') {
    const vsmovBase = kind === 'movie'
      ? `https://vidsrc.mov/embed/movie/${id}`
      : `https://vidsrc.mov/embed/tv/${id}/${season}/${episode}`;
    add('vidsrcmov', 'VidSrc.mov', vsmovBase);
  }

  // VidLink — TMDB
  if (kind !== 'al') {
    const vlBase = kind === 'movie'
      ? `https://vidlink.pro/movie/${id}`
      : `https://vidlink.pro/tv/${id}/${season}/${episode}`;
    const vlp = new URLSearchParams();
    vlp.set('primaryColor', color);
    vlp.set('title', 'true');
    if (kind === 'tv') vlp.set('nextbutton', 'true');
    add('vidlink', 'VidLink', `${vlBase}?${vlp}`);
  }

  // MegaPlay — AniList (anime)
  if (alId) add('megaplay', 'MegaPlay', `https://megaplay.buzz/stream/ani/${alId}/${episode}/sub`);

  // VidHawk — AniList (anime)
  if (kind === 'al' && alId) {
    add('vidhawk', 'VidHawk', `https://vidhawk.buzz/embed/ani/${alId}/${episode}/sub?server=flow&autoskipIntro=1&autoskipOutro=1`);
  }

  // JustPlay — AniList (anime)
  if (kind === 'al' && alId) {
    add('justplay', 'JustPlay', `https://justplay.boo/?ani=${alId}&ep=${episode}&lang=sub&autoskip=1`);
  }

  // AniEmbed — AniList (anime)
  if (kind === 'al' && alId) {
    add('aniembed', 'AniEmbed', `https://aniembed.se/e/${alId}/${episode}`);
  }

  // YapGrid — reklamsız, altyazı çevirisi destekli
  if (kind !== 'al') {
    const ygBase = kind === 'movie'
      ? `https://yapgrid.com/embed/movie/${id}`
      : `https://yapgrid.com/embed/tv/${id}/${season}/${episode}`;
    add('yapgrid', 'YapGrid', `${ygBase}?autoplay=1`);
  }

  // StreamFlizo — film/dizi/anime, TMDB ID
  if (kind !== 'al') {
    const sfBase = kind === 'movie'
      ? `https://streamflizoapi.top/stream/tmdb/${id}/multi`
      : `https://streamflizoapi.top/stream/tmdb/${id}/${season}/${episode}/multi`;
    add('streamflizo', 'StreamFlizo', sfBase);
  }

  return list;
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
  if (path === '/api/status') return json({mode: 'cloud', tmdb: authProblem ? 'anahtar geçersiz' : lastOk ? 'bağlı' : 'henüz denenmedi', authProblem, lastSuccess: lastOk, auth: env.TMDB_READ_TOKEN ? 'okuma jetonu (v4)' : env.TMDB_API_KEY ? 'API anahtarı' : 'yok', dataErrors, library: 0});
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
        const omdbUrl = `https://www.omdbapi.com/?i=${titleData.imdbId || ''}&tmdbId=${m[2]}&type=${m[1] === 'movie' ? 'movie' : 'series'}&apikey=${env.OMDB_API_KEY}&plot=short`;
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
    const alId = q.get('alId') ? Number(q.get('alId')) : null;
    const kind = m[1];
    const id = m[2];

    // KV / MEDIA_SOURCES_JSON / MEDIA_SOURCE_API'den yerel kaynaklar
    const sources = await cloudSources(env, mediaKey(kind, id, season, episode));

    // Embed sağlayıcıları — iframe tabanlı, kurulum gerektirmez
    const brandColor = (env.VIDRIFT_COLOR || 'e4202b').replace('#', '');
    const brand = (env.VIDRIFT_BRAND || 'LOVELL').slice(0, 28);
    const brandLogo = env.VIDRIFT_LOGO || '';
    const embeds = buildEmbeds(kind, id, alId, season, episode, {brand, brandColor, brandLogo});
    const vidrift = embeds.find(e => e.id === 'vidrift')?.url || null;

    // VidRock Resolver — VIDROCK_RESOLVER_URL varsa HLS kaynağını çek
    let vidRockSources = [];
    if (env.VIDROCK_RESOLVER_URL && kind !== 'al') {
      try {
        const vrParams = new URLSearchParams({type: kind, id, season: String(season), episode: String(episode)});
        const vrRes = await fetch(`${env.VIDROCK_RESOLVER_URL}/api/resolve?${vrParams}`, {
          signal: AbortSignal.timeout(25000),
          headers: {Accept: 'application/json'},
        });
        if (vrRes.ok) {
          const vrData = await vrRes.json().catch(() => ({}));
          const vrStreams = vrData.sources || vrData.streams || [];
          vidRockSources = vrStreams.filter(s => {
            try { const u = new URL(s?.url); return u.protocol === 'https:'; } catch { return false; }
          }).map(s => ({
            name: `VidRock · ${s.server || s.quality || 'HLS'}`,
            origin: 'vidrock-resolved',
            url: s.url,
            type: s.type === 'hls' || /\.m3u8/i.test(s.url) ? 'hls' : 'mp4',
            subtitles: [],
          }));
        }
      } catch { /* resolver timeout — embed ile devam */ }
    }

    return json({sources: [...sources, ...vidRockSources], embeds, vidrift, folder: `${kind}-${id}`, cloud: true});
  }
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
