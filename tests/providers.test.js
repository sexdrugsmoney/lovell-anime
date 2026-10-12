import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {buildEmbeds, fetchRemoteSources, normalizeSources, resetProviderState} from '../lib/providers.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; resetProviderState(); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jsonRes = (data, status = 200) => ({ok: status < 400, status, json: async () => data});

test('embed adresleri: film, dizi ve anime biçimleri', () => {
  const movie = buildEmbeds('movie', 372058, null, 1, 1, {});
  const frame = movie.find(e => e.id === 'framex');
  assert.equal(frame.url, 'https://framextv.xyz/embed/movie/372058?autoplay=1');
  const tv = buildEmbeds('tv', 94605, null, 2, 7, {});
  assert.equal(tv.find(e => e.id === 'framex').url, 'https://framextv.xyz/embed/tv/94605/2/7?autoplay=1');
  assert.ok(tv.every(e => e.url.startsWith('https://') && e.kind === 'embed'));
  assert.ok(!tv.some(e => e.anime), 'AniList id yoksa anime oynatıcıları eklenmez');
  assert.equal(new Set(tv.map(e => e.url)).size, tv.length, 'adresler tekrarlanmaz');
  // Ölçümle eklenen oynatıcıların adres biçimleri
  assert.equal(tv.find(e => e.id === 'cinesrc').url, 'https://cinesrc.st/embed/tv/94605?s=2&e=7');
  assert.equal(tv.find(e => e.id === 'viduki-s1').url, 'https://viduki.net/api/1/tv/?id=94605&s=2&e=7');
  assert.equal(movie.find(e => e.id === 'vidsrcru').url, 'https://vidsrc-embed.ru/embed/movie/372058');
  assert.equal(tv.find(e => e.id === 'vidsrcru').url, 'https://vidsrc-embed.ru/embed/tv/94605/2-7');
  assert.equal(movie.find(e => e.id === 'vidstorm').url, 'https://vidstorm.ru/movie/372058');
  assert.ok(tv.findIndex(e => e.backup) > tv.findIndex(e => e.id === 'vidstorm'), 'doğrulananlar yedeklerden önce');
});

test('anime embed adresleri önce gelir; altyazılı ve dublaj ayrı listelenir', () => {
  const list = buildEmbeds('tv', 127532, 151807, 1, 3, {brandColor: '#ff3d7f', malId: 52299});
  assert.equal(list[0].anime, true);
  assert.equal(list[0].backup, undefined, 'ilk sıradaki oynatıcı doğrulanmış olmalı');
  const ids = list.map(e => e.id);
  // Doğrulanmış oynatıcılar yedeklerin önünde
  assert.ok(ids.indexOf('anixo-sub') < ids.indexOf('megaplay-sub'));
  assert.ok(list.slice(ids.findIndex(() => true), list.findIndex(e => e.backup)).every(e => !e.backup));
  assert.ok(list.slice(list.findIndex(e => e.backup)).every(e => e.backup), 'yedekler en sonda');
  assert.equal(list.find(e => e.id === 'megaplay-dub').url, 'https://megaplay.buzz/stream/ani/151807/3/dub');
  assert.equal(list.find(e => e.id === 'megaplay-sub').url, 'https://megaplay.buzz/stream/mal/52299/3/sub');
  assert.equal(list.find(e => e.id === 'anixo-dub').url, 'https://anixo.buzz/embed/ani/151807/3/dub?color=%23ff3d7f');
  assert.match(list.find(e => e.id === 'zoko-sub').url, /^https:\/\/zokoanime\.video\/stream\/mal\/52299\/3\/sub\?/);
  assert.equal(list.find(e => e.id === 'zoko-sub').resume, 'time');
  assert.match(list.find(e => e.id === 'aniflow-dub').url, /^https:\/\/api\.aniflow\.cc\/embed\/ani\/151807\/3\/dub\?/);
  // MAL id'si yoksa Zoko AniList yolunu kullanır
  assert.match(buildEmbeds('tv', 127532, 151807, 1, 3, {}).find(e => e.id === 'zoko-sub').url, /\/stream\/anilist\/151807\/3\/sub/);
  // Anime TMDB dizisi olduğu için genel oynatıcılar da var
  assert.ok(list.some(e => e.id === 'framex'));
  // AniList sayfasından açılan başlıkta (kind=al) TMDB oynatıcıları yok
  const al = buildEmbeds('al', 21, null, 1, 5, {});
  assert.ok(al.length > 0 && al.every(e => e.anime));
  assert.match(al[0].url, /\/21\/5\//);
});

test('uzak kaynaklar: yavaş servis beklenmez, biten sonuçlar döner', async () => {
  globalThis.fetch = async url => {
    if (String(url).startsWith('https://ant.example/')) { await sleep(400); return jsonRes({sources: [{url: 'https://cdn.example/a.m3u8', name: 'AnimeciX'}]}); }
    if (String(url).startsWith('https://vr.example/')) return jsonRes({sources: [{url: 'https://cdn.example/b.mp4', server: 'S1', quality: '1080p'}]});
    throw Error('beklenmeyen ' + url);
  };
  const t0 = Date.now();
  const r = await fetchRemoteSources({kind: 'tv', id: 1, season: 1, episode: 1}, {anthologyUrl: 'https://ant.example', vidrockUrl: 'https://vr.example', deadline: 120});
  assert.ok(Date.now() - t0 < 350, 'süre sınırında dönmeli');
  assert.deepEqual(r.sources.map(s => s.url), ['https://cdn.example/b.mp4']);
  assert.deepEqual(r.timedOut, ['anthology']);
  assert.equal(r.report.find(x => x.id === 'vidrock').count, 1);
});

test('uzak kaynaklar: başlık ipucu iletilir, güvensiz ve Referer isteyen akışlar elenir', async () => {
  let seen;
  globalThis.fetch = async url => {
    seen = new URL(url);
    return jsonRes({sources: [
      {url: 'https://cdn.example/ok.m3u8', name: 'TR', lang: 'tr', quality: '1080p'},
      {url: 'http://cdn.example/insecure.mp4', name: 'x'},
      {url: 'https://cdn.example/ref.m3u8', name: 'y', needsReferer: true},
      {url: 'https://cdn.example/ok.m3u8', name: 'dup'},
      {url: 'https://cdn.example/sub.mp4', name: 'z', subtitles: [{url: 'https://cdn.example/s.vtt', lang: 'tr'}, {url: 'http://bad/s.vtt'}]},
    ]});
  };
  const r = await fetchRemoteSources({kind: 'movie', id: 372058, hint: {title: 'Senin Adın', original: '君の名は。', year: '2016', imdb: 'tt5311514'}}, {anthologyUrl: 'https://ant.example/'});
  assert.equal(seen.pathname, '/api/all');
  assert.equal(seen.searchParams.get('title'), 'Senin Adın');
  assert.equal(seen.searchParams.get('imdb'), 'tt5311514');
  assert.equal(seen.searchParams.get('type'), 'movie');
  assert.deepEqual(r.sources.map(s => s.url), ['https://cdn.example/ok.m3u8', 'https://cdn.example/sub.mp4']);
  assert.equal(r.sources[0].name, 'TR · 1080p');
  assert.equal(r.sources[0].type, 'hls');
  assert.equal(r.sources[1].subtitles.length, 1);
});

test('uzak kaynaklar: AniList kimlikli başlıklar TMDB servislerine gönderilmez, hata raporlanır', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return jsonRes({}, 500); };
  const al = await fetchRemoteSources({kind: 'al', id: 21}, {anthologyUrl: 'https://ant.example', vidrockUrl: 'https://vr.example'});
  assert.equal(calls, 0);
  assert.deepEqual(al.sources, []);
  const tv = await fetchRemoteSources({kind: 'tv', id: 1}, {anthologyUrl: 'https://ant.example', deadline: 500});
  assert.equal(tv.report[0].ok, false);
  assert.match(tv.report[0].error, /HTTP 500/);
});

test('geçersiz ya da boş adresler yok sayılır', async () => {
  globalThis.fetch = async () => { throw Error('çağrılmamalı'); };
  const r = await fetchRemoteSources({kind: 'tv', id: 1}, {anthologyUrl: '\n', vidrockUrl: 'http://insecure.example', cineproUrl: ''});
  assert.deepEqual(r, {sources: [], report: [], timedOut: []});
  assert.deepEqual(normalizeSources([{url: 'javascript:alert(1)'}, null, {url: 'https://a.example/x.mpd'}], 'x').map(s => s.type), ['dash']);
});

test('devre kesici: hata veren servis kısa süre tekrar sorulmaz, yavaş servis kesilmez', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return jsonRes({}, 404); };
  const cfg = {cineproUrl: 'https://cine.example', deadline: 500};
  const first = await fetchRemoteSources({kind: 'tv', id: 1}, cfg);
  assert.match(first.report[0].error, /HTTP 404/);
  const second = await fetchRemoteSources({kind: 'tv', id: 1}, cfg);
  assert.equal(calls, 1);
  assert.match(second.report[0].error, /atlandı/);
  // Zaman aşımı "kapalı" sayılmaz
  resetProviderState();
  globalThis.fetch = async () => { await sleep(300); return jsonRes({sources: []}); };
  const slow = await fetchRemoteSources({kind: 'tv', id: 1}, {anthologyUrl: 'https://ant.example', deadline: 60});
  assert.deepEqual(slow.timedOut, ['anthology']);
  let again = 0;
  globalThis.fetch = async () => { again++; return jsonRes({sources: []}); };
  await fetchRemoteSources({kind: 'tv', id: 1}, {anthologyUrl: 'https://ant.example', deadline: 500});
  assert.equal(again, 1);
});

test('Türkçe fansub arşivi: AniList + bölüm → sıralı fansub embed\'leri', async () => {
  const {fetchTrArchive} = await import('../lib/providers.js');
  let asked;
  globalThis.fetch = async url => {
    asked = String(url);
    return jsonRes({anilist: 999, bolumler: [
      {n: 1, src: [['SIBNET', 'A', 'https://video.sibnet.ru/shell.php?videoid=1', 'ok'], ['MAIL', 'Grup', 'https://my.mail.ru/video/embed/1', 'ok'], ['UQLOAD', 'Grup', 'https://uqload.com/embed-x.html', 'ok'], ['VK', 'B', 'https://href.li/?https://vk.com/video_ext.php?oid=1&id=2', 'ok'], ['UQLOAD', 'C', 'https://uqload.com/embed-y.html', null], ['MEGA', 'D', 'https://mega.nz/embed/x', 'ok']]},
      {n: 2, src: [['UQLOAD', 'Grup', 'https://uqload.com/embed-2.html', 'ok']]},
    ]});
  };
  const list = await fetchTrArchive({index: {map: {999: 'ornek-anime'}}, alId: 999, episode: 1});
  assert.match(asked, /\/public\/data\/anime\/ornek-anime\.json$/);
  assert.deepEqual(list.map(e => e.name), ['Grup · Uqload', 'Grup · Mail.ru', 'B · VK', 'C · Uqload'], 'doğrulanmışlar önce, gömülemeyenler (Sibnet, Mega) yok');
  assert.equal(list[2].url, 'https://vk.com/video_ext.php?oid=1&id=2', 'href.li sarmalayıcısı çıkarılır');
  assert.ok(list.every(e => e.tr && e.referrer === 'no-referrer' && e.lang === 'sub'));
  assert.deepEqual(await fetchTrArchive({index: {map: {}}, alId: 1, episode: 1}), [], 'dizinde yoksa istek atılmaz');
  assert.deepEqual(await fetchTrArchive({index: {map: {999: 'ornek-anime'}}, alId: 999, episode: 7}), []);
});

test('Türkçe altyazı: anahtar yoksa istek atılmaz, varsa srt/vtt listesi döner', async () => {
  const {fetchTurkishSubs} = await import('../lib/providers.js');
  let calls = 0;
  globalThis.fetch = async url => { calls++; assert.match(String(url), /language=tr/); return jsonRes([{url: 'https://sub.example/1.srt', format: 'srt', release: 'Arcane.S01E01'}, {url: 'http://bad/2.srt', format: 'srt'}, {url: 'https://sub.example/3.ass', format: 'ass'}]); };
  assert.deepEqual(await fetchTurkishSubs({kind: 'tv', id: 1, key: ''}), []);
  assert.equal(calls, 0);
  const subs = await fetchTurkishSubs({kind: 'tv', id: 94605, season: 1, episode: 1, key: 'k'});
  assert.deepEqual(subs.map(s => [s.type, s.url]), [['srt', 'https://sub.example/1.srt']]);
  assert.match(subs[0].label, /^Türkçe · Arcane/);
});
