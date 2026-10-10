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
  res.json({ status: 'ok', service: 'anthology-scraper' });
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

// ---- All (parallel) ----
app.get('/api/all', async (req, res) => {
  const { tmdbId, type = 'tv', season = '1', episode = '1' } = req.query;
  if (!tmdbId) return res.json({ sources: [], count: 0, error: 'tmdbId gerekli' });

  const base = `http://localhost:${PORT}`;
  const fetchSource = async (url) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
    const [a, b, c] = await Promise.all([
      fetchSource(`${base}/api/animecix?${params}`),
      fetchSource(`${base}/api/anizium?${params}`),
      fetchSource(`${base}/api/sonanime?${params}`),
    ]);
    allSources = [...a, ...b, ...c];
  } else {
    allSources = await fetchSource(`${base}/api/hdfilmcehennemi?tmdbId=${encodeURIComponent(tmdbId)}`);
  }

  res.json({ sources: allSources, count: allSources.length });
});

app.listen(PORT, () => {
  console.log(`anthology-scraper listening on port ${PORT}`);
});
