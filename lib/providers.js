// Oynatma sağlayıcıları — yerel sunucu (server.js) ve Cloudflare Worker aynı kodu kullanır.
// Yalnızca fetch kullanır; Node 20+ ve Workers'ta çalışır.
//
//  buildEmbeds()        : iframe tabanlı oynatıcıların adreslerini üretir (ağ isteği yok, anında).
//  fetchRemoteSources() : Anthology / VidRock çözücü / CinePro gibi doğrudan akış (HLS/MP4) bulan
//                         servisleri paralel sorar; toplam süre sınırı vardır ve bitenlerin sonucu
//                         yavaş kalan servisi beklemeden döner.

import {proxyPath} from './hls-proxy.js';

// Yerel geliştirmede (Anthology aynı bilgisayarda çalışırken) yalnızca döngü adresine http izni verilir.
const isLoopback = h => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
const cleanUrl = v => {
  const s = String(v ?? '').trim();
  try {
    const u = new URL(s);
    const ok = (u.protocol === 'https:' || (u.protocol === 'http:' && isLoopback(u.hostname))) && !u.username && !u.password;
    return ok ? u.origin + u.pathname.replace(/\/+$/, '') : '';
  } catch { return ''; }
};
const httpsOnly = (v, loopbackOk = false) => { try { const u = new URL(v); return (u.protocol === 'https:' || (loopbackOk && u.protocol === 'http:' && isLoopback(u.hostname))) && !u.username && !u.password; } catch { return false; } };
const hex = v => String(v || 'e4202b').replace('#', '').replace(/[^0-9a-f]/gi, '').slice(0, 6) || 'e4202b';

// ---------------------------------------------------------------------------
// Embed sağlayıcıları
// ---------------------------------------------------------------------------
/**
 * kind: 'tv' | 'movie' | 'al'   id: TMDB ya da AniList id'si   alId: anime için (o sezonun) AniList id'si
 * opts.malId: anime için MyAnimeList id'si (bazı oynatıcılar yalnızca MAL ile çalışır)
 * Dönen her öğe: {id, name, url, kind:'embed', origin:'embed', lang?, anime?, backup?, resume?}
 *   resume: kaldığı yerden başlatmak için adrese eklenecek parametre adı (saniye cinsinden)
 *
 * Sıralama gerçek ölçüme dayanır: her oynatıcı Chrome'da iframe içinde açılıp video akışı (m3u8/mp4)
 * yükleyip yüklemediğine bakıldı. Akış yükleyenler önde; tekrarlanan denemelerde yükleyemeyenler silinmedi,
 * "yedek" olarak sona kondu (Cloudflare gibi korumalar test tarayıcısını engellemiş olabilir).
 */
export function buildEmbeds(kind, id, alId, season, episode, opts = {}) {
  const color = hex(opts.brandColor);
  const brand = String(opts.brand || 'LOVELL').slice(0, 28);
  const brandLogo = opts.brandLogo || '';
  const tmdb = kind !== 'al';
  const ani = Number(alId) > 0 ? Number(alId) : (kind === 'al' ? Number(id) : 0);
  const mal = Number(opts.malId) > 0 ? Number(opts.malId) : 0;
  const movie = kind === 'movie';
  const ep = Math.max(1, Number(episode) || 1), se = Math.max(1, Number(season) || 1);
  // Anime oynatıcıları AniList kaydının kendi bölüm numarasını ister (TMDB numarası farklı olabilir).
  const aep = Number(opts.animeEpisode) > 0 ? Number(opts.animeEpisode) : ep;
  const anime = [], generic = [], backup = [];
  const push = (to, embedId, name, url, extra = {}) => { if (url) to.push({id: embedId, name, url, kind: 'embed', origin: 'embed', ...extra, ...(to === backup ? {backup: true} : {})}); };
  const path = movie ? `movie/${id}` : `tv/${id}/${se}/${ep}`;
  const label = lang => ({sub: 'Altyazılı', dub: 'Dublaj', hsub: 'Gömülü altyazı'}[lang]);

  // ---- Anime (AniList / MAL id'siyle) ----
  if (ani || mal) {
    for (const lang of ['sub', 'dub']) {
      if (ani) push(anime, `anixo-${lang}`, `AniXo · ${label(lang)}`, `https://anixo.buzz/embed/ani/${ani}/${aep}/${lang}?color=%23${color}`, {lang, anime: true});
      if (ani) push(anime, `anipm-${lang}`, `Ani.pm · ${label(lang)}`, `https://ani.pm/embed/ani/${ani}/${aep}/${lang}`, {lang, anime: true});
      if (ani) push(anime, `aniflow-${lang}`, `AniFlow · ${label(lang)}`, `https://api.aniflow.cc/embed/ani/${ani}/${aep}/${lang}?autoskipIntro=1&autoskipOutro=1`, {lang, anime: true, resume: 'startAt'});
      if (mal) push(anime, `zoko-${lang}`, `Zoko · ${label(lang)}`, `https://zokoanime.video/stream/mal/${mal}/${aep}/${lang}?color=${color}&autoplay=1&asi=1`, {lang, anime: true, resume: 'time'});
      else if (ani) push(anime, `zoko-${lang}`, `Zoko · ${label(lang)}`, `https://zokoanime.video/stream/anilist/${ani}/${aep}/${lang}?color=${color}&autoplay=1&asi=1`, {lang, anime: true, resume: 'time'});
      if (ani) push(anime, `tryembed-${lang}`, `TryEmbed · ${label(lang)}`, `https://tryembed.us.cc/embed/anime/${ani}/${aep}/${lang}?autoplay=true&autoSkip=true&autoNext=false&lang-type=false`, {lang, anime: true, resume: 'startAt'});
      if (ani) push(anime, `supaplay-${lang}`, `SupaPlay · ${label(lang)}`, `https://supaplay.fun/stream/ani/${ani}/${aep}/${lang}`, {lang, anime: true});
    }
    if (ani) {
      push(anime, 'megaplay-dub', 'MegaPlay · Dublaj', `https://megaplay.buzz/stream/ani/${ani}/${aep}/dub`, {lang: 'dub', anime: true});
      push(anime, 'megavid-sub', 'Megavid · Altyazılı', `https://megavid.buzz/ani/${ani}/${aep}/sub?color=%23${color}&autoplay=true`, {lang: 'sub', anime: true});
      push(anime, 'aniembed-sub', 'AniEmbed · Altyazılı', `https://aniembed.se/e/${ani}/${aep}?lang=sub&autoplay=1&s=nero`, {lang: 'sub', anime: true});
      push(anime, 'aniembed-dub', 'AniEmbed · Dublaj', `https://aniembed.se/e/${ani}/${aep}?lang=dub&autoplay=1&s=nero`, {lang: 'dub', anime: true});
      // Yedek (testte akış yüklemedi)
      push(backup, 'megaplay-sub', 'MegaPlay · Altyazılı', mal ? `https://megaplay.buzz/stream/mal/${mal}/${aep}/sub` : `https://megaplay.buzz/stream/ani/${ani}/${aep}/sub`, {lang: 'sub', anime: true});
      push(backup, 'videasy-anime', 'Videasy · Anime', `https://player.videasy.to/anime/${ani}/${aep}?color=${color}`, {anime: true});
      push(backup, 'vidnest-anime', 'VidNest · Altyazılı', `https://vidnest.fun/anime/${ani}/${aep}/sub`, {lang: 'sub', anime: true, resume: 'startAt'});
      push(backup, 'vidhawk', 'VidHawk · Altyazılı', `https://vidhawk.buzz/embed/ani/${ani}/${aep}/sub?server=flow&autoskipIntro=1&autoskipOutro=1`, {lang: 'sub', anime: true});
      push(backup, 'vidplus-anime', 'VidPlus · Anime', `https://player.vidplus.to/embed/anime/${ani}/${aep}?primarycolor=${color}&autonext=true&autoplay=true`, {anime: true});
      push(backup, 'vidy-anime', 'Vidy · Anime', `https://vidy.st/anime/${ani}/${aep}?color=${color}&episodeSelector=true&autoplayNextEpisode=true`, {anime: true});
      push(backup, 'justplay', 'JustPlay · Altyazılı', `https://justplay.boo/?ani=${ani}&ep=${aep}&lang=sub&autoskip=1`, {lang: 'sub', anime: true});
    }
  }

  // ---- Film / dizi (TMDB id'siyle) ----
  if (tmdb) {
    const vr = new URLSearchParams({brand, brandColor: color, exit: '1'});
    if (brandLogo) vr.set('brandLogo', brandLogo);
    push(generic, 'vidrift', 'VidRift', `https://embed.vidrift.net/embed/${path}?${vr}`);
    push(generic, 'vidrock', 'VidRock', `https://vidrock.to/embed/${path}`);
    push(generic, 'vixsrc', 'VixSrc', `https://vixsrc.to/${path}?autoplay=true&primaryColor=${color}`, {resume: 'startAt'});
    push(generic, 'vidsrcsh', 'VidSrc.sh', `https://vidsrc.sh/embed/${path}?autoplay=1&autonext=0`, {resume: 'startAt'});
    push(generic, 'framex', 'FrameX', `https://framextv.xyz/embed/${path}?autoplay=1`);
    push(generic, 'viduki', 'Viduki', `https://www.viduki.net/1/${path}?color=${color}`);
    push(generic, 'vidcore', 'VidCore', `https://vidcore.org/embed/${path}?autoplay=true&theme=${color}`);
    push(generic, 'embedwave', 'EmbedWave', `https://embedwave.cc/embed/${path}?autoplay=1`);
    push(generic, 'vidsrcio', 'VidSrc.io', `https://vidsrc.io/embed/${path}`);
    push(generic, 'cinesrc', 'CineSrc', movie ? `https://cinesrc.st/embed/movie/${id}` : `https://cinesrc.st/embed/tv/${id}?s=${se}&e=${ep}`);
    push(generic, 'vidstorm', 'VidStorm', `https://vidstorm.ru/${path}`);
    push(generic, 'vidzen', 'VidZen', `https://vidzen.fun/${path}?autoPlay=true`);
    push(generic, 'yapgrid', 'YapGrid', `https://yapgrid.com/embed/${path}?autoplay=1`);
    // Viduki'nin ayrı sunucuları (vidsrc.wtf adresi buraya yönlenir)
    push(generic, 'viduki-s1', 'Viduki · Sunucu 1', movie ? `https://viduki.net/api/1/movie/?id=${id}` : `https://viduki.net/api/1/tv/?id=${id}&s=${se}&e=${ep}`);
    push(generic, 'viduki-s4', 'Viduki · Sunucu 4', movie ? `https://viduki.net/api/4/movie/?id=${id}` : `https://viduki.net/api/4/tv/?id=${id}&s=${se}&e=${ep}`);
    push(generic, 'vidsrcru', 'VidSrc.ru', movie ? `https://vidsrc-embed.ru/embed/movie/${id}` : `https://vidsrc-embed.ru/embed/tv/${id}/${se}-${ep}`);
    push(generic, '2embed', '2Embed', `https://www.2embed.stream/embed/${path}`);
    push(generic, '2embedonline', '2Embed.online', `https://www.2embed.online/embed/${path}`);
    push(generic, 'embedmaster', 'EmbedMaster', `https://embedmaster.link/${path}`);
    push(generic, 'vidsrc', 'VidSrc', `https://vidsrc.buzz/embed/${path}?autoplay=true`);
    push(generic, 'vidy', 'Vidy', movie ? `https://vidy.st/movie/${id}?color=${color}&autoplay=true` : `https://vidy.st/tv/${id}/${se}/${ep}?color=${color}&nextEpisode=true&episodeSelector=true&autoplayNextEpisode=true`);
    // Yedek (testte akış yüklemedi; çoğu Cloudflare korumalı ya da tıklamayla başlıyor)
    push(backup, 'streamflizo', 'StreamFlizo', movie ? `https://streamflizoapi.top/stream/tmdb/${id}/multi` : `https://streamflizoapi.top/stream/tmdb/${id}/${se}/${ep}/multi`);
    push(backup, 'hnembed', 'HnEmbed', `https://hnembed.cc/embed/${path}`);
    push(backup, 'vidfast', 'VidFast', `https://vidfast.vc/${path}?autoPlay=true&theme=${color}`, {resume: 'startAt'});
    push(backup, 'videasy', 'Videasy', `https://player.videasy.to/${path}?color=${color}`, {resume: 'progress'});
    push(backup, 'moviesapi', 'MoviesAPI', `https://moviesapi.to/${path}?theme=${color}`, {resume: 't'});
    push(backup, 'vidplus', 'VidPlus', `https://player.vidplus.to/embed/${movie ? `movie/${id}?primarycolor=${color}&autoplay=true` : `tv/${id}/${se}/${ep}?primarycolor=${color}&autonext=true&autoplay=true`}`);
    push(backup, 'vidlink', 'VidLink', `https://vidlink.pro/${path}?${new URLSearchParams({primaryColor: color, title: 'true', ...(movie ? {} : {nextbutton: 'true'})})}`);
    push(backup, 'vidsrcto', 'VidSrc.to', `https://vidsrc.to/embed/${path}`);
    push(backup, 'mycineby', 'MyCineBy', `https://mycineby.cc/embed/${path}?color=${color}&autoplay=true`);
    push(backup, 'autoembed', 'AutoEmbed', movie ? `https://autoembed.co/movie/tmdb/${id}` : `https://autoembed.co/tv/tmdb/${id}-${se}-${ep}`);
    push(backup, 'vidsrcsu', 'VidSrc.su', `https://vidsrc.su/embed/${path}`);
    push(backup, 'vidzee', 'VidZee', `https://player.vidzee.wtf/embed/${path}`);
    push(backup, 'primesrc', 'PrimeSrc', movie ? `https://primesrc.me/embed/movie?tmdb=${id}` : `https://primesrc.me/embed/tv?tmdb=${id}&season=${se}&episode=${ep}`);
    push(backup, 'vidup', 'VidUp', `https://vidup.to/${path}`);
  }

  // Anime ise önce anime oynatıcıları; yedekler en sonda. Aynı adresi iki kez ekleme.
  const seen = new Set();
  return [...anime, ...generic, ...backup].filter(e => !seen.has(e.url) && seen.add(e.url));
}

// ---------------------------------------------------------------------------
// Doğrudan akış (HLS / MP4 / DASH) bulan servisler
// ---------------------------------------------------------------------------
const kindOfUrl = (url, declared) => {
  const d = String(declared || '').toLowerCase();
  if (d === 'dash' || /\.mpd(\?|$)/i.test(url)) return 'dash';
  if (d === 'hls' || d === 'm3u8' || /\.m3u8(\?|$)/i.test(url)) return 'hls';
  return 'mp4';
};
const cleanSubs = list => (Array.isArray(list) ? list : []).slice(0, 12).flatMap(t => {
  const url = t?.url || t?.file;
  return httpsOnly(url) ? [{label: String(t.label || t.lang || 'Altyazı').slice(0, 60), lang: String(t.lang || t.language || 'tr').slice(0, 12), url}] : [];
});
export function normalizeSources(list, origin, defaults = {}) {
  return (Array.isArray(list) ? list : []).slice(0, 40).flatMap(s => {
    if (!s || !httpsOnly(s.url, defaults.loopbackOk)) return [];
    // Referer / başlık gerektiren akışlar tarayıcıda oynamaz; Anthology bunları ayrıca işaretler.
    if (s.needsReferer) return [];
    const q = s.quality && !/^(auto|hd)$/i.test(s.quality) ? ` · ${s.quality}` : '';
    // Türkçe dublaj: kaynaklar 'tr-dub' diliyle ya da adında "Dublaj" geçerek bildirir; istemci tek biçim görür (lang 'tr' + dub)
    const dub = /^tr-?dub/i.test(s.lang || '') || s.dub === true || /dublaj/i.test(s.name || '');
    const lang = dub ? 'tr' : (s.lang || defaults.lang);
    return [{name: `${s.name || defaults.name || 'Kaynak'}${q}`.slice(0, 90), origin, url: s.url, type: kindOfUrl(s.url, s.type), subtitles: cleanSubs(s.subtitles || s.tracks), lang, ...(dub ? {dub: true} : {}), ...(s.proxied ? {proxied: true} : {}), q: Number(String(s.quality || '').match(/\d{3,4}/)?.[0]) || 0}];
  });
}

// Devre kesici: bir servis açıkça hata verirse (404/410/5xx ya da bağlantı hatası) 5 dakika sorulmaz;
// böylece kapalı bir servis her oynatmada saniyeler harcatmaz. Zaman aşımı sayılmaz (yavaş ≠ kapalı).
const DOWN = new Map();
const DOWN_MS = 5 * 60 * 1000;
export const resetProviderState = () => DOWN.clear();
const isHardFailure = e => /HTTP (404|410|5\d\d)|fetch failed|ENOTFOUND|ECONNREFUSED/i.test(String(e?.message || e)) && !/timeout|abort/i.test(String(e?.name));

async function getJson(url, ms, headers = {}) {
  const res = await fetch(url, {signal: AbortSignal.timeout(ms), headers: {accept: 'application/json', ...headers}});
  if (!res.ok) throw Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * params: {kind, id, alId, season, episode, hint?:{title, original, year, imdb}}
 * cfg:    {anthologyUrl, vidrockUrl, cineproUrl, extra?: [{id, run:async()=>[...]}], deadline?: ms}
 * Döner:  {sources:[...], report:[{id, ok, ms, count, error?}], timedOut:[id...]}
 */
export async function fetchRemoteSources(params, cfg = {}) {
  const {kind, id, season = 1, episode = 1, hint} = params;
  const deadline = cfg.deadline ?? 14000;
  const anthology = cleanUrl(cfg.anthologyUrl), vidrock = cleanUrl(cfg.vidrockUrl), cinepro = cleanUrl(cfg.cineproUrl);
  const tasks = [];
  const isTmdb = kind !== 'al';
  // Devre kesici anahtarı: servis adı + adresi
  const downKey = (id, base) => `${id}:${base}`;
  if (isTmdb && anthology) tasks.push({id: 'anthology', run: async () => {
    const q = new URLSearchParams({tmdbId: String(id), type: kind, season: String(season), episode: String(episode), budget: String(Math.max(3000, deadline - 1500))});
    if (hint?.title) q.set('title', hint.title);
    if (hint?.original) q.set('original', hint.original);
    if (hint?.year) q.set('year', hint.year);
    if (hint?.imdb) q.set('imdb', hint.imdb);
    const d = await getJson(`${anthology}/api/all?${q}`, deadline, {});
    return normalizeSources(d.sources, 'anthology', {name: 'Türkçe', lang: 'tr', loopbackOk: anthology.startsWith('http://')});
  }});
  if (isTmdb && vidrock) tasks.push({id: 'vidrock', run: async () => {
    const q = new URLSearchParams({type: kind, id: String(id), season: String(season), episode: String(episode)});
    const d = await getJson(`${vidrock}/api/resolve?${q}`, Math.min(deadline, 10000));
    return normalizeSources((d.sources || d.streams || []).map(s => ({...s, name: `VidRock${s.server ? ' · ' + s.server : ''}`, quality: s.quality})), 'vidrock-resolved');
  }});
  if (isTmdb && cinepro) tasks.push({id: 'cinepro', run: async () => {
    const q = new URLSearchParams({tmdbId: String(id), type: kind === 'movie' ? 'movie' : 'tv', ...(kind === 'movie' ? {} : {season: String(season), episode: String(episode)})});
    let d;
    try { d = await getJson(`${cinepro}/scrape?${q}`, deadline); } catch (e) { if (!/HTTP 50[23]/.test(e.message)) throw e; await new Promise(r => setTimeout(r, 600)); d = await getJson(`${cinepro}/scrape?${q}`, deadline); }
    return normalizeSources((d.sources || d.results || d.streams || []).map(s => ({...s, name: `CinePro${s.server || s.provider ? ' · ' + (s.server || s.provider) : ''}`, quality: s.quality, type: s.isM3U8 ? 'hls' : s.isDASH ? 'dash' : s.type})), 'cinepro');
  }});
  for (const t of cfg.extra || []) tasks.push(t);

  const bases = {anthology, vidrock, cinepro};
  const report = [], sources = [];
  await new Promise(resolve => {
    let left = tasks.length;
    if (!left) return resolve();
    const timer = setTimeout(resolve, deadline);
    for (const t of tasks) {
      const started = Date.now();
      const key = downKey(t.id, bases[t.id] || '');
      if ((DOWN.get(key) || 0) > started) {
        report.push({id: t.id, ok: false, ms: 0, count: 0, error: 'geçici olarak atlandı (son denemede hata verdi)'});
        if (--left === 0) { clearTimeout(timer); resolve(); }
        continue;
      }
      Promise.resolve().then(t.run).then(list => {
        sources.push(...list);
        report.push({id: t.id, ok: true, ms: Date.now() - started, count: list.length});
      }, e => {
        if (bases[t.id] && isHardFailure(e)) DOWN.set(key, Date.now() + DOWN_MS);
        report.push({id: t.id, ok: false, ms: Date.now() - started, count: 0, error: String(e?.message || e).slice(0, 120)});
      })
        .finally(() => { if (--left === 0) { clearTimeout(timer); resolve(); } });
    }
  });
  const done = new Set(report.map(r => r.id));
  const timedOut = tasks.map(t => t.id).filter(x => !done.has(x));
  // Aynı adres iki kaynaktan gelirse tek tut; HLS'i MP4'ten önce sırala.
  const seen = new Set();
  // Sıra: Türkçe önce, aracı sunucudan geçmeyenler önce, sonra HLS, sonra yüksek kalite.
  const rank = s => (s.dub ? 0 : s.lang === 'tr' ? 500 : 1000) + (s.proxied ? 100 : 0) + (s.type === 'hls' ? 0 : s.type === 'dash' ? 10 : 20) - Math.min(9, (s.q || 0) / 240);
  const unique = sources.filter(s => !seen.has(s.url) && seen.add(s.url)).sort((a, b) => rank(a) - rank(b)).map(({q, ...rest}) => rest);
  return {sources: unique, report, timedOut};
}

// ---------------------------------------------------------------------------
// Türkçe fansub arşivi (GenesisAnime veri seti, MIT): AniList kaydı + bölüm → fansub embed'leri
// ---------------------------------------------------------------------------
// Dizin (AniList id → kayıt adı) depoda: src/data/tr-archive-index.json (scripts/build-tr-archive.mjs üretir).
// Bölüm verisi oynatma anında jsDelivr CDN'den kayıt başına (~8 KB) çekilir ve 30 dk bellekte tutulur.
const TR_ARCHIVE_CDN = 'https://cdn.jsdelivr.net/gh/GenesisAnime/GenesisAnime-site@main/public/data/anime/';
// Sıra gerçek ölçüme göre (iframe içinde akış yükleyenler önde); gömülemeyen ya da ölü barındırıcılar listede yok
// (SIBNET sunuculara 403, PIXELDRAIN / YADISK / MEGA gömülemez, VOE / DOODSTREAM / BYSE bot duvarı).
const ARCHIVE_HOSTS = {
  UQLOAD: ['Uqload', 1], STREAMWISH: ['StreamWish', 2], VIDEA: ['Videa', 3], MAIL: ['Mail.ru', 4],
  ODNOKLASSNIKI: ['OK.ru', 5], 'OK.RU': ['OK.ru', 5], CYBERFILE: ['CyberFile', 6], VK: ['VK', 7],
  MP4UPLOAD: ['Mp4Upload', 8], GDRIVE: ['Drive', 9], DAILYMOTION: ['Dailymotion', 10], HDVID: ['HDVid', 11],
};
const archiveCache = new Map(); // slug -> {at, job: Promise}
// İndirme, çağıranın süre sınırından bağımsız sürer: ilk istek süreyi aşsa da sonraki istek hazır veriyi bulur.
function archiveEntry(slug, timeout) {
  let hit = archiveCache.get(slug);
  if (!hit || Date.now() - hit.at > 30 * 60e3) {
    const job = getJson(`${TR_ARCHIVE_CDN}${encodeURIComponent(slug)}.json`, 20000);
    hit = {at: Date.now(), job};
    job.catch(() => archiveCache.delete(slug));
    if (archiveCache.size > 300) archiveCache.delete(archiveCache.keys().next().value);
    archiveCache.set(slug, hit);
  }
  return Promise.race([hit.job, new Promise((_, rej) => setTimeout(() => rej(Error('zaman aşımı')), timeout))]);
}
/**
 * index: tr-archive-index.json içeriği. alId: o sezonun AniList id'si. episode: AniList'e göre bölüm numarası.
 * Dönen embed'ler: {id, name, url, kind:'embed', origin:'tr-archive', lang:'sub', tr:true, anime:true, fansub, referrer}
 */
export async function fetchTrArchive({index, alId, episode, timeout = 2500, limit = 10}) {
  const slug = index?.map?.[alId];
  if (!slug) return [];
  let d;
  try { d = await archiveEntry(slug, timeout); } catch { return []; }
  const ep = (d?.bolumler || []).find(b => Number(b.n) === Number(episode));
  if (!ep) return [];
  const links = [];
  for (const [host, fansub, raw, ok] of ep.src || []) {
    const meta = ARCHIVE_HOSTS[host];
    if (!meta) continue;
    const url = String(raw || '').replace(/^https?:\/\/href\.li\/\?/, '');
    if (!httpsOnly(url)) continue;
    links.push({host, label: meta[0], rank: meta[1] + (ok === 'ok' ? 0 : 50), fansub: String(fansub || 'Fansub').slice(0, 40), url});
  }
  const seen = new Set();
  return links.sort((a, b) => a.rank - b.rank)
    .filter(l => !seen.has(l.url) && seen.add(l.url))
    .slice(0, limit)
    .map((l, i) => ({id: `tr-${l.host.toLowerCase()}-${i}`, name: `${l.fansub} · ${l.label}`, url: l.url, kind: 'embed', origin: 'tr-archive', lang: 'sub', tr: true, anime: true, fansub: l.fansub, referrer: 'no-referrer'}));
}

// ---------------------------------------------------------------------------
// Türkçe dublaj kaynakları (Cloudflare Worker'dan erişilir; Oracle IP'si bu sitelerce engelli)
// Dönen akışlar Referer ister: {name, url, referer, type, lang:'tr', dub:true, subtitles:[{label, lang, url, referer}]}
// Çağıran taraf adresleri imzalı HLS geçidinden (lib/hls-proxy.js) geçirir.
// ---------------------------------------------------------------------------
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const DUB_CACHE = new Map();   // anahtar → {at, list}; bulunanlar 2 saat, boş sonuç 30 dk
function cached(key, run) {
  const hit = DUB_CACHE.get(key);
  if (hit && Date.now() - hit.at < (hit.list.length ? 2 * 3600e3 : 1800e3)) return Promise.resolve(hit.list);
  return run().then(list => {
    DUB_CACHE.set(key, {at: Date.now(), list});
    if (DUB_CACHE.size > 500) DUB_CACHE.delete(DUB_CACHE.keys().next().value);
    return list;
  });
}
const getText = (url, signal, headers = {}) => fetch(url, {signal, headers: {'user-agent': BROWSER_UA, ...headers}}).then(r => r.ok ? r.text() : '');
const absUrl = s => s.startsWith('//') ? `https:${s}` : s.replace(/^http:/, 'https:');
// Aynı adları numaralandır ("Vip", "Vip 2")
const uniqueNames = list => { const n = {}; for (const s of list) { n[s.name] = (n[s.name] || 0) + 1; if (n[s.name] > 1) s.name += ` ${n[s.name]}`; } return list; };

// ---- JetFilmizle: IMDb ile arama → dublaj düğmeleri → POST /jetplayer → videopark oynatıcısı → m3u8 ----
const JET = 'https://jetfilmizle.now';
const VIDEOPARK = 'https://videopark.top/';
async function videoparkStream(frame, signal) {
  if (/videopark\.top\/vip\//.test(frame)) {
    // Vip: sayfadaki WORKER_URL + VIDEO_ID → /api/video → hlsSource.file
    const html = await getText(frame, signal);
    const worker = html.match(/WORKER_URL\s*=\s*['"](https:\/\/[^'"]+)/)?.[1];
    const vid = html.match(/VIDEO_ID\s*=\s*['"]?(\d+)/)?.[1] || new URL(frame).searchParams.get('id');
    if (!worker || !vid) return null;
    const d = await fetch(`${worker}/api/video?id=${vid}`, {signal, headers: {'user-agent': BROWSER_UA, referer: VIDEOPARK}}).then(r => r.ok ? r.json() : null);
    const file = d?.hlsSource?.file || d?.mp4Sources?.[0]?.file;
    return file ? {url: file, type: /\.mp4(\?|$)/.test(file) ? 'mp4' : 'hls', subtitles: []} : null;
  }
  if (/videopark\.top\/titan\//.test(frame)) {
    // Titan: sayfadaki "var _sd = {...}" (stream_url + altyazılar). Bu oynatıcı başka sitede gömülü açılmaz.
    const html = await getText(frame, signal);
    const raw = html.match(/var _sd\s*=\s*(\{[\s\S]*?\});/)?.[1];
    let sd; try { sd = JSON.parse(raw); } catch { return null; }
    if (!sd?.stream_url) return null;
    const subs = (sd.subtitles || []).filter(t => t?.file).map(t => ({label: String(t.label || 'Altyazı').slice(0, 40), lang: /türk|turk/i.test(t.label || '') ? 'tr' : 'en', url: absUrl(new URL(t.file, frame).href), referer: VIDEOPARK}));
    return {url: absUrl(sd.stream_url), type: 'hls', subtitles: subs};
  }
  return null;
}
export function fetchJetDub({kind, imdb, season = 1, episode = 1, timeout = 7000, limit = 5}) {
  if (kind === 'al' || !/^tt\d{5,10}$/.test(String(imdb || ''))) return Promise.resolve([]);
  const movie = kind === 'movie';
  return cached(`jet:${imdb}:${movie ? '' : `${season}:${episode}`}`, async () => {
    const signal = AbortSignal.timeout(timeout);
    const xhr = referer => ({'user-agent': BROWSER_UA, 'x-requested-with': 'XMLHttpRequest', referer});
    const search = await fetch(`${JET}/arama-json?q=${imdb}`, {signal, headers: xhr(`${JET}/`)}).then(r => r.ok ? r.json() : null);
    const item = (search?.results || []).find(r => r.imdb_id === imdb && r.type === (movie ? 'film' : 'dizi'));
    if (!item || !/^[a-z0-9/-]+$/i.test(item.url || '')) return [];
    const page = `${JET}/${item.url}`;
    const html = await getText(page, signal);
    const filmId = html.match(/name="film_id" value="(\d+)"/)?.[1];
    if (!filmId) return [];
    const buttons = [...html.matchAll(/data-source-index="(\d+)"\s*data-player-type="dublaj"(?:\s*data-season="(\d+)"\s*data-episode="(\d+)")?\s*>\s*([^<]*?)\s*</g)]
      .map(m => ({index: m[1], season: Number(m[2]), episode: Number(m[3]), label: m[4].replace(/\s+/g, ' ').trim()}))
      .filter(b => movie ? !b.season : b.season === Number(season) && b.episode === Number(episode));
    const found = await Promise.all(buttons.map(async b => {
      try {
        const t = await fetch(`${JET}/jetplayer`, {method: 'POST', signal, headers: {...xhr(page), 'content-type': 'application/x-www-form-urlencoded'}, body: `film_id=${filmId}&source_index=${b.index}&player_type=dublaj`}).then(r => r.ok ? r.text() : '');
        const frame = [...t.matchAll(/<iframe[^>]+src=['"]([^'"]+)/gi)].map(m => absUrl(m[1])).find(s => /^https:\/\/videopark\.top\/(vip|titan)\//.test(s));
        const s = frame && await videoparkStream(frame, signal);
        return s && {...s, name: `JetFilm · ${movie ? b.label : 'Dublaj'}`.slice(0, 50), referer: VIDEOPARK, lang: 'tr', dub: true};
      } catch { return null; }
    }));
    const seen = new Set();
    return uniqueNames(found.filter(s => s && httpsOnly(s.url) && !seen.has(s.url) && seen.add(s.url)).slice(0, limit));
  });
}

// ---- SelcukFlix (Dizilla / RoketDizi ile aynı altyapı): ad ile arama → IMDb eşleşmesi → sayfa verisi → pichive oynatıcısı → m3u8 ----
const SELCUK = 'https://selcukflix.app';
const SELCUK_KEY = '9bYMCNQiWsXIYFWYAu7EkdsSbmGBTyUI';   // sitenin istemci kodundaki sabit AES-256-CBC anahtarı (IV: 16 sıfır)
let selcukKey;
async function selcukDecode(b64) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  try {
    selcukKey ||= crypto.subtle.importKey('raw', new TextEncoder().encode(SELCUK_KEY), {name: 'AES-CBC'}, false, ['decrypt']);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-CBC', iv: new Uint8Array(16)}, await selcukKey, bytes)));
  } catch { return JSON.parse(new TextDecoder().decode(bytes)); }   // RoketDizi şifresiz base64 kullanır
}
async function pichiveStream(frame, signal) {
  const html = await getText(frame, signal, {referer: `${SELCUK}/`});
  const token = html.match(/openPlayer\('([^']+)'/)?.[1];
  if (!token) return null;
  const d = await fetch(`${new URL(frame).origin}/source2.php?v=${encodeURIComponent(token)}`, {signal, headers: {'user-agent': BROWSER_UA, referer: frame, 'x-requested-with': 'XMLHttpRequest'}}).then(r => r.ok ? r.json() : null);
  const file = (d?.playlist || []).flatMap(p => p.sources || []).find(s => s?.file)?.file;
  return file ? {url: absUrl(file).replace('/m.php', '/master.m3u8'), type: 'hls', subtitles: []} : null;
}
export function fetchSelcukDub({kind, imdb, titles = [], season = 1, episode = 1, timeout = 8000, limit = 3}) {
  if (kind === 'al' || !/^tt\d{5,10}$/.test(String(imdb || ''))) return Promise.resolve([]);
  const movie = kind === 'movie';
  const names = [...new Set(titles.map(t => String(t || '').trim()).filter(Boolean))].slice(0, 2);
  if (!names.length) return Promise.resolve([]);
  return cached(`selcuk:${imdb}:${movie ? '' : `${season}:${episode}`}`, async () => {
    const signal = AbortSignal.timeout(timeout);
    let item;
    for (const q of names) {
      const r = await fetch(`${SELCUK}/api/bg/searchContent?searchterm=${encodeURIComponent(q)}`, {method: 'POST', signal, headers: {'user-agent': BROWSER_UA, 'x-requested-with': 'XMLHttpRequest', referer: `${SELCUK}/`}}).then(x => x.ok ? x.json() : null);
      const res = r?.response ? await selcukDecode(r.response) : null;
      item = (res?.result || []).find(x => x.object_related_imdb_id === imdb && (movie ? x.used_type === 'Movies' : x.used_type === 'Series'));
      if (item) break;
    }
    if (!item || !/^[a-z0-9/-]+$/i.test(item.used_slug || '')) return [];
    const page = `${SELCUK}/${item.used_slug}${movie ? '' : `/sezon-${Number(season)}/bolum-${Number(episode)}`}`;
    const html = await getText(page, signal);
    const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    let secure; try { secure = await selcukDecode(JSON.parse(raw).props.pageProps.secureData); } catch { return []; }
    const rel = secure?.RelatedResults || {};
    const items = Object.entries(rel).filter(([k]) => /^(getEpisodeSources|getMoviePartSourcesById)/.test(k)).flatMap(([, v]) => v?.result || []);
    // Yalnızca dublaj; aynı oynatıcı iki kez listelenebilir
    const frames = [...new Set(items.filter(x => /dublaj/i.test(x.language_name || '')).map(x => (x.source_content || '').match(/src=["']([^"']+)/)?.[1]).filter(Boolean).map(absUrl))]
      .filter(f => /^https:\/\/([a-z0-9-]+\.)?pichive\.online\/iframe\.php\?/.test(f)).slice(0, limit);
    const found = await Promise.all(frames.map(f => pichiveStream(f, signal).then(s => s && {...s, name: 'SelcukFlix · Dublaj', referer: f, lang: 'tr', dub: true}).catch(() => null)));
    return uniqueNames(found.filter(s => s && httpsOnly(s.url)));
  });
}

/**
 * Türkçe dublaj akışları (JetFilm + SelcukFlix) — Referer isteyen adresler imzalı geçide sarılır.
 * origin: bu sitenin adresi (ör. https://lovell.workers.dev); secret: geçit imza anahtarı.
 */
export async function fetchDubSources({kind, id, imdb, titles, season, episode, origin, secret}) {
  if (!secret || !/^https?:\/\//.test(origin || '')) return [];
  const lists = await Promise.all([
    fetchJetDub({kind, imdb, season, episode}).catch(() => []),
    fetchSelcukDub({kind, imdb, titles, season, episode}).catch(() => []),
  ]);
  const out = [];
  for (const s of lists.flat()) {
    const subtitles = await Promise.all((s.subtitles || []).map(async t => ({label: t.label, lang: t.lang, url: origin + await proxyPath(secret, t.url, t.referer || s.referer)})));
    out.push({name: s.name, url: origin + await proxyPath(secret, s.url, s.referer), type: s.type, lang: 'tr', dub: true, proxied: true, quality: 'HD', subtitles});
  }
  return normalizeSources(out, 'dublaj', {loopbackOk: true});
}

// ---------------------------------------------------------------------------
// Türkçe altyazı (Wyzie Subs, ücretsiz API anahtarı ister: https://store.wyzie.io/redeem)
// ---------------------------------------------------------------------------
export async function fetchTurkishSubs({kind, id, season = 1, episode = 1, key, limit = 6}) {
  const k = String(key || '').trim();
  if (!k || kind === 'al') return [];
  const q = new URLSearchParams({id: String(id), language: 'tr', key: k});
  if (kind === 'tv') { q.set('season', String(season)); q.set('episode', String(episode)); }
  let list;
  try { list = await getJson(`https://sub.wyzie.io/search?${q}`, 8000); } catch { return []; }
  const seen = new Set();
  return (Array.isArray(list) ? list : []).flatMap(s => {
    const url = s?.url;
    if (!httpsOnly(url) || seen.has(url)) return [];
    seen.add(url);
    const fmt = String(s.format || '').toLowerCase();
    if (fmt && !['srt', 'vtt', 'webvtt'].includes(fmt)) return [];
    const rel = String(s.release || s.media || s.display || '').replace(/\s+/g, ' ').slice(0, 40);
    return [{label: `Türkçe${s.isHearingImpaired ? ' (SDH)' : ''}${rel ? ' · ' + rel : ''}`, lang: 'tr', url, type: fmt === 'srt' ? 'srt' : 'vtt', origin: 'wyzie'}];
  }).slice(0, limit);
}
