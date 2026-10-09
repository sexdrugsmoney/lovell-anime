// Tek tip anime verisi: önce TMDB, olmazsa AniList, o da olmazsa yerel seçki.
// Platformdan bağımsızdır: hem Node sunucusu (lib/catalog.js) hem Cloudflare Worker (worker/index.js) kullanır.
import {ALL_ANIME_CATALOG} from '../src/data/anime-catalog.js';

let deps = {tmdbJson: null, offlineEpisodes: {}, region: 'TR', localPosters: true};
export function configure(next) { deps = {...deps, ...next}; LOCAL = ALL_ANIME_CATALOG.map(fromLocal); }
const tmdbJson = (...a) => { if (!deps.tmdbJson) throw Error('TMDB yapılandırılmadı'); return deps.tmdbJson(...a); };
const plainFetch = (url, init = {}, timeout = 8000) => fetch(url, {...init, signal: AbortSignal.timeout(timeout)});
const REGION = () => String(deps.region || 'TR').toUpperCase();
const LANG = 'tr-TR';
const ANIME_KEYWORD = 210024;
const slugOf = a => (a.poster_path || '').split('/').pop().replace(/\.jpg$/, '');

// ---------- Türler ----------
export const GENRES = [
  {slug: 'aksiyon', name: 'Aksiyon', tv: 10759, movie: 28, al: 'Action'},
  {slug: 'macera', name: 'Macera', tv: 10759, movie: 12, al: 'Adventure'},
  {slug: 'komedi', name: 'Komedi', tv: 35, movie: 35, al: 'Comedy'},
  {slug: 'dram', name: 'Dram', tv: 18, movie: 18, al: 'Drama'},
  {slug: 'fantastik', name: 'Fantastik', tv: 10765, movie: 14, al: 'Fantasy'},
  {slug: 'bilim-kurgu', name: 'Bilim kurgu', tv: 10765, movie: 878, al: 'Sci-Fi'},
  {slug: 'gizem', name: 'Gizem', tv: 9648, movie: 9648, al: 'Mystery'},
  {slug: 'romantik', name: 'Romantik', tv: null, movie: 10749, al: 'Romance'},
  {slug: 'korku', name: 'Korku', tv: null, movie: 27, al: 'Horror'},
  {slug: 'spor', name: 'Spor', tv: null, movie: null, al: 'Sports'},
  {slug: 'gunluk-yasam', name: 'Günlük yaşam', tv: null, movie: null, al: 'Slice of Life'},
  {slug: 'dogaustu', name: 'Doğaüstü', tv: null, movie: null, al: 'Supernatural'},
];
// Film & Dizi bölümü için TMDB türleri (anime dışı içerik).
export const MEDIA_GENRES = [
  {slug: 'aksiyon', name: 'Aksiyon', tv: 10759, movie: 28},
  {slug: 'macera', name: 'Macera', tv: 10759, movie: 12},
  {slug: 'komedi', name: 'Komedi', tv: 35, movie: 35},
  {slug: 'dram', name: 'Dram', tv: 18, movie: 18},
  {slug: 'suc', name: 'Suç', tv: 80, movie: 80},
  {slug: 'gerilim', name: 'Gerilim', tv: null, movie: 53},
  {slug: 'gizem', name: 'Gizem', tv: 9648, movie: 9648},
  {slug: 'bilim-kurgu', name: 'Bilim kurgu', tv: 10765, movie: 878},
  {slug: 'fantastik', name: 'Fantastik', tv: 10765, movie: 14},
  {slug: 'korku', name: 'Korku', tv: null, movie: 27},
  {slug: 'romantik', name: 'Romantik', tv: null, movie: 10749},
  {slug: 'animasyon', name: 'Animasyon', tv: 16, movie: 16},
  {slug: 'belgesel', name: 'Belgesel', tv: 99, movie: 99},
  {slug: 'aile', name: 'Aile', tv: 10751, movie: 10751},
  {slug: 'savas', name: 'Savaş', tv: 10768, movie: 10752},
  {slug: 'tarih', name: 'Tarih', tv: null, movie: 36},
  {slug: 'western', name: 'Western', tv: 37, movie: 37},
];
export const sectionOf = s => s === 'media' ? 'media' : 'anime';
// /api/genres yanıtı: hangi türün dizi / film tarafında karşılığı olduğunu da söyler.
export function genresFor(section) {
  if (sectionOf(section) === 'media') return MEDIA_GENRES.map(({slug, name, tv, movie}) => ({slug, name, tv: !!tv, movie: !!movie}));
  return GENRES.map(({slug, name}) => ({slug, name, tv: true, movie: true}));
}
const TMDB_GENRE_TR = {10759: 'Aksiyon & macera', 28: 'Aksiyon', 12: 'Macera', 35: 'Komedi', 18: 'Dram', 10765: 'Bilim kurgu & fantastik', 14: 'Fantastik', 878: 'Bilim kurgu', 9648: 'Gizem', 10749: 'Romantik', 27: 'Korku', 80: 'Suç', 10751: 'Aile', 10402: 'Müzik', 36: 'Tarih', 53: 'Gerilim', 10752: 'Savaş', 16: 'Animasyon', 99: 'Belgesel', 37: 'Western', 10768: 'Savaş & politik', 10762: 'Çocuk', 10764: 'Reality', 10770: 'TV filmi'};
const AL_GENRE_TR = Object.fromEntries([...GENRES.map(g => [g.al, g.name]), ['Psychological', 'Psikolojik'], ['Thriller', 'Gerilim'], ['Music', 'Müzik'], ['Mecha', 'Mecha'], ['Mahou Shoujo', 'Büyülü kız'], ['Ecchi', 'Ecchi']]);

// ---------- Küçük önbellek ----------
const cache = new Map();
const inflight = new Map();
async function memo(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().then(value => {
    if (cache.size > 400) cache.delete(cache.keys().next().value);
    // Yedek kaynaktan gelen sonuçları kısa tut ki TMDB düzelince hemen geçilsin.
    const fallback = value && value.source && value.source !== 'TMDB' && !key.startsWith('al');
    cache.set(key, {value, until: Date.now() + (fallback ? 60_000 : ttl)});
    return value;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
const MIN = 60_000;

// ---------- Görsel adresleri ----------
const tmdbImg = (p, size) => p ? `/api/img?p=${encodeURIComponent(`/t/p/${size}${p}`)}` : null;
const remoteImg = u => u ? `/api/img?u=${encodeURIComponent(u)}` : null;

// ---------- TMDB ----------
const GENERIC_EP = /^\s*(\d+\.?\s*)?(Bölüm|Episode|Épisode|Folge|第)\s*\d*\s*(話)?\s*$/i;
const today = () => new Date().toISOString().slice(0, 10);
function fromTmdb(r, kind) {
  kind = r.media_type === 'movie' || r.media_type === 'tv' ? r.media_type : kind;
  const date = r.first_air_date || r.release_date || '';
  return {
    kind, id: r.id, source: 'TMDB',
    title: r.name || r.title || r.original_name || r.original_title,
    original: r.original_name || r.original_title || '',
    overview: r.overview || '',
    poster: tmdbImg(r.poster_path, 'w342'),
    posterLarge: tmdbImg(r.poster_path, 'w780'),
    backdrop: tmdbImg(r.backdrop_path, 'w1280'),
    year: date.slice(0, 4),
    score: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
    genres: (r.genres?.map(g => g.id) || r.genre_ids || []).filter(id => id !== 16 || !isAnime(r)).map(id => TMDB_GENRE_TR[id]).filter(Boolean),
    section: isAnime(r) ? 'anime' : 'media',
  };
}
function isAnime(r) { return (r.genre_ids || r.genres?.map(g => g.id) || []).includes(16) && (r.original_language === 'ja' || (r.origin_country || []).includes('JP') || (r.production_countries || []).some(c => c.iso_3166_1 === 'JP')); }

function tmdbDiscoverParams(kind, {genre, sort, page}) {
  const g = GENRES.find(x => x.slug === genre);
  const genreId = g ? g[kind] : null;
  if (genre && !genreId) return null; // TMDB'de karşılığı yok, AniList'e bırak
  const dateField = kind === 'tv' ? 'first_air_date' : 'primary_release_date';
  const p = {language: LANG, include_adult: 'false', with_genres: ['16', genreId].filter(Boolean).join(','), with_original_language: 'ja', page: page || 1};
  // TMDB'nin "anime" anahtar kelimesi: Japon yapımı ama anime olmayan animasyonları ayıklar.
  if (!genre) p.with_keywords = ANIME_KEYWORD;
  if (sort === 'rating') Object.assign(p, {sort_by: 'vote_average.desc', 'vote_count.gte': kind === 'tv' ? 300 : 500});
  else if (sort === 'new') Object.assign(p, {sort_by: `${dateField}.desc`, [`${dateField}.lte`]: today(), 'vote_count.gte': 10});
  else if (sort === 'season') {
    // Son 15 ayda başlayan yapımlar: Doraemon gibi yıllardır süren seriler "yeni" listesine girmesin.
    const from = new Date(Date.now() - 456 * 86400000).toISOString().slice(0, 10);
    Object.assign(p, {sort_by: 'popularity.desc', [`${dateField}.gte`]: from, [`${dateField}.lte`]: today(), 'vote_count.gte': 5});
  } else p.sort_by = 'popularity.desc';
  return p;
}

// Film & Dizi: anime anahtar kelimesini dışarıda bırak, TV'de talk/reality/haber gibi türleri ele.
function tmdbMediaParams(kind, {genre, sort, page}) {
  const g = MEDIA_GENRES.find(x => x.slug === genre);
  const genreId = g ? g[kind] : null;
  if (genre && !genreId) return null;
  const dateField = kind === 'tv' ? 'first_air_date' : 'primary_release_date';
  const p = {language: LANG, include_adult: 'false', page: page || 1, without_keywords: ANIME_KEYWORD};
  if (genreId) p.with_genres = String(genreId);
  if (kind === 'tv') p.without_genres = '10763,10764,10766,10767';
  if (sort === 'rating') Object.assign(p, {sort_by: 'vote_average.desc', 'vote_count.gte': kind === 'tv' ? 500 : 1500});
  else if (sort === 'new') Object.assign(p, {sort_by: `${dateField}.desc`, [`${dateField}.lte`]: today(), 'vote_count.gte': 40});
  else if (sort === 'season') {
    const from = new Date(Date.now() - (kind === 'tv' ? 365 : 150) * 86400000).toISOString().slice(0, 10);
    Object.assign(p, {sort_by: 'popularity.desc', [`${dateField}.gte`]: from, [`${dateField}.lte`]: today(), 'vote_count.gte': 15});
  } else Object.assign(p, {sort_by: 'popularity.desc', 'vote_count.gte': 60});
  return p;
}

// Türkçe çevirisi olmayan başlıklarda TMDB Japonca adı döndürüyor; o zaman İngilizce adı kullan.
const latin = t => /[a-zçğıöşü]/i.test(t || '');
async function withLatinTitles(items, fetchEn) {
  if (items.every(i => latin(i.title) && i.overview)) return items;
  let en = [];
  try { en = await fetchEn(); } catch { return items; }
  const byId = new Map(en.map(r => [r.id, r]));
  return items.map(i => {
    const e = byId.get(i.id);
    if (!e) return i;
    const out = {...i};
    if (!latin(i.title)) out.title = e.name || e.title || i.title;
    if (!i.overview && e.overview) { out.overview = e.overview; out.overviewLang = 'en'; }
    return out;
  });
}

async function tmdbList(kind, opts, section = 'anime') {
  const media = sectionOf(section) === 'media';
  const params = media ? tmdbMediaParams(kind, opts) : tmdbDiscoverParams(kind, opts);
  if (!params) throw Error('TMDB bu tür filtresini desteklemiyor');
  const d = await tmdbJson(`discover/${kind}`, params);
  const rows = media ? d.results.filter(r => !isAnime(r)) : d.results;
  return {page: d.page, pages: Math.min(d.total_pages || 1, 500), total: d.total_results, items: await withLatinTitles(rows.map(r => fromTmdb(r, kind)), () => tmdbJson(`discover/${kind}`, {...params, language: 'en-US'}).then(x => x.results)), source: 'TMDB'};
}

// Haftanın gündemi (yalnızca Film & Dizi bölümü).
async function tmdbTrending() {
  const d = await tmdbJson('trending/all/week', {language: LANG});
  const rows = d.results.filter(r => ['tv', 'movie'].includes(r.media_type) && !isAnime(r));
  return {items: await withLatinTitles(rows.map(r => fromTmdb(r)), () => tmdbJson('trending/all/week', {language: 'en-US'}).then(x => x.results)), source: 'TMDB'};
}

async function tmdbSearch(q, page = 1, section = 'anime') {
  const media = sectionOf(section) === 'media';
  const d = await tmdbJson('search/multi', {query: q, language: LANG, include_adult: 'false', page});
  const items = await withLatinTitles(d.results.filter(r => ['tv', 'movie'].includes(r.media_type) && (media ? !isAnime(r) : isAnime(r))).map(r => fromTmdb(r)), () => tmdbJson('search/multi', {query: q, language: 'en-US', include_adult: 'false', page}).then(x => x.results));
  return {page: d.page, pages: Math.min(d.total_pages || 1, 500), total: items.length, items, source: 'TMDB'};
}

function pickTrailer(videos = []) {
  const yt = videos.filter(v => v.site === 'YouTube' && ['Trailer', 'Teaser', 'Opening Credits'].includes(v.type));
  const rank = v => (v.type === 'Trailer' ? 0 : 1) + (v.iso_639_1 === 'tr' ? 0 : v.iso_639_1 === 'ja' ? 0.2 : 0.4) + (v.official ? 0 : 0.5);
  const best = yt.sort((a, b) => rank(a) - rank(b))[0];
  return best ? {site: 'youtube', key: best.key, name: best.name} : null;
}

function providerBlock(wp) {
  const results = wp?.results || {};
  const region = results[REGION()] ? REGION() : null;
  const r = region ? results[region] : null;
  if (!r) return null;
  const map = list => (list || []).map(p => ({name: p.provider_name, logo: tmdbImg(p.logo_path, 'w92')}));
  return {region, link: r.link, stream: map(r.flatrate), free: map([...(r.free || []), ...(r.ads || [])]), rent: map(r.rent), buy: map(r.buy)};
}

async function tmdbDetail(kind, id) {
  const d = await tmdbJson(`${kind}/${id}`, {language: LANG, append_to_response: 'videos,watch/providers,external_ids,recommendations', include_video_language: 'tr,ja,en,null'});
  let watchProviders = d['watch/providers'];
  // TMDB'nin nested append yanıtı bazı Worker/proxy kombinasyonlarında atlanıyor;
  // resmî sağlayıcı listesini kendi endpoint'inden bir kez daha al.
  if (!watchProviders?.results) {
    try { watchProviders = await tmdbJson(`${kind}/${id}/watch/providers`, {}); } catch {}
  }
  const item = fromTmdb(d, kind);
  if (!item.overview || !latin(item.title)) {
    try {
      const en = await tmdbJson(`${kind}/${id}`, {language: 'en-US'});
      if (!item.overview && en.overview) { item.overview = en.overview; item.overviewLang = 'en'; }
      if (!latin(item.title)) item.title = en.name || en.title || item.title;
    } catch {}
  }
  let trailer = pickTrailer(d.videos?.results);
  if (!trailer) { try { trailer = pickTrailer((await tmdbJson(`${kind}/${id}/videos`, {})).results); } catch {} }
  return {
    ...item,
    tagline: d.tagline || '',
    status: d.status,
    runtime: d.episode_run_time?.[0] || d.runtime || null,
    seasons: kind === 'tv' ? (d.seasons || []).filter(s => s.season_number > 0 && s.episode_count > 0).map(s => ({n: s.season_number, name: s.name, count: s.episode_count, year: (s.air_date || '').slice(0, 4)})) : [],
    episodeCount: d.number_of_episodes || null,
    studios: (d.production_companies || []).slice(0, 2).map(c => c.name),
    trailer,
    providers: providerBlock(watchProviders),
    imdb: d.external_ids?.imdb_id || d.imdb_id || null,
    section: isAnime(d) ? 'anime' : 'media',
    recommendations: (d.recommendations?.results || []).filter(r => isAnime(r) === isAnime(d)).slice(0, 12).map(r => fromTmdb(r, kind)).filter(r => latin(r.title)),
  };
}

async function tmdbSeason(id, season) {
  const d = await tmdbJson(`tv/${id}/season/${season}`, {language: LANG});
  let en = null;
  if (d.episodes?.some(e => !e.name || GENERIC_EP.test(e.name))) { try { en = await tmdbJson(`tv/${id}/season/${season}`, {language: 'en-US'}); } catch {} }
  return (d.episodes || []).filter(e => !e.air_date || e.air_date <= today()).map((e, i) => {
    const alt = en?.episodes?.[i];
    const generic = !e.name || GENERIC_EP.test(e.name);
    const altOk = alt?.name && !GENERIC_EP.test(alt.name);
    return {n: e.episode_number, title: generic ? (altOk ? alt.name : `Bölüm ${e.episode_number}`) : e.name || `Bölüm ${e.episode_number}`, overview: e.overview || alt?.overview || '', still: tmdbImg(e.still_path, 'w300'), runtime: e.runtime || null, date: e.air_date || null};
  });
}

// ---------- AniList ----------
const AL_FIELDS = 'id idMal title{english romaji native} description(asHtml:false) coverImage{large extraLarge} bannerImage averageScore startDate{year} genres format status episodes duration nextAiringEpisode{episode}';
async function anilist(query, variables) {
  const key = JSON.stringify([query, variables]);
  return memo('al:' + key, 15 * MIN, async () => {
    const res = await plainFetch('https://graphql.anilist.co', {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json'}, body: JSON.stringify({query, variables})});
    if (!res.ok) throw Error(`AniList HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw Error(json.errors[0].message);
    return json.data;
  });
}
const cleanText = s => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\(Source:[^)]*\)/gi, '').replace(/\n{3,}/g, '\n\n').trim();
function fromAniList(m) {
  return {
    kind: 'al', id: m.id, source: 'AniList', format: m.format,
    isMovie: m.format === 'MOVIE',
    title: m.title.english || m.title.romaji,
    original: m.title.native || m.title.romaji || '',
    overview: cleanText(m.description),
    overviewLang: 'en',
    poster: remoteImg(m.coverImage?.large),
    posterLarge: remoteImg(m.coverImage?.extraLarge || m.coverImage?.large),
    backdrop: remoteImg(m.bannerImage),
    year: m.startDate?.year ? String(m.startDate.year) : '',
    score: m.averageScore ? m.averageScore / 10 : null,
    genres: (m.genres || []).map(g => AL_GENRE_TR[g] || g).slice(0, 4),
    section: 'anime',
  };
}
const AL_SORT = {popular: 'POPULARITY_DESC', rating: 'SCORE_DESC', new: 'START_DATE_DESC', season: 'TRENDING_DESC', trending: 'TRENDING_DESC'};
async function alList(kind, {genre, sort, page, q, status}) {
  const g = GENRES.find(x => x.slug === genre);
  // AniList boş (null) filtreleri bazen "eşleşme yok" diye yorumluyor; yalnızca dolu olanları gönder.
  const vars = {page: Math.max(1, Math.min(500, Number(page) || 1)), sort: q ? ['SEARCH_MATCH', 'POPULARITY_DESC'] : [AL_SORT[sort] || 'POPULARITY_DESC']};
  const decl = ['$page:Int', '$sort:[MediaSort]'], args = ['type:ANIME', 'isAdult:false', 'countryOfOrigin:"JP"', 'sort:$sort'];
  const add = (name, type, value) => { if (value === null || value === undefined || value === '') return; vars[name] = value; decl.push(`$${name}:${type}`); args.push(`${name === 'formatIn' ? 'format_in' : name}:$${name}`); };
  add('search', 'String', q || null);
  add('genre', 'String', g?.al || null);
  if (kind === 'movie') add('format', 'MediaFormat', 'MOVIE'); else add('formatIn', '[MediaFormat]', ['TV', 'TV_SHORT', 'ONA']);
  add('status', 'MediaStatus', status || null);
  const data = await anilist(`query(${decl.join(',')}){Page(page:$page,perPage:24){pageInfo{currentPage lastPage total hasNextPage} media(${args.join(',')}){${AL_FIELDS}}}}`, vars);
  const p = data.Page;
  return {page: p.pageInfo.currentPage, pages: Math.min(p.pageInfo.lastPage || 1, 500), total: p.pageInfo.total, items: p.media.map(fromAniList), source: 'AniList'};
}

async function alDetail(id) {
  const data = await anilist(`query($id:Int){Media(id:$id,type:ANIME){${AL_FIELDS} studios(isMain:true){nodes{name}} trailer{id site} externalLinks{site url type language} streamingEpisodes{title thumbnail} recommendations(perPage:12,sort:RATING_DESC){nodes{mediaRecommendation{${AL_FIELDS} isAdult}}}}}`, {id: Number(id)});
  const m = data.Media;
  if (!m) throw Error('Anime bulunamadı');
  const total = m.episodes || (m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : null);
  return {
    ...fromAniList(m),
    status: m.status,
    runtime: m.duration,
    seasons: m.format === 'MOVIE' ? [] : [{n: 1, name: 'Bölümler', count: total || 0}],
    episodeCount: total,
    studios: m.studios?.nodes?.map(s => s.name) || [],
    trailer: m.trailer?.site === 'youtube' ? {site: 'youtube', key: m.trailer.id} : null,
    links: streamingLinks(m.externalLinks),
    streamingEpisodes: m.streamingEpisodes || [],
    recommendations: (m.recommendations?.nodes || []).map(n => n.mediaRecommendation).filter(r => r && !r.isAdult).map(fromAniList),
  };
}
function streamingLinks(list = []) {
  const seen = new Set();
  return list.filter(l => l.type === 'STREAMING' && /^https:\/\//.test(l.url)).filter(l => !seen.has(l.site) && seen.add(l.site)).map(l => ({name: l.site, url: l.url, language: l.language || null}));
}
async function alEpisodes(id) {
  const det = await alDetail(id);
  const offline = Object.values(deps.offlineEpisodes).find(r => r.anilistId === Number(id));
  const titles = new Map();
  for (const se of det.streamingEpisodes) {
    const m = se.title?.match(/^Episode\s+(\d+)\s*[-–:]\s*(.+)$/i);
    if (m) titles.set(Number(m[1]), {title: m[2], still: remoteImg(se.thumbnail)});
  }
  const count = det.episodeCount || offline?.episodes.length || titles.size;
  return Array.from({length: count}, (_, i) => {
    const n = i + 1;
    const off = offline?.episodes.find(e => e.n === n);
    return {n, title: titles.get(n)?.title || off?.t || `Bölüm ${n}`, overview: '', still: titles.get(n)?.still || null, runtime: det.runtime || (off?.r ? Math.round(off.r / 60) : null), date: off?.d || null};
  });
}
// TMDB başlığı için AniList'ten yasal yayın bağlantıları (en iyi çaba).
async function alLinksByTitle(title, isMovie) {
  try {
    const data = await anilist(`query($s:String,$f:[MediaFormat]){Media(search:$s,type:ANIME,format_in:$f){id externalLinks{site url type language}}}`, {s: title, f: isMovie ? ['MOVIE'] : ['TV', 'TV_SHORT', 'ONA']});
    return {anilistId: data.Media?.id, links: streamingLinks(data.Media?.externalLinks)};
  } catch { return {anilistId: null, links: []}; }
}

// ---------- Yerel seçki ----------
function fromLocal(a) {
  return {
    kind: a.media_type, id: a.id, source: 'Yerel seçki',
    title: a.title.replace(/ \((?!20)[^)]*\)$/, ''), original: a.original_title || '', overview: a.overview || '',
    poster: deps.localPosters ? a.poster_path : null, posterLarge: deps.localPosters ? a.poster_path : null, backdrop: deps.localPosters ? (a.backdrop_path || a.poster_path) : null,
    year: (a.first_air_date || a.release_date || '').slice(0, 4), score: a.vote_average || null,
    genres: (a.genres || []).slice(0, 3), trailerKey: a.trailer_id || null, section: 'anime',
  };
}
let LOCAL = ALL_ANIME_CATALOG.map(fromLocal);
function localList(kind, {genre, sort, q, page}) {
  const g = GENRES.find(x => x.slug === genre);
  let items = LOCAL.filter(a => (kind === 'all' || a.kind === kind) && (!g || a.genres.some(x => x.toLocaleLowerCase('tr').startsWith(g.name.toLocaleLowerCase('tr').slice(0, 5)))) && (!q || `${a.title} ${a.original}`.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'))));
  if (sort === 'rating') items.sort((a, b) => b.score - a.score);
  if (sort === 'new') items.sort((a, b) => b.year.localeCompare(a.year));
  const per = 24, pages = Math.max(1, Math.ceil(items.length / per)), cur = Math.min(Math.max(1, Number(page) || 1), pages);
  return {page: cur, pages, total: items.length, items: items.slice((cur - 1) * per, cur * per), source: 'Yerel seçki'};
}

// ---------- Dışa açık işlevler ----------
export const dataErrors = [];
async function withFallback(steps) {
  const errors = [];
  for (const [name, fn] of steps) {
    try { return await fn(); } catch (e) {
      errors.push(`${name}: ${e.message}`);
      dataErrors.unshift({at: new Date().toISOString(), source: name, error: e.message});
      dataErrors.length = Math.min(dataErrors.length, 15);
    }
  }
  throw Object.assign(Error('Hiçbir veri kaynağına ulaşılamadı'), {details: errors});
}

export function browse({kind = 'tv', genre = '', sort = 'popular', page = 1, q = '', section = 'anime'} = {}) {
  kind = kind === 'movie' ? 'movie' : 'tv';
  section = sectionOf(section);
  q = String(q || '').trim().slice(0, 80);
  if (section === 'media') {
    return memo(`browse:media:${kind}:${genre}:${sort}:${page}:${q}`, 10 * MIN, () => withFallback([
      ['TMDB', () => q ? tmdbSearch(q, page, 'media').then(r => ({...r, items: r.items.filter(i => i.kind === kind)})) : tmdbList(kind, {genre, sort, page}, 'media')],
    ]));
  }
  const key = `browse:${kind}:${genre}:${sort}:${page}:${q}`;
  return memo(key, 10 * MIN, () => withFallback([
    ['TMDB', () => q ? tmdbSearch(q, page).then(r => ({...r, items: r.items.filter(i => i.kind === kind)})) : tmdbList(kind, {genre, sort, page})],
    ['AniList', () => alList(kind, {genre, sort, page, q})],
    ['Yerel', async () => localList(kind, {genre, sort, page, q})],
  ]));
}

export function search(q, section = 'anime') {
  q = String(q || '').trim().slice(0, 80);
  if (q.length < 2) return Promise.resolve({items: [], source: null});
  if (sectionOf(section) === 'media') return memo(`search:media:${q.toLocaleLowerCase('tr')}`, 10 * MIN, () => withFallback([
    ['TMDB', () => tmdbSearch(q, 1, 'media')],
  ]));
  return memo(`search:${q.toLocaleLowerCase('tr')}`, 10 * MIN, () => withFallback([
    ['TMDB', async () => { const r = await tmdbSearch(q); if (!r.items.length) throw Error('Sonuç yok'); return r; }],
    ['AniList', () => alList('tv', {q}).then(async r => { const m = await alList('movie', {q}).catch(() => ({items: []})); return {...r, items: [...r.items, ...m.items].slice(0, 20)}; })],
    ['Yerel', async () => localList('all', {q})],
  ]));
}

// Raflar: layout = 'poster' | 'land' (yatay 16:9) | 'rank' (ilk 10, büyük numaralı)
const settle = async list => (await Promise.allSettled(list)).map(r => r.status === 'fulfilled' ? r.value : {items: []});
const genreShelves = (defs, results) => defs.map(([id, title, more, layout], i) => ({id, title, more, layout, items: results[i].items})).filter(s => s.items.length);

function mediaHome() {
  return memo('home:media', 15 * MIN, () => withFallback([
    ['TMDB', async () => {
      const [trending, tvPop, moviePop, tvNew, movieNew, tvTop, movieTop, ...g] = await settle([
        tmdbTrending(), tmdbList('tv', {sort: 'popular'}, 'media'), tmdbList('movie', {sort: 'popular'}, 'media'),
        tmdbList('tv', {sort: 'season'}, 'media'), tmdbList('movie', {sort: 'season'}, 'media'),
        tmdbList('tv', {sort: 'rating'}, 'media'), tmdbList('movie', {sort: 'rating'}, 'media'),
        tmdbList('movie', {genre: 'aksiyon'}, 'media'), tmdbList('tv', {genre: 'suc'}, 'media'), tmdbList('movie', {genre: 'komedi'}, 'media'),
        tmdbList('tv', {genre: 'bilim-kurgu'}, 'media'), tmdbList('movie', {genre: 'korku'}, 'media'), tmdbList('tv', {genre: 'dram'}, 'media'),
        tmdbList('movie', {genre: 'animasyon'}, 'media'), tmdbList('tv', {genre: 'belgesel'}, 'media'),
      ]);
      if (![trending, tvPop, moviePop].some(x => x.items.length)) throw Error('TMDB film/dizi listesi boş döndü');
      const seen = new Set();
      const heroPool = [...trending.items, ...tvPop.items, ...moviePop.items].filter(i => i.backdrop && i.overview && !seen.has(`${i.kind}:${i.id}`) && seen.add(`${i.kind}:${i.id}`));
      return {source: 'TMDB', section: 'media', hero: heroPool.slice(0, 6), shelves: [
        {id: 'top10', title: 'Bu hafta ilk 10', items: trending.items.slice(0, 10), layout: 'rank'},
        {id: 'tv-new', title: 'Yeni diziler', items: tvNew.items, more: '#/kesfet?sirala=season', layout: 'land'},
        {id: 'movie-pop', title: 'Popüler filmler', items: moviePop.items, more: '#/filmler', layout: 'land'},
        {id: 'tv-pop', title: 'Popüler diziler', items: tvPop.items, more: '#/kesfet', layout: 'land'},
        {id: 'movie-new', title: 'Vizyondan yeni çıkanlar', items: movieNew.items, more: '#/filmler?sirala=season', layout: 'poster'},
        ...genreShelves([
          ['g-aksiyon', 'Aksiyon & macera filmleri', '#/filmler?tur=aksiyon', 'land'],
          ['g-suc', 'Suç dizileri', '#/kesfet?tur=suc', 'land'],
          ['g-komedi', 'Komedi filmleri', '#/filmler?tur=komedi', 'land'],
          ['g-bk', 'Bilim kurgu & fantastik diziler', '#/kesfet?tur=bilim-kurgu', 'land'],
          ['g-korku', 'Korku filmleri', '#/filmler?tur=korku', 'poster'],
          ['g-dram', 'Sürükleyici dramlar', '#/kesfet?tur=dram', 'land'],
          ['g-anim', 'Animasyon filmleri', '#/filmler?tur=animasyon', 'poster'],
          ['g-belgesel', 'Belgeseller', '#/kesfet?tur=belgesel', 'land'],
        ], g),
        {id: 'movie-top', title: 'Tüm zamanların en iyi filmleri', items: movieTop.items, more: '#/filmler?sirala=rating', layout: 'poster'},
        {id: 'tv-top', title: 'En yüksek puanlı diziler', items: tvTop.items, more: '#/kesfet?sirala=rating', layout: 'land'},
      ].filter(s => s.items.length)};
    }],
  ]));
}

export function home(section = 'anime') {
  if (sectionOf(section) === 'media') return mediaHome();
  return memo('home', 15 * MIN, () => withFallback([
    ['TMDB', async () => {
      const [season, popular, top, movies, ...g] = await settle([
        tmdbList('tv', {sort: 'season'}), tmdbList('tv', {sort: 'popular'}), tmdbList('tv', {sort: 'rating'}), tmdbList('movie', {sort: 'popular'}),
        tmdbList('tv', {genre: 'aksiyon'}), tmdbList('tv', {genre: 'fantastik'}), tmdbList('tv', {genre: 'komedi'}), tmdbList('tv', {genre: 'gizem'}), tmdbList('tv', {genre: 'dram'}),
      ]);
      if (![season, popular].some(x => x.items.length)) throw Error('TMDB anime listesi boş döndü');
      return {source: 'TMDB', section: 'anime', hero: season.items.filter(i => i.backdrop && i.overview).slice(0, 6), shelves: [
        {id: 'season', title: 'Bu sezon yayında', items: season.items, more: '#/kesfet?sirala=season', layout: 'poster'},
        {id: 'top10', title: 'Şu an en popüler 10 anime', items: popular.items.slice(0, 10), layout: 'rank'},
        {id: 'movies', title: 'Anime filmleri', items: movies.items, more: '#/filmler', layout: 'land'},
        ...genreShelves([
          ['g-aksiyon', 'Shōnen aksiyon', '#/kesfet?tur=aksiyon', 'poster'],
          ['g-fantastik', 'Fantastik & isekai dünyaları', '#/kesfet?tur=fantastik', 'poster'],
          ['g-komedi', 'Kafa dağıtmalık komediler', '#/kesfet?tur=komedi', 'poster'],
          ['g-gizem', 'Gizem & psikolojik', '#/kesfet?tur=gizem', 'poster'],
          ['g-dram', 'Duygusal dramlar', '#/kesfet?tur=dram', 'poster'],
        ], g),
        {id: 'popular', title: 'Herkesin bildiği seriler', items: popular.items.length > 10 ? popular.items.slice(10) : popular.items, more: '#/kesfet', layout: 'poster'},
        {id: 'top', title: 'Puanı en yüksekler', items: top.items, more: '#/kesfet?sirala=rating', layout: 'poster'},
      ]};
    }],
    ['AniList', async () => {
      const [season, popular, top, movies] = await Promise.all([
        alList('tv', {sort: 'trending', status: 'RELEASING'}), alList('tv', {sort: 'popular'}), alList('tv', {sort: 'rating'}), alList('movie', {sort: 'popular'}),
      ]);
      return {source: 'AniList', hero: season.items.filter(i => i.backdrop).slice(0, 6), shelves: [
        {id: 'season', title: 'Bu sezon yayında', items: season.items, more: '#/kesfet?sirala=season', layout: 'poster'},
        {id: 'top10', title: 'Şu an en popüler 10 anime', items: popular.items.slice(0, 10), layout: 'rank'},
        {id: 'popular', title: 'Herkesin bildiği seriler', items: popular.items.slice(10), more: '#/kesfet'},
        {id: 'top', title: 'En yüksek puanlılar', items: top.items, more: '#/kesfet?sirala=rating'},
        {id: 'movies', title: 'Anime filmleri', items: movies.items, more: '#/filmler'},
      ]};
    }],
    ['Yerel', async () => ({source: 'Yerel seçki', hero: LOCAL.slice(0, 6), shelves: [
      {id: 'popular', title: 'Seçki', items: LOCAL.filter(a => a.kind === 'tv'), more: '#/kesfet'},
      {id: 'top', title: 'En yüksek puanlılar', items: [...LOCAL].sort((a, b) => b.score - a.score).slice(0, 12), more: '#/kesfet?sirala=rating'},
      {id: 'movies', title: 'Anime filmleri', items: LOCAL.filter(a => a.kind === 'movie'), more: '#/filmler'},
    ]})],
  ]));
}

function localDetail(kind, id) {
  const raw = ALL_ANIME_CATALOG.find(a => a.media_type === kind && a.id === Number(id));
  if (!raw) return null;
  const item = fromLocal(raw);
  const off = deps.offlineEpisodes[slugOf(raw)];
  return {...item, status: raw.status, seasons: kind === 'tv' ? [{n: 1, name: '1. sezon', count: off?.episodes.length || raw.episodes_count || 0}] : [], trailer: raw.trailer_id ? {site: 'youtube', key: raw.trailer_id} : null, providers: null, links: [], recommendations: [], anilistId: off?.anilistId || null};
}

export function detail(kind, id) {
  if (!['tv', 'movie', 'al'].includes(kind) || !/^\d{1,9}$/.test(String(id))) return Promise.reject(Object.assign(Error('Geçersiz adres'), {status: 400}));
  return memo(`detail:${kind}:${id}`, 30 * MIN, async () => {
    if (kind === 'al') return alDetail(id);
    return withFallback([
      ['TMDB', async () => {
        const d = await tmdbDetail(kind, id);
        // Anime olmayan yapımlarda AniList eşleşmesi aranmaz (yanlış eşleşmeyi önler).
        if (d.section === 'media') return {...d, anilistId: null, links: []};
        const {anilistId, links} = await alLinksByTitle(d.original && /[a-z]/i.test(d.original) ? d.original : d.title, kind === 'movie');
        return {...d, anilistId, links};
      }],
      ['AniList', async () => {
        const local = localDetail(kind, id);
        if (!local?.anilistId) throw Error('Bu başlık için AniList eşleşmesi yok');
        const al = await alDetail(local.anilistId);
        return {...al, kind, id: Number(id), source: 'AniList', anilistId: local.anilistId, seasons: kind === 'tv' ? al.seasons : [], trailer: al.trailer || local.trailer, poster: local.poster, posterLarge: local.posterLarge, backdrop: al.backdrop || local.backdrop};
      }],
      ['Yerel', async () => { const l = localDetail(kind, id); if (!l) throw Error('Yerel seçkide yok'); return l; }],
    ]);
  });
}

export function episodes(kind, id, season = 1) {
  season = Math.max(1, Number(season) || 1);
  return memo(`eps:${kind}:${id}:${season}`, 30 * MIN, async () => {
    if (kind === 'al') return {source: 'AniList', episodes: await alEpisodes(id)};
    if (kind !== 'tv') return {episodes: []};
    return withFallback([
      ['TMDB', async () => ({source: 'TMDB', episodes: await tmdbSeason(id, season)})],
      ['Yerel', async () => {
        const raw = ALL_ANIME_CATALOG.find(a => a.media_type === 'tv' && a.id === Number(id));
        // One Piece ve Hunter x Hunter'da TMDB sezonları ile mutlak bölüm sırası örtüşmüyor.
        if (!raw || season !== 1 || [37854, 46298].includes(raw.id)) return {source: 'Yerel', episodes: []};
        const off = deps.offlineEpisodes[slugOf(raw)];
        return {source: 'Yerel', episodes: (off?.episodes || []).map(e => ({n: e.n, title: e.t || `Bölüm ${e.n}`, overview: '', still: null, runtime: e.r ? Math.round(e.r / 60) : null, date: e.d}))};
      }],
    ]);
  });
}

export {anilist as _anilist};
