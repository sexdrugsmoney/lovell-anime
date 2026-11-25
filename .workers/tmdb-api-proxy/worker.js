// TMDB API Proxy — Cloudflare Worker
// api.themoviedb.org ve api.tmdb.org'u proxy'ler
// TMDB_API_KEY secret olarak ya da URL parametresiyle geçilebilir

const TMDB_HOSTS = ['api.themoviedb.org', 'api.tmdb.org'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Yalnızca GET ve HEAD kabul et
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Yol: /3/... → api.themoviedb.org/3/...
    const pathname = url.pathname;
    if (!pathname.startsWith('/3/')) {
      return new Response('Geçersiz TMDB uç noktası. /3/ ile başlamalı.', { status: 400 });
    }

    // API key: URL'den ya da env'den al
    const apiKey = url.searchParams.get('api_key') || (env && env.TMDB_API_KEY) || '';

    const targetParams = new URLSearchParams(url.searchParams);
    if (apiKey && !targetParams.get('api_key')) {
      targetParams.set('api_key', apiKey);
    }

    // İki TMDB host'u sırayla dene
    let lastError;
    for (const host of TMDB_HOSTS) {
      const targetUrl = `https://${host}${pathname}?${targetParams}`;
      try {
        const resp = await fetch(targetUrl, {
          method: request.method,
          headers: { 'user-agent': 'Mozilla/5.0', 'accept': 'application/json' },
          signal: AbortSignal.timeout(8000),
          cf: { cacheTtl: 300, cacheEverything: true },
        });
        if (!resp.ok) { lastError = resp; continue; }

        const body = request.method === 'HEAD' ? null : resp.body;
        return new Response(body, {
          status: resp.status,
          headers: {
            'Content-Type': resp.headers.get('Content-Type') || 'application/json',
            'Cache-Control': 'public, max-age=300, s-maxage=300',
            'Access-Control-Allow-Origin': '*',
            'X-Proxied-By': 'lovell-tmdb-proxy',
          },
        });
      } catch (e) {
        lastError = e;
      }
    }

    return new Response(JSON.stringify({ error: 'TMDB erişilemiyor', detail: String(lastError) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  },
};
