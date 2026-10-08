import {test} from 'node:test';
import assert from 'node:assert/strict';

// Cloudflare Worker sürümü: TMDB'ye Bearer jetonla gider, görselleri vekiller, statik dosyaları ASSETS'e bırakır.
const seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  seen.push({url, init});
  const j = d => new Response(JSON.stringify(d), {headers: {'content-type': 'application/json'}});
  if (url.hostname === 'api.themoviedb.org') {
    if (url.pathname === '/3/discover/tv' || url.pathname === '/3/discover/movie') return j({page: 1, total_pages: 2, results: [{id: 7, name: 'Bulut Anime', genre_ids: [16], original_language: 'ja', overview: 'Özet', backdrop_path: '/b.jpg', poster_path: '/p.jpg', first_air_date: '2026-01-01', vote_average: 8}]});
    if (url.pathname === '/3/tv/7') return j({id: 7, name: 'Bulut Anime', genres: [{id: 16}], original_language: 'ja', overview: 'Özet', seasons: [{season_number: 1, episode_count: 1}]});
    return new Response('{"status_message":"yok"}', {status: 404, headers: {'content-type': 'application/json'}});
  }
  if (url.hostname === 'image.tmdb.org') return new Response(new Uint8Array([1, 2, 3]), {headers: {'content-type': 'image/jpeg'}});
  if (url.hostname === 'graphql.anilist.co') return j({data: {Media: null}});
  return realFetch(input, init);
};
const {default: worker} = await import('../worker/index.js');
const env = {TMDB_READ_TOKEN: 'jeton', ASSETS: {fetch: req => new Response('statik:' + new URL(req.url).pathname)}};
const call = p => worker.fetch(new Request('https://lovell.example.workers.dev' + p), env);

test('ana sayfa TMDB verisiyle ve Bearer jetonla gelir', async () => {
  const d = await (await call('/api/home')).json();
  assert.equal(d.source, 'TMDB');
  assert.equal(d.shelves[0].items[0].title, 'Bulut Anime');
  const tm = seen.find(s => s.url.hostname === 'api.themoviedb.org');
  assert.equal(tm.init.headers.authorization, 'Bearer jeton');
  assert.equal(tm.url.searchParams.get('api_key'), null);
});
test('durum bulut modunu bildirir, oynatma kaynağı uydurmaz', async () => {
  assert.equal((await (await call('/api/status')).json()).mode, 'cloud');
  assert.deepEqual((await (await call('/api/play/tv/7?s=1&e=1')).json()).sources, []);
});
test('Worker, HTTPS olan sahipli kaynak kayıtlarını oynatıcıya iletir', async () => {
  const sourceEnv = {...env, MEDIA_SOURCES: {get: async key => key === 'tv:7:1:1' ? {sources: [
    {name: 'Kendi HLS yayınım', type: 'hls', url: 'https://media.example.test/anime/7/1.m3u8', subtitles: [{lang: 'tr', url: 'https://media.example.test/anime/7/1.vtt'}]},
    {name: 'Güvensiz', url: 'http://media.example.test/video.mp4'},
  ]} : null}};
  const res = await worker.fetch(new Request('https://lovell.example.workers.dev/api/play/tv/7?s=1&e=1'), sourceEnv);
  const d = await res.json();
  assert.deepEqual(d.sources, [{name: 'Kendi HLS yayınım', type: 'hls', url: 'https://media.example.test/anime/7/1.m3u8', subtitles: [{label: 'tr', lang: 'tr', url: 'https://media.example.test/anime/7/1.vtt'}]}]);
});
test('görseller Cloudflare üzerinden vekillenir, yabancı sunucu reddedilir', async () => {
  const r = await call('/api/img?p=' + encodeURIComponent('/t/p/w342/p.jpg'));
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal((await call('/api/img?u=' + encodeURIComponent('https://example.com/x.jpg'))).status, 400);
});
test('statik dosyalar ASSETS üzerinden sunulur', async () => {
  assert.equal(await (await call('/src/main.js')).text(), 'statik:/src/main.js');
});
