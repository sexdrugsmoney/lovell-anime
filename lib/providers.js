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
      if (mal) push(anime, `supaplay-mal-${lang}`, `SupaPlay MAL · ${label(lang)}`, `https://supaplay.fun/stream/mal/${mal}/${aep}/${lang}`, {lang, anime: true});
      if (ani) push(anime, `yumezone-${lang}`, `YumeZone · ${label(lang)}`, `https://yumezone.qzz.io/embed/megaplay/ani/${ani}/${aep}/${lang}`, {lang, anime: true});
      if (ani) push(anime, `vidhawk-${lang}`, `VidHawk · ${label(lang)}`, `https://vidhawk.buzz/embed/ani/${ani}/${aep}/${lang}?server=flow&autoskipIntro=1&autoskipOutro=1`, {lang, anime: true});
      if (ani) push(anime, `vidly-anime-${lang}`, `Vidly · ${label(lang)}`, `https://vidly.pro/anime/${ani}/${aep}?color=${color}&audio=${lang}`, {lang, anime: true});
    }
    if (ani) {
      push(anime, 'megaplay-sub', 'MegaPlay · Altyazılı', mal ? `https://megaplay.buzz/stream/mal/${mal}/${aep}/sub` : `https://megaplay.buzz/stream/ani/${ani}/${aep}/sub`, {lang: 'sub', anime: true});
      push(anime, 'megaplay-dub', 'MegaPlay · Dublaj', `https://megaplay.buzz/stream/ani/${ani}/${aep}/dub`, {lang: 'dub', anime: true});
      push(anime, 'megavid-sub', 'Megavid · Altyazılı', `https://megavid.buzz/ani/${ani}/${aep}/sub?color=%23${color}&autoplay=true`, {lang: 'sub', anime: true});
      push(anime, 'aniembed-sub', 'AniEmbed · Altyazılı', `https://aniembed.se/e/${ani}/${aep}?lang=sub&autoplay=1&s=nero`, {lang: 'sub', anime: true});
      push(anime, 'aniembed-dub', 'AniEmbed · Dublaj', `https://aniembed.se/e/${ani}/${aep}?lang=dub&autoplay=1&s=nero`, {lang: 'dub', anime: true});
      // Yedek (testte akış yüklemedi)
      push(anime, 'videasy-ws-anime', 'Videasy · Anime', `https://player.videasy.ws/embed/anime/${ani}/${aep}`, {anime: true});
      push(backup, 'videasy-anime', 'Videasy.to · Anime', `https://player.videasy.to/anime/${ani}/${aep}?color=${color}`, {anime: true});
      push(backup, 'vidnest-anime', 'VidNest · Altyazılı', `https://vidnest.fun/anime/${ani}/${aep}/sub`, {lang: 'sub', anime: true, resume: 'startAt'});
      push(backup, 'vidplus-anime', 'VidPlus · Anime', `https://player.vidplus.to/embed/anime/${ani}/${aep}?primarycolor=${color}&autonext=true&autoplay=true`, {anime: true});
      push(backup, 'vidy-anime', 'Vidy · Anime', `https://vidy.st/anime/${ani}/${aep}?color=${color}&episodeSelector=true&autoplayNextEpisode=true`, {anime: true});
      push(backup, 'justplay', 'JustPlay · Altyazılı', `https://justplay.boo/?ani=${ani}&ep=${aep}&lang=sub&autoskip=1`, {lang: 'sub', anime: true});
    }
  }

  // ---- Film / dizi (TMDB id'siyle) ----
  if (tmdb) {
    // Ruthless (2023), TMDB 984249: standard YouTube embed, checked on Lovell.
    // Turkish audio evidence: channel dub label and original Turkish ASR captions.
    // This exact-title mapping must not be used for other films or television IDs.
    if (movie && String(id) === '984249') {
      push(generic, 'weco-ruthless-tr', 'Weco / YouTube · Türkçe dublaj',
        'https://www.youtube.com/embed/4T726OAFonM?rel=0', {lang: 'tr', dub: true, resume: 'start'});
    }
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
    push(generic, 'vidlove', 'VidLove', movie ? `https://player.vidlove.cc/embed/movie/${id}` : `https://player.vidlove.cc/embed/tv/${id}/${se}/${ep}`);
    push(generic, 'cinemaos', 'CinemaOS', movie ? `https://cinemaos.tech/player/${id}?lang=en` : `https://cinemaos.tech/player/${id}/${se}/${ep}?lang=en`);
    push(generic, '2embed', '2Embed', `https://www.2embed.stream/embed/${path}`);
    push(generic, '2embedonline', '2Embed.online', `https://www.2embed.online/embed/${path}`);
    push(generic, 'embedmaster', 'EmbedMaster', `https://embedmaster.link/${path}`);
    push(generic, 'vidsrc', 'VidSrc', `https://vidsrc.buzz/embed/${path}?autoplay=true`);
    push(generic, 'vidy', 'Vidy', movie ? `https://vidy.st/movie/${id}?color=${color}&autoplay=true` : `https://vidy.st/tv/${id}/${se}/${ep}?color=${color}&nextEpisode=true&episodeSelector=true&autoplayNextEpisode=true`);
    push(generic, 'vidly', 'Vidly', movie ? `https://vidly.pro/movie/${id}?color=${color}` : `https://vidly.pro/tv/${id}/${se}/${ep}?color=${color}`);
    push(generic, 'videasy-ws', 'Videasy', movie ? `https://player.videasy.ws/embed/movie/${id}` : `https://player.videasy.ws/embed/tv/${id}/${se}/${ep}`);
    push(generic, 'vidsrcparty', 'VidSrc.party', movie ? `https://vidsrc.party/embed/movie/${id}` : `https://vidsrc.party/embed/tv/${id}/${se}/${ep}`);
    push(generic, 'vidsrclink', 'VidSrc.link', movie ? `https://vidsrc.link/embed/movie/${id}` : `https://vidsrc.link/embed/tv/${id}/${se}/${ep}`);
    push(generic, 'vidsrctop', 'VidSrc.top', movie ? `https://vid-src.top/embed/movie/${id}` : `https://vid-src.top/embed/tv/${id}/${se}/${ep}`);
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
    push(backup, 'vidzee', 'VidZee', movie ? `https://player.vidzee.wtf/embed/movie/${id}?lang=en` : `https://player.vidzee.wtf/embed/tv/${id}/${se}/${ep}?lang=en`);
    push(backup, '1embed', '1Embed', movie ? `https://1embed.cc/embed/movie/${id}` : `https://1embed.cc/embed/tv/${id}/${se}/${ep}`);
    push(backup, 'primesrc', 'PrimeSrc', movie ? `https://primesrc.me/embed/movie?tmdb=${id}` : `https://primesrc.me/embed/tv?tmdb=${id}&season=${se}&episode=${ep}`);
    push(backup, 'vidup', 'VidUp', `https://vidup.to/${path}`);
  }

  // Anime ise önce anime oynatıcıları; yedekler en sonda. Aynı adresi iki kez ekleme.
  const seen = new Set();
  return [...anime, ...generic, ...backup].filter(e => !seen.has(e.url) && seen.add(e.url));
}

// Zenkaii (zenkaii.pages.dev) ReAnime gömüsü: AniList id → FlixCloud oynatıcı.
const ZENKAII = 'https://zenkaii.pages.dev';
export async function fetchZenkaiiReanime({alId, episode = 1, audio = 'sub', timeout = 8000}) {
  const ani = Number(alId);
  const ep = Math.max(1, Number(episode) || 1);
  if (!(ani > 0)) return [];
  const lang = audio === 'dub' ? 'dub' : 'sub';
  const res = await fetch(`${ZENKAII}/api/embed/reanime?id=${ani}&ep=${ep}&audio=${lang}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(timeout),
    headers: {accept: 'text/html'},
  });
  let href = res.headers.get('location') || '';
  if (!href) {
    const html = await res.text().catch(() => '');
    href = html.match(/https?:\/\/flixcloud\.cc\/e\/[A-Za-z0-9_-]+[^"'<\s]*/)?.[0] || '';
  }
  try { href = new URL(href, ZENKAII).href; } catch { return []; }
  if (!httpsOnly(href)) return [];
  return [{id: 'reanime', name: 'ReAnime', url: href, kind: 'embed', origin: 'embed', lang, anime: true}];
}

// AnimeciX (animecix.tv): Türkiye fansub kataloğu. Tau Video kendi oynatıcısı, iframe'e açık, reklam yok.
const ANIMECIX = 'https://animecix.tv';
const foldName = s => String(s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
async function animecixJson(path, timeout) {
  const res = await fetch(ANIMECIX + path, {
    signal: AbortSignal.timeout(timeout),
    headers: {accept: 'application/json', origin: ANIMECIX, referer: ANIMECIX + '/', 'user-agent': BROWSER_UA},
  });
  if (!res.ok) throw Error(`HTTP ${res.status}`);
  return res.json();
}
function pickAnimecix(hits, {alId, malId, titles, year}) {
  const al = Number(alId) || 0, mal = Number(malId) || 0, y = Number(String(year || '').slice(0, 4)) || 0;
  const names = (titles || []).map(foldName).filter(Boolean);
  if (mal) {
    const byMal = hits.find(h => Number(h.mal_id) === mal);
    if (byMal) return byMal;
  }
  if (al) {
    const byAl = hits.find(h => Number(h.anilist_id) === al);
    if (byAl) return byAl;
  }
  let best = null, score = 0;
  for (const h of hits) {
    const hn = [h.name, h.name_english, h.name_romanji, h.original_title].map(foldName).filter(Boolean);
    let s = 0;
    if (names.some(n => hn.includes(n))) s = 70;
    else if (names.some(n => hn.some(x => x.includes(n) || n.includes(x)))) s = 40;
    if (!s) continue;
    if (y && Number(h.year) === y) s += 20;
    else if (y && Number(h.year) && Math.abs(Number(h.year) - y) > 1) continue;
    if (s > score) { score = s; best = h; }
  }
  return score >= 70 ? best : null;
}
export function fetchAnimecixEmbed({alId, malId, titles = [], year, season = 1, episode = 1, timeout = 8000, limit = 6}) {
  const queries = [...new Set((titles || []).map(t => String(t || '').trim()).filter(t => t.length >= 2))].slice(0, 3);
  const ep = Math.max(1, Number(episode) || 1);
  const se = Math.max(1, Number(season) || 1);
  if (!queries.length && !(Number(malId) > 0) && !(Number(alId) > 0)) return Promise.resolve([]);
  const q0 = queries[0] || '';
  return cached(`animecix:${alId || ''}:${malId || ''}:${foldName(q0)}:${se}:${ep}`, async () => {
    let hits = [];
    for (const q of (queries.length ? queries : [])) {
      try {
        const d = await animecixJson(`/secure/search/${encodeURIComponent(q)}?type=&limit=12`, timeout);
        hits = Array.isArray(d?.results) ? d.results : [];
      } catch { continue; }
      if (hits.length) break;
    }
    const pick = pickAnimecix(hits, {alId, malId, titles: queries, year});
    if (!pick?.id) return [];
    const d = await animecixJson(`/secure/episode-videos-points?titleId=${pick.id}&episode=${ep}&season=${se}`, timeout);
    const videos = Array.isArray(d?.videos) ? d.videos : [];
    const out = [];
    const seen = new Set();
    for (const v of videos) {
      if (v?.language && v.language !== 'tr') continue;
      const url = String(v.url || '');
      if (!httpsOnly(url) || seen.has(url) || !/^https:\/\/tau-video\.xyz\/embed\/[A-Za-z0-9]+$/i.test(url)) continue;
      seen.add(url);
      const fansub = String(v.extra || 'Fansub').split('/')[0].replace(/^çevirmen:\s*/i, '').trim().slice(0, 40) || 'Fansub';
      out.push({
        id: out.length ? `animecix-${out.length + 1}` : 'animecix',
        name: `${fansub} · TR`,
        url,
        kind: 'embed',
        origin: 'embed',
        lang: 'sub',
        tr: true,
        anime: true,
        fansub,
        pin: true,
      });
      if (out.length >= limit) break;
    }
    return out;
  });
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
    // A dubbed track is not necessarily Turkish; preserve its declared language.
    const rawLang = String(s.lang || s.language || defaults.lang || '').trim().toLowerCase();
    const lang = /^(tr|tur)(?:[-_]|dub$|$)/.test(rawLang) ? 'tr' : (rawLang || undefined);
    const dub = s.dub === true || /^(tr|tur)[-_]?dub$/.test(rawLang) || (lang === 'tr' && /dublaj/i.test(s.name || ''));
    return [{name: `${s.name || defaults.name || 'Kaynak'}${q}`.slice(0, 90), origin, url: s.url, type: kindOfUrl(s.url, s.type), subtitles: cleanSubs(s.subtitles || s.tracks), lang, ...(dub ? {dub: true} : {}), ...(s.proxied ? {proxied: true} : {}), q: Number(String(s.quality || '').match(/\d{3,4}/)?.[0]) || 0}];
  });
}

// Devre kesici: bir servis açıkça hata verirse (404/410/5xx ya da bağlantı hatası) 5 dakika sorulmaz;
// böylece kapalı bir servis her oynatmada saniyeler harcatmaz. Zaman aşımı sayılmaz (yavaş ≠ kapalı).
const DOWN = new Map();
const DOWN_MS = 5 * 60 * 1000;
export const resetProviderState = () => { DOWN.clear(); DUB_CACHE.clear(); };
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
    return normalizeSources(d.sources, 'anthology', {name: 'Anthology', loopbackOk: anthology.startsWith('http://')});
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
// Sıra gerçek ölçüme göre. PIXELDRAIN / YADISK / MEGA ve bot duvarlı barındırıcılar (VOE, DOODSTREAM, BYSE) gömülemez.
// Sibnet sunucu isteğinde 403 verir; iframe'i ziyaretçinin tarayıcısı açar.
const ARCHIVE_HOSTS = {
  UQLOAD: ['Uqload', 1], STREAMWISH: ['StreamWish', 2], VIDEA: ['Videa', 3], MAIL: ['Mail.ru', 4],
  ODNOKLASSNIKI: ['OK.ru', 5], 'OK.RU': ['OK.ru', 5], CYBERFILE: ['CyberFile', 6], VK: ['VK', 7],
  MP4UPLOAD: ['Mp4Upload', 8], GDRIVE: ['Drive', 9], DAILYMOTION: ['Dailymotion', 10], HDVID: ['HDVid', 11],
  SIBNET: ['Sibnet', 12], SENDVID: ['Sendvid', 13], SAVEFILE: ['Savefile', 14],
};
// animelvl arşivindeki adres biçimleri: Mail.ru, OK.ru, Drive, Sibnet. İzleyici iframe'i ancak gömme adresinde açar.
export function toEmbedUrl(raw) {
  const url = String(raw || '').replace(/^https?:\/\/href\.li\/\?/i, '').trim();
  if (!httpsOnly(url)) return '';
  let u;
  try { u = new URL(url); } catch { return ''; }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const id = u.pathname.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] || u.searchParams.get('id');
    return id ? `https://drive.google.com/file/d/${id}/preview` : '';
  }
  if (host === 'ok.ru') {
    const id = u.pathname.match(/(\d{5,})/)?.[1];
    return id ? `https://ok.ru/videoembed/${id}` : '';
  }
  if (host.endsWith('mail.ru')) {
    if (/\/video\/embed\/|\/videos\/embed\//.test(u.pathname)) return u.href;
    const id = u.pathname.match(/(\d{6,})/)?.[1];
    return id ? `https://my.mail.ru/video/embed/${id}` : '';
  }
  if (host === 'video.sibnet.ru') {
    const id = u.searchParams.get('videoid') || u.pathname.match(/video(\d+)/)?.[1];
    return id ? `https://video.sibnet.ru/shell.php?videoid=${id}` : '';
  }
  if (host === 'sendvid.com') {
    const id = u.pathname.split('/').filter(Boolean).pop();
    if (!id || id === 'embed') return u.href;
    return `https://sendvid.com/embed/${id}`;
  }
  if (host === 'dailymotion.com') {
    const id = u.pathname.match(/\/video\/([A-Za-z0-9]+)/)?.[1];
    return id ? `https://www.dailymotion.com/embed/video/${id}` : u.href;
  }
  return u.href;
}
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
    const url = toEmbedUrl(raw);
    if (!url) continue;
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
    const prev = DUB_CACHE.get(key);
    if (!list.length && prev?.list?.length) return prev.list;
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
const JET = 'https://jetfilmizle.app';
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
async function pichiveStream(frame, signal, referer = `${SELCUK}/`) {
  const html = await getText(frame, signal, {referer});
  const token = html.match(/openPlayer\('([^']+)'/)?.[1];
  if (!token) return null;
  const d = await fetch(`${new URL(frame).origin}/source2.php?v=${encodeURIComponent(token)}`, {signal, headers: {'user-agent': BROWSER_UA, referer: frame, 'x-requested-with': 'XMLHttpRequest'}}).then(r => r.ok ? r.json() : null);
  const file = (d?.playlist || []).flatMap(p => p.sources || []).find(s => s?.file)?.file;
  return file ? {url: absUrl(file).replace('/m.php', '/master.m3u8'), type: 'hls', subtitles: []} : null;
}
function packedUnpack(packed) {
  try {
    const m = String(packed).match(/\(function\(p,a,c,k,e,(?:d|r)\)\{[\s\S]+?\}\('([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)/);
    if (!m) return packed;
    let [, p, radix, count, dict] = m;
    radix = parseInt(radix, 10) || 36;
    count = parseInt(count, 10) || 0;
    const k = dict.split('|');
    const toBase = n => (n < radix ? '' : toBase(Math.floor(n / radix))) + ((n %= radix) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    for (let i = Math.max(count, k.length) - 1; i >= 0; i--) {
      if (k[i]) p = p.replace(new RegExp(`\\b${toBase(i)}\\b`, 'g'), k[i]);
    }
    return p;
  } catch { return packed; }
}
function rot13(s) {
  return String(s).replace(/[a-z]/gi, c => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}
function decodeImgzBlob(blob) {
  try {
    const e = atob(String(blob).split('').reverse().join(''));
    let n = '';
    for (let i = 0; i < e.length; i++) n += String.fromCharCode(e.charCodeAt(i) - ('K9L'.charCodeAt(i % 3) % 5 + 1));
    return atob(n);
  } catch { return ''; }
}
function closeloadDecode(b64) {
  try {
    return atob(atob(b64).split('').reverse().join('')).split('|')[1] || null;
  } catch { return null; }
}
function extractScx(html) {
  const anchor = html.search(/\bscx\s*=\s*\{/);
  if (anchor < 0) return null;
  const start = html.indexOf('{', anchor);
  let depth = 0, inStr = false, quote = '', esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
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

// ---- Yalnızca film: SinemaCX, HDFilm (ikisi de FirePlayer kullanır), FilmModu ----
const slugify = s => String(s || '').toLocaleLowerCase('tr').replace(/[çğıöşüâî]/g, c => ({ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i'})[c]).normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleSlugs = titles => [...new Set(titles.map(slugify).filter(s => s.length >= 3))];
// FirePlayer: .../video/<id> → POST /player/index.php?do=getVideo → securedLink (m3u8; Referer oynatıcının kendisi)
async function firePlayer(frame, site, signal) {
  const u = new URL(frame);
  const id = u.pathname.split('/').filter(Boolean).pop();
  if (!/^[a-f0-9]{16,64}$/i.test(id || '')) return null;
  const d = await fetch(`${u.origin}/player/index.php?data=${id}&do=getVideo`, {method: 'POST', signal,
    headers: {'user-agent': BROWSER_UA, 'x-requested-with': 'XMLHttpRequest', referer: site, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'},
    body: `hash=${id}&r=${encodeURIComponent(site)}`}).then(r => r.ok ? r.json() : null).catch(() => null);
  const link = d?.securedLink || d?.videoSource;
  return link && /^https:\/\//.test(link) ? {url: link, type: 'hls', referer: `${u.origin}/`, subtitles: []} : null;
}

// SinemaCX: ?s= araması → /film/<ad-yıl>/ → sayfada IMDb id doğrulaması → data-vsrc (base64) → FirePlayer
const SINEMACX = 'https://sinemacc.com';
export function fetchSinemaCxDub({kind, imdb, titles = [], year, timeout = 8000}) {
  if (kind !== 'movie' || !/^tt\d{5,10}$/.test(String(imdb || ''))) return Promise.resolve([]);
  const slugs = titleSlugs(titles);
  if (!slugs.length) return Promise.resolve([]);
  return cached(`sinemacx:${imdb}`, async () => {
    const signal = AbortSignal.timeout(timeout);
    // Adres düzeni çoğunlukla <türkçe-ad>-<özgün-ad>-<yıl>; önce tahmin edilen adresler, sonra arama sonuçları denenir
    const [orig, tr] = titles.map(slugify);
    const guesses = [tr && orig && tr !== orig && `${tr}-${orig}`, orig, tr].filter(Boolean).flatMap(g => year ? [`${g}-${year}`, g] : [g]);
    for (const q of [null, ...titles.filter(Boolean).slice(0, 2)]) {
      const html = q ? await getText(`${SINEMACX}/?s=${encodeURIComponent(q)}`, signal) : guesses.slice(0, 4).map(g => `href="${SINEMACX}/film/${g}/"`).join(' ');
      const links = [...new Set([...html.matchAll(/href="(https:\/\/sinemacc\.com\/film\/([a-z0-9-]+)\/)"/g)].filter(m => slugs.some(s => m[2].includes(s)) && (!year || m[2].includes(String(year)) || !/-\d{4}$/.test(m[2]))).map(m => m[1]))].slice(0, 3);
      for (const page of links) {
        const p = await getText(page, signal);
        if (!p.includes(imdb)) continue;
        const frames = [...p.matchAll(/data-vsrc="([A-Za-z0-9+/=]+)"/g)].map(m => { try { return atob(m[1]); } catch { return ''; } }).filter(f => /^https:\/\//.test(f));
        const tr = frames.filter(f => /lng=tur/.test(f));
        const found = await Promise.all((tr.length ? tr : frames).slice(0, 2).map(f => firePlayer(f, `${SINEMACX}/`, signal)));
        return uniqueNames(found.filter(Boolean).map(s => ({...s, name: 'SinemaCX · Dublaj', lang: 'tr', dub: true})));
      }
    }
    return [];
  });
}

// HDFilm: ?s= araması → film sayfası (+ /2/, /3/ alternatifleri) → base64 <script> içindeki "<!--baslik:..., Türkçe Dublaj ...-->" iframe → FirePlayer
const HDFILM = 'https://hdfilm.us';
export function fetchHdFilmDub({kind, imdb, titles = [], year, timeout = 8000}) {
  if (kind !== 'movie' || !/^tt\d{5,10}$/.test(String(imdb || ''))) return Promise.resolve([]);
  const slugs = titleSlugs(titles);
  if (!slugs.length || !year) return Promise.resolve([]);
  return cached(`hdfilm:${imdb}`, async () => {
    const signal = AbortSignal.timeout(timeout);
    let page;
    for (const q of titles.filter(Boolean).slice(0, 2)) {
      const html = await getText(`${HDFILM}/?s=${encodeURIComponent(q)}`, signal);
      const cands = [...new Set([...html.matchAll(/href="(https:\/\/hdfilm\.us\/([a-z0-9-]+)\/)"/g)].filter(m => slugs.some(s => m[2].includes(s))).map(m => m[1]))].slice(0, 3);
      for (const c of cands) {
        const p = await getText(c, signal);
        // Sayfada IMDb id yok: yapım yılı eşleşmeli
        if (p.includes(String(year))) { page = {url: c, html: p}; break; }
      }
      if (page) break;
    }
    if (!page) return [];
    const parts = [page.html, ...await Promise.all([2, 3].map(n => getText(`${page.url}${n}/`, signal).catch(() => '')))];
    const frames = [...new Set(parts.flatMap(h => [...h.matchAll(/<script[^>]*>\s*(PCEtLWJhc2xpazp[A-Za-z0-9+/=]+)\s*<\/script>/g)].map(m => { try { return new TextDecoder().decode(Uint8Array.from(atob(m[1]), c => c.charCodeAt(0))); } catch { return ''; } }))
      .filter(t => /dublaj|,\s*tr\s*-->/i.test(t)).map(t => t.match(/<iframe[^>]+src="(https:\/\/[^"]+)"/)?.[1]).filter(Boolean))].slice(0, 2);
    const found = await Promise.all(frames.map(f => firePlayer(f, `${HDFILM}/`, signal)));
    return uniqueNames(found.filter(Boolean).map(s => ({...s, name: 'HDFilm · Dublaj', lang: 'tr', dub: true})));
  });
}

// FilmModu (filmmodu.cc): POST /arama/ (Türkçe harfler sadeleştirilmiş) → /film/<ad>-izle/ → kapak adresindeki IMDb id doğrulaması
// → pdata['prt_atom…'] (base64 iframe) → vidmixi bePlayer (CryptoJS AES, parola sayfada) → video_location (Türkçe + İngilizce ses izli m3u8)
const FILMMODU = 'https://filmmodu.cc';
// CryptoJS AES (OpenSSL EVP_BytesToKey, MD5) — Workers'ta WebCrypto MD5 yok, küçük bir MD5 yeterli
function md5Bytes(input) {
  const s = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21], K = Array.from({length: 64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const len = input.length, n = (((len + 8) >> 6) + 1) * 16, w = new Uint32Array(n);
  for (let i = 0; i < len; i++) w[i >> 2] |= input[i] << ((i % 4) * 8);
  w[len >> 2] |= 0x80 << ((len % 4) * 8); w[n - 2] = len * 8;
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let o = 0; o < n; o += 16) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      const r = i >> 4;
      let f = r === 0 ? (b & c) | (~b & d) : r === 1 ? (d & b) | (~d & c) : r === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const g = r === 0 ? i : r === 1 ? (5 * i + 1) % 16 : r === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
      f = (f + a + K[i] + w[o + g]) >>> 0; a = d; d = c; c = b;
      const sh = s[r * 4 + (i % 4)];
      b = (b + ((f << sh) | (f >>> (32 - sh)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((v, i) => { for (let j = 0; j < 4; j++) out[i * 4 + j] = (v >>> (8 * j)) & 255; });
  return out;
}
async function cryptoJsDecrypt(pass, {ct, iv, s}) {
  const salt = Uint8Array.from(String(s).match(/../g) || [], h => parseInt(h, 16));
  const p = new TextEncoder().encode(pass);
  let prev = new Uint8Array(0), out = new Uint8Array(0);
  while (out.length < 48) { prev = md5Bytes(new Uint8Array([...prev, ...p, ...salt])); out = new Uint8Array([...out, ...prev]); }
  const key = await crypto.subtle.importKey('raw', out.slice(0, 32), {name: 'AES-CBC'}, false, ['decrypt']);
  const data = Uint8Array.from(atob(ct), c => c.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-CBC', iv: out.slice(32, 48)}, key, data));
}
async function vidmixiStream(frame, signal) {
  const html = await getText(frame, signal, {referer: `${FILMMODU}/`});
  const m = html.match(/bePlayer\('([^']+)',\s*'(\{[^']+\})'/);
  if (!m) return null;
  let d; try { d = JSON.parse(await cryptoJsDecrypt(m[1], JSON.parse(m[2].replace(/\\\//g, '/')))); } catch { return null; }
  const url = String(d?.video_location || '').replace(/\\\//g, '/');
  if (!/^https:\/\//.test(url)) return null;
  // Yalnızca Türkçe ses izi olan akışlar (dublaj)
  const master = await getText(url, signal, {referer: frame});
  if (!/TYPE=AUDIO[^\n]*LANGUAGE="tu?r/i.test(master)) return null;
  const origin = new URL(frame).origin;
  const subtitles = (d.strSubtitles || []).filter(t => t?.file && /^(tur|tr)$/i.test(t.language || '')).map(t => ({label: 'Türkçe', lang: 'tr', url: new URL(t.file, origin).href, referer: `${origin}/`}));
  return {url, type: 'hls', referer: `${origin}/`, subtitles};
}
export function fetchFilmModuDub({kind, imdb, titles = [], timeout = 9000}) {
  if (kind !== 'movie' || !/^tt\d{5,10}$/.test(String(imdb || ''))) return Promise.resolve([]);
  const queries = [...new Set(titles.map(t => slugify(t).replace(/-/g, ' ')).filter(q => q.length >= 3))].slice(0, 2);
  if (!queries.length) return Promise.resolve([]);
  return cached(`filmmodu:${imdb}`, async () => {
    const signal = AbortSignal.timeout(timeout);
    const tried = new Set();
    for (const q of queries) {
      const r = await fetch(`${FILMMODU}/arama/`, {method: 'POST', signal, headers: {'user-agent': BROWSER_UA, 'x-requested-with': 'XMLHttpRequest', referer: `${FILMMODU}/`, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'}, body: `action=ajax_search&arama_kelime=${encodeURIComponent(q)}`}).then(x => x.ok ? x.text() : '');
      const cands = [...new Set([...r.matchAll(/href="(https:\/\/filmmodu\.cc\/film\/[a-z0-9-]+\/)"/g)].map(m => m[1]))].filter(u => !tried.has(u)).slice(0, 5);
      for (const page of cands) {
        tried.add(page);
        const html = await getText(page, signal);
        // Kapak görseli IMDb id'siyle adlandırılmış: .../covers/2024-08/tt0241527.webp
        if (!html.includes(`/${imdb}.`)) continue;
        const frames = [...html.matchAll(/pdata\['prt_[a-z]+\d+'\]\s*=\s*'([A-Za-z0-9+/=]+)'/g)].map(m => {
          // Değer, başına bir harf eklenmiş base64 (iframe etiketinin ortası); eksik baş kısım önemsiz
          for (const cut of [1, 2, 3, 0]) { try { const t = atob(m[1].slice(cut)); const src = t.match(/src="(https:\/\/[^"]+)"/)?.[1]; if (src) return src; } catch {} }
          return null;
        }).filter(f => f && /^https:\/\/vidmixi\.com\/embed\//.test(f));
        const found = await Promise.all([...new Set(frames)].slice(0, 2).map(f => vidmixiStream(f, signal).catch(() => null)));
        return uniqueNames(found.filter(Boolean).map(s => ({...s, name: 'FilmModu · Dublaj', lang: 'tr', dub: true})));
      }
    }
    return [];
  });
}

// ---- DiziYou: arama → {slug}-{sezon}-sezon-{bölüm}-bolum → storage.diziyou.one HLS (Türkçe dublaj: {id}_tr) ----
const DIZIYOU = 'https://www.diziyou.one';
export function fetchDiziYouDub({kind, titles = [], season = 1, episode = 1, timeout = 8000}) {
  if (kind !== 'tv') return Promise.resolve([]);
  const slugs = titleSlugs(titles);
  const queries = [...new Set(titles.map(t => String(t || '').trim()).filter(t => t.length >= 3))].slice(0, 2);
  if (!slugs.length || !queries.length) return Promise.resolve([]);
  return cached(`diziyou:${slugs.join('|')}:${season}:${episode}`, async () => {
    const signal = AbortSignal.timeout(timeout);
    let slug;
    for (const q of queries) {
      const html = await getText(`${DIZIYOU}/?s=${encodeURIComponent(q)}`, signal, {referer: `${DIZIYOU}/`});
      const hits = [...html.matchAll(/href="https:\/\/www\.diziyou\.one\/([a-z0-9-]+)\/"/g)].map(m => m[1]).filter(s => s.length >= 3 && !/^(feed|search|uye-ol|comments)$/.test(s));
      const hit = hits.find(s => slugs.includes(s)) || hits.find(s => slugs.some(want => s === want || s.includes(want) || want.includes(s)));
      if (hit) { slug = hit; break; }
    }
    if (!slug) return [];
    const page = `${DIZIYOU}/${slug}-${Math.max(1, Number(season) || 1)}-sezon-${Math.max(1, Number(episode) || 1)}-bolum/`;
    const html = await getText(page, signal, {referer: `${DIZIYOU}/`});
    if (!html.includes('id="turkceDublaj"') && !/türkçe dublaj/i.test(html)) return [];
    const itemId = html.match(/id="diziyouPlayer"[^>]+src="[^"]*\/player\/(\d+)\.html/)?.[1]
      || html.match(/\/player\/(\d+)\.html/)?.[1];
    if (!itemId) return [];
    const url = `https://storage.diziyou.one/episodes/${itemId}_tr/play.m3u8`;
    return [{url, type: 'hls', name: 'DiziYou · Dublaj', referer: `${DIZIYOU}/`, lang: 'tr', dub: true, subtitles: []}];
  });
}

// ---- Dizilla: slug-{sezon}-sezon-{bölüm}-bolum → pichive iframe (lang=dub) ----
const DIZILLA = 'https://dizilla.la';
export function fetchDizillaDub({kind, titles = [], season = 1, episode = 1, timeout = 8000, limit = 2}) {
  if (kind !== 'tv') return Promise.resolve([]);
  const slugs = titleSlugs(titles);
  if (!slugs.length) return Promise.resolve([]);
  return cached(`dizilla:${slugs.join('|')}:${season}:${episode}`, async () => {
    const signal = AbortSignal.timeout(timeout);
    const se = Math.max(1, Number(season) || 1), ep = Math.max(1, Number(episode) || 1);
    let html = '';
    for (const slug of slugs.slice(0, 3)) {
      html = await getText(`${DIZILLA}/${slug}-${se}-sezon-${ep}-bolum`, signal, {referer: `${DIZILLA}/`});
      if (html && /pichive\.online/i.test(html)) break;
      html = '';
    }
    if (!html) return [];
    const raw = html.replace(/\\"/g, '"').replace(/\\\//g, '/');
    const frames = [...raw.matchAll(/"lang"\s*:\s*"dub"[\s\S]{0,320}?"src"\s*:\s*"(https:\/\/(?:[a-z0-9-]+\.)?pichive\.online\/iframe\.php\?v=[A-Za-z0-9]+)"/g)]
      .map(m => m[1]);
    const uniq = [...new Set(frames)].slice(0, limit);
    if (!uniq.length) return [];
    const found = await Promise.all(uniq.map(f => pichiveStream(f, signal, `${DIZILLA}/`).then(s => s && {...s, name: 'Dizilla · Dublaj', referer: f, lang: 'tr', dub: true}).catch(() => null)));
    return uniqueNames(found.filter(s => s && httpsOnly(s.url)));
  });
}

// ---- HDFilmCehennemi: /search?q= → TR alternatif → /video/{id}/ packed file_link (film + dizi) ----
const HDFC = 'https://www.hdfilmcehennemi.nl';
export function fetchHdFilmCehennemiDub({kind, titles = [], year, season = 1, episode = 1, timeout = 8000}) {
  if (kind !== 'movie' && kind !== 'tv') return Promise.resolve([]);
  const slugs = titleSlugs(titles);
  const queries = [...new Set(titles.map(t => String(t || '').trim()).filter(t => t.length >= 3))].slice(0, 2);
  if (!slugs.length || !queries.length) return Promise.resolve([]);
  return cached(`hdfc:${kind}:${slugs.join('|')}:${year || ''}:${season}:${episode}`, async () => {
    const signal = AbortSignal.timeout(timeout);
    const hdr = {'user-agent': BROWSER_UA, 'x-requested-with': 'fetch', referer: `${HDFC}/`};
    let href;
    for (const q of queries) {
      const d = await fetch(`${HDFC}/search?q=${encodeURIComponent(q)}`, {signal, headers: hdr}).then(r => r.ok ? r.json() : null).catch(() => null);
      const snippets = Array.isArray(d?.results) ? d.results : [];
      for (const snip of snippets) {
        const t = String(snip);
        const title = slugify(t.match(/<h4[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)/i)?.[1] || t.match(/<h4[^>]*>([^<]+)/i)?.[1] || '');
        const link = (t.match(/href="(https?:\/\/[^"]+)"/i) || t.match(/href="(\/[^"]+)"/i) || [])[1];
        if (!link || !title) continue;
        if (!slugs.some(s => title === s || title.includes(s) || s.includes(title))) continue;
        href = /^https?:/i.test(link) ? link : new URL(link, HDFC).href;
        break;
      }
      if (href) break;
    }
    if (!href) return [];
    let html = await getText(href, signal, hdr);
    if (kind === 'tv') {
      const se = Math.max(1, Number(season) || 1), ep = Math.max(1, Number(episode) || 1);
      const epHref = [...html.matchAll(/href="([^"]+)"[^>]*>[\s\S]{0,120}?(\d+)\.\s*Sezon[\s\S]{0,40}?(\d+)\.\s*Bölüm/gi)]
        .find(m => Number(m[2]) === se && Number(m[3]) === ep)?.[1]
        || [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]).find(u => new RegExp(`${se}[.\\-]sezon.*${ep}[.\\-]bolum|sezon-${se}.*bolum-${ep}`, 'i').test(u));
      if (epHref) html = await getText(/^https?:/i.test(epHref) ? epHref : new URL(epHref, HDFC).href, signal, hdr);
    }
    const blocks = [...html.matchAll(/<div[^>]+class="[^"]*alternative-links[^"]*"[^>]*data-lang="([^"]+)"[^>]*>([\s\S]*?)<\/div>/gi)];
    const tr = blocks.filter(b => /^tr$/i.test(b[1]));
    const use = (tr.length ? tr : blocks).map(b => b[2]).join('\n');
    const videoIds = [...use.matchAll(/data-video="(\d+)"/g)].map(m => m[1]).slice(0, 2);
    if (!videoIds.length) return [];
    const found = [];
    for (const vid of videoIds) {
      const api = await getText(`${HDFC}/video/${vid}/`, signal, {...hdr, referer: href, 'content-type': 'application/json'});
      let iframe = (api.match(/data-src=\\?"([^"\\]+)/) || [])[1]?.replace(/\\+/g, '') || '';
      if (/rapidrame_id=/.test(iframe)) iframe = `${HDFC}/playerr/${iframe.split('rapidrame_id=').pop()}`;
      if (!iframe) continue;
      iframe = absUrl(iframe);
      const player = await getText(iframe, signal, {referer: `${HDFC}/`});
      const packed = player.match(/eval\(function\(p,a,c,k,e,(?:d|r)\)[\s\S]+?\)\)/);
      const unpacked = packed ? packedUnpack(packed[0]) : player;
      const b64 = unpacked.match(/file_link\s*=\s*"([A-Za-z0-9+/=]+)"/)?.[1];
      let url = '';
      if (b64) { try { url = atob(b64); } catch { url = ''; } }
      if (!url) url = (unpacked.match(/["'](https:\/\/[^"']+\.m3u8[^"']*)["']/) || [])[1] || '';
      if (url && httpsOnly(url)) found.push({url, type: 'hls', name: 'HDFilmCehennemi · Dublaj', referer: `${HDFC}/`, lang: 'tr', dub: true, subtitles: []});
    }
    return uniqueNames(found);
  });
}

// ---- FullHDFilmizlesene: scx (ROT13+base64) → RapidVid/imgz veya VidMoly m3u8 (film) ----
const FULLHD = 'https://www.fullhdfilmizlesene.now';
async function rapidVidStream(frame, signal) {
  const html = await getText(frame, signal, {referer: `${FULLHD}/`});
  const origin = new URL(frame).origin;
  const p8 = html.match(/window\._p8\s*=\s*['"]([^'"]+)['"]/)?.[1];
  if (p8) {
    try {
      const cfg = JSON.parse(decodeImgzBlob(p8));
      const url = cfg.cm || cfg.tm;
      if (url && /^https:\/\//.test(url)) return {url, type: 'hls', referer: `${origin}/`, subtitles: []};
    } catch {}
  }
  const blob = html.match(/["']file["']\s*:\s*(?:av|_)\(\s*["']([^"']+)["']\s*\)/)?.[1];
  if (blob) {
    const url = decodeImgzBlob(blob);
    if (url && /^https:\/\//.test(url)) return {url, type: 'hls', referer: `${origin}/`, subtitles: []};
  }
  const file = html.match(/file:\s*['"](https:\/\/[^'"]+\.m3u8[^'"]*)['"]/i)?.[1];
  return file ? {url: file, type: 'hls', referer: `${origin}/`, subtitles: []} : null;
}
export function fetchFullHdDub({kind, titles = [], year, timeout = 9000}) {
  if (kind !== 'movie') return Promise.resolve([]);
  const slugs = titleSlugs(titles);
  const queries = [...new Set(titles.map(t => String(t || '').trim()).filter(t => t.length >= 3))].slice(0, 2);
  if (!slugs.length || !queries.length) return Promise.resolve([]);
  return cached(`fullhd:${slugs.join('|')}:${year || ''}`, async () => {
    const signal = AbortSignal.timeout(timeout);
    let page;
    for (const q of queries) {
      const html = await getText(`${FULLHD}/arama/${encodeURIComponent(q)}`, signal, {referer: `${FULLHD}/`})
        || await getText(`${FULLHD}/?s=${encodeURIComponent(q)}`, signal, {referer: `${FULLHD}/`});
      const hrefs = [...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map(m => m[1]))]
        .filter(u => /fullhdfilmizlesene/i.test(u) && slugs.some(s => u.includes(s)));
      for (const href of hrefs.slice(0, 4)) {
        const p = await getText(href, signal, {referer: `${FULLHD}/`});
        if (year && p.includes(String(year)) || !year || /scx\s*=/.test(p)) { page = p; break; }
      }
      if (page) break;
    }
    if (!page) return [];
    const scx = extractScx(page);
    if (!scx) return [];
    const encoded = [];
    for (const [key, item] of Object.entries(scx)) {
      if (!item || typeof item !== 'object' || /advid/i.test(key)) continue;
      const t = item.sx?.t;
      const pick = t && typeof t === 'object' ? (t.tr || t.atom || Object.values(t)[0]) : null;
      const enc = typeof pick === 'string' ? pick : Array.isArray(pick) ? pick[0] : null;
      if (enc) encoded.push(enc);
    }
    const frames = encoded.map(e => { try { return atob(rot13(e)); } catch { return ''; } }).filter(u => /^https:\/\//.test(u)).slice(0, 3);
    const found = [];
    for (const f of frames) {
      try {
        let s = null;
        if (/rapidvid|imgz\.me/i.test(f)) s = await rapidVidStream(f, signal);
        else if (/vidmoly|vidmoxy/i.test(f)) {
          const html = await getText(f, signal, {referer: `${FULLHD}/`});
          const file = html.match(/file:\s*['"](https:\/\/[^'"]+\.m3u8[^'"]*)['"]/i)?.[1];
          if (file) s = {url: file, type: 'hls', referer: `${new URL(f).origin}/`, subtitles: []};
        }
        if (s?.url && httpsOnly(s.url)) found.push({...s, name: 'FullHDFilmizlesene · Dublaj', lang: 'tr', dub: true});
      } catch {}
    }
    return uniqueNames(found);
  });
}

// ---- FilmMakinesi CloseLoad: lema/v1 TMDB → packed POST → HLS (film) ----
const FILMMAKINESI = 'https://filmmakinesi.to';
const CLOSELOAD = 'https://closeload.filmmakinesi.to';
export function fetchCloseLoadDub({kind, id, titles = [], timeout = 8000}) {
  if (kind !== 'movie' || !Number(id)) return Promise.resolve([]);
  return cached(`closeload:${id}`, async () => {
    const signal = AbortSignal.timeout(timeout);
    const hdr = {'user-agent': BROWSER_UA, referer: `${FILMMAKINESI}/`, accept: 'application/json'};
    let videoId = null;
    const lema = await fetch(`${FILMMAKINESI}/lema/v1/search?tmdb=${id}&type=movie`, {signal, headers: hdr}).then(r => r.ok ? r.json() : null).catch(() => null);
    videoId = lema?.closeload_id || lema?.video_id || lema?.embed_id
      || lema?.data?.[0]?.closeload_id || lema?.results?.[0]?.closeload_id || lema?.film?.closeload_id || null;
    if (!videoId) {
      const q = titles.map(t => String(t || '').trim()).find(Boolean);
      const html = q ? await getText(`${FILMMAKINESI}/?s=${encodeURIComponent(q)}`, signal, {'user-agent': BROWSER_UA, referer: `${FILMMAKINESI}/`}) : '';
      videoId = html.match(/closeload\.filmmakinesi\.to\/video\/embed\/([A-Za-z0-9]+)/)?.[1] || null;
    }
    if (!videoId) return [];
    const embedUrl = `${CLOSELOAD}/video/embed/${videoId}/ah/`;
    const getHtml = await getText(embedUrl, signal, {
      'user-agent': BROWSER_UA, referer: `${FILMMAKINESI}/`, accept: 'text/html',
      'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-site',
    });
    const hash = getHtml.match(/var\s+\w+\s*=\s*["']([a-f0-9]{32})["']/i)?.[1] || getHtml.match(/["']([a-f0-9]{32})["']/)?.[1];
    if (!hash) return [];
    const postHtml = await fetch(embedUrl, {
      signal, method: 'POST',
      headers: {
        'user-agent': BROWSER_UA, origin: CLOSELOAD, referer: embedUrl,
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: `hash=${hash}`,
    }).then(r => r.ok ? r.text() : '').catch(() => '');
    const packed = postHtml.match(/eval\(function\(p,a,c,k,e,(?:d|r)\)[\s\S]+?\)\)/);
    if (!packed) return [];
    const unpacked = packedUnpack(packed[0]);
    const b64 = unpacked.match(/return result\}[^(]*\(["']([A-Za-z0-9+/=]{20,})["']\)/)?.[1]
      || unpacked.match(/\(["']([A-Za-z0-9+/=]{20,})["']\)/)?.[1];
    const url = b64 ? closeloadDecode(b64) : null;
    if (!url || !url.startsWith('http')) return [];
    return [{url, type: 'hls', name: 'FilmMakinesi · Dublaj', referer: `${CLOSELOAD}/`, lang: 'tr', dub: true, subtitles: []}];
  });
}

// ---- HDFilmizleyelim (hdfilmizleyelim3.com): WP REST → content → iframe player.izlsene.shop → m3u8 ----
// Format: GET /wp-json/wp/v2/posts?search={title}&_fields=id,slug,title,content
// content.rendered → <!--baslik:N.Bölüm,trd,1080p--><iframe src="...?video=PATH"> 
// Dizi: Her WP post bir sezonu; bölümler <!--nextpage--> ile ayrılır. page parametresiyle istenilen bölüme atlanır.
// Film: Tek post, tek iframe.
// M3u8: https://player.izlsene.shop{decodedPath} — Referer: https://player.izlsene.shop/
const HDFILMIZLEYELIM = 'https://hdfilmizleyelim3.com';
const IZLSENE_BASE = 'https://player.izlsene.shop';
const IZLSENE_REFERER = `${IZLSENE_BASE}/`;

function izlseneM3u8FromIframe(iframeSrc) {
  try {
    const u = new URL(iframeSrc);
    const raw = u.searchParams.get('video');
    if (!raw) return null;
    const decoded = decodeURIComponent(raw).replace(/^\.\./, '');
    const full = IZLSENE_BASE + (decoded.startsWith('/') ? decoded : '/' + decoded);
    return httpsOnly(full) ? full : null;
  } catch { return null; }
}

function hdfilmizleyelimFrames(html, episode) {
  // Her bölüm <!--baslik:...--> ile işaretlenmiş; bölümler <!--nextpage--> ile ayrılıyor.
  // episode=1 → ilk blok; episode=N → N-1. <!--nextpage-->'den sonrası
  const blocks = html.split(/<!--nextpage-->/);
  const idx = Math.max(0, (Number(episode) || 1) - 1);
  const block = blocks[idx] || blocks[0] || '';
  const iframes = [...block.matchAll(/<iframe[^>]+src="([^"]+player\.izlsene\.shop[^"]+)"/gi)].map(m => m[1]);
  return iframes.map(izlseneM3u8FromIframe).filter(Boolean);
}

export function fetchHdFilmizleyelimEmbed({kind, titles = [], year, season = 1, episode = 1, timeout = 8000}) {
  if (kind === 'al') return Promise.resolve([]);
  const slugs = titleSlugs(titles);
  const queries = [...new Set(titles.map(t => String(t || '').trim()).filter(t => t.length >= 3))].slice(0, 2);
  if (!slugs.length || !queries.length) return Promise.resolve([]);
  const isMovie = kind === 'movie';
  return cached(`hdfilmizleyelim:${kind}:${slugs.join('|')}:${isMovie ? year || '' : `${season}:${episode}`}`, async () => {
    const signal = AbortSignal.timeout(timeout);
    let hit = null;
    for (const q of queries) {
      const list = await fetch(
        `${HDFILMIZLEYELIM}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=10&_fields=id,slug,title,content`,
        {signal, headers: {'user-agent': BROWSER_UA, 'accept': 'application/json'}}
      ).then(r => r.ok ? r.json() : []).catch(() => []);
      if (!Array.isArray(list)) continue;
      // Başlık eşleşmesi: slug içinde kelimeler + yıl kontrolü
      for (const post of list) {
        const postSlug = slugify(String(post.slug || ''));
        let score = 0;
        for (const s of slugs) {
          if (postSlug === s || postSlug.includes(s) || s.includes(postSlug.replace(/-izle.*$/, '').replace(/-\d{4}$/, ''))) score = Math.max(score, 80);
          const st = slugTokens(s), pt = slugTokens(postSlug);
          let share = 0; for (const w of st) if (pt.has(w)) share++;
          if (share >= 2) score = Math.max(score, 40 + share * 10);
        }
        if (!score) continue;
        // Sezon kontrolü: dizi için post başlığında sezon numarası ara
        if (!isMovie) {
          const titleText = String(post.title?.rendered || '');
          const seasonMatch = titleText.match(/(\d+)[.]\s*sezon|sezon\s*(\d+)/i);
          const postSeason = seasonMatch ? Number(seasonMatch[1] || seasonMatch[2]) : 1;
          if (postSeason !== Number(season)) continue;
        }
        if (year && !isMovie) { /* dizi için yıl kontrolü yapmıyoruz */ }
        else if (year && isMovie) {
          const yearInSlug = postSlug.match(/(\d{4})/)?.[1];
          if (yearInSlug && Math.abs(Number(yearInSlug) - Number(year)) > 1) continue;
        }
        hit = post;
        break;
      }
      if (hit) break;
    }
    if (!hit) return [];
    const html = String(hit.content?.rendered || '');
    const urls = hdfilmizleyelimFrames(html, isMovie ? 1 : episode);
    return urls.map((url, i) => ({
      id: i ? `izlsene-${i + 1}` : 'izlsene',
      name: i ? `HDFilmizleyelim ${i + 1}` : 'HDFilmizleyelim',
      url,
      type: 'hls',
      referer: IZLSENE_REFERER,
      lang: 'tr',
      dub: true,
      subtitles: [],
    }));
  });
}

// ---- DDizici + Pilavyer Player: film sayfası → data-pv slug → s.php → video ID → token → stream.php → m3u8 ----
// DDizici başlık slug'u: Türkçe harfler sadeleştirilip boşluklar tire yapılır; yılsız ve yıllı formatlar denenir.
// Dizi: /dizi/{slug}/sezon-{s}/bolum-{e}  Film: /film/{slug}
// Referer: https://ddizici.org  (pilavyer origin kilidi için zorunlu)
const DDIZICI = 'https://ddizici.org';
const PILAVYER = 'https://play2.pilavyerplay.top';
const DDIZICI_REFERER = `${DDIZICI}/`;
const PILAVYER_REFERER = `${PILAVYER}/`;

const ddiziciSlug = s => String(s || '')
  .toLocaleLowerCase('tr')
  .replace(/[çğıöşüâî]/g, c => ({ç:'c',ğ:'g',ı:'i',ö:'o',ş:'s',ü:'u',â:'a',î:'i'})[c] || c)
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function pilavyerStreamFromSlug(pvSlug, signal) {
  // 1. s.php → window.__PLAYER__.v (video ID) al
  const sUrl = `${PILAVYER}/assets/js/s.php?s=${encodeURIComponent(pvSlug)}`;
  const html = await fetch(sUrl, {
    signal,
    headers: {'user-agent': BROWSER_UA, 'referer': DDIZICI_REFERER, 'origin': DDIZICI},
  }).then(r => r.ok ? r.text() : '');
  const vid = html.match(/"v"\s*:\s*"([a-f0-9]{20,})"/)?.[1];
  if (!vid) return null;

  // 2. token.php → JWT token
  const tokData = await fetch(`${PILAVYER}/api/token.php?v=${vid}`, {
    signal,
    headers: {'user-agent': BROWSER_UA, 'referer': DDIZICI_REFERER, 'origin': DDIZICI},
  }).then(r => r.ok ? r.json() : null);
  const token = tokData?.token;
  if (!token) return null;

  // 3. stream.php → m3u8 (doğrudan HLS manifest döner)
  const streamUrl = `${PILAVYER}/api/stream.php?v=${vid}&token=${encodeURIComponent(token)}`;
  const probe = await fetch(streamUrl, {
    signal, method: 'HEAD',
    headers: {'user-agent': BROWSER_UA, 'referer': PILAVYER_REFERER, 'origin': PILAVYER},
  });
  if (!probe.ok) return null;
  const ct = probe.headers.get('content-type') || '';
  if (!ct.includes('mpegurl') && !ct.includes('m3u8')) return null;

  return {url: streamUrl, type: 'hls', referer: PILAVYER_REFERER};
}

export function fetchDdiziciEmbed({kind, titles = [], year, season = 1, episode = 1, timeout = 10000}) {
  if (kind === 'al') return Promise.resolve([]);
  const slugs = [
    ...titles.map(t => ddiziciSlug(t)),
    ...titles.map(t => ddiziciSlug(t) + (year ? `-${year}` : '')),
  ].filter((s, i, a) => s.length >= 3 && a.indexOf(s) === i).slice(0, 4);
  if (!slugs.length) return Promise.resolve([]);
  const isMovie = kind === 'movie';
  return cached(`ddizici:${kind}:${slugs[0]}:${isMovie ? year || '' : `${season}:${episode}`}`, async () => {
    const signal = AbortSignal.timeout(timeout);
    for (const slug of slugs) {
      try {
        // Film veya dizi bölüm sayfasını al
        const pageUrl = isMovie
          ? `${DDIZICI}/film/${slug}`
          : `${DDIZICI}/dizi/${slug}/sezon-${season}/bolum-${episode}`;
        const html = await getText(pageUrl, signal, {'referer': DDIZICI_REFERER});
        // data-pv slug'unu çıkar
        const pvSlug = html.match(/data-pv="([^"]+)"/)?.[1];
        if (!pvSlug) continue;
        const stream = await pilavyerStreamFromSlug(pvSlug, signal);
        if (!stream) continue;
        return [{
          url: stream.url,
          type: stream.type,
          referer: stream.referer,
          name: 'DDizici · Türkçe',
          lang: 'tr',
          dub: true,
          subtitles: [],
        }];
      } catch { continue; }
    }
    return [];
  });
}

// ---- DiziSol: TMDB id → /api/movies/by-tmdb/{id}[?season=&episode=] → sources[].m3u8Url ----
// Public API, kimlik doğrulaması yok. Yalnızca isActive=true kaynaklar alınır.
// s4.dizisol.com/?m3u8=BASE64 → doğrudan HLS, Referer gerektirmiyor.
// Diğer proxy'ler (s6, s8, s12, s15, rapid.*, load-mixi.*, cortina.*, pal.*, four.*)
// dizisol.com Referer istiyor; imzalı geçitten geçirilir.
const DIZISOL = 'https://dizisol.com';
const DIZISOL_REFERER = `${DIZISOL}/`;

// s4.dizisol.com/?m3u8=BASE64 → gerçek m3u8 URL'si (base64 decode)
function decodeDizisolM3u8(url) {
  try {
    const u = new URL(url);
    const b64 = u.searchParams.get('m3u8');
    if (!b64) return url;
    const decoded = typeof atob === 'function'
      ? atob(b64)
      : Buffer.from(b64, 'base64').toString('utf8');
    return decoded.startsWith('http') ? decoded : url;
  } catch { return url; }
}

// Dizisol proxy URL'lerini gerçek HLS URL'ye çözer; çözülemeyen proxy'ler Referer ile geçirilir.
function dizisolSourceInfo(src) {
  const raw = String(src.m3u8Url || '');
  if (!raw || !raw.startsWith('http')) return null;
  // s4.dizisol.com — m3u8= param içeriyor, Referer gerekmez
  if (/^https:\/\/s4\.dizisol\.com\/\?m3u8=/.test(raw)) {
    const url = decodeDizisolM3u8(raw);
    if (!httpsOnly(url)) return null;
    return {url, type: 'hls', referer: null};
  }
  // Diğer s*.dizisol.com, *.workers.dev → dizisol.com Referer ile çalışır
  if (/dizisol\d*\.com|dizisol\d+\.workers\.dev/.test(raw)) {
    return {url: raw, type: 'hls', referer: DIZISOL_REFERER};
  }
  return null;
}

function dizisolSubUrl(url) {
  if (!url || !url.startsWith('http')) return null;
  if (!httpsOnly(url)) return null;
  return url;
}

export function fetchDizisolSources({kind, id, season = 1, episode = 1, timeout = 9000, limit = 4}) {
  if (kind === 'al' || !Number(id)) return Promise.resolve([]);
  const isMovie = kind === 'movie';
  const cacheKey = isMovie
    ? `dizisol:movie:${id}`
    : `dizisol:tv:${id}:${season}:${episode}`;
  return cached(cacheKey, async () => {
    const q = isMovie ? '' : `?season=${season}&episode=${episode}`;
    const signal = AbortSignal.timeout(timeout);
    const data = await fetch(`${DIZISOL}/api/movies/by-tmdb/${id}${q}`, {
      signal,
      headers: {'user-agent': BROWSER_UA, 'accept': 'application/json'},
    }).then(r => r.ok ? r.json() : null).catch(() => null);
    if (!data) return [];
    const activeSources = (data.sources || []).filter(s => s.isActive);
    const found = [];
    for (const src of activeSources) {
      if (found.length >= limit) break;
      const info = dizisolSourceInfo(src);
      if (!info) continue;
      const subTr = dizisolSubUrl(src.subtitleTr);
      const subEn = dizisolSubUrl(src.subtitleEn);
      const subtitles = [
        ...(subTr ? [{label: 'Türkçe', lang: 'tr', url: subTr, referer: DIZISOL_REFERER}] : []),
        ...(subEn ? [{label: 'İngilizce', lang: 'en', url: subEn, referer: DIZISOL_REFERER}] : []),
      ];
      found.push({
        url: info.url,
        type: info.type,
        referer: info.referer,
        name: `DiziSol · ${src.provider || 'Kaynak'}`,
        lang: 'tr',
        dub: true,
        subtitles,
      });
    }
    return uniqueNames(found);
  });
}

/**
 * Türkçe dublaj akışları (JetFilm, SelcukFlix, DiziYou, Dizilla; filmlerde SinemaCX, HDFilm, FilmModu, HDFilmCehennemi, FullHD, CloseLoad).
 * Referer isteyen adresler imzalı geçide sarılır.
 * origin: bu sitenin adresi (ör. https://lovell.workers.dev); secret: geçit imza anahtarı.
 */
// Dizi78: /ara?q= araması → yıl + ad eşleşmesi → film ya da bölüm sayfasındaki gömme oynatıcı.
const DIZI78 = 'https://dizi83.life';
function dizi78Hits(html, type) {
  const re = new RegExp(`href="(?:https://dizi83\\.life)?/${type}/([a-z0-9-]+)"([\\s\\S]*?)</a>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(html)) && out.length < 24) {
    const year = Number(m[2].match(/<span>(\d{4})<\/span>/)?.[1]) || 0;
    out.push({slug: m[1], year});
  }
  return out;
}
const slugTokens = slug => new Set(slug.split('-').filter(w => w.length >= 4));
function pickDizi78(hits, slugs, year) {
  let best = null, score = 0;
  for (const h of hits) {
    const ht = slugTokens(h.slug);
    let s = slugs.includes(h.slug) ? 100 : 0;
    if (!s) {
      for (const slug of slugs) {
        const st = slugTokens(slug);
        let share = 0;
        for (const w of st) if (ht.has(w)) share++;
        if (share >= 2) s = Math.max(s, 40 + share * 10);
        else if (slug.length >= 8 && (h.slug.includes(slug) || slug.includes(h.slug))) s = Math.max(s, 60);
      }
    }
    if (!s) continue;
    if (year && h.year && Math.abs(h.year - Number(year)) > 1) continue;
    if (year && h.year) s += 10;
    if (s > score) { score = s; best = h; }
  }
  return best;
}
export function fetchDizi78Embed({kind, titles = [], year, season = 1, episode = 1, timeout = 8000}) {
  if (kind !== 'movie' && kind !== 'tv') return Promise.resolve([]);
  const slugs = titleSlugs(titles);
  const queries = [...new Set(titles.map(t => String(t || '').trim()).filter(t => t.length >= 3))].slice(0, 2);
  if (!slugs.length || !queries.length) return Promise.resolve([]);
  return cached(`dizi78:${kind}:${slugs.join('|')}:${year || ''}:${season}:${episode}`, async () => {
    const signal = AbortSignal.timeout(timeout);
    const type = kind === 'movie' ? 'film' : 'dizi';
    let hit = null;
    for (const q of queries) {
      hit = pickDizi78(dizi78Hits(await getText(`${DIZI78}/ara?q=${encodeURIComponent(q)}`, signal), type), slugs, year);
      if (hit) break;
    }
    if (!hit) return [];
    const page = kind === 'movie'
      ? `${DIZI78}/film/${hit.slug}`
      : `${DIZI78}/dizi/${hit.slug}/sezon/${Math.max(1, Number(season) || 1)}/bolum/${Math.max(1, Number(episode) || 1)}`;
    const html = await getText(page, signal, {referer: `${DIZI78}/`});
    const frames = [...new Set([...html.matchAll(/<iframe[^>]+src="(https:\/\/[a-z0-9.-]+\/player\/[A-Za-z0-9_-]{8,})"/gi)].map(m => m[1]))].slice(0, 2);
    return frames.map((url, i) => ({id: i ? `dizi78-${i + 1}` : 'dizi78', name: i ? `Dizi78 ${i + 1}` : 'Dizi78', url, kind: 'embed', origin: 'embed', lang: 'tr', dub: true, pin: true}));
  });
}

// HDFilmizle: arama (CSRF) → film sayfası ya da /dizi/{slug}/sezon/n/bolum/n → lang=tr (yoksa dual) iframe.
const HDFILMIZLE = 'https://www.hdfilmizle.to';
function pickHdFilmizle(items, slugs, year) {
  let best = null, score = 0;
  for (const item of items || []) {
    const slug = slugify(item.slug || '');
    const name = slugify(item.name || '');
    let s = 0;
    for (const want of slugs) {
      if (slug === want || name === want) s = Math.max(s, 100);
      else {
        const have = new Set([...slugTokens(slug), ...slugTokens(name)]);
        let share = 0;
        for (const w of slugTokens(want)) if (have.has(w)) share++;
        if (share >= 2) s = Math.max(s, 40 + share * 10);
      }
    }
    if (!s) continue;
    const y = Number(item.year) || 0;
    if (year && y && Math.abs(y - Number(year)) > 1) continue;
    if (year && y && Number(year) === y) s += 25;
    else if (year && y) s += 8;
    if (s > score) { score = s; best = item; }
  }
  return best;
}
function hdFilmizleFrames(html) {
  const raw = html.match(/let parts=(\[[\s\S]*?\]);/)?.[1];
  if (!raw) return [];
  let parts;
  try { parts = JSON.parse(raw); } catch { return []; }
  const tr = parts.filter(p => p?.lang === 'tr');
  const use = tr.length ? tr : parts.filter(p => p?.lang === 'dual');
  return [...new Set(use.map(p => String(p.data || '').match(/src="(https:\/\/[^"]+)"/)?.[1]).filter(Boolean))].slice(0, 2);
}
export function fetchHdFilmizleEmbed({kind, titles = [], year, season = 1, episode = 1, timeout = 8000}) {
  if (kind !== 'movie' && kind !== 'tv') return Promise.resolve([]);
  const slugs = titleSlugs(titles);
  const queries = [...new Set(titles.map(t => String(t || '').trim()).filter(t => t.length >= 3))].slice(0, 2);
  if (!slugs.length || !queries.length) return Promise.resolve([]);
  return cached(`hdfilmizle:${kind}:${slugs.join('|')}:${year || ''}:${season}:${episode}`, async () => {
    const signal = AbortSignal.timeout(timeout);
    const home = await fetch(`${HDFILMIZLE}/`, {signal, headers: {'user-agent': BROWSER_UA}});
    const homeHtml = home.ok ? await home.text() : '';
    const set = typeof home.headers.getSetCookie === 'function' ? home.headers.getSetCookie() : String(home.headers.get('set-cookie') || '').split(/,(?=[^;,]+=)/);
    const cookie = set.map(c => String(c).split(';')[0].trim()).filter(Boolean).join('; ');
    const token = homeHtml.match(/csrf-token"\s+content="([^"]+)"/)?.[1] || '';
    const xsrf = decodeURIComponent((cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    if (!cookie || !token) return [];
    const headers = {'user-agent': BROWSER_UA, 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest', referer: `${HDFILMIZLE}/`, cookie, 'x-csrf-token': token, 'x-xsrf-token': xsrf};
    let hit = null;
    for (const q of queries) {
      const list = await fetch(`${HDFILMIZLE}/search/`, {method: 'POST', signal, headers, body: `query=${encodeURIComponent(q)}`}).then(r => r.ok ? r.json() : []).catch(() => []);
      hit = pickHdFilmizle(list, slugs, year);
      if (hit?.slug && /^[a-z0-9-]+$/.test(hit.slug)) break;
      hit = null;
    }
    if (!hit) return [];
    const page = kind === 'movie'
      ? `${HDFILMIZLE}/${hit.slug}/`
      : `${HDFILMIZLE}/dizi/${hit.slug}/sezon/${Math.max(1, Number(season) || 1)}/bolum/${Math.max(1, Number(episode) || 1)}/`;
    const frames = hdFilmizleFrames(await getText(page, signal, {referer: `${HDFILMIZLE}/`, cookie}));
    return frames.map((url, i) => ({id: i ? `hdfilmizle-${i + 1}` : 'hdfilmizle', name: i ? `HDFilmizle ${i + 1}` : 'HDFilmizle', url, kind: 'embed', origin: 'embed', lang: 'tr', dub: true, pin: true}));
  });
}

export async function fetchDubSources({kind, id, imdb, titles, year, season, episode, origin, secret}) {
  if (!secret || !/^https?:\/\//.test(origin || '')) return [];
  const lists = await Promise.all([
    fetchJetDub({kind, imdb, season, episode}).catch(() => []),
    fetchSelcukDub({kind, imdb, titles, season, episode}).catch(() => []),
    fetchSinemaCxDub({kind, imdb, titles, year}).catch(() => []),
    fetchHdFilmDub({kind, imdb, titles, year}).catch(() => []),
    fetchFilmModuDub({kind, imdb, titles}).catch(() => []),
    fetchDiziYouDub({kind, titles, season, episode}).catch(() => []),
    fetchDizillaDub({kind, titles, season, episode}).catch(() => []),
    fetchHdFilmCehennemiDub({kind, titles, year, season, episode}).catch(() => []),
    fetchFullHdDub({kind, titles, year}).catch(() => []),
    fetchCloseLoadDub({kind, id, titles}).catch(() => []),
    fetchDizisolSources({kind, id, season, episode}).catch(() => []),
    fetchHdFilmizleyelimEmbed({kind, titles, year, season, episode}).catch(() => []),
    fetchDdiziciEmbed({kind, titles, year, season, episode}).catch(() => []),
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
