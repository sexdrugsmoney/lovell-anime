import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {buildEmbeds, fetchRemoteSources, fetchDizi78Embed, fetchHdFilmizleEmbed, fetchZenkaiiReanime, fetchAnimecixEmbed, fetchDiziYouDub, fetchDizillaDub, fetchHdFilmCehennemiDub, fetchFullHdDub, fetchCloseLoadDub, normalizeSources, resetProviderState} from '../lib/providers.js';

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
  assert.equal(movie.find(e => e.id === 'vidlove').url, 'https://player.vidlove.cc/embed/movie/372058');
  assert.equal(tv.find(e => e.id === 'vidlove').url, 'https://player.vidlove.cc/embed/tv/94605/2/7');
  assert.equal(movie.find(e => e.id === 'cinemaos').url, 'https://cinemaos.tech/player/372058?lang=en');
  assert.equal(tv.find(e => e.id === 'cinemaos').url, 'https://cinemaos.tech/player/94605/2/7?lang=en');
  assert.equal(movie.find(e => e.id === 'vidly').url, 'https://vidly.pro/movie/372058?color=e4202b');
  assert.equal(tv.find(e => e.id === 'vidsrcparty').url, 'https://vidsrc.party/embed/tv/94605/2/7');
  assert.equal(movie.find(e => e.id === 'videasy-ws').url, 'https://player.videasy.ws/embed/movie/372058');
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
  assert.equal(list.find(e => e.id === 'megaplay-sub').backup, undefined);
  assert.equal(list.find(e => e.id === 'megaplay-dub').url, 'https://megaplay.buzz/stream/ani/151807/3/dub');
  assert.equal(list.find(e => e.id === 'megaplay-sub').url, 'https://megaplay.buzz/stream/mal/52299/3/sub');
  assert.equal(list.find(e => e.id === 'yumezone-sub').url, 'https://yumezone.qzz.io/embed/megaplay/ani/151807/3/sub');
  assert.match(list.find(e => e.id === 'vidhawk-dub').url, /vidhawk\.buzz\/embed\/ani\/151807\/3\/dub/);
  assert.equal(list.find(e => e.id === 'vidly-anime-sub').url, 'https://vidly.pro/anime/151807/3?color=ff3d7f&audio=sub');
  assert.equal(list.find(e => e.id === 'videasy-ws-anime').url, 'https://player.videasy.ws/embed/anime/151807/3');
  assert.equal(list.find(e => e.id === 'supaplay-mal-sub').url, 'https://supaplay.fun/stream/mal/52299/3/sub');
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

test('Zenkaii ReAnime gömüsü FlixCloud adresine yönlendirir', async () => {
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /zenkaii\.pages\.dev\/api\/embed\/reanime\?id=195539&ep=1&audio=sub/);
    assert.equal(init.redirect, 'manual');
    return {ok: false, status: 302, headers: {get: k => k === 'location' ? 'https://flixcloud.cc/e/doh59dcdu2qx?v=2' : null}, text: async () => ''};
  };
  const list = await fetchZenkaiiReanime({alId: 195539, episode: 1});
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'reanime');
  assert.equal(list[0].url, 'https://flixcloud.cc/e/doh59dcdu2qx?v=2');
  assert.equal(list[0].lang, 'sub');
});

test('AnimeciX Tau Video Türkçe altyazılı gömü döner, reklam hostlarını almaz', async () => {
  const seen = [];
  globalThis.fetch = async url => {
    seen.push(String(url));
    if (String(url).includes('/secure/search/')) {
      return jsonRes({results: [
        {id: 9, name: 'Naruto x UT', name_english: 'Naruto x UT', mal_id: 10075, year: 2011},
        {id: 11130, name: 'Sousou no Frieren', name_english: "Frieren: Beyond Journey's End", mal_id: 52991, anilist_id: 0, year: 2023},
      ]});
    }
    if (String(url).includes('episode-videos-points')) {
      return jsonRes({videos: [
        {language: 'tr', extra: 'HakaiRyuu', name: 'Tau Video', url: 'https://tau-video.xyz/embed/abc123'},
        {language: 'tr', extra: 'Shikisubs', name: 'Doodstream', url: 'https://doodstream.com/e/ads'},
        {language: 'en', extra: 'Eng', name: 'Tau Video', url: 'https://tau-video.xyz/embed/enonly'},
      ]});
    }
    throw Error('beklenmeyen ' + url);
  };
  const list = await fetchAnimecixEmbed({malId: 52991, titles: ['Frieren: Beyond Journey\'s End'], year: 2023, season: 1, episode: 1});
  assert.equal(list.length, 1);
  assert.equal(list[0].url, 'https://tau-video.xyz/embed/abc123');
  assert.equal(list[0].tr, true);
  assert.equal(list[0].lang, 'sub');
  assert.match(list[0].name, /HakaiRyuu/);
  assert.match(seen[0], /secure\/search\/Frieren/);
  assert.match(seen[1], /titleId=11130&episode=1&season=1/);
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

test('Türkçe dublaj tek biçimde işaretlenir ve en öne alınır', async () => {
  globalThis.fetch = async () => jsonRes({sources: [
    {url: 'https://cdn.example/sub.m3u8', name: 'DiziYou · Altyazılı', lang: 'tr'},
    {url: 'https://cdn.example/dub1.m3u8', name: 'SineWix (TR Dublaj)', lang: 'tr-dub'},
    {url: 'https://cdn.example/dub2.m3u8', name: 'DiziYou · Türkçe Dublaj', lang: 'tr'},
  ]});
  const r = await fetchRemoteSources({kind: 'tv', id: 1}, {anthologyUrl: 'https://ant.example'});
  assert.deepEqual(r.sources.map(s => [s.name, s.lang, !!s.dub]), [
    ['SineWix (TR Dublaj)', 'tr', true], ['DiziYou · Türkçe Dublaj', 'tr', true], ['DiziYou · Altyazılı', 'tr', false]]);
});

test('Dizi78 aramada yıl ve ad eşleşen filmin gömme oynatıcısını alır', async () => {
  const search = `<a href="https://dizi83.life/film/baska-film"><span>1999</span></a><a href="https://dizi83.life/film/harry-potter-ve-felsefe-tasi"><span>2001</span></a><a href="https://dizi83.life/dizi/harry-potter"><span>2001</span></a>`;
  const page = `<iframe src="https://player.example/player/abcdefghijk" title="film"></iframe><iframe src="javascript:alert(1)"></iframe>`;
  globalThis.fetch = async url => ({ok: true, status: 200, text: async () => String(url).includes('/ara?') ? search : page});
  const hit = await fetchDizi78Embed({kind: 'movie', titles: ['Harry Potter ve Felsefe Taşı'], year: '2001'});
  assert.equal(hit.length, 1);
  assert.equal(hit[0].name, 'Dizi78');
  assert.equal(hit[0].url, 'https://player.example/player/abcdefghijk');
  assert.equal(hit[0].dub, true);
  assert.equal(hit[0].pin, true);
  const en = await fetchDizi78Embed({kind: 'movie', titles: ['Harry Potter and the Sorcerer\'s Stone'], year: '2001'});
  assert.equal(en[0]?.url, 'https://player.example/player/abcdefghijk');
  const miss = await fetchDizi78Embed({kind: 'movie', titles: ['Harry Potter ve Felsefe Taşı'], year: '1990'});
  assert.deepEqual(miss, []);
});

test('DiziYou Türkçe dublaj HLS adresini player id ile üretir', async () => {
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('/?s=')) return new Response('<div id="categorytitle"><a href="https://www.diziyou.one/breaking-bad/">Breaking Bad</a></div>');
    if (u.includes('-1-sezon-1-bolum')) return new Response('<span class="diziyouOption" id="turkceDublaj"></span><iframe id="diziyouPlayer" src="https://www.diziyou.one/player/10551.html"></iframe>');
    return new Response('', {status: 404});
  };
  const hit = await fetchDiziYouDub({kind: 'tv', titles: ['Breaking Bad'], season: 1, episode: 1});
  assert.equal(hit.length, 1);
  assert.equal(hit[0].url, 'https://storage.diziyou.one/episodes/10551_tr/play.m3u8');
  assert.equal(hit[0].dub, true);
  assert.equal(hit[0].name, 'DiziYou · Dublaj');
  assert.deepEqual(await fetchDiziYouDub({kind: 'movie', titles: ['Breaking Bad']}), []);
});

test('Dizilla dublaj pichive iframe\'inden m3u8 çözer', async () => {
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('dizilla.la') && u.includes('sezon')) {
      return new Response('{"key":"dub-1","lang":"dub","langLabel":"Türkçe Dublaj","src":"https://four.pichive.online/iframe.php?v=abc123"}');
    }
    if (u.includes('iframe.php')) return new Response("openPlayer('tok123')");
    if (u.includes('source2.php')) return new Response(JSON.stringify({playlist: [{sources: [{file: 'https://cdn.example/master.m3u8'}]}]}));
    return new Response('', {status: 404});
  };
  const hit = await fetchDizillaDub({kind: 'tv', titles: ['Breaking Bad'], season: 1, episode: 1});
  assert.equal(hit.length, 1);
  assert.equal(hit[0].url, 'https://cdn.example/master.m3u8');
  assert.equal(hit[0].dub, true);
  assert.equal(hit[0].name, 'Dizilla · Dublaj');
});

test('HDFilmCehennemi TR alternatifinden packed file_link çözer', async () => {
  const b64 = Buffer.from('https://cdn.example/hdfc.m3u8').toString('base64');
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('/search?q=')) return new Response(JSON.stringify({results: ['<h4 class="title">Inception</h4><a href="https://www.hdfilmcehennemi.nl/inception-izle/">']}));
    if (u.endsWith('/inception-izle/') || u.includes('/inception-izle')) {
      return new Response('<div class="alternative-links" data-lang="tr"><button class="alternative-link" data-video="9">Vip TR</button></div>');
    }
    if (u.includes('/video/9/')) return new Response('{"html":"data-src=\\"https://www.hdfilmcehennemi.nl/playerr/abc\\""}');
    if (u.includes('/playerr/')) return new Response(`file_link="${b64}";`);
    return new Response('', {status: 404});
  };
  const hit = await fetchHdFilmCehennemiDub({kind: 'movie', titles: ['Inception'], year: '2010'});
  assert.equal(hit.length, 1);
  assert.equal(hit[0].url, 'https://cdn.example/hdfc.m3u8');
  assert.equal(hit[0].dub, true);
});

test('FullHDFilmizlesene scx TR kaydından VidMoly m3u8 alır', async () => {
  const embed = 'https://vidmoly.to/embed-abc.html';
  const enc = Buffer.from(embed).toString('base64').replace(/[a-zA-Z]/g, c => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('/arama/')) return new Response('<a href="https://www.fullhdfilmizlesene.now/inception-izle/">Inception</a>');
    if (u.includes('inception-izle')) return new Response(`var scx = {"atom":{"sx":{"t":{"tr":"${enc}"}}}};`);
    if (u.includes('vidmoly.to')) return new Response("file: 'https://cdn.example/fullhd.m3u8'");
    return new Response('', {status: 404});
  };
  const hit = await fetchFullHdDub({kind: 'movie', titles: ['Inception'], year: '2010'});
  assert.equal(hit.length, 1);
  assert.equal(hit[0].url, 'https://cdn.example/fullhd.m3u8');
  assert.equal(hit[0].name, 'FullHDFilmizlesene · Dublaj');
});

test('CloseLoad lema id + packed POST ile HLS çözer', async () => {
  const innerB64 = Buffer.from('|https://cdn.example/cl.m3u8', 'utf8').toString('base64');
  const b64 = Buffer.from(innerB64.split('').reverse().join(''), 'utf8').toString('base64');
  const packed = `eval(function(p,a,c,k,e,d){return p}('("${b64}")',62,1,''.split('|'),0,{}))`;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/lema/v1/search')) return new Response(JSON.stringify({closeload_id: 'vid1'}));
    if (u.includes('/video/embed/vid1/') && init.method === 'POST') return new Response(packed);
    if (u.includes('/video/embed/vid1/')) return new Response('var h = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";');
    return new Response('', {status: 404});
  };
  const hit = await fetchCloseLoadDub({kind: 'movie', id: 27205, titles: ['Inception']});
  assert.equal(hit.length, 1);
  assert.equal(hit[0].url, 'https://cdn.example/cl.m3u8');
  assert.equal(hit[0].name, 'FilmMakinesi · Dublaj');
});

test('HDFilmizle Türkçe iframe döner, yalnızca İngilizce olanı almaz', async () => {
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.endsWith('/search/')) return new Response(JSON.stringify([
      {name: 'Başka', year: 1999, slug: 'baska-film'},
      {name: 'Harry Potter 1 Felsefe Taşı', year: 2001, slug: 'harry-potter-1-felsefe-tasi-hdf-izle-1'},
    ]));
    if (u.endsWith('.to/')) return new Response('<meta name="csrf-token" content="tok">', {headers: {'content-type': 'text/html', 'set-cookie': 'XSRF-TOKEN=abc; Path=/'}});
    return new Response('let parts=[{"lang":"en","data":"<iframe src=\\"https://player.example/en\\"></iframe>"},{"lang":"tr","data":"<iframe src=\\"https://vidmoxy.com/ml/v1x93f91898\\"></iframe>"}];');
  };
  const hit = await fetchHdFilmizleEmbed({kind: 'movie', titles: ['Harry Potter ve Felsefe Taşı'], year: '2001'});
  assert.equal(hit.length, 1);
  assert.equal(hit[0].url, 'https://vidmoxy.com/ml/v1x93f91898');
  assert.equal(hit[0].pin, true);
  assert.equal(hit[0].name, 'HDFilmizle');
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

test('gömme adresleri Mail, OK, Drive ve Sibnet biçimine çevrilir', async () => {
  const {toEmbedUrl} = await import('../lib/providers.js');
  assert.equal(toEmbedUrl('https://drive.google.com/file/d/abc_123/view'), 'https://drive.google.com/file/d/abc_123/preview');
  assert.equal(toEmbedUrl('https://ok.ru/video/1888128207418'), 'https://ok.ru/videoembed/1888128207418');
  assert.equal(toEmbedUrl('https://video.sibnet.ru/video12345'), 'https://video.sibnet.ru/shell.php?videoid=12345');
  assert.equal(toEmbedUrl('https://my.mail.ru/video/embed/917'), 'https://my.mail.ru/video/embed/917');
  assert.equal(toEmbedUrl('javascript:alert(1)'), '');
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
  assert.deepEqual(list.map(e => e.name), ['Grup · Uqload', 'Grup · Mail.ru', 'B · VK', 'A · Sibnet', 'C · Uqload'], 'doğrulanmışlar önce, Mega gömülmez');
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


test('verified Turkish YouTube film is restricted to its exact TMDB movie', () => {
  const source = buildEmbeds('movie', 984249, null, 1, 1).find(e => e.id === 'weco-ruthless-tr');
  assert.ok(source);
  assert.equal(source.url, 'https://www.youtube.com/embed/4T726OAFonM?rel=0');
  assert.equal(source.lang, 'tr');
  assert.equal(source.dub, true);
  assert.equal(source.kind, 'embed');
  for (const [kind, id] of [['tv', 984249], ['al', 984249], ['movie', 37504], ['movie', 100575], ['movie', '984249other']]) {
    assert.ok(!buildEmbeds(kind, id, null, 1, 1).some(e => e.id === source.id));
  }
});


test('dub flags and provider names do not invent Turkish audio', async () => {
  const list = normalizeSources([
    {url: 'https://cdn.example/en.m3u8', lang: 'en', dub: true},
    {url: 'https://cdn.example/unknown.m3u8', dub: true},
    {url: 'https://cdn.example/name.m3u8', name: 'Dublaj'},
    {url: 'https://cdn.example/tr.m3u8', language: 'tr-TR', dub: true},
  ], 'test');
  assert.equal(list[0].lang, 'en');
  assert.equal(list[1].lang, undefined);
  assert.equal(list[2].lang, undefined);
  assert.equal(list[2].dub, undefined);
  assert.equal(list[3].lang, 'tr');
  assert.equal(list[3].dub, true);
  assert.equal(normalizeSources([{url: 'https://cdn.example/compact.m3u8', lang: 'trdub'}], 'test')[0].lang, 'tr');
  globalThis.fetch = async () => jsonRes({sources: [{url: 'https://cdn.example/no-language.m3u8'}]});
  const remote = await fetchRemoteSources({kind: 'movie', id: 1}, {anthologyUrl: 'https://ant.example'});
  assert.equal(remote.sources[0].lang, undefined);
  assert.equal(remote.sources[0].name, 'Anthology');
});
