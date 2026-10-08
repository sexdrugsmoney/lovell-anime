import './lib/env.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from './lib/env.js';
import {tmdbGet, netStatus} from './lib/net.js';
import {browse, search, home, detail, episodes, GENRES, dataErrors} from './lib/catalog.js';
import {sources, library, resolveMedia, srtToVtt, scan, MEDIA_DIR, vidriftUrl, embedSources, cineproSources} from './lib/media.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.vtt': 'text/vtt; charset=utf-8',
  '.aac': 'audio/aac'
};
const PUBLIC_FILES = /^(index\.html|src\/(main\.js|style\.css|.*)|public\/[\w./-]+)$/;
const ALLOWED_IMG_HOSTS = new Set(['s4.anilist.co', 's3.anilist.co', 'img.anili.st', 'image.tmdb.org', 'media.themoviedb.org']);
const imgCache = new Map();

const json = (res, status, data, maxAge = 0) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store'
  });
  res.end(JSON.stringify(data));
};
const esc = s => String(s).replace(/[<>&"']/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'}[c]));

function placeholder(title = '') {
  const t = esc(title.slice(0, 32));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513" viewBox="0 0 342 513"><rect width="342" height="513" fill="#1c2140"/><path d="M0 400 342 300V513H0Z" fill="#232951"/><g transform="translate(139 190)" fill="none" stroke="#3a4280" stroke-width="6"><rect x="0" y="0" width="64" height="64" rx="14"/><path d="M26 20v24l18-12z" fill="#3a4280" stroke="none"/></g><text x="171" y="310" text-anchor="middle" fill="#aab0d6" font-family="system-ui,sans-serif" font-size="17">${t}</text></svg>`;
}

async function imageProxy(u, res) {
  const p = u.searchParams.get('p');
  const remote = u.searchParams.get('u');
  const title = u.searchParams.get('t') || '';
  const key = p ? 'p:' + p : 'u:' + remote;
  const hit = imgCache.get(key);
  const send = d => {
    res.writeHead(200, {'Content-Type': d.type, 'Cache-Control': 'public, max-age=604800, immutable'});
    res.end(d.body);
  };
  if (hit) return send(hit);
  try {
    let d;
    if (p) {
      if (!/^\/t\/p\/(w\d{2,4}|original)\/[\w-]+\.(jpg|png|webp|svg)$/.test(p)) return json(res, 400, {error: 'Geçersiz görsel yolu'});
      const r = await tmdbGet('image', p);
      if (r.status !== 200) throw Error('HTTP ' + r.status);
      d = {type: r.type, body: r.body};
    } else if (remote) {
      let url;
      try { url = new URL(remote); } catch {}
      if (!url || url.protocol !== 'https:' || !ALLOWED_IMG_HOSTS.has(url.hostname) || url.port || url.username) return json(res, 400, {error: 'Bu görsel sunucusuna izin verilmiyor'});
      const r = await fetch(url, {signal: AbortSignal.timeout(8000), redirect: 'error'});
      if (!r.ok) throw Error('HTTP ' + r.status);
      d = {type: r.headers.get('content-type'), body: Buffer.from(await r.arrayBuffer())};
    } else throw Error('boş');
    if (!d.type?.startsWith('image/') || d.body.length > 6e6) throw Error('Görsel değil');
    if (imgCache.size > 300) imgCache.delete(imgCache.keys().next().value);
    imgCache.set(key, d);
    return send(d);
  } catch {
    res.writeHead(200, {'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store'});
    res.end(placeholder(title));
  }
}

function serveFile(req, res, file, {cache = 'no-cache'} = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch { return json(res, 404, {error: 'Bulunamadı'}); }
  if (!stat.isFile()) return json(res, 404, {error: 'Bulunamadı'});
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? +range[1] : stat.size - +range[2];
    let end = range[1] && range[2] ? Math.min(+range[2], stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end || start < 0) {
      res.writeHead(416, {'Content-Range': `bytes */${stat.size}`});
      return res.end();
    }
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cache
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, {start, end}).pipe(res);
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function decodeSubtitle(buf) {
  try { return new TextDecoder('utf-8', {fatal: true}).decode(buf); } catch { return new TextDecoder('windows-1254').decode(buf); }
}

const int = (v, d = 1) => (/^\d{1,4}$/.test(v || '') ? Number(v) : d);

export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, {error: 'Desteklenmeyen istek'});
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch { return json(res, 400, {error: 'Geçersiz adres'}); }
  const q = u.searchParams;
  try {
    // ---- API ----
    if (u.pathname === '/api/status') return json(res, 200, {...netStatus(), dataErrors, mediaDir: MEDIA_DIR(), library: library().length});
    if (u.pathname === '/api/genres') return json(res, 200, GENRES.map(({slug, name}) => ({slug, name})), 86400);
    if (u.pathname === '/api/home') return json(res, 200, await home(), 300);
    if (u.pathname === '/api/browse') return json(res, 200, await browse({kind: q.get('kind'), genre: q.get('genre') || '', sort: q.get('sort') || 'popular', page: int(q.get('page')), q: q.get('q') || ''}), 300);
    if (u.pathname === '/api/search') return json(res, 200, await search(q.get('q')), 300);
    let m = u.pathname.match(/^\/api\/title\/(tv|movie|al)\/(\d{1,9})$/);
    if (m) return json(res, 200, await detail(m[1], m[2]), 600);
    m = u.pathname.match(/^\/api\/episodes\/(tv|movie|al)\/(\d{1,9})$/);
    if (m) return json(res, 200, await episodes(m[1], m[2], int(q.get('season'))), 600);
    m = u.pathname.match(/^\/api\/play\/(tv|movie|al)\/(\d{1,9})$/);
    if (m) {
      const kind = m[1], id = Number(m[2]);
      const season = int(q.get('s')), episode = int(q.get('e'));
      const alId = q.get('alId') ? Number(q.get('alId')) : null;
      const folder = `${kind}-${id}`;

      // Paralel: yerel dosyalar + CinePro kaynak sorgusu
      const [localSources, cinepro] = await Promise.all([
        Promise.resolve(sources(kind, id, season, episode)),
        // CinePro yalnızca tv/movie için — al kind için TMDB id yok
        (kind !== 'al')
          ? cineproSources(kind, id, alId, season, episode).catch(() => [])
          : Promise.resolve([]),
      ]);

      // Embed sağlayıcıları (iframe tabanlı)
      const embeds = embedSources(kind, id, alId, season, episode);

      // VidRift hala tek embed olarak da açık kalıyor (geriye dönük uyumluluk)
      const vidrift = embeds.find(e => e.id === 'vidrift')?.url || null;

      return json(res, 200, {
        sources: [...localSources, ...cinepro],
        embeds,
        vidrift,  // eskiyle uyumluluk
        folder,
      });
    }
    if (u.pathname === '/api/library') return json(res, 200, {items: library()});    if (u.pathname === '/api/rescan') { scan(true); return json(res, 200, {items: library()}); }
    if (u.pathname === '/api/img') return imageProxy(u, res);
    if (u.pathname === '/api/sub') {
      const file = resolveMedia(q.get('f') || '');
      if (!file || !/\.(srt|vtt)$/i.test(file)) return json(res, 400, {error: 'Geçersiz altyazı'});
      let text;
      try { text = decodeSubtitle(fs.readFileSync(file)); } catch { return json(res, 404, {error: 'Altyazı bulunamadı'}); }
      res.writeHead(200, {'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-cache'});
      return res.end(/\.srt$/i.test(file) ? srtToVtt(text) : text);
    }
    if (u.pathname.startsWith('/api/')) return json(res, 404, {error: 'Bilinmeyen uç nokta'});

    // ---- Yerel videolar ----
    if (u.pathname.startsWith('/media/')) {
      let rel;
      try { rel = decodeURIComponent(u.pathname.slice(7)); } catch { return json(res, 400, {error: 'Geçersiz yol'}); }
      const file = resolveMedia(rel);
      if (!file || !TYPES[path.extname(file).toLowerCase()] || /\.(html|js|css|svg|json)$/i.test(file)) return json(res, 403, {error: 'Erişim yok'});
      return serveFile(req, res, file, {cache: 'private, max-age=3600'});
    }

    // ---- Statik dosyalar ----
    let rel;
    try { rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html'; } catch { return json(res, 400, {error: 'Geçersiz yol'}); }
    if (rel.includes('..') || !PUBLIC_FILES.test(rel)) return json(res, 404, {error: 'Bulunamadı'});
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep)) return json(res, 403, {error: 'Erişim yok'});
    return serveFile(req, res, file, {cache: rel.startsWith('public/') ? 'public, max-age=86400' : 'no-cache'});
  } catch (e) {
    if (res.headersSent) return res.end();
    return json(res, e.status === 400 ? 400 : 503, {error: e.message || 'İstek başarısız', details: e.details});
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`\n  LOVELL çalışıyor → http://localhost:${port}\n  Video klasörü: ${MEDIA_DIR()}\n  Bağlantı testi: npm run doctor\n`));
  server.on('error', e => {
    console.error(e.code === 'EADDRINUSE' ? `${port} numaralı port kullanımda. Örnek: PORT=3002 npm start` : e.message);
    process.exitCode = 1;
  });
}
