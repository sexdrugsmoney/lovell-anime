import express from 'express';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import crypto from 'node:crypto';

const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY || '500330721680edb6d5f7f12ba7cd9023';
const MIN = 60 * 1000;

// ---- Simple LRU cache (girdi başına özel süre desteklenir) ----
class LRUCache {
  constructor(max = 500, ttl = 3600000) {
    this.max = max;
    this.ttl = ttl;
    this.store = new Map();
  }
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) { this.store.delete(key); return null; }
    // Move to end (LRU)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }
  set(key, value, ttl = this.ttl) {
    if (this.store.has(key)) this.store.delete(key);
    else if (this.store.size >= this.max) this.store.delete(this.store.keys().next().value);
    this.store.set(key, { value, expires: Date.now() + ttl });
  }
}

const cache = new LRUCache(1000, 3600 * 1000);
const tmdbCache = new LRUCache(500, 24 * 3600 * 1000);

// Başarısız sorgular 3 dakika boyunca önbellekte tutulur: aynı bölüm için her tıklamada
// 10 saniyelik zaman aşımlarını yeniden beklemeyiz. Başarılı sonuçlar 1 saat kalır.
function fail(res, cacheKey, e) {
  const result = { sources: [], error: String(e?.message || e) };
  if (cacheKey) cache.set(cacheKey, result, 3 * MIN);
  return res.json(result);
}

// ---- CORS + JSON ----
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// ---- Health ----
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'anthology-scraper', uptime: Math.round(process.uptime()), cache: cache.store.size, scrapers: ['animecix', 'sonanime', 'diziyou', 'stremio', 'anizium', 'hdfilmcehennemi', 'sinewix', 'dizimom', 'closeload', 'webteizle', 'lovefilmizle', 'filmizlebabam', 'filmmakinesi', 'ddizi', 'diziwatch', 'diziyou'] });
});

// ---- TMDB ----
// Türkiye'deki bazı ağlar api.themoviedb.org'u engelliyor. Çağıran (LOVELL) başlığı zaten bildiği
// için ?title=&original=&year=&imdb= ile gönderebilir; bu durumda TMDB'ye hiç gitmeyiz.
// Gönderilmediyse iki resmî adres sırayla denenir ve sonuç 24 saat önbelleğe alınır.
const HINTS = new Map(); // "tv:94605" -> {title, original, year, imdb}
function setHint(kind, id, q) {
  const title = String(q.title || '').slice(0, 200), original = String(q.original || '').slice(0, 200);
  if (!title && !original) return;
  if (HINTS.size > 2000) HINTS.delete(HINTS.keys().next().value);
  HINTS.set(`${kind}:${id}`, { title, original, year: /^\d{4}$/.test(q.year || '') ? q.year : '', imdb: /^tt\d{5,10}$/.test(q.imdb || '') ? q.imdb : '' });
}
function fromHint(kind, h) {
  const date = h.year ? `${h.year}-01-01` : '';
  const ext = { imdb_id: h.imdb || undefined };
  return kind === 'movie'
    ? { title: h.title || h.original, original_title: h.original || h.title, release_date: date, imdb_id: h.imdb || undefined, external_ids: ext }
    : { name: h.title || h.original, original_name: h.original || h.title, first_air_date: date, external_ids: ext };
}
async function tmdbFetch(kind, id, external) {
  const key = `${kind}:${id}:${external ? 'x' : ''}`;
  const hit = tmdbCache.get(key);
  if (hit) return hit;
  let lastErr;
  for (const host of ['api.themoviedb.org', 'api.tmdb.org']) {
    try {
      const url = `https://${host}/3/${kind}/${id}?api_key=${TMDB_KEY}&language=tr-TR${external ? '&append_to_response=external_ids' : ''}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
      const data = await res.json();
      tmdbCache.set(key, data);
      return data;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
async function tmdbDetail(kind, id, external) {
  const h = HINTS.get(`${kind}:${id}`);
  const enough = h && (h.title || h.original) && (!external || h.imdb);
  if (enough) return fromHint(kind, h);
  try { return await tmdbFetch(kind, id, external); }
  catch (e) { if (h && (h.title || h.original)) return fromHint(kind, h); throw e; }
}
const tmdbTv = id => tmdbDetail('tv', id, false);
const tmdbMovie = id => tmdbDetail('movie', id, false);
const tmdbTvWithExternal = id => tmdbDetail('tv', id, true);
const tmdbMovieWithExternal = id => tmdbDetail('movie', id, true);

// /api/* isteklerinde gelen başlık ipuçlarını kaydet (tmdbId + type ile eşlenir).
app.use('/api', (req, _res, next) => {
  const q = req.query;
  if (q.tmdbId && /^\d{1,9}$/.test(String(q.tmdbId)) && (q.title || q.original)) {
    const kind = q.type === 'movie' || /^\/(hdfilmcehennemi|closeload)/.test(req.path) ? 'movie' : 'tv';
    setHint(kind, q.tmdbId, q);
  }
  next();
});

// ---- Eşleştirme ----
// Sitelerin arama sonuçlarında ilk kaydı körü körüne almak yanlış diziyi oynatır. Önce TMDB id'si,
// sonra başlık (ve yıl) uyumu aranır; güvenilir eşleşme yoksa null döner.
const norm = s => String(s || '').toLowerCase().replace(/ı/g, 'i').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function titlesOf(item) {
  return [item.name, item.title, item.original_name, item.original_title, item.title_english, item.name_english, item.name_romanji, item.english, item.romaji, item.title_romaji, item.slug && String(item.slug).replace(/-/g, ' ')].filter(Boolean).map(norm).filter(Boolean);
}
function yearOf(item) {
  const v = item.year || item.release_date || item.first_air_date || item.start_date || item.release_year || '';
  const m = String(v).match(/\d{4}/);
  return m ? Number(m[0]) : null;
}
function pickMatch(list, tmdbId, names, year) {
  const items = (Array.isArray(list) ? list : []).filter(x => x && typeof x === 'object');
  if (!items.length) return null;
  const byId = items.find(t => [t.tmdb_id, t.tmdbId, t.tmdb].some(v => v && String(v) === String(tmdbId)));
  if (byId) return byId;
  const want = names.map(norm).filter(Boolean);
  // Sonuçlarda hiç başlık alanı yoksa doğrulayamayız; eski davranışı (ilk kayıt) koru.
  if (!items.some(i => titlesOf(i).length)) return items[0];
  let best = null, bestScore = 0;
  for (const it of items) {
    const have = titlesOf(it);
    let score = 0;
    for (const w of want) for (const h of have) {
      if (h === w) score = Math.max(score, 3);
      else if (w.length >= 4 && h.length >= 4 && (h.includes(w) || w.includes(h))) score = Math.max(score, 2);
    }
    // Ortak anlamlı kelime (en az 3 harf) varsa zayıf eşleşme say
    if (!score) {
      const wt = new Set(want.flatMap(w => w.split(' ')).filter(t => t.length >= 3));
      if (have.some(h => h.split(' ').some(t => wt.has(t)))) score = 1;
    }
    const y = yearOf(it);
    if (score && year && y && Math.abs(y - year) > 1) score = 0;
    it.__score = score;
    if (score > bestScore) { best = it; bestScore = score; }
  }
  // Güçlü eşleşme varsa onu, yoksa sitenin ilk sonucunu (yalnızca zayıf da olsa uyumluysa) kullan.
  if (bestScore >= 2) return best;
  return items[0].__score >= 1 ? items[0] : null;
}
const yearNum = tmdb => Number(String(tmdb?.first_air_date || tmdb?.release_date || '').slice(0, 4)) || null;
const nameList = tmdb => [tmdb?.name, tmdb?.original_name, tmdb?.title, tmdb?.original_title];

// Doğrudan MP4 bağlantılarının çalışıp çalışmadığını 1 baytlık aralık isteğiyle sınar;
// ölü olanları (ör. silinmiş 480p dosyası) listeden çıkarır, kalanları yüksek kaliteden sıralar.
const qualityNum = q => Number(String(q || '').match(/\d{3,4}/)?.[0]) || 0;
async function liveOnly(list) {
  const ok = await Promise.all(list.map(async s => {
    if (s.type === 'hls') return true;
    try {
      const r = await fetch(s.url, { headers: { Range: 'bytes=0-0', 'User-Agent': UA_DESKTOP }, signal: AbortSignal.timeout(5000) });
      const good = (r.status === 200 || r.status === 206) && !/json|html/i.test(r.headers.get('content-type') || '');
      try { r.body?.destroy?.(); } catch {}
      return good;
    } catch { return false; }
  }));
  return list.filter((_, i) => ok[i]).sort((a, b) => qualityNum(b.quality) - qualityNum(a.quality));
}

// ---- Referer gerektiren akışlar için güvenli geçit ----
// Bazı akışlar (ör. VidMoly) yalnızca belirli bir Referer ile açılır; tarayıcı bu başlığı gönderemez.
// Bu yüzden yalnızca BU SERVİSİN kendi verdiği adresler (kısa ömürlü jeton) sunucu üzerinden aktarılır;
// herhangi bir adresi açan bir vekil değildir.
const PROXY = new LRUCache(6000, 4 * 3600 * 1000);
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
function proxyToken(url, referer, vtt) {
  const token = crypto.randomBytes(12).toString('base64url');
  PROXY.set(token, vtt ? { url, referer, vtt } : { url, referer });
  return token;
}
const publicBase = req => `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;
function rewritePlaylist(text, baseUrl, referer, base) {
  const wrap = ref => { try { const abs = new URL(ref, baseUrl).href; return /^https:/.test(abs) ? `${base}/proxy/${proxyToken(abs, referer)}` : ref; } catch { return ref; } };
  return text.split(/\r?\n/).map(line => {
    if (!line) return line;
    if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${wrap(u)}"`);
    return wrap(line.trim());
  }).join('\n');
}
app.get('/proxy/:token', async (req, res) => {
  const entry = PROXY.get(req.params.token);
  if (!entry) return res.status(404).json({ error: 'Bağlantının süresi dolmuş' });
  try {
    const headers = { 'User-Agent': UA_DESKTOP, Referer: entry.referer, Accept: '*/*' };
    if (req.headers.range) headers.Range = req.headers.range;
    const up = await fetch(entry.url, { headers, signal: AbortSignal.timeout(30000) });
    const type = up.headers.get('content-type') || '';
    if (/mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(entry.url)) {
      const body = rewritePlaylist(await up.text(), up.url || entry.url, entry.referer, publicBase(req));
      res.status(up.status).set('Content-Type', 'application/vnd.apple.mpegurl').set('Cache-Control', 'no-store').send(body);
      return;
    }
    res.status(up.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(h); if (v) res.setHeader(h, v); }
    if (entry.vtt) res.setHeader('Content-Type', 'text/vtt; charset=utf-8'); // altyazı dosyaları .html uzantısıyla gelebiliyor
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (!up.body) return res.end();
    up.body.on('error', () => res.destroy()).pipe(res);
  } catch (e) {
    res.status(502).json({ error: 'Kaynağa ulaşılamadı' });
  }
});

// ---- VidMoly extractor ----
async function extractVidMoly(embedUrl, referer) {
  const normalizedUrl = embedUrl
    .replace('//vidmoly.to/', '//vidmoly.biz/')
    .replace('//vidmoly.net/', '//vidmoly.biz/')
    .replace('//vidmoly.com/', '//vidmoly.biz/');

  const res = await fetch(normalizedUrl, {
    signal: AbortSignal.timeout(10000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': referer || 'https://webteizle.info/',
    },
  });
  if (!res.ok) return null;
  const html = await res.text();

  // Pattern 1: file: "https://...m3u8"
  const m1 = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
  if (m1) return { url: m1[1], referer: 'https://vidmoly.biz/' };

  // Pattern 2: sources:[{file:"..."}]
  const m2 = html.match(/sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+)["']/i);
  if (m2) return { url: m2[1], referer: 'https://vidmoly.biz/' };

  return null;
}

// ---- Pixeldrain extractor ----
function extractPixeldrain(html) {
  const m = html.match(/pixeldrain\.com\/(?:u|l)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  return `https://pixeldrain.com/api/file/${m[1]}`;
}

// ---- Turkish slug helper ----
function toSlug(text) {
  return text
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---- AnimeciX ----
app.get('/api/animecix', async (req, res) => {
  const { tmdbId, season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  const cacheKey = `animecix:${tmdbId}:${season}:${episode}`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);

  try {
    // 1. TMDB'den anime adı al
    const tmdb = await tmdbTv(tmdbId);
    const name = tmdb.name || tmdb.original_name;
    if (!name) throw new Error('TMDB başlık bulunamadı');

    // 2. AnimeciX arama
    const searchUrl = `https://animecix.tv/secure/search/${encodeURIComponent(name)}?limit=10`;
    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'x-e-h': '7Y2ozlO+QysR5w9Q6Tupmtvl9jJp7ThFH8SB+Lo7NvZjgjqRSqOgcT2v4ISM9sP10LmnlYI8WQ==.xrlyOBFS5BHjQ2Lk',
        'Referer': 'https://animecix.tv/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    if (!searchRes.ok) throw new Error(`AnimeciX arama HTTP ${searchRes.status}`);
    const searchData = await searchRes.json();
    const titles = searchData.results || searchData.titles || searchData || [];

    // 3. TMDB ID eşleşmesi bul
    const match = pickMatch(titles, tmdbId, nameList(tmdb), yearNum(tmdb));
    if (!match) throw new Error('AnimeciX eşleşme bulunamadı');

    const titleId = match.id || match.title_id;

    // 4. Best video endpoint
    const bestUrl = `https://animecix.tv/secure/best-video?titleId=${titleId}&episode=${episode}&season=${season}`;
    const bestRes = await fetch(bestUrl, {
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
      headers: {
        'x-e-h': '7Y2ozlO+QysR5w9Q6Tupmtvl9jJp7ThFH8SB+Lo7NvZjgjqRSqOgcT2v4ISM9sP10LmnlYI8WQ==.xrlyOBFS5BHjQ2Lk',
        'Referer': 'https://animecix.tv/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    // 5. TauVideo ID çıkar
    const finalUrl = bestRes.url || '';
    const tauMatch = finalUrl.match(/tau-video\.xyz\/embed\/([a-zA-Z0-9_-]+)/);
    if (!tauMatch) {
      // Response JSON olabilir
      const bestData = await bestRes.json().catch(() => ({}));
      const directUrl = bestData.url || bestData.stream || bestData.hls;
      if (directUrl) {
        const result = { sources: [{ url: directUrl, quality: 'HD', name: 'AnimeciX', type: /\.m3u8/i.test(directUrl) ? 'hls' : 'mp4' }] };
        cache.set(cacheKey, result);
        return res.json(result);
      }
      throw new Error('TauVideo ID bulunamadı');
    }

    const tauId = tauMatch[1];

    // 6. TauVideo API
    const tauRes = await fetch(`https://tau-video.xyz/api/video/${tauId}`, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'Referer': 'https://animecix.tv/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    if (!tauRes.ok) throw new Error(`TauVideo HTTP ${tauRes.status}`);
    const tauData = await tauRes.json();
    // TauVideo artık {urls:[{label,url,size}]} döndürüyor (eski biçim: sources / streams).
    const streams = tauData.urls || tauData.sources || tauData.streams || [];
    const sources = await liveOnly(streams
      .filter(s => s?.url && s.url.startsWith('http'))
      .map(s => ({
        url: s.url,
        quality: s.label || s.quality || 'HD',
        name: 'AnimeciX',
        lang: 'tr',
        type: s.type === 'hls' || /\.m3u8/i.test(s.url) ? 'hls' : 'mp4',
      })));

    const result = { sources };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    fail(res, cacheKey, e);
  }
});

// ---- Anizium ----
app.get('/api/anizium', async (req, res) => {
  const { tmdbId, season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  const cacheKey = `anizium:${tmdbId}:${season}:${episode}`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);

  try {
    // 1. TMDB'den ad al
    const tmdb = await tmdbTv(tmdbId);
    const name = tmdb.name || tmdb.original_name;

    // 2. Anizium arama
    const searchRes = await fetch(`https://api.anizium.co/api/animes?search=${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Referer': 'https://anizium.co/', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!searchRes.ok) throw new Error(`Anizium arama HTTP ${searchRes.status}`);
    const searchData = await searchRes.json();
    const animes = searchData.data || searchData.results || searchData;

    // 3. TMDB ID eşleştir
    const match = pickMatch(animes, tmdbId, nameList(tmdb), yearNum(tmdb));
    if (!match) throw new Error('Anizium eşleşme bulunamadı');

    const aniziumId = match.id || match.anime_id;

    // 4. Episodes
    const epRes = await fetch(
      `https://api.anizium.co/api/animes/${aniziumId}/seasons/${season}/episodes/${episode}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { 'Referer': 'https://anizium.co/', 'User-Agent': 'Mozilla/5.0' },
      }
    );
    if (!epRes.ok) throw new Error(`Anizium episode HTTP ${epRes.status}`);
    const epData = await epRes.json();

    // 5. Sources
    const rawSources = epData.episode?.sources || epData.sources || epData.data?.sources || [];
    const sources = (Array.isArray(rawSources) ? rawSources : [])
      .filter(s => s?.url && s.url.startsWith('http'))
      .map(s => ({
        url: s.url,
        quality: s.quality || s.label || 'HD',
        name: 'Anizium',
        type: /\.m3u8/i.test(s.url) ? 'hls' : 'mp4',
      }));

    const result = { sources };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    fail(res, cacheKey, e);
  }
});

// ---- SonAnime ----
// Herkese açık API: arama sonuçları TMDB ve MAL id'si taşır, bölümler doğrudan MP4 (CORS açık, Referer gerekmez).
const SONANIME_API = 'https://api.sonanime.com/api';
const SONANIME_HEADERS = { Referer: 'https://sonanime.com/', Origin: 'https://sonanime.com', Accept: 'application/json', 'User-Agent': UA_DESKTOP };
app.get('/api/sonanime', async (req, res) => {
  const { tmdbId, type = 'tv', season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  const cacheKey = `sonanime:${type}:${tmdbId}:${season}:${episode}`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);
  try {
    const tmdb = type === 'movie' ? await tmdbMovie(tmdbId) : await tmdbTv(tmdbId);
    const names = [...new Set(nameList(tmdb).filter(Boolean))];
    let found = [];
    for (const n of names.slice(0, 3)) {
      const r = await fetch(`${SONANIME_API}/anime/search?q=${encodeURIComponent(n)}`, { headers: SONANIME_HEADERS, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`SonAnime arama HTTP ${r.status}`);
      const list = await r.json();
      found = Array.isArray(list) ? list : (list.data || []);
      if (found.some(a => String(a.tmdb_id) === String(tmdbId))) break;
    }
    const match = found.find(a => String(a.tmdb_id) === String(tmdbId))
      || pickMatch(found.map(a => ({ ...a, name: a.anime_name, title: a.anime_name_en, year: a.anime_year })), tmdbId, names, yearNum(tmdb));
    if (!match) throw new Error('SonAnime eşleşme bulunamadı');
    const r = await fetch(`${SONANIME_API}/anime/link/${encodeURIComponent(match.anime_link)}`, { headers: SONANIME_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`SonAnime bölüm HTTP ${r.status}`);
    const d = await r.json();
    const eps = Array.isArray(d.episodes) ? d.episodes : [];
    const ep = type === 'movie'
      ? eps[0]
      : eps.find(e => Number(e.anime_season) === Number(season) && Number(e.episode_number) === Number(episode))
        // TMDB tek sezon, site ayrı sezonlar tutuyorsa mutlak bölüm numarasıyla dene
        || (Number(season) === 1 ? eps.filter(e => e.episode_number != null).sort((a, b) => a.anime_season - b.anime_season || a.episode_number - b.episode_number)[Number(episode) - 1] : null);
    if (!ep) throw new Error('SonAnime bölüm bulunamadı');
    const sources = await liveOnly(['1080', '720', '480', '360']
      .map(q => ep[`episode_link_${q}`] ? { url: ep[`episode_link_${q}`], quality: `${q}p`, name: 'SonAnime', lang: 'tr', type: 'mp4' } : null)
      .filter(Boolean)
      .slice(0, 3));
    const result = { sources };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    fail(res, cacheKey, e);
  }
});

// ---- HDFilmCehennemi ----
app.get('/api/hdfilmcehennemi', async (req, res) => {
  const { tmdbId } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  const cacheKey = `hdfilmcehennemi:${tmdbId}`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);

  try {
    // 1. TMDB film adı + yılı
    const tmdb = await tmdbMovie(tmdbId);
    const name = tmdb.title || tmdb.original_title;
    const year = tmdb.release_date ? tmdb.release_date.slice(0, 4) : '';

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';

    // 2. HDFilmCehennemi arama
    const searchRes = await fetch(
      `https://www.hdfilmcehennemi.nl/?s=${encodeURIComponent(name)}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': UA,
          'Referer': 'https://www.hdfilmcehennemi.nl/',
          'Accept-Language': 'tr-TR,tr;q=0.9',
        },
      }
    );
    if (!searchRes.ok) throw new Error(`HDFilmCehennemi arama HTTP ${searchRes.status}`);
    const searchHtml = await searchRes.text();

    // 3. cheerio ile ilk sonucu parse et
    const $ = cheerio.load(searchHtml);
    const firstLink = $('.film-list .film-item a, .movies .movie a, article a, .result a').first().attr('href');
    if (!firstLink) throw new Error('HDFilmCehennemi sonuç bulunamadı');

    // 4. Film sayfasını çek
    const filmRes = await fetch(firstLink, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': UA, 'Referer': 'https://www.hdfilmcehennemi.nl/' },
    });
    if (!filmRes.ok) throw new Error(`Film sayfası HTTP ${filmRes.status}`);
    const filmHtml = await filmRes.text();
    const $f = cheerio.load(filmHtml);

    // 5. iframe/player URL bul
    const iframeSrc = $f('iframe[src*="closeload"], iframe[src*="embed"], iframe[src*="player"]').first().attr('src');
    if (!iframeSrc) throw new Error('Embed iframe bulunamadı');

    // CloseLoad pattern: iframe → JSON api → m3u8
    let m3u8Url = null;
    if (iframeSrc.includes('closeload') || iframeSrc.includes('embed')) {
      const embedRes = await fetch(iframeSrc, {
        signal: AbortSignal.timeout(10000),
        headers: { 'Referer': firstLink, 'User-Agent': UA },
      });
      const embedHtml = await embedRes.text();
      const m3u8Match = embedHtml.match(/["'](https?:\/\/[^"']*\.m3u8[^"']*)['"]/);
      if (m3u8Match) m3u8Url = m3u8Match[1];
    }

    if (!m3u8Url) throw new Error('m3u8 stream bulunamadı');

    const result = { sources: [{ url: m3u8Url, quality: 'HD', name: 'HDFilmCehennemi', type: 'hls' }] };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    fail(res, cacheKey, e);
  }
});

// ---- SineWix ----
const SINEWIX_HEADERS = {
  'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b',
  'signature': '3082058830820370a00302010202145bbfbba9791db758ad12295636e094ab4b07dc24300d06092a864886f70d01010b05003074310b3009060355040613025553311330110603550408130a43616c69666f726e6961311630140603550407130d4d6f756e7461696e205669657731143012060355040a130b476f6f676c6520496e632e3110300e060355040b1307416e64726f69643110300e06035504031307416e64726f696430820222300d06092a864886f70d01010105000382020f003082020a0282020100a5106a24bb3f9c0aaf3a2b228f794b5eaf1757ba758b19736a39d1bdc73fc983a7237b8d5ca5156cfa999c1dab3418bbc2be0920e0ee001c8aa4812d1dae75d080f09e91e0abda83ff9a76e8384a4429f4849248069a59505b12ac2c14ba2e4d1a13afcdaf54e508697ff928a9f738e6f4a6fc27409c55329eb149b5ff89c5a2d7c06bf9e62086f955cad17d7be2623ee9d5ec56068eadc23cb0965a13ff97d49fe10ef41afc6eeca36b4ace9582097faff89f590bc831cdb3a69eec5d15b67c3f2cad49e37ed053733e3d2d400c47755b932bdbe15d749fd6ad1dce30ba5e66094dfb6ee6f64cafb807e11b19a990c5d078c6d6701cda0bdeb21e99404ff166074f4c89b04c418f4e7940db5c78647c475bcfb85d4c4e836ee7d7c1d53e9e736b5d96d4b4d8b98209064b729ac6a682d55a6a930e518d849898bb28329ca0aaa133b5e5270a9d5940cac6af4802a57fd971efda91abb602882dd6aa6ce2b236b57b52ee2481498f0cacbcc2c36c238bc84becad7eaaf1125b9a1ca9ded6c79f3f283a52050377809b2a9995d66e1636b0ed426fdd8685c47cb18e82077f4aefcc07887e1dc58b4d64be1632f0e7b4625da6f40c65a8512a6454a4b96963e7f876136e6c0069a519a79ad632078ed965aa12482458060c030ed50db706d854f88cb004630b49285d8af8b471ff8f6070687826412287b50049bcb7d1b6b62ef90203010001a310300e300c0603551d13040530030101ff300d06092a864886f70d01010b0500038202010051c0b7bd793181dc29ca777d3773f928a366c8469ecf2fa3cfb076e8831970d19bb2b96e44e8ccc647cf0696bb824ac61c23d958525d283cab26037b04d58aa79bf92192db843adf5c26a980f081d2f0e14f759fc5ff4c5bb3dce0860299bfe7b349a8155a2efaf731ba25ce796a80c1442c7bf80f8c1a7912ff0b6f6592264315337251a846460194fa594f81f38f9e5233a63201e931ad9cab5bf119f24025613f307194eaa6eb39a83f3c05a49ba34455b1aff7c6839bbb657d9392ffdf397432af6e56ba9534a8b07d7060fe09691c6cf07cb5324f67b3cc0871a8c621d81fe71d71085c55206a4f57e25f774fd4b979b299e8bb076b50fca42fa57da2d519fd35a4a7c0137babaed4345f8031b63b6a71f5e8268f709d658ccd7c2a58849379d25bfa598c3f4a2c3d9b7d89285fefeb7f0ec65137d38b08ce432a15688b624a179e6a4a505ebc3bcdfbc4d4330508ee2d8d0f016924dcec21a6838ef7d834c6f43bde4a5201ed0b3bb4e9bd377b470e36bcf5bc3d56169dbd8e39567aa7dce4d1a8a8a54a5e1aa6fb1a8aab0062669a966f96e15ccce6fe12ea5e6a8b8c8823bdc94988ca39759fd1cc8fd8ae5c3d74db50b174cf7d77655016c075c91d439ed01cc0a9f695c99fad3b5495fb6cb1e01a5fa020cc6022a85c07ec55f9eba89719f86e49d34ab5bd208c5f70cced2b7b7963c014f8404432979b506de29e',
  'User-Agent': 'EasyPlex (Android 14; SM-A546B; Samsung Galaxy A54 5G; tr)',
  'Accept': 'application/json',
};
const SINEWIX_KEY = '9iQNC5HQwPlaFuJDkhncJ5XTJ8feGXOJatAA';
const SINEWIX_BASE = 'https://ydfvfdizipanel.ru/public/api';

async function resolveMediafire(mfUrl) {
  const r = await fetch(mfUrl, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await r.text();
  const m = html.match(/href="(https:\/\/download\d+\.mediafire\.com[^"]+)"/);
  return m ? m[1] : mfUrl;
}

async function sinewixSearch(query) {
  const url = `${SINEWIX_BASE}/search/${encodeURIComponent(query)}/${SINEWIX_KEY}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000), headers: SINEWIX_HEADERS });
  if (!r.ok) throw new Error(`SineWix arama HTTP ${r.status}`);
  const data = await r.json();
  return data.movies || data.results || data.data || [];
}

app.get('/api/sinewix', async (req, res) => {
  const { tmdbId, type = 'movie', season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  const cacheKey = `sinewix:${tmdbId}:${type}:${season}:${episode}`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);

  try {
    // 1. TMDB'den başlık al (TR + orijinal)
    let tmdb;
    if (type === 'movie') {
      tmdb = await tmdbMovieWithExternal(tmdbId);
    } else {
      tmdb = await tmdbTvWithExternal(tmdbId);
    }
    const trTitle = tmdb.title || tmdb.name;
    const origTitle = tmdb.original_title || tmdb.original_name;
    if (!trTitle && !origTitle) throw new Error('TMDB başlık bulunamadı');

    // 2. SineWix'te ara — önce TR, yoksa orijinal
    let results = [];
    if (trTitle) {
      results = await sinewixSearch(trTitle);
    }
    if (results.length === 0 && origTitle && origTitle !== trTitle) {
      results = await sinewixSearch(origTitle);
    }
    if (results.length === 0) throw new Error('SineWix sonuç bulunamadı');

    // 3. TMDB ID eşleşmesi
    const match = pickMatch(results, tmdbId, nameList(tmdb), yearNum(tmdb));
    if (!match) throw new Error('SineWix eşleşme bulunamadı');
    const id = match.id || match.movie_id || match.series_id;
    if (!id) throw new Error('SineWix ID bulunamadı');

    let sources = [];

    if (type === 'movie') {
      // 4a. Film detayı
      const detailUrl = `${SINEWIX_BASE}/media/detail/${id}/${SINEWIX_KEY}`;
      const detailRes = await fetch(detailUrl, { signal: AbortSignal.timeout(10000), headers: SINEWIX_HEADERS });
      if (!detailRes.ok) throw new Error(`SineWix detail HTTP ${detailRes.status}`);
      const detailData = await detailRes.json();
      const videos = detailData.videos || detailData.data?.videos || [];

      for (const v of (Array.isArray(videos) ? videos : [])) {
        let link = v.link || v.url;
        if (!link) continue;
        if (link.includes('mediafire.com')) {
          link = await resolveMediafire(link).catch(() => link);
        }
        sources.push({
          url: link,
          quality: v.quality || '1080p',
          name: 'SineWix (TR Dublaj)',
          type: 'mkv',
          lang: 'tr-dub',
        });
      }
    } else {
      // 4b. Dizi detayı
      const seriesUrl = `${SINEWIX_BASE}/series/show/${id}/${SINEWIX_KEY}`;
      const seriesRes = await fetch(seriesUrl, { signal: AbortSignal.timeout(10000), headers: SINEWIX_HEADERS });
      if (!seriesRes.ok) throw new Error(`SineWix series HTTP ${seriesRes.status}`);
      const seriesData = await seriesRes.json();

      let seasons = seriesData.seasons || seriesData.data?.seasons || [];
      // seasons nesne ise diziye çevir
      if (!Array.isArray(seasons)) seasons = Object.values(seasons);

      const seasonNum = parseInt(season, 10);
      const episodeNum = parseInt(episode, 10);

      // Sezon bul — index veya season_number ile
      const seasonData = seasons[seasonNum - 1]
        || seasons.find(s => String(s.season_number || s.number) === String(seasonNum));
      if (!seasonData) throw new Error('SineWix sezon bulunamadı');

      let episodes = seasonData.episodes || [];
      if (!Array.isArray(episodes)) episodes = Object.values(episodes);

      const episodeData = episodes[episodeNum - 1]
        || episodes.find(e => String(e.episode_number || e.number) === String(episodeNum));
      if (!episodeData) throw new Error('SineWix bölüm bulunamadı');

      let videos = episodeData.videos || [];
      if (!Array.isArray(videos)) videos = Object.values(videos);

      for (const v of videos) {
        let link = v.link || v.url;
        if (!link) continue;
        if (link.includes('mediafire.com')) {
          link = await resolveMediafire(link).catch(() => link);
        }
        sources.push({
          url: link,
          quality: v.quality || '1080p',
          name: 'SineWix (TR Dublaj)',
          type: 'mkv',
          lang: 'tr-dub',
        });
      }
    }

    const result = { sources };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    fail(res, cacheKey, e);
  }
});

// ---- DiziMom ----
const DIZIMOM_BASE = process.env.DIZIMOM_BASE || 'https://www.dizimom.cafe'; // alan adı değişirse yalnızca burayı güncelle
const DIZIMOM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';

app.get('/api/dizimom', async (req, res) => {
  const { tmdbId, season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  const cacheKey = `dizimom:${tmdbId}:${season}:${episode}`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);

  try {
    // 1. TMDB'den dizi adı al (TR)
    const tmdb = await tmdbTv(tmdbId);
    const name = tmdb.name || tmdb.original_name;
    if (!name) throw new Error('TMDB başlık bulunamadı');

    const names = [...new Set(nameList(tmdb).filter(Boolean))];
    const get = (url, referer) => fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': DIZIMOM_UA, 'Referer': referer || `${DIZIMOM_BASE}/` } });

    // 2. Arama — dizi sayfaları "/diziler/{n}-{ad}-izle-hd/" ve "/diziler/{ad}-turkce-dublaj-izle/" biçiminde.
    // Altyazılı ve dublaj ayrı dizi sayfalarıdır; adı tam eşleşenlerin hepsi alınır.
    const want = names.map(norm).filter(Boolean);
    const showKey = s => norm(s.replace(/^\d+-/, '').replace(/-izle.*$/, '').replace(/-turkce-dublaj.*$/, '').replace(/-/g, ' '));
    let shows = [];
    for (const n of names.slice(0, 2)) {
      const r = await get(`${DIZIMOM_BASE}/?s=${encodeURIComponent(n)}`);
      if (!r.ok) throw new Error(`DiziMom arama HTTP ${r.status}`);
      const html = await r.text();
      const slugs = [...new Set([...html.matchAll(/\/diziler\/([a-z0-9-]+)\//g)].map(m => m[1]))];
      shows = slugs.filter(s => want.includes(showKey(s)));
      if (shows.length) break;
    }
    if (!shows.length) throw new Error('DiziMom eşleşme bulunamadı');

    // 3. Her dizi sayfasında bölümü bul ("...-{s}-sezon-{e}-bolum-..."), oynatıcıdan HLS adresini al
    const epRe = new RegExp(`href="([^"]*[/-]${Number(season)}-sezon-${Number(episode)}-bolum[^"]*)"`);
    // Yerli diziler sezonsuz, mutlak bölüm numarasıyla listelenir ("kurulus-osman-12-bolum-izle")
    let absEp = Number(episode);
    if (Number(season) > 1) {
      try { const full = await tmdbFetch('tv', tmdbId); absEp = (full.seasons || []).filter(x => x.season_number > 0 && x.season_number < Number(season)).reduce((a, x) => a + (x.episode_count || 0), 0) + Number(episode); }
      catch { absEp = 0; }
    }
    const absRe = absEp ? new RegExp(`href="(${DIZIMOM_BASE.replace(/[.]/g, '\\.')}/[a-z0-9-]*?-${absEp}-bolum[^"]*)"`) : null;
    const sources = [], seenIds = new Set(); // altyazılı ve dublaj sayfaları aynı videoyu gösterebilir
    await Promise.all(shows.slice(0, 3).map(async slug => {
      try {
        const showUrl = `${DIZIMOM_BASE}/diziler/${slug}/`;
        const sr = await get(showUrl);
        if (!sr.ok) return;
        const showHtml = await sr.text();
        const yerli = !/-sezon-\d+-bolum/.test(showHtml);
        const epHref = (yerli ? absRe && showHtml.match(absRe) : showHtml.match(epRe))?.[1];
        if (!epHref) return;
        const er = await get(epHref, showUrl);
        if (!er.ok) return;
        // iframe'ler tembel yüklenir (src="about:blank", data-src=...) — her iki niteliği de tara.
        // FirePlayer biçimleri: /player/index.php?data={id} (eski) ve /embed/{id} (yeni). hdstreamable /tv/video/ telif uyarısı videosu döndürüyor → alınmaz.
        const iframeSrcs = [...new Set([...(await er.text()).matchAll(/<iframe[^>]+?(?:data-src|src)="(https?:\/\/[^"]*\/(?:player\/index\.php\?data=|embed\/)[^"]+)"/g)].map(m => m[1]))];
        for (const iframeSrc of iframeSrcs) {
          const iframeUrl = new URL(iframeSrc);
          const dataParam = iframeUrl.searchParams.get('data') || iframeUrl.pathname.match(/\/embed\/([A-Za-z0-9]+)/)?.[1];
          if (!dataParam || seenIds.has(dataParam)) continue;
          seenIds.add(dataParam);
          const postRes = await fetch(`https://${iframeUrl.host}/player/index.php?data=${dataParam}&do=getVideo`, {
            method: 'POST', signal: AbortSignal.timeout(10000),
            body: new URLSearchParams({ hash: dataParam, r: epHref }),
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': iframeSrc, 'User-Agent': DIZIMOM_UA },
          }).catch(() => null);
          if (!postRes?.ok) continue;
          const d = await postRes.json().catch(() => ({}));
          const url = d.securedLink || d.videoSource;
          if (!url) continue;
          const referer = `https://${iframeUrl.host}/`;
          // Yeni oynatıcıda altyazı ayrı VTT izi, ses izleri (tur/eng) ana listede
          let subtitles, dual = false;
          if (/\/embed\//.test(iframeSrc)) {
            try {
              const eh = await (await fetch(iframeSrc, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': DIZIMOM_UA, Referer: epHref } })).text();
              const tracks = JSON.parse(getAndUnpack(eh).match(/"tracks":(\[[^\]]*\])/)?.[1] || '[]');
              subtitles = tracks.filter(t => t.file && /captions|subtitles/.test(t.kind || 'captions')).map(t => ({ label: /tur/i.test(t.language || t.label) ? 'Türkçe' : t.label, lang: /tur/i.test(t.language || t.label) ? 'tr' : (t.language || ''), url: String(t.file).replace(/\\+\//g, '/'), proxy: true }));
            } catch { /* altyazısız devam */ }
            try { dual = /TYPE=AUDIO[^\n]*LANGUAGE="tur"/.test(await (await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': DIZIMOM_UA, Referer: referer } })).text()); } catch {}
          }
          const dub = dual || /turkce-dublaj/.test(slug + epHref);
          // Yerli dizi: ses zaten Türkçe → 'tr-dub' (Türkçe ses) olarak işaretlenir
          const name = yerli ? 'DiziMom (Türkçe)' : dual ? 'DiziMom (TR Dublaj + Altyazı)' : dub ? 'DiziMom (TR Dublaj)' : 'DiziMom (TR Altyazı)';
          // Segmentler yalnızca oynatıcı alan adına CORS izni veriyor → Referer ile güvenli geçitten oynatılır
          sources.push({ url, quality: '1080p', name, type: 'hls', lang: dub || yerli ? 'tr-dub' : 'tr', referer, ...(subtitles?.length ? { subtitles } : {}) });
          break;
        }
      } catch { /* sıradaki dizi sayfası */ }
    }));
    if (!sources.length) throw new Error('DiziMom bölüm/oynatıcı bulunamadı');

    const result = { sources };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    fail(res, cacheKey, e);
  }
});

// ---- DiziYou — storage.diziyou.one direkt HLS ----
const DIZIYOU_BASE = 'https://www.diziyou.one';
const DIZIYOU_STORAGE = 'https://storage.diziyou.one';
const DIZIYOU_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

// DiziYou: arama → bölüm sayfası → oynatıcı numarası. Akışlar storage alt alanındadır; Türkçe altyazılı
// ({id}/play.m3u8) ve Türkçe dublaj ({id}_tr/play.m3u8) ayrı listelenir, VTT altyazı eklenir. CORS açık.
app.get('/api/diziyou', async (req, res) => {
  const { tmdbId, season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  const cacheKey = `diziyou:${tmdbId}:${season}:${episode}`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);
  const get = url => fetch(url, { headers: { 'User-Agent': DIZIYOU_UA, Referer: `${DIZIYOU_BASE}/`, 'Accept-Language': 'tr-TR,tr;q=0.9' }, signal: AbortSignal.timeout(9000) });
  try {
    const tmdb = await tmdbTv(tmdbId);
    const names = [...new Set(nameList(tmdb).filter(Boolean))];
    // Bölüm adresleri "{slug}-{sezon}-sezon-{bölüm}-bolum/" biçiminde; aramadan slug'ı bul.
    let slug = null;
    for (const n of names.slice(0, 2)) {
      const r = await get(`${DIZIYOU_BASE}/?s=${encodeURIComponent(n)}`);
      if (!r.ok) continue;
      const html = await r.text();
      const slugs = [...new Set([...html.matchAll(/href="https:\/\/www\.diziyou\.[a-z]+\/([a-z0-9-]+?)(?:-\d+-sezon-\d+-bolum)?\/"/g)].map(m => m[1]))]
        .filter(s => !/^(page|kategori|tag|author|wp-|diziler|filmler|iletisim)/.test(s));
      const want = names.map(norm).filter(Boolean);
      slug = slugs.find(s => want.includes(norm(s.replace(/-/g, ' ')))) || slugs.find(s => want.some(w => w.length >= 4 && norm(s.replace(/-/g, ' ')).startsWith(w)));
      if (slug) break;
    }
    if (!slug) throw new Error('DiziYou eşleşme bulunamadı');
    const pr = await get(`${DIZIYOU_BASE}/${slug}-${Number(season)}-sezon-${Number(episode)}-bolum/`);
    if (!pr.ok) throw new Error(`DiziYou bölüm HTTP ${pr.status}`);
    const page = await pr.text();
    const id = page.match(/id="diziyouPlayer"[^>]*src="[^"]*\/player\/(\d+)\.html/)?.[1];
    if (!id) throw new Error('DiziYou oynatıcı bulunamadı');
    const sub = { label: 'Türkçe', lang: 'tr', url: `${DIZIYOU_STORAGE}/subtitles/${id}/tr.vtt` };
    const sources = [];
    if (/turkceAltyazili/.test(page) || !/turkceDublaj/.test(page)) sources.push({ url: `${DIZIYOU_STORAGE}/episodes/${id}/play.m3u8`, name: 'DiziYou · Altyazılı', quality: 'HD', lang: 'tr', type: 'hls', subtitles: [sub] });
    if (/turkceDublaj/.test(page)) sources.push({ url: `${DIZIYOU_STORAGE}/episodes/${id}_tr/play.m3u8`, name: 'DiziYou · Türkçe Dublaj', quality: 'HD', lang: 'tr', type: 'hls' });
    // Listelerin gerçekten var olduğunu doğrula
    const ok = await Promise.all(sources.map(async s => { try { const r = await fetch(s.url, { headers: { 'User-Agent': DIZIYOU_UA }, signal: AbortSignal.timeout(6000) }); return r.ok && /EXTM3U/.test(await r.text()); } catch { return false; } }));
    const result = { sources: sources.filter((_, i) => ok[i]) };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    fail(res, cacheKey, e);
  }
});

// ---- Stremio eklentileri (varsayılan: CNCVerse Bridge) ----
// Stremio protokolü: GET {addon}/stream/{movie|series}/{imdb}[:S:E].json. Torrent ve harici bağlantılar alınmaz;
// tarayıcının oynatamayacağı biçimler (MKV, HEVC/x265, DTS/TrueHD, REMUX, dev dosyalar) elenir.
// Referer isteyen akışlar /api/all içinde güvenli geçide yönlendirilir.
const STREMIO_ADDONS = (process.env.STREMIO_ADDONS || 'https://cncverse.dpdns.org').split(',').map(s => s.trim().replace(/\/manifest\.json$/, '').replace(/\/+$/, '')).filter(s => /^https:\/\//.test(s));
const BAD_FORMAT = /\b(mkv|hevc|x265|h\.?265|10.?bit|dts|truehd|atmos|remux|av1|dolby ?vision|\bdv\b)\b/i;
const sizeGb = t => { const m = String(t).match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i); return m ? Number(m[1]) / (m[2].toUpperCase() === 'MB' ? 1024 : 1) : 0; };
app.get('/api/stremio', async (req, res) => {
  const { type = 'tv', season = '1', episode = '1' } = req.query;
  const imdb = /^tt\d{5,10}$/.test(req.query.imdb || '') ? req.query.imdb : null;
  if (!imdb || !STREMIO_ADDONS.length) return res.json({ sources: [], error: imdb ? 'eklenti yok' : 'imdb gerekli' });
  const cacheKey = `stremio:${type}:${imdb}:${season}:${episode}`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);
  const path = type === 'movie' ? `movie/${imdb}` : `series/${imdb}:${Number(season)}:${Number(episode)}`;
  try {
    const lists = await Promise.all(STREMIO_ADDONS.map(async base => {
      const r = await fetch(`${base}/stream/${path}.json`, { headers: { Accept: 'application/json', 'User-Agent': UA_DESKTOP }, signal: AbortSignal.timeout(14000) });
      if (!r.ok) return [];
      const d = await r.json().catch(() => ({}));
      return Array.isArray(d.streams) ? d.streams : [];
    }));
    const sources = [];
    for (const s of lists.flat()) {
      if (!s?.url || !/^https:\/\//.test(s.url) || s.infoHash || s.externalUrl) continue;
      const text = `${s.name || ''} ${s.title || s.description || ''}`;
      if (BAD_FORMAT.test(text) || /use vlc|external player/i.test(text) || sizeGb(text) > 6 || /\.mkv(\?|$)/i.test(s.url)) continue;
      const hls = /\bHLS\b|m3u8/i.test(text) || /\.m3u8(\?|$)/i.test(s.url);
      const mp4 = /\.mp4(\?|$)/i.test(s.url) || /\bmp4\b/i.test(text);
      if (!hls && !mp4) continue;   // biçimi belirsiz (çoğunlukla MKV indirme bağlantıları)
      const origin = (text.match(/Source:\s*([^\n•]+?)\s*•\s*([^\n]+)/) || [])[2] || (text.match(/Source:\s*([^\n•]+)/) || [])[1] || 'Stremio';
      const quality = (text.match(/\b(2160p|4K|1080p|720p|480p|Auto)\b/i) || [])[1] || 'Auto';
      const headers = s.behaviorHints?.proxyHeaders?.request || {};
      sources.push({ url: s.url, name: `${origin.trim().slice(0, 30)} (CNC)`, quality, type: hls ? 'hls' : 'mp4', lang: /türk|turk|\btr\b/i.test(text) ? 'tr' : undefined, ...(headers.Referer ? { referer: headers.Referer } : {}) });
      if (sources.length >= 6) break;
    }
    const result = { sources };
    cache.set(cacheKey, result, 20 * MIN);
    res.json(result);
  } catch (e) {
    fail(res, cacheKey, e);
  }
});

// ---- DDizi (Python filmmakinesi-scraper proxy) ----
app.get('/api/ddizi', async (req, res) => {
  const url = process.env.FILMMAKINESI_SCRAPER_URL;
  if (!url) return res.json({ sources: [], error: 'FILMMAKINESI_SCRAPER_URL yok' });
  const { tmdbId, season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  try {
    const r = await fetch(
      `${url}/api/ddizi?tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}&title=${encodeURIComponent(req.query.title || '')}&original=${encodeURIComponent(req.query.original || '')}`,
      { signal: AbortSignal.timeout(30000) }
    );
    res.json(await r.json());
  } catch (e) {
    res.json({ sources: [], error: e.message });
  }
});

// ---- DiziWatch (Python filmmakinesi-scraper proxy) ----
app.get('/api/diziwatch', async (req, res) => {
  const url = process.env.FILMMAKINESI_SCRAPER_URL;
  if (!url) return res.json({ sources: [], error: 'FILMMAKINESI_SCRAPER_URL yok' });
  const { tmdbId, season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  try {
    const r = await fetch(
      `${url}/api/diziwatch?tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`,
      { signal: AbortSignal.timeout(30000) }
    );
    res.json(await r.json());
  } catch (e) {
    res.json({ sources: [], error: e.message });
  }
});

// Akış: GET closeload.filmmakinesi.to/video/embed/{id}/tmdb-id={tmdbId}
// → HTML → packed JS unpack → Base64 double decode → m3u8
function getAndUnpack(packed) {
  // p,a,c,k,e,d unpacker
  try {
    const match = packed.match(/eval\(function\(p,a,c,k,e,(?:d|r)\)\{.*?\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)/s);
    if (!match) return packed;
    let [, p, a, , k] = match;
    a = parseInt(a);
    k = k.split('|');
    const e = (c) => (c ? (c < a ? '' : e(Math.floor(c / a))) + (c % a > 35 ? String.fromCharCode(c % a + 29) : (c % a).toString(36)) : c);
    for (let i = k.length - 1; i >= 0; i--) {
      if (k[i]) p = p.replace(new RegExp(`\\b${e(i)}\\b`, 'g'), k[i]);
    }
    return p;
  } catch { return packed; }
}

function closeloadM3u8(data) {
  try {
    // Base64 decode → reverse bytes → Base64 decode → split("|")[1]
    const first = Buffer.from(data, 'base64');
    const reversed = Buffer.from([...first].reverse());
    const second = Buffer.from(reversed.toString('ascii'), 'base64');
    return second.toString('utf8').split('|')[1] || null;
  } catch { return null; }
}

app.get('/api/closeload', async (req, res) => {
  const { tmdbId, type = 'movie', season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });

  const cacheKey = `closeload:${tmdbId}:${type}:${season}:${episode}`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  const CLOSELOAD_BASE = 'https://closeload.filmmakinesi.to';

  try {
    // 1. lema/v1 API'den film bilgisi al — filmmakinesi.to TMDB ID ile eşleme yapar
    // CloseLoad embed URL direkt TMDB ID ile çalışıyor
    let embedPath;
    if (type === 'movie') {
      // Film: /video/embed/{id}/tmdb-id={tmdbId} — videoId'yi bulmak için önce arama yap
      // filmmakinesi.to arama API'si
      const searchRes = await fetch(
        `https://filmmakinesi.to/lema/v1/search?tmdb=${tmdbId}&type=movie`,
        {
          signal: AbortSignal.timeout(10000),
          headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://filmmakinesi.to/' },
        }
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json().catch(() => null);
        const videoId = searchData?.closeload_id || searchData?.video_id || searchData?.embed_id
          || searchData?.data?.[0]?.closeload_id || searchData?.results?.[0]?.closeload_id;
        if (videoId) {
          embedPath = `/video/embed/${videoId}/ah/`;
        }
      }
      // Fallback: tmdb-id ile direkt dene
      if (!embedPath) {
        embedPath = `/video/embed/tmdb-${tmdbId}/ah/`;
      }
    } else {
      // Dizi
      const searchRes = await fetch(
        `https://filmmakinesi.to/lema/v1/search?tmdb=${tmdbId}&type=tv&season=${season}&episode=${episode}`,
        {
          signal: AbortSignal.timeout(10000),
          headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://filmmakinesi.to/' },
        }
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json().catch(() => null);
        const videoId = searchData?.closeload_id || searchData?.video_id
          || searchData?.data?.[0]?.closeload_id;
        if (videoId) embedPath = `/video/embed/${videoId}/ah/`;
      }
      if (!embedPath) embedPath = `/video/embed/tmdb-${tmdbId}-s${season}e${episode}/ah/`;
    }

    // 2. CloseLoad embed sayfasını GET ile çek (referer: filmmakinesi.to)
    const embedUrl = `${CLOSELOAD_BASE}${embedPath}`;
    const embedRes = await fetch(embedUrl, {
      signal: AbortSignal.timeout(10000),
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Referer': 'https://filmmakinesi.to/',
        'Accept': 'text/html,application/xhtml+xml',
        'sec-fetch-dest': 'iframe',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-site',
      },
    });

    if (!embedRes.ok) throw new Error(`CloseLoad GET HTTP ${embedRes.status}`);
    const embedHtml = await embedRes.text();

    // 3. Hash değerini HTML'den çıkar
    const hashMatch = embedHtml.match(/var\s+\w+\s*=\s*['"]([a-f0-9]{32})['"]/i)
      || embedHtml.match(/hash['":\s]+['"]([a-f0-9]{32})['"]/i);
    if (!hashMatch) throw new Error('CloseLoad hash bulunamadı');
    const hash = hashMatch[1];

    // 4. POST ile video kaynağını al
    const postRes = await fetch(embedUrl, {
      signal: AbortSignal.timeout(10000),
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Referer': embedUrl,
        'Origin': CLOSELOAD_BASE,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'same-origin',
        'sec-fetch-site': 'same-origin',
      },
      body: new URLSearchParams({ hash }).toString(),
    });

    if (!postRes.ok) throw new Error(`CloseLoad POST HTTP ${postRes.status}`);
    const postHtml = await postRes.text();

    // 5. Packed JS bul ve unpack et
    const scriptMatch = postHtml.match(/eval\(function\(p,a,c,k,e,(?:d|r)\)[\s\S]+?\)\)/);
    if (!scriptMatch) throw new Error('Packed JS bulunamadı');

    const unpacked = getAndUnpack(scriptMatch[0]);

    // 6. Base64 encoded data'yı çıkar
    // Pattern: var XXX=("XXXXXX") veya return result}var XXX=("XXXXX")
    const dataMatch = unpacked.match(/return result\}[^(]*\(["']([A-Za-z0-9+/=]+)['"]\)/)
      || unpacked.match(/['"]((?:[A-Za-z0-9+/]{4}){8,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)['"]/);

    if (!dataMatch) throw new Error('Base64 data bulunamadı');

    const m3u8Url = closeloadM3u8(dataMatch[1]);
    if (!m3u8Url || !m3u8Url.startsWith('http')) throw new Error('m3u8 URL çıkarılamadı');

    // 7. Altyazıları da çıkar
    const $ = cheerio.load(postHtml);
    const subtitles = [];
    $('track[kind="subtitles"], track[kind="captions"]').each((_, el) => {
      const src = $(el).attr('src');
      const label = $(el).attr('label') || 'Altyazı';
      const lang = $(el).attr('srclang') || 'tr';
      if (src) subtitles.push({ url: src, label, lang });
    });

    const result = {
      sources: [{
        url: m3u8Url,
        quality: '1080p',
        name: 'FilmMakinesi (TR Dublaj)',
        type: 'hls',
        lang: 'tr-dub',
        subtitles,
      }],
    };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    fail(res, cacheKey, e);
  }
});

// ---- WebteIzle ----
// Yalnızca film sitesi (diziler sezonlukdizi.org'a gider). Akış: arama.asp → /izle/{dublaj|altyazi}/{slug}
// sayfasındaki id="wip" data-id → dataAlternatif3.asp (dil 0=dublaj, 1=altyazı) → dataEmbed.asp (HTML iframe).
// Not: dataAlternatif3/dataEmbed uçları Cloudflare kuralıyla veri merkezi IP'lerine 403 verebiliyor; o durumda hızlıca vazgeçilir.
const WEBTEIZLE_BASE = process.env.WEBTEIZLE_BASE || 'https://webteizle.info'; // alan adı değişirse yalnızca burayı güncelle
app.get('/api/webteizle', async (req, res) => {
  const { tmdbId, type = 'movie' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  if (type !== 'movie') return res.json({ sources: [], error: 'WebteIzle yalnızca film' });
  const cacheKey = `webteizle:${tmdbId}:movie`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);

  const WEBT_HEADERS = { 'User-Agent': UA_DESKTOP, 'Accept-Language': 'tr-TR,tr;q=0.9', 'Referer': `${WEBTEIZLE_BASE}/` };
  const ajax = (path, body, referer) => fetch(`${WEBTEIZLE_BASE}/ajax/${path}`, {
    method: 'POST', signal: AbortSignal.timeout(9000), body: new URLSearchParams(body).toString(),
    headers: { ...WEBT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', ...(referer ? { Referer: referer } : {}) },
  });
  // Site windows-1254 kodlamasıyla yanıt veriyor
  // (small-icu Node sürümlerinde TextDecoder bu kodlamayı tanımıyor → latin1 + Türkçe harf eşlemesi)
  const TR1254 = { 0xD0: 'Ğ', 0xDD: 'İ', 0xDE: 'Ş', 0xF0: 'ğ', 0xFD: 'ı', 0xFE: 'ş' };
  const text = async r => { const b = Buffer.from(await r.arrayBuffer()); let s = ''; for (const c of b) s += TR1254[c] || String.fromCharCode(c); return s; };

  try {
    const tmdb = await tmdbMovie(tmdbId);
    const names = [...new Set(nameList(tmdb).filter(Boolean))];
    const year = yearNum(tmdb);
    if (!names.length) throw new Error('TMDB başlık bulunamadı');

    // 1. Arama — sonuç: {status, results:{filmler:{results:[{title:"Avengers: Endgame (2019)", description:"<TR ad>", url:"/hakkinda/<slug>"}]}}}
    let found = null;
    for (const q of names.slice(0, 2)) {
      const r = await ajax('arama.asp', { q });
      if (r.status === 403) throw new Error('WebteIzle Cloudflare engeli (HTTP 403)'); // aşılmaz, hızlıca vazgeç
      if (!r.ok) continue;
      let d; try { d = JSON.parse(await text(r)); } catch { continue; }
      const list = (d?.results?.filmler?.results || d?.data?.results?.filmler?.results || []).map(x => ({
        ...x, name: String(x.title || '').replace(/\s*\(\d{4}\)\s*$/, ''), original_name: x.description, year: String(x.title || '').match(/\((\d{4})\)/)?.[1],
      }));
      found = pickMatch(list, tmdbId, names, year);
      if (found?.url) break;
    }
    if (!found?.url) throw new Error('WebteIzle eşleşme bulunamadı');
    const slug = found.url.split('/').filter(Boolean).pop();

    // 2. Film sayfası — filmId (id="wip" data-id) ve mevcut diller
    const pageUrl = `${WEBTEIZLE_BASE}/izle/dublaj/${slug}`;
    const pr = await fetch(pageUrl, { signal: AbortSignal.timeout(9000), headers: WEBT_HEADERS });
    if (!pr.ok) throw new Error(`WebteIzle sayfa HTTP ${pr.status}`);
    const html = await text(pr);
    const filmId = html.match(/id=["']wip["'][^>]*data-id=["'](\d+)["']/)?.[1];
    if (!filmId) throw new Error('WebteIzle filmId bulunamadı');
    const langs = [/data-dil="0"/.test(html) && '0', /data-dil="1"/.test(html) && '1'].filter(Boolean);

    // 3. Her dil için alternatif listesi → embed iframe → VidMoly ise m3u8
    const sources = [];
    let blocked = false;
    for (const dil of langs.length ? langs : ['0']) {
      const ar = await ajax('dataAlternatif3.asp', { filmid: filmId, dil, s: '', b: '', bot: '0' }, pageUrl);
      if (ar.status === 403) { blocked = true; break; }
      if (!ar.ok) continue;
      let alt; try { alt = JSON.parse(await text(ar)); } catch { continue; }
      if (alt?.status !== 'success' || !Array.isArray(alt.data)) continue;
      const dub = dil === '0';
      for (const item of alt.data.slice(0, 6)) {
        try {
          const er = await ajax('dataEmbed.asp', { id: item.id }, pageUrl);
          if (!er.ok) continue;
          const body = await text(er);
          const iframeSrc = body.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1] || body.match(/(https?:\/\/(?:www\.)?vidmoly\.[a-z]+\/[^"'\s<]+)/i)?.[1];
          if (!iframeSrc || !/vidmoly/i.test(iframeSrc)) continue;
          const extracted = await extractVidMoly(iframeSrc.startsWith('//') ? `https:${iframeSrc}` : iframeSrc, `${WEBTEIZLE_BASE}/`);
          if (!extracted) continue;
          sources.push({ url: extracted.url, quality: '1080p', name: dub ? 'WebteIzle (TR Dublaj)' : 'WebteIzle (TR Altyazı)', type: 'hls', lang: dub ? 'tr-dub' : 'tr', referer: extracted.referer });
          break;
        } catch { /* sıradaki alternatif */ }
      }
    }
    if (!sources.length && blocked) throw new Error('WebteIzle oynatıcı uçları sunucu IP\'sine kapalı (Cloudflare 403)');
    if (!sources.length) throw new Error('WebteIzle oynatılabilir kaynak yok');

    const result = { sources };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    fail(res, cacheKey, e);
  }
});

// ---- LoveFilmIzle ----
// WordPress sitesi; yazılar IMDb id ile aranabiliyor. Filmde tek yazı, dizide her sezon ayrı yazı ("...-{s}-sezon-izle").
// İçerik "<!--nextpage-->" ile parçalara bölünür; her parçanın başlığında bayraklar (fl tr / fl en) ve
// dizide "{n}.Bölüm" bulunur. Kaynaklar: VidMoly (bemoly sarmalayıcı), VideoSeyred (JSON çalma listesi), Pixeldrain.
const LOVEFILMIZLE_BASE = process.env.LOVEFILMIZLE_BASE || 'https://lovefilmizle.net'; // alan adı değişirse yalnızca burayı güncelle
async function extractVideoSeyred(embedUrl) {
  const id = embedUrl.match(/\/embed\/(\d+)/)?.[1];
  if (!id) return null;
  const host = new URL(embedUrl).origin;
  const r = await fetch(`${host}/playlist/${id}.json`, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA_DESKTOP, Referer: embedUrl } });
  if (!r.ok) return null;
  const item = (await r.json().catch(() => []))?.[0];
  const file = item?.sources?.find(s => /^https:/.test(s.file || ''))?.file;
  if (!file) return null;
  const seen = new Set();
  const subtitles = (item.tracks || []).filter(t => t.kind === 'captions' && /^https:/.test(t.file || '') && !seen.has(t.language) && seen.add(t.language))
    .map(t => ({ label: t.label || 'Türkçe', lang: /tur/i.test(t.language || '') ? 'tr' : (t.language || ''), url: t.file }));
  return { url: file, type: /\.m3u8/i.test(file) ? 'hls' : 'mp4', subtitles };
}

app.get('/api/lovefilmizle', async (req, res) => {
  const { tmdbId, type = 'movie', season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  const cacheKey = `lovefilmizle:${tmdbId}:${type}:${season}:${episode}`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);

  try {
    // 1. IMDb ID al
    const tmdb = type === 'movie' ? await tmdbMovieWithExternal(tmdbId) : await tmdbTvWithExternal(tmdbId);
    const imdbId = tmdb.external_ids?.imdb_id || tmdb.imdb_id;
    if (!imdbId) throw new Error('IMDb ID bulunamadı');

    // 2. WordPress REST API — IMDb id ile ara, film/sezon yazısını seç
    const wpRes = await fetch(`${LOVEFILMIZLE_BASE}/wp-json/wp/v2/posts?search=${encodeURIComponent(imdbId)}&per_page=20&_fields=link,content,dil`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': UA_DESKTOP, 'Accept': 'application/json', 'Referer': `${LOVEFILMIZLE_BASE}/` },
    });
    if (!wpRes.ok) throw new Error(`LoveFilmIzle WP API HTTP ${wpRes.status}`);
    const posts = await wpRes.json().catch(() => []);
    if (!Array.isArray(posts) || !posts.length) throw new Error('LoveFilmIzle içerik bulunamadı');
    const isSeason = p => /-\d+-sezon/.test(p.link || '');
    const post = type === 'movie'
      ? posts.find(p => !isSeason(p))
      : posts.find(p => new RegExp(`-${Number(season)}-sezon`).test(p.link || ''));
    if (!post) throw new Error(type === 'movie' ? 'LoveFilmIzle film bulunamadı' : 'LoveFilmIzle sezon bulunamadı');

    // 3. Parçalar: başlık bayrakları + iframe. Dizide yalnızca istenen bölümün parçaları.
    const parts = String(post.content?.rendered || '').split('<!--nextpage-->').map(html => {
      const head = html.match(/<!--baslik:(.*?)-->/)?.[1] || '';
      const flags = [...head.matchAll(/class=['"]fl (\w+)['"]/g)].map(m => m[1]);
      const label = head.replace(/<[^>]+>/g, '').trim();
      return { html, flags, label };
    }).filter(p => type === 'movie' || new RegExp(`^${Number(episode)}\\.\\s*B[öo]l[üu]m`, 'i').test(p.label));
    if (!parts.length) throw new Error('LoveFilmIzle bölüm bulunamadı');

    const sources = [];
    await Promise.all(parts.slice(0, 6).map(async p => {
      try {
        // Yalnızca TR bayrağı → Türkçe dublaj; EN (+TR) → orijinal ses, Türkçe altyazı
        const dub = p.flags.includes('tr') && !p.flags.includes('en');
        const lang = dub ? 'tr-dub' : 'tr';
        const tag = dub ? 'TR Dublaj' : 'TR Altyazı';
        const src = p.html.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1] || '';
        const vm = src.match(/[?&]url=(https?:\/\/(?:www\.)?vidmoly\.[a-z]+\/[^&"']+)/)?.[1] || (/vidmoly\./.test(src) ? src : null);
        if (vm) {
          const ex = await extractVidMoly(decodeURIComponent(vm), `${LOVEFILMIZLE_BASE}/`);
          if (ex) sources.push({ url: ex.url, quality: '1080p', name: `LoveFilmIzle VidMoly (${tag})`, type: 'hls', lang, referer: ex.referer });
          return;
        }
        if (/videoseyred\./.test(src)) {
          const ex = await extractVideoSeyred(src.startsWith('//') ? `https:${src}` : src);
          if (ex) sources.push({ url: ex.url, quality: '1080p', name: `LoveFilmIzle VideoSeyred (${tag})`, type: ex.type, lang, ...(ex.subtitles.length ? { subtitles: ex.subtitles } : {}) });
          return;
        }
        const pd = extractPixeldrain(p.html);
        if (pd) sources.push({ url: pd, quality: '1080p', name: `LoveFilmIzle Pixeldrain (${tag})`, type: 'mp4', lang });
      } catch { /* sıradaki parça */ }
    }));
    if (!sources.length) throw new Error('LoveFilmIzle oynatılabilir kaynak yok (VidMoly dosyası silinmiş olabilir)');

    const result = { sources };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    fail(res, cacheKey, e);
  }
});

// ---- FilmMakinesi Proxy ----
app.get('/api/filmmakinesi', async (req, res) => {
  const url = process.env.FILMMAKINESI_SCRAPER_URL;
  if (!url) return res.json({ sources: [], error: 'FILMMAKINESI_SCRAPER_URL ayarlanmamis' });
  const { tmdbId, type = 'movie', season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  try {
    const r = await fetch(
      `${url}/api/stream?tmdbId=${encodeURIComponent(tmdbId)}&type=${encodeURIComponent(type)}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`,
      { signal: AbortSignal.timeout(30000) }
    );
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.json({ sources: [], error: e.message });
  }
});

// ---- FilmizleBabam ----
const FILMIZLEBABAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';

async function filmizlebabamFetchPage(url, referer) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    redirect: 'follow',
    headers: {
      'User-Agent': FILMIZLEBABAM_UA,
      'Referer': referer || 'https://www.filmizlebabam.com/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`filmizlebabam HTTP ${res.status} for ${url}`);
  return res.text();
}

async function filmizlebabamExtractToken(html) {
  const m = html.match(/data-pv=["']([A-Za-z0-9_-]+)["']/);
  return m ? m[1] : null;
}

async function filmizlebabamExtractIframe(html) {
  const m = html.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  return m ? m[1] : null;
}

async function pilavyerplayResolve(token, pageUrl) {
  const endpoints = [
    { method: 'GET',  url: `https://pilavyerplay.top/api/${token}`,         body: null,                                      ct: null },
    { method: 'POST', url: 'https://pilavyerplay.top/api/source',           body: `token=${encodeURIComponent(token)}`,       ct: 'application/x-www-form-urlencoded' },
    { method: 'GET',  url: `https://pilavyerplay.top/api/source/${token}`,  body: null,                                      ct: null },
    { method: 'POST', url: 'https://pilavyerplay.top/source',               body: `r=${encodeURIComponent(pageUrl)}&token=${encodeURIComponent(token)}`, ct: 'application/x-www-form-urlencoded' },
  ];

  for (const ep of endpoints) {
    try {
      const opts = {
        method: ep.method,
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent': FILMIZLEBABAM_UA,
          'Referer': 'https://pilavyerplay.top/',
          'Origin': 'https://pilavyerplay.top',
          'Accept': 'application/json, text/plain, */*',
        },
      };
      if (ep.body) {
        opts.body = ep.body;
        opts.headers['Content-Type'] = ep.ct;
      }
      const r = await fetch(ep.url, opts);
      if (!r.ok) continue;
      const text = await r.text();
      // m3u8 URL ara
      const m3u8 = text.match(/(https?:\/\/[^"'\s,]+\.m3u8[^"'\s,]*)/i);
      if (m3u8) return { url: m3u8[1], type: 'hls' };
      // mp4 ara
      const mp4 = text.match(/(https?:\/\/[^"'\s,]+\.mp4[^"'\s,]*)/i);
      if (mp4) return { url: mp4[1], type: 'mp4' };
      // JSON içinde url/file/src alanı ara
      try {
        const json = JSON.parse(text);
        const candidates = [json.url, json.file, json.src, json.stream,
          json.data?.url, json.data?.file, json.sources?.[0]?.url, json.sources?.[0]?.file];
        for (const c of candidates) {
          if (c && typeof c === 'string' && c.startsWith('http')) {
            return { url: c, type: /\.m3u8/i.test(c) ? 'hls' : 'mp4' };
          }
        }
      } catch { /* not json */ }
    } catch { /* try next endpoint */ }
  }
  return null;
}

app.get('/api/filmizlebabam', async (req, res) => {
  const { tmdbId, type = 'movie', season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  const cacheKey = `filmizlebabam:${tmdbId}:${type}:${season}:${episode}`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);

  try {
    // 1. TMDB'den TR + orijinal başlık al
    let tmdb;
    if (type === 'movie') {
      tmdb = await tmdbMovie(tmdbId);
    } else {
      tmdb = await tmdbTv(tmdbId);
    }
    const trTitle = tmdb.title || tmdb.name || '';
    const origTitle = tmdb.original_title || tmdb.original_name || '';
    if (!trTitle && !origTitle) throw new Error('TMDB başlık bulunamadı');

    const slugTr = toSlug(trTitle);
    const slugOrig = toSlug(origTitle);
    const s = parseInt(season, 10);
    const e = parseInt(episode, 10);

    // 2. Denenecek URL'leri oluştur
    let urlsToTry = [];
    if (type === 'tv') {
      if (slugTr)   urlsToTry.push(`https://www.filmizlebabam.com/bolum/${slugTr}-${s}-sezon-${e}-bolum/`);
      if (slugOrig && slugOrig !== slugTr) urlsToTry.push(`https://www.filmizlebabam.com/bolum/${slugOrig}-${s}-sezon-${e}-bolum/`);
    } else {
      if (slugTr)   urlsToTry.push(`https://www.filmizlebabam.com/film/${slugTr}-izle/`);
      if (slugOrig && slugOrig !== slugTr) urlsToTry.push(`https://www.filmizlebabam.com/film/${slugOrig}-izle/`);
    }

    let pageHtml = null;
    let pageUrl = null;

    // 3. URL'leri sırayla dene
    for (const url of urlsToTry) {
      try {
        pageHtml = await filmizlebabamFetchPage(url, 'https://www.filmizlebabam.com/');
        pageUrl = url;
        break;
      } catch { /* try next */ }
    }

    if (!pageHtml) throw new Error('filmizlebabam sayfa bulunamadı \u2014 t\u00fcm URL\u2019ler ba\u015far\u0131s\u0131z');

    // 4. data-pv token'ını çıkar
    const token = await filmizlebabamExtractToken(pageHtml);

    let sources = [];

    if (token) {
      // 5. pilavyerplay API'sini çağır
      const resolved = await pilavyerplayResolve(token, pageUrl);
      if (resolved) {
        sources.push({
          url: resolved.url,
          quality: '1080p',
          name: 'FilmizleBabam',
          type: resolved.type,
        });
      }
    }

    // 6. Fallback: iframe src
    if (sources.length === 0) {
      const iframeSrc = await filmizlebabamExtractIframe(pageHtml);
      if (iframeSrc) {
        sources.push({
          url: iframeSrc,
          quality: '1080p',
          name: 'FilmizleBabam (iframe)',
          type: 'hls',
        });
      }
    }

    const result = { sources };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    fail(res, cacheKey, e);
  }
});

// Anizium API'si koruma belirteci istiyor (taklit edilmez), SineWix API'si 401 dönüyor. FilmizleBabam oynatıcısı
// (pilavyerplay) origin kilitli jeton + heartbeat korumalı; taklit edilmez, bu yüzden taranmaz.
const LEGACY = new Set(['anizium', 'sinewix', 'filmizlebabam']);

const INFLIGHT = new Map();

// ---- All (parallel) ----
// Tüm kaynakları aynı anda sorar. ?budget=ms süresi dolunca, o ana kadar bulunanları döndürür;
// yavaş bir site yüzünden hiçbir şey dönmeme durumu yoktur. Yanıtta her kaynağın durumu da bulunur.
app.get('/api/all', async (req, res) => {
  const { tmdbId, type = 'tv', season = '1', episode = '1' } = req.query;
  if (!tmdbId || !/^\d{1,9}$/.test(String(tmdbId))) return res.json({ sources: [], count: 0, error: 'tmdbId gerekli' });
  const isMovie = type === 'movie';
  const budget = Math.min(25000, Math.max(3000, Number(req.query.budget) || 12000));
  const cacheKey = `all:${type}:${tmdbId}:${season}:${episode}`;
  const hit = cache.get(cacheKey);
  const base = publicBase(req);
  const finish = (sources, providers) => {
    // Referer isteyen akışları güvenli geçide yönlendir.
    const out = sources.map(s => {
      if (!s.referer || !/^https:/.test(s.url || '')) return s;
      const { referer, ...rest } = s;
      // Altyazılar da aynı Referer/CORS kısıtına tabi → onları da geçitten ver
      const subtitles = Array.isArray(s.subtitles) ? s.subtitles.map(t => t?.url && /^https:/.test(t.url) && t.proxy ? { label: t.label, lang: t.lang, url: `${base}/proxy/${proxyToken(t.url, referer, true)}` } : t) : s.subtitles;
      return { ...rest, ...(subtitles ? { subtitles } : {}), url: `${base}/proxy/${proxyToken(s.url, referer)}`, name: `${s.name || 'Kaynak'}`, type: s.type || 'hls', proxied: true };
    });
    // Aynı adres tekrarlanmasın.
    const seen = new Set();
    const unique = out.filter(s => s?.url && !seen.has(s.url) && seen.add(s.url));
    return { sources: unique, count: unique.length, providers };
  };
  if (hit) return res.json(finish(hit.raw, hit.providers));

  const q = k => `${k}=${encodeURIComponent(({ tmdbId, season, episode })[k])}`;
  const params = `${q('tmdbId')}&${q('season')}&${q('episode')}`;
  const list = isMovie
    ? [
        ['hdfilmcehennemi', `tmdbId=${encodeURIComponent(tmdbId)}`],
        ['sinewix', `tmdbId=${encodeURIComponent(tmdbId)}&type=movie`],
        ['closeload', `tmdbId=${encodeURIComponent(tmdbId)}&type=movie`],
        ['webteizle', `tmdbId=${encodeURIComponent(tmdbId)}&type=movie`],
        ['lovefilmizle', `tmdbId=${encodeURIComponent(tmdbId)}&type=movie`],
        ['filmmakinesi', `tmdbId=${encodeURIComponent(tmdbId)}&type=movie`],
        ['filmizlebabam', `tmdbId=${encodeURIComponent(tmdbId)}&type=movie`],
        ['sonanime', `tmdbId=${encodeURIComponent(tmdbId)}&type=movie`],
      ]
    : [
        ['animecix', params], ['anizium', params], ['sonanime', `${params}&type=tv`], ['diziyou', params],
        ['sinewix', `${params}&type=tv`], ['dizimom', params], ['webteizle', `${params}&type=tv`],
        ['lovefilmizle', `${params}&type=tv`], ['filmmakinesi', `${params}&type=tv`], ['filmizlebabam', `${params}&type=tv`],
        ['ddizi', params], ['diziwatch', params],
      ];
  // IMDb id'si biliniyorsa Stremio eklentilerini de sor
  if (/^tt\d{5,10}$/.test(req.query.imdb || '')) list.push(['stremio', `type=${isMovie ? 'movie' : 'tv'}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`]);
  // Başlık ipuçlarını alt isteklere de ilet (TMDB'ye gitmeden eşleştirme yapılabilsin).
  const hintQs = ['title', 'original', 'year', 'imdb'].filter(k => req.query[k]).map(k => `${k}=${encodeURIComponent(req.query[k])}`).join('&');

  // Giriş / premium gerektiren ya da kapanmış servisler varsayılan olarak taranmaz (ANTHOLOGY_LEGACY=1 ile açılır).
  const active = process.env.ANTHOLOGY_LEGACY === '1' ? list : list.filter(([id]) => !LEGACY.has(id));
  const providers = [];
  const raw = [];
  await new Promise(resolve => {
    let left = active.length;
    const timer = setTimeout(resolve, budget);
    for (const [id, qs] of active) {
      const started = Date.now();
      (async () => {
        // Aynı alt sorgu zaten sürüyorsa (ör. kısa + tam bütçeli iki istek) onu paylaş
        const url = `http://127.0.0.1:${PORT}/api/${id}?${qs}${hintQs ? '&' + hintQs : ''}`;
        if (!INFLIGHT.has(url)) {
          const job = fetch(url, { signal: AbortSignal.timeout(25000) }).then(async r => ({ ok: r.ok, status: r.status, d: await r.json().catch(() => ({})) }));
          INFLIGHT.set(url, job);
          job.finally(() => INFLIGHT.delete(url)).catch(() => {});
        }
        const { ok, status, d } = await Promise.race([INFLIGHT.get(url), new Promise((_, rej) => setTimeout(() => rej(new Error('zaman aşımı')), budget))]);
        if (!ok) throw new Error(`HTTP ${status}`);
        const items = Array.isArray(d.sources) ? d.sources : [];
        raw.push(...items.map(s => ({ ...s, provider: id })));
        providers.push({ id, ok: !d.error || items.length > 0, ms: Date.now() - started, count: items.length, ...(d.error && !items.length ? { error: String(d.error).slice(0, 120) } : {}) });
      })().catch(e => providers.push({ id, ok: false, ms: Date.now() - started, count: 0, error: String(e.message).slice(0, 120) }))
        .finally(() => { if (--left === 0) { clearTimeout(timer); resolve(); } });
    }
  });
  const answered = new Set(providers.map(p => p.id));
  for (const [id] of active) if (!answered.has(id)) providers.push({ id, ok: false, ms: budget, count: 0, error: 'zaman aşımı' });
  // Tam sonuç (zaman aşımı olmadan) 30 dk, eksik sonuç 1 dk önbelleğe alınır.
  const complete = providers.every(p => p.error !== 'zaman aşımı');
  if (raw.length) cache.set(cacheKey, { raw, providers }, complete ? 30 * MIN : MIN);
  res.json(finish(raw, providers));
});

// HOST=127.0.0.1 verilirse yalnızca yerel arayüzü dinler (önünde Caddy gibi bir ters vekil varken).
app.listen(PORT, process.env.HOST || "0.0.0.0", () => {
  console.log(`anthology-scraper listening on port ${PORT}`);
});
