// TMDB için ücretsiz Cloudflare Worker vekili (kurulum README'de).
// İki biçimi de destekler:
//   https://WORKER/3/discover/tv?...            (TMDB_PROXY_STYLE=path, varsayılan)
//   https://WORKER/?endpoint=/discover/tv&...   (TMDB_PROXY_STYLE=query)
//   https://WORKER/image/w342/abc.jpg  veya  /t/p/w342/abc.jpg   (görseller)
// İsteğe bağlı: Worker ayarlarında TMDB_API_KEY adında bir "secret" tanımlarsan
// anahtar istemciden gelmese bile Worker kendisi ekler.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let upstream, isImage = false;
    if (url.pathname.startsWith('/image/') || url.pathname.startsWith('/t/p/')) {
      isImage = true;
      upstream = 'https://image.tmdb.org/t/p/' + url.pathname.replace(/^\/(image|t\/p)\//, '');
    } else {
      let path = url.pathname, params = new URLSearchParams(url.search);
      if (params.has('endpoint')) { path = '/3' + params.get('endpoint'); params.delete('endpoint'); }
      if (!path.startsWith('/3/')) return new Response('Bulunamadı', {status: 404});
      if (!params.has('api_key') && !request.headers.get('authorization') && env?.TMDB_API_KEY) params.set('api_key', env.TMDB_API_KEY);
      upstream = 'https://api.themoviedb.org' + path + '?' + params;
    }
    const headers = {accept: request.headers.get('accept') || '*/*'};
    const auth = request.headers.get('authorization');
    if (auth) headers.authorization = auth;
    const res = await fetch(upstream, {headers, cf: {cacheTtl: isImage ? 604800 : 600, cacheEverything: true}});
    return new Response(res.body, {status: res.status, headers: {
      'content-type': res.headers.get('content-type') || 'application/json',
      'cache-control': isImage ? 'public, max-age=604800' : 'public, max-age=600',
      'access-control-allow-origin': '*',
    }});
  },
};
