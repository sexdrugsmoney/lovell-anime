import {test, before} from 'node:test';
import assert from 'node:assert/strict';
import {kvProfileStore, profileRequest} from '../lib/profiles.js';

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
  if (url.hostname === 'dizi83.life' || url.hostname === 'hdfilmizle.to' || url.hostname === 'www.hdfilmizle.to') return new Response('', {status: 200, headers: {'content-type': 'text/html'}});
  if (url.hostname === 'animecix.tv' || url.hostname === 'tau-video.xyz') return new Response('{"results":[],"videos":[]}', {status: 200, headers: {'content-type': 'application/json'}});
  const dubHosts = new Set([
    'www.diziyou.one', 'diziyou.one', 'storage.diziyou.one', 'cdn.diziyou.one',
    'dizilla.la', 'dizilla.nl', 'pichive.online', 'four.pichive.online',
    'www.hdfilmcehennemi.nl', 'hdfilmcehennemi.nl',
    'www.fullhdfilmizlesene.now', 'fullhdfilmizlesene.now',
    'filmmakinesi.to', 'closeload.filmmakinesi.to',
    'selcukflix.app', 'jetfilmizle.now', 'videopark.top',
    'sinemacc.com', 'hdfilm.us', 'filmmodu.cc', 'vidmixi.com',
  ]);
  if (dubHosts.has(url.hostname)) return new Response(url.pathname.includes('search') ? '{"results":[]}' : '', {status: 200, headers: {'content-type': 'text/html'}});
  if (url.hostname === 'graphql.anilist.co') return j({data: {Media: null}});
  if (url.hostname === 'api.mangadex.org' || url.hostname === 'uploads.mangadex.org') return j({data: []});
  if (url.hostname === 'searchify.bextercontact.workers.dev' && url.pathname === '/api/lookup') {
    const body = JSON.parse(init.body || '{}');
    if (!body.urlOrId) return new Response(JSON.stringify({error: 'gerekli'}), {status: 400, headers: {'content-type': 'application/json'}});
    return j({success: true, data: {trackId: 'abc', trackName: 'Deneme', artists: 'Sanatçı', isrc: 'TRABC123', distributor: 'TuneCore'}});
  }
  return realFetch(input, init);
};
const {default: worker} = await import('../worker/index.js');
const box = new Map();
const kv = {
  get: async key => box.get(key) ?? null,
  put: async (key, value) => { box.set(key, value); },
  delete: async key => { box.delete(key); },
  list: async ({prefix} = {}) => ({keys: [...box.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({name})), list_complete: true}),
};
let pass = '';
const env = {TMDB_READ_TOKEN: 'jeton', PROFILES: kv, ADMIN_PASSWORD: 'worker-password-123', ADMIN_PATH: 'm4n8q2w6e9r3t7y5u1i0o', ASSETS: {fetch: req => new Response('statik:' + new URL(req.url).pathname)}};
before(async () => {
  const created = await profileRequest({method: 'POST', admin: true, body: {name: 'Test'}, store: kvProfileStore(kv), ip: 'boot'});
  pass = 'lovell_pass=' + encodeURIComponent(created.data.key);
});
const call = p => worker.fetch(new Request('https://lovell.example.workers.dev' + p, {headers: {cookie: pass}}), env);

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
    {name: 'Kendi HLS yayınım', dub: true, lang: 'tr', type: 'hls', url: 'https://media.example.test/anime/7/1.m3u8', subtitles: [{lang: 'tr', url: 'https://media.example.test/anime/7/1.vtt'}]},
    {name: 'Güvensiz', url: 'http://media.example.test/video.mp4'},
  ]} : null}};
  const res = await worker.fetch(new Request('https://lovell.example.workers.dev/api/play/tv/7?s=1&e=1', {headers: {cookie: pass}}), sourceEnv);
  const d = await res.json();
  assert.deepEqual(d.sources, [{name: 'Kendi HLS yayınım', origin: 'manifest', dub: true, lang: 'tr', type: 'hls', url: 'https://media.example.test/anime/7/1.m3u8', subtitles: [{label: 'tr', lang: 'tr', url: 'https://media.example.test/anime/7/1.vtt'}]}]);
});
test('görseller Cloudflare üzerinden vekillenir, yabancı sunucu reddedilir', async () => {
  const r = await call('/api/img?p=' + encodeURIComponent('/t/p/w342/p.jpg'));
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal((await call('/api/img?u=' + encodeURIComponent('https://example.com/x.jpg'))).status, 400);
});
test('statik dosyalar ASSETS üzerinden sunulur', async () => {
  assert.equal(await (await call('/src/main.js')).text(), 'statik:/src/main.js');
});
test('profil anahtarı KV içinde özetle saklanır ve yalnızca yönetici üretir', async () => {
  assert.equal((await worker.fetch(new Request('https://lovell.example.workers.dev/api/home'), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://lovell.example.workers.dev/api/profile', {method: 'POST', body: '{}'}), env)).status, 404);
  const box = new Map();
  const kv = {
    get: async key => box.get(key) ?? null,
    put: async (key, value) => { box.set(key, value); },
    delete: async key => { box.delete(key); },
    list: async ({prefix} = {}) => ({keys: [...box.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({name})), list_complete: true}),
  };
  const kvEnv = {...env, PROFILES: kv, ADMIN_PASSWORD: 'worker-password-123', ADMIN_PATH: 'm4n8q2w6e9r3t7y5u1i0o'};
  const send = (path, opts = {}) => worker.fetch(new Request('https://lovell.example.workers.dev' + path, opts), kvEnv);
  assert.equal((await send('/api/profile', {method: 'POST', body: '{"name":"Ece"}'})).status, 404);
  assert.equal((await (await send('/baska-bir-sayfa')).text()).includes('Devam etmek için parola'), false);
  const login = await send('/' + kvEnv.ADMIN_PATH, {method: 'POST', headers: {'cf-connecting-ip': '203.0.113.9'}, body: JSON.stringify({op: 'login', password: kvEnv.ADMIN_PASSWORD})});
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const created = await (await send('/' + kvEnv.ADMIN_PATH, {method: 'POST', headers: {cookie, 'cf-connecting-ip': '203.0.113.9'}, body: JSON.stringify({op: 'create', name: 'Ece'})})).json();
  assert.equal(created.profile.name, 'Ece');
  assert.equal([...box.keys()].some(k => k.startsWith('profile:') && !k.includes(created.key)), true);
  const again = await (await send('/api/profile', {headers: {'x-lovell-key': created.key}})).json();
  assert.equal(again.name, 'Ece');
  assert.equal((await worker.fetch(new Request('https://lovell.example.workers.dev/api/home', {method: 'POST'}), env)).status, 401);
  assert.equal((await send('/api/home', {method: 'POST', headers: {cookie: 'lovell_pass=' + encodeURIComponent(created.key)}})).status, 405);
});
test('Speedfy sıralaması anahtar ister, kaydeder ve karşılaştırır', async () => {
  assert.equal((await worker.fetch(new Request('https://lovell.example.workers.dev/api/speed/board'), env)).status, 401);
  const body = {duration: 30, lang: 'tr', wpm: 80, acc: 95, raw: 84, chars: {correct: 200, incorrect: 8, extra: 2, missed: 4}};
  const res = await worker.fetch(new Request('https://lovell.example.workers.dev/api/speed/result', {method: 'POST', headers: {cookie: pass, 'content-type': 'application/json'}, body: JSON.stringify(body)}), env);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.result.wpm, 80);
  assert.equal(d.board[0].you, true);
  const board = await (await call('/api/speed/board?duration=30&lang=tr')).json();
  assert.equal(board.me.rank, 1);
  assert.equal((await worker.fetch(new Request('https://lovell.example.workers.dev/api/speed/result', {method: 'POST', headers: {cookie: pass, 'content-type': 'application/json'}, body: JSON.stringify({...body, wpm: 12})}), env)).status, 400);
});
test('Lovellify Searchify vekili anahtar ister ve sonucu döndürür', async () => {
  assert.equal((await worker.fetch(new Request('https://lovell.example.workers.dev/api/music/lookup', {method: 'POST', body: '{"urlOrId":"x"}'}), env)).status, 401);
  const res = await worker.fetch(new Request('https://lovell.example.workers.dev/api/music/lookup', {method: 'POST', headers: {cookie: pass, 'content-type': 'application/json'}, body: JSON.stringify({urlOrId: 'Sanatçı Şarkı'})}), env);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.data.trackName, 'Deneme');
  assert.equal(d.data.distributor, 'TuneCore');
});
