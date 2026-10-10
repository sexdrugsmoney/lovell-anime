import express from 'express';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY || '500330721680edb6d5f7f12ba7cd9023';

// ---- Simple LRU cache ----
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
  set(key, value) {
    if (this.store.has(key)) this.store.delete(key);
    else if (this.store.size >= this.max) this.store.delete(this.store.keys().next().value);
    this.store.set(key, { value, expires: Date.now() + this.ttl });
  }
}

const cache = new LRUCache(500, 3600 * 1000);

// ---- CORS + JSON ----
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// ---- Health ----
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'anthology-scraper', scrapers: ['animecix', 'anizium', 'sonanime', 'hdfilmcehennemi', 'sinewix', 'dizimom', 'closeload', 'webteizle', 'lovefilmizle'] });
});

// ---- TMDB helpers ----
async function tmdbTv(tmdbId) {
  const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_KEY}&language=tr-TR`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  return res.json();
}

async function tmdbMovie(tmdbId) {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=tr-TR`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  return res.json();
}

async function tmdbTvWithExternal(tmdbId) {
  const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_KEY}&language=tr-TR&append_to_response=external_ids`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  return res.json();
}

async function tmdbMovieWithExternal(tmdbId) {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=tr-TR&append_to_response=external_ids`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  return res.json();
}

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
    const match = titles.find(t =>
      (t.tmdb_id && String(t.tmdb_id) === String(tmdbId)) ||
      (t.tmdbId && String(t.tmdbId) === String(tmdbId))
    ) || titles[0];
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
    const streams = tauData.sources || tauData.streams || [];
    const sources = streams
      .filter(s => s?.url && s.url.startsWith('http'))
      .map(s => ({
        url: s.url,
        quality: s.label || s.quality || 'HD',
        name: 'AnimeciX',
        type: s.type === 'hls' || /\.m3u8/i.test(s.url) ? 'hls' : 'mp4',
      }));

    const result = { sources };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    res.json({ sources: [], error: e.message });
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
    const match = (Array.isArray(animes) ? animes : []).find(a =>
      (a.tmdb_id && String(a.tmdb_id) === String(tmdbId)) ||
      (a.tmdbId && String(a.tmdbId) === String(tmdbId))
    ) || (Array.isArray(animes) ? animes[0] : null);
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
    res.json({ sources: [], error: e.message });
  }
});

// ---- SonAnime ----
app.get('/api/sonanime', async (req, res) => {
  const { tmdbId, season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  const cacheKey = `sonanime:${tmdbId}:${season}:${episode}`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);

  try {
    // 1. TMDB'den ad al
    const tmdb = await tmdbTv(tmdbId);
    const name = tmdb.name || tmdb.original_name;

    // 2. SonAnime arama
    const searchRes = await fetch(`https://api.sonanime.com/api/animes?q=${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Referer': 'https://sonanime.com/', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!searchRes.ok) throw new Error(`SonAnime arama HTTP ${searchRes.status}`);
    const searchData = await searchRes.json();
    const animes = searchData.data || searchData.results || searchData;

    const match = (Array.isArray(animes) ? animes : []).find(a =>
      (a.tmdb_id && String(a.tmdb_id) === String(tmdbId)) ||
      (a.tmdbId && String(a.tmdbId) === String(tmdbId))
    ) || (Array.isArray(animes) ? animes[0] : null);
    if (!match) throw new Error('SonAnime eşleşme bulunamadı');

    const animeId = match.id || match.anime_id;

    // 3. Episodes
    const epListRes = await fetch(
      `https://api.sonanime.com/api/animes/${animeId}/episodes?season=${season}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { 'Referer': 'https://sonanime.com/', 'User-Agent': 'Mozilla/5.0' },
      }
    );
    if (!epListRes.ok) throw new Error(`SonAnime episodes HTTP ${epListRes.status}`);
    const epListData = await epListRes.json();
    const episodes = epListData.data || epListData.episodes || epListData;

    // 4. Episode bul
    const ep = (Array.isArray(episodes) ? episodes : []).find(
      e => String(e.number || e.episode_number || e.n) === String(episode)
    );
    if (!ep) throw new Error('SonAnime bölüm bulunamadı');

    const rawVideos = ep.videos || ep.sources || [];
    const sources = (Array.isArray(rawVideos) ? rawVideos : [])
      .filter(v => v?.url && v.url.startsWith('http'))
      .map(v => ({
        url: v.url,
        quality: v.quality || v.label || 'HD',
        name: 'SonAnime',
        type: /\.m3u8/i.test(v.url) ? 'hls' : 'mp4',
      }));

    const result = { sources };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    res.json({ sources: [], error: e.message });
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
    res.json({ sources: [], error: e.message });
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
    const match = results.find(item => String(item.tmdb_id) === String(tmdbId)) || results[0];
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
    res.json({ sources: [], error: e.message });
  }
});

// ---- DiziMom ----
const DIZIMOM_BASE = 'https://www.dizimom.diy';
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

    // 2. DiziMom arama
    const searchRes = await fetch(`${DIZIMOM_BASE}/?s=${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': DIZIMOM_UA, 'Referer': DIZIMOM_BASE },
    });
    if (!searchRes.ok) throw new Error(`DiziMom arama HTTP ${searchRes.status}`);
    const searchHtml = await searchRes.text();

    // 3. Parse et — slug bul
    const $s = cheerio.load(searchHtml);
    let slug = null;

    // Primary selectors
    const primaryHref = $s('.single-item .categorytitle a, article.single-item h2 a').first().attr('href');
    if (primaryHref) {
      const m = primaryHref.match(/\/diziler\/([^/]+)\//);
      if (m) slug = m[1];
    }

    // Fallback
    if (!slug) {
      const fallbackHref = $s('a[href*="/diziler/"]').first().attr('href');
      if (fallbackHref) {
        const m = fallbackHref.match(/\/diziler\/([^/]+)\//);
        if (m) slug = m[1];
      }
    }

    if (!slug) throw new Error('DiziMom slug bulunamadı');

    // 4. Show sayfası
    const showRes = await fetch(`${DIZIMOM_BASE}/diziler/${slug}/`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': DIZIMOM_UA, 'Referer': `${DIZIMOM_BASE}/?s=${encodeURIComponent(name)}` },
    });
    if (!showRes.ok) throw new Error(`DiziMom show sayfası HTTP ${showRes.status}`);
    const showHtml = await showRes.text();
    const $show = cheerio.load(showHtml);

    // 5. Bölüm linkini bul
    const epSelector = `a[href*="${season}-sezon-${episode}-bolum"], a[href*="-sezon"][href*="-bolum"]`;
    const epHref = $show(epSelector).first().attr('href')
      || $show('a[href*="-sezon"][href*="-bolum"]').filter((_i, el) => {
        const h = $show(el).attr('href') || '';
        return h.includes(`${season}-sezon`) && h.includes(`${episode}-bolum`);
      }).first().attr('href');

    if (!epHref) throw new Error('DiziMom bölüm linki bulunamadı');

    // 6. Bölüm sayfasını çek, iframe src'leri topla
    const epRes = await fetch(epHref, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': DIZIMOM_UA, 'Referer': `${DIZIMOM_BASE}/diziler/${slug}/` },
    });
    if (!epRes.ok) throw new Error(`DiziMom bölüm sayfası HTTP ${epRes.status}`);
    const epHtml = await epRes.text();
    const $ep = cheerio.load(epHtml);

    const iframeSrcs = [];
    $ep('iframe[src*="hdplayersystem"], iframe[src*="hdstreamable"], iframe[src*="filmizle"]').each((_i, el) => {
      const src = $ep(el).attr('src');
      if (src) iframeSrcs.push(src);
    });

    if (iframeSrcs.length === 0) throw new Error('DiziMom uyumlu iframe bulunamadı');

    // 7. İlk geçerli iframe için HDPlayer POST
    let videoUrl = null;
    for (const iframeSrc of iframeSrcs) {
      try {
        const iframeUrl = new URL(iframeSrc);
        const dataParam = iframeUrl.searchParams.get('data');
        if (!dataParam) continue;

        const postUrl = `https://${iframeUrl.host}/player/index.php?data=${dataParam}&do=getVideo`;
        const body = new URLSearchParams({ hash: dataParam, r: epHref });

        const postRes = await fetch(postUrl, {
          method: 'POST',
          signal: AbortSignal.timeout(10000),
          body,
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': iframeSrc,
            'User-Agent': DIZIMOM_UA,
          },
        });
        if (!postRes.ok) continue;
        const postData = await postRes.json().catch(() => ({}));
        const url = postData.securedLink || postData.videoSource;
        if (url) { videoUrl = url; break; }
      } catch {
        // try next iframe
      }
    }

    if (!videoUrl) throw new Error('DiziMom video URL bulunamadı');

    const result = { sources: [{ url: videoUrl, quality: '1080p', name: 'DiziMom', type: 'hls', lang: 'tr' }] };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    res.json({ sources: [], error: e.message });
  }
});

// ---- CloseLoad (filmmakinesi.to) ----
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
    res.json({ sources: [], error: e.message });
  }
});

// ---- WebteIzle ----
app.get('/api/webteizle', async (req, res) => {
  const { tmdbId, type = 'movie', season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  const cacheKey = `webteizle:${tmdbId}:${type}:${season}:${episode}`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);

  const WEBT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36';
  const WEBT_HEADERS = {
    'User-Agent': WEBT_UA,
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'tr-TR,tr;q=0.9',
    'Referer': 'https://webteizle.info/',
  };

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

    const slugTr = toSlug(trTitle);
    const slugEn = toSlug(origTitle);

    // 2. URL'leri dene
    const urlsToTry = [
      `https://webteizle.info/izle/dublaj/${slugTr}`,
      `https://webteizle.info/izle/altyazi/${slugTr}`,
      `https://webteizle.info/izle/dublaj/${slugEn}`,
      `https://webteizle.info/izle/altyazi/${slugEn}`,
    ].filter(u => !u.endsWith('/'));

    let filmId = null;
    let langHint = 'tr-dub';

    for (const tryUrl of urlsToTry) {
      try {
        const r = await fetch(tryUrl, { signal: AbortSignal.timeout(10000), headers: WEBT_HEADERS });
        if (!r.ok) continue;
        const html = await r.text();
        const m = html.match(/button[^>]+id=["']wip["'][^>]+data-id=["'](\d+)["']/) ||
                  html.match(/data-id=["'](\d+)["']/);
        if (m) {
          filmId = m[1];
          if (tryUrl.includes('/altyazi/')) langHint = 'tr-sub';
          break;
        }
      } catch {
        // try next
      }
    }

    // 3. Fallback: POST arama
    if (!filmId) {
      const searchTitle = trTitle || origTitle;
      const searchRes = await fetch('https://webteizle.info/ajax/arama.asp', {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          ...WEBT_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: new URLSearchParams({ q: searchTitle }).toString(),
      });
      if (searchRes.ok) {
        const searchData = await searchRes.json().catch(() => null);
        const firstUrl = searchData?.data?.results?.filmler?.results?.[0]?.url;
        if (firstUrl) {
          const pageRes = await fetch(firstUrl.startsWith('http') ? firstUrl : `https://webteizle.info${firstUrl}`, {
            signal: AbortSignal.timeout(10000),
            headers: WEBT_HEADERS,
          });
          if (pageRes.ok) {
            const pageHtml = await pageRes.text();
            const m = pageHtml.match(/button[^>]+id=["']wip["'][^>]+data-id=["'](\d+)["']/) ||
                      pageHtml.match(/data-id=["'](\d+)["']/);
            if (m) filmId = m[1];
          }
        }
      }
    }

    if (!filmId) throw new Error('WebteIzle filmId bulunamadı');

    // 4. Embed listesini al
    const altRes = await fetch('https://webteizle.info/ajax/dataAlternatif3.asp', {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        ...WEBT_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams({
        filmid: filmId,
        dil: '0',
        s: season,
        b: episode,
        bot: '0',
      }).toString(),
    });
    if (!altRes.ok) throw new Error(`WebteIzle alternatif HTTP ${altRes.status}`);
    const altData = await altRes.json().catch(() => null);
    const embedList = altData?.data || altData?.results || altData || [];
    const embedItems = Array.isArray(embedList) ? embedList : Object.values(embedList);

    if (embedItems.length === 0) throw new Error('WebteIzle embed listesi boş');

    // 5. Her embed için iframe src al, VidMoly ise m3u8 çıkar
    const sources = [];
    for (const item of embedItems.slice(0, 5)) {
      try {
        const embedId = item.id || item.embed_id;
        if (!embedId) continue;

        const embedRes = await fetch('https://webteizle.info/ajax/dataEmbed.asp', {
          method: 'POST',
          signal: AbortSignal.timeout(10000),
          headers: {
            ...WEBT_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: new URLSearchParams({ id: embedId }).toString(),
        });
        if (!embedRes.ok) continue;
        const embedData = await embedRes.json().catch(() => null);
        const iframeSrc = embedData?.iframe || embedData?.url || embedData?.src || embedData?.data;
        if (!iframeSrc || typeof iframeSrc !== 'string') continue;

        if (/vidmoly/i.test(iframeSrc)) {
          const extracted = await extractVidMoly(iframeSrc, 'https://webteizle.info/');
          if (extracted) {
            sources.push({
              url: extracted.url,
              quality: '1080p',
              name: 'WebteIzle (TR Dublaj)',
              type: 'hls',
              lang: langHint,
              referer: extracted.referer,
            });
          }
        }
      } catch {
        // try next embed
      }
    }

    const result = { sources };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    res.json({ sources: [], error: e.message });
  }
});

// ---- LoveFilmIzle ----
app.get('/api/lovefilmizle', async (req, res) => {
  const { tmdbId, type = 'movie', season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], error: 'tmdbId gerekli' });
  const cacheKey = `lovefilmizle:${tmdbId}:${type}:${season}:${episode}`;
  const hit = cache.get(cacheKey);
  if (hit) return res.json(hit);

  try {
    // 1. IMDb ID al
    let tmdb;
    if (type === 'movie') {
      tmdb = await tmdbMovieWithExternal(tmdbId);
    } else {
      tmdb = await tmdbTvWithExternal(tmdbId);
    }
    const imdbId = tmdb.external_ids?.imdb_id;
    if (!imdbId) throw new Error('IMDb ID bulunamadı');

    // 2. WordPress REST API
    const wpRes = await fetch(
      `https://lovefilmizle.net/wp-json/wp/v2/posts?search=${encodeURIComponent(imdbId)}&per_page=1`,
      {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://lovefilmizle.net/',
        },
      }
    );
    if (!wpRes.ok) throw new Error(`LoveFilmIzle WP API HTTP ${wpRes.status}`);
    const wpData = await wpRes.json().catch(() => []);
    if (!Array.isArray(wpData) || wpData.length === 0) throw new Error('LoveFilmIzle içerik bulunamadı');

    const post = wpData[0];
    const content = post?.content?.rendered || '';

    // 3. Dil tespiti
    let lang = 'tr';
    const taxonomies = post?.dil || post?.categories || [];
    const taxStr = JSON.stringify(taxonomies).toLowerCase();
    if (taxStr.includes('turkce-dublaj') || taxStr.includes('dublaj') || content.includes('dublaj')) {
      lang = 'tr-dub';
    } else if (taxStr.includes('turkce-altyazili') || taxStr.includes('altyazili') || content.includes('altyazili')) {
      lang = 'tr-sub';
    }

    // 4. VidMoly URL'sini çıkar
    let vidmolyUrl = null;
    const m1 = content.match(/src=["\']\/bemoly\/bemoly\.php\?url=(https:\/\/vidmoly[^&"']+)/);
    const m2 = content.match(/src=["'](https:\/\/vidmoly[^"']+)/);
    if (m1) vidmolyUrl = decodeURIComponent(m1[1]);
    else if (m2) vidmolyUrl = m2[1];

    const sources = [];

    if (vidmolyUrl) {
      const extracted = await extractVidMoly(vidmolyUrl, 'https://lovefilmizle.net/');
      if (extracted) {
        sources.push({
          url: extracted.url,
          quality: '1080p',
          name: 'LoveFilmIzle (TR)',
          type: 'hls',
          lang,
          referer: extracted.referer,
        });
      }
    }

    // 5. Fallback: Pixeldrain
    if (sources.length === 0) {
      const pdUrl = extractPixeldrain(content);
      if (pdUrl) {
        sources.push({
          url: pdUrl,
          quality: '1080p',
          name: 'LoveFilmIzle (Pixeldrain)',
          type: 'mp4',
          lang,
        });
      }
    }

    const result = { sources };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    res.json({ sources: [], error: e.message });
  }
});

// ---- All (parallel) ----
app.get('/api/all', async (req, res) => {
  const { tmdbId, type = 'tv', season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], count: 0, error: 'tmdbId gerekli' });

  const base = `http://localhost:${PORT}`;
  const fetchSource = async (url) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return [];
      const d = await r.json().catch(() => ({}));
      return d.sources || [];
    } catch {
      return [];
    }
  };

  let allSources = [];
  if (type === 'tv') {
    const params = `tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`;
    const results = await Promise.all([
      fetchSource(`${base}/api/animecix?${params}`),
      fetchSource(`${base}/api/anizium?${params}`),
      fetchSource(`${base}/api/sonanime?${params}`),
      fetchSource(`${base}/api/sinewix?${params}&type=tv`),
      fetchSource(`${base}/api/dizimom?${params}`),
      fetchSource(`${base}/api/webteizle?${params}&type=tv`),
      fetchSource(`${base}/api/lovefilmizle?${params}&type=tv`),
    ]);
    allSources = results.flat();
  } else {
    // film
    const tmdbParam = `tmdbId=${encodeURIComponent(tmdbId)}`;
    const results = await Promise.all([
      fetchSource(`${base}/api/hdfilmcehennemi?${tmdbParam}`),
      fetchSource(`${base}/api/sinewix?${tmdbParam}&type=movie`),
      fetchSource(`${base}/api/closeload?${tmdbParam}&type=movie`),
      fetchSource(`${base}/api/webteizle?${tmdbParam}&type=movie`),
      fetchSource(`${base}/api/lovefilmizle?${tmdbParam}&type=movie`),
    ]);
    allSources = results.flat();
  }

  res.json({ sources: allSources, count: allSources.length });
});

app.listen(PORT, () => {
  console.log(`anthology-scraper listening on port ${PORT}`);
});
