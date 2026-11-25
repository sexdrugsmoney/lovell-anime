// TMDB Image Proxy — Cloudflare Worker
// image.tmdb.org görsellerini proxy'ler; 7 gün cache'ler
// Kullanım: https://tmdb-img.{account}.workers.dev/t/p/w500/poster.jpg

const IMAGE_HOST = 'image.tmdb.org';
const ALLOWED_SIZES = new Set([
  'w92','w154','w185','w342','w500','w780','original',
  'h632','w300_and_h450_bestv2','w300_and_h169_bestv2',
]);

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // /t/p/{size}/{file} formatı zorunlu
    const match = url.pathname.match(/^\/t\/p\/([\w]+)\/([\w.%-]+)$/);
    if (!match) {
      return new Response('Geçersiz görsel yolu. /t/p/{boyut}/{dosya} formatı gerekli.', { status: 400 });
    }

    const [, size, file] = match;

    // Geçersiz boyutları reddet
    if (!ALLOWED_SIZES.has(size) && !/^w\d{2,4}$/.test(size)) {
      return new Response('Geçersiz boyut parametresi.', { status: 400 });
    }

    // Dosya adında tehlikeli karakter var mı?
    if (!/^[\w.\-]+$/.test(file)) {
      return new Response('Geçersiz dosya adı.', { status: 400 });
    }

    const targetUrl = `https://${IMAGE_HOST}/t/p/${size}/${file}`;

    try {
      const resp = await fetch(targetUrl, {
        method: request.method,
        headers: { 'user-agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000),
        cf: { cacheTtl: 604800, cacheEverything: true },  // 7 gün CF cache
      });

      if (!resp.ok) {
        return new Response(`TMDB görsel sunucusu hata döndürdü: ${resp.status}`, { status: resp.status });
      }

      const contentType = resp.headers.get('Content-Type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) {
        return new Response('Görsel değil.', { status: 502 });
      }

      const body = request.method === 'HEAD' ? null : resp.body;
      return new Response(body, {
        status: resp.status,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=604800, immutable',
          'Access-Control-Allow-Origin': '*',
          'X-Proxied-By': 'lovell-tmdb-image-proxy',
        },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Görsel alınamadı', detail: String(e) }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};
