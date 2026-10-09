// VidRock Stream Resolver
// GET /api/resolve?type=movie&id=27205
// GET /api/resolve?type=tv&id=1396&season=1&episode=1
// GET /health

import express from 'express';
import crypto from 'node:crypto';

const app = express();
const PORT = process.env.PORT || 3001;
const VIDROCK_ORIGIN = 'https://vidrock.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// In-memory cache: key -> {sources, expires}
const cache = new Map();
const CACHE_TTL = 3600 * 1000; // 1 saat

function cacheKey(type, id, season, episode) {
  return `${type}:${id}:${season}:${episode}`;
}

// VidRock API'den şifreli kaynakları çek ve çöz
async function resolveVidRock(type, id, season = 1, episode = 1) {
  const key = cacheKey(type, id, season, episode);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.sources;

  // API URL
  const apiUrl = type === 'movie'
    ? `${VIDROCK_ORIGIN}/api/sources/movie/${id}`
    : `${VIDROCK_ORIGIN}/api/sources/tv/${id}/${season}/${episode}`;

  const headers = {
    'User-Agent': UA,
    'Referer': VIDROCK_ORIGIN + '/',
    'Origin': VIDROCK_ORIGIN,
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };

  const res = await fetch(apiUrl, {headers, signal: AbortSignal.timeout(15000)});
  if (!res.ok) throw new Error(`VidRock API ${res.status}`);

  const data = await res.json();

  // Şifreli payload çöz (AES-256-GCM)
  let sources = [];
  if (data.encrypted && data.data) {
    try {
      // Client bundle key (vidrock-stream-resolver referansından)
      const keyHex = data.key || process.env.VIDROCK_KEY || '';
      if (keyHex) {
        const raw = Buffer.from(data.data, 'base64url');
        const iv = raw.slice(0, 12);
        const tag = raw.slice(-16);
        const ciphertext = raw.slice(12, -16);
        const key = Buffer.from(keyHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        sources = JSON.parse(plain.toString());
      }
    } catch { sources = []; }
  } else if (Array.isArray(data.sources)) {
    sources = data.sources;
  } else if (Array.isArray(data)) {
    sources = data;
  }

  // Sadece https URL'leri kabul et
  const cleaned = sources.filter(s => {
    try { return new URL(s?.url).protocol === 'https:'; } catch { return false; }
  }).map(s => ({
    url: s.url,
    type: s.type || (s.url?.includes('.m3u8') ? 'hls' : 'mp4'),
    quality: s.quality || s.label || 'Auto',
    server: s.server || s.name || 'VidRock',
  }));

  cache.set(key, {sources: cleaned, expires: Date.now() + CACHE_TTL});
  // Cache 200 entry sınırı
  if (cache.size > 200) cache.delete(cache.keys().next().value);

  return cleaned;
}

app.get('/health', (_, res) => res.json({status: 'ok', service: 'vidrock-resolver'}));

app.get('/api/resolve', async (req, res) => {
  const {type, id, season = '1', episode = '1'} = req.query;
  
  if (!type || !id || !/^(movie|tv)$/.test(type) || !/^\d+$/.test(id)) {
    return res.status(400).json({error: 'type (movie|tv) ve id gerekli'});
  }

  try {
    const sources = await resolveVidRock(type, id, Number(season), Number(episode));
    res.json({sources, count: sources.length});
  } catch (e) {
    res.status(502).json({error: e.message, sources: []});
  }
});

app.listen(PORT, () => console.log(`VidRock Resolver :${PORT}`));
