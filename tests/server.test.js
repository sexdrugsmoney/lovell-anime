import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Sahte TMDB sunucusu: TMDB_PROXY_URL üzerinden gerçek veri yolunu sınar.
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = d => { res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(d)); };
  if (u.pathname === '/3/discover/tv') return send({page: 1, total_pages: 3, total_results: 60, results: [{id: 1, name: 'Deneme Anime', original_name: 'テスト', genre_ids: [16, 10759], original_language: 'ja', poster_path: '/p.jpg', backdrop_path: '/b.jpg', overview: 'Özet', first_air_date: '2024-01-01', vote_average: 8.24}]});
  if (u.pathname === '/3/discover/movie') return send({page: 1, total_pages: 1, results: []});
  if (u.pathname === '/3/tv/1') return send({id: 1, name: 'Deneme Anime', genres: [{id: 16}, {id: 18}], original_language: 'ja', overview: 'Özet', first_air_date: '2024-01-01', vote_average: 8, seasons: [{season_number: 0, episode_count: 2}, {season_number: 1, episode_count: 2, name: 'Sezon 1'}], videos: {results: [{site: 'YouTube', type: 'Trailer', key: 'abc', official: true}]}, 'watch/providers': {results: {TR: {link: 'https://www.themoviedb.org/tv/1/watch', flatrate: [{provider_name: 'Netflix', logo_path: '/n.jpg'}]}}}});
  if (u.pathname === '/3/tv/1/season/1') return send({episodes: [{episode_number: 1, name: 'Başlangıç', air_date: '2024-01-01', runtime: 24}, {episode_number: 2, name: 'Gelecek', air_date: '2999-01-01'}]});
  res.writeHead(404, {'content-type': 'application/json'}); res.end('{"status_message":"yok"}');
});
let base, media, srv;
before(async () => {
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  process.env.TMDB_PROXY_URL = `http://127.0.0.1:${fake.address().port}`;
  media = fs.mkdtempSync(path.join(os.tmpdir(), 'lovell-'));
  fs.mkdirSync(path.join(media, 'tv-1', 'Season 1'), {recursive: true});
  fs.writeFileSync(path.join(media, 'tv-1', 'Season 1', 'Deneme - 01.mp4'), Buffer.alloc(2048, 1));
  fs.writeFileSync(path.join(media, 'tv-1', 'S01E02.webm'), Buffer.alloc(10));
  fs.writeFileSync(path.join(media, 'tv-1', 'S01E02.tr.srt'), Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\nT\xfcrk\xe7e alt yaz\xfd\r\n', 'latin1'));
  process.env.MEDIA_DIR = media;
  const {server} = await import('../server.js');
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  srv = server;
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(r => { fake.close(); srv.close(r); }));
const get = p => fetch(base + p);

test('ana sayfa ve modüller doğru türde sunulur', async () => {
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /LOVELL/);
  assert.match((await get('/src/main.js')).headers.get('content-type'), /javascript/);
});
test('sunucu dosyaları, .env ve klasör dışı yollar okunamaz', async () => {
  for (const p of ['/server.js', '/.env', '/streams.json', '/lib/net.js', '/src/..%2fserver.js', '/media/..%2f..%2fetc%2fpasswd', '/public/..%2fserver.js']) assert.ok([400, 403, 404].includes((await get(p)).status), p);
});
test('TMDB verisi vekil yolundan okunur ve dönüştürülür', async () => {
  const d = await (await get('/api/browse?kind=tv')).json();
  assert.equal(d.source, 'TMDB');
  assert.equal(d.items[0].title, 'Deneme Anime');
  assert.equal(d.items[0].score, 8.2);
  assert.match(d.items[0].poster, /^\/api\/img\?p=/);
});
test('ayrıntı: fragman, Türkiye yayıncıları ve sezonlar', async () => {
  const d = await (await get('/api/title/tv/1')).json();
  assert.equal(d.trailer.key, 'abc');
  assert.equal(d.providers.region, 'TR');
  assert.equal(d.providers.stream[0].name, 'Netflix');
  assert.deepEqual(d.seasons.map(s => s.n), [1]);
});
test('yayınlanmamış bölümler listelenmez', async () => {
  const d = await (await get('/api/episodes/tv/1?season=1')).json();
  assert.deepEqual(d.episodes.map(e => e.n), [1]);
});
test('yerel video dosyaları bulunur, aralık isteği desteklenir', async () => {
  const p1 = await (await get('/api/play/tv/1?s=1&e=1')).json();
  assert.equal(p1.sources.length, 1);
  const r = await fetch(base + p1.sources[0].url, {headers: {range: 'bytes=0-99'}});
  assert.equal(r.status, 206);
  assert.equal((await r.arrayBuffer()).byteLength, 100);
  const p2 = await (await get('/api/play/tv/1?s=1&e=2')).json();
  assert.equal(p2.sources[0].type, 'webm');
  const vtt = await (await get(p2.sources[0].subtitles[0].url)).text();
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /00:00:01\.000/);
  assert.match(vtt, /Türkçe alt yazı/);
});
test('görsel vekili rastgele sunuculara izin vermez, başlığı kaçışlar', async () => {
  for (const u of ['http://127.0.0.1/x', 'https://example.com/a.jpg']) assert.equal((await get('/api/img?u=' + encodeURIComponent(u))).status, 400);
  assert.equal((await get('/api/img?p=' + encodeURIComponent('/../../etc'))).status, 400);
});
test('geçersiz kimlikler reddedilir', async () => {
  assert.equal((await get('/api/title/tv/abc')).status, 404);
  assert.equal((await get('/api/title/foo/1')).status, 404);
});

test('query biçimli vekil (?endpoint=) doğru adrese çevrilir', async () => {
  const seen = [];
  const q = http.createServer((req, res) => { seen.push(req.url); res.writeHead(200, {'content-type': 'application/json'}); res.end('{"page":1,"total_pages":1,"results":[]}'); });
  await new Promise(r => q.listen(0, '127.0.0.1', r));
  const old = [process.env.TMDB_PROXY_URL, process.env.TMDB_PROXY_STYLE];
  process.env.TMDB_PROXY_URL = `http://127.0.0.1:${q.address().port}`;
  process.env.TMDB_PROXY_STYLE = 'query';
  const {tmdbJson} = await import('../lib/net.js');
  await tmdbJson('discover/tv', {with_keywords: 210024});
  [process.env.TMDB_PROXY_URL, process.env.TMDB_PROXY_STYLE] = old;
  q.close();
  const u = new URL(seen[0], 'http://x');
  assert.equal(u.searchParams.get('endpoint'), '/discover/tv');
  assert.equal(u.searchParams.get('with_keywords'), '210024');
  assert.equal(u.searchParams.get('api_key'), null);
});
