// MangaDex açık API üzerinden manga arama ve bölüm sayfaları.
const MD = 'https://api.mangadex.org';
const UA = 'LOVELL/1.0 (https://lovell.love)';

function mdGet(path, timeout = 10000) {
  return fetch(`${MD}${path}`, {
    signal: AbortSignal.timeout(timeout),
    headers: {accept: 'application/json', 'user-agent': UA},
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(Error(data.errors?.[0]?.detail || `MangaDex HTTP ${r.status}`), {status: [404,429].includes(r.status) ? r.status : r.status >= 500 ? 502 : 400});
    return data;
  });
}

function coverOf(manga) {
  const rel = (manga.relationships || []).find(x => x.type === 'cover_art');
  const file = rel?.attributes?.fileName;
  return file ? `https://uploads.mangadex.org/covers/${manga.id}/${file}.256.jpg` : '';
}

function titleOf(manga) {
  const t = manga.attributes?.title || {};
  return t.tr || t.en || t.ja || Object.values(t)[0] || 'Manga';
}

function altTitles(m) {
  const main = Object.values(m.attributes?.title || {});
  const extra = (m.attributes?.altTitles || []).flatMap(o => Object.values(o || {}));
  return [...new Set([...main, ...extra].map(s => String(s || '').trim()).filter(Boolean))].slice(0, 12);
}

function mapItem(m) {
  return {
    id: m.id,
    title: String(titleOf(m)).slice(0, 140),
    alts: altTitles(m),
    year: String(m.attributes?.year || ''),
    status: m.attributes?.status || '',
    cover: coverOf(m),
    desc: String(m.attributes?.description?.tr || m.attributes?.description?.en || '').replace(/<[^>]+>/g, '').slice(0, 280),
  };
}

export async function searchManga(q) {
  const query = String(q || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
  if (query.length < 2) return {items: []};
  const d = await mdGet(`/manga?title=${encodeURIComponent(query)}&limit=16&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&order[relevance]=desc`);
  return {items: (d.data || []).map(mapItem)};
}

// MangaDex’te yerel bir manga arşivi yok. Öneri ve “hepsini gör” bu popüler listeyi sayfalar.
export async function popularManga(offset = 0) {
  const off = Math.max(0, Math.min(2000, Math.floor(Number(offset) || 0)));
  const d = await mdGet(`/manga?limit=18&offset=${off}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&availableTranslatedLanguage[]=tr&availableTranslatedLanguage[]=en&hasAvailableChapters=true&order[followedCount]=desc`);
  return {items: (d.data || []).map(mapItem), total: Number(d.total) || 0, offset: off};
}

const validId = id => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '');
function requireId(id, label) { if (!validId(id)) throw Object.assign(Error('Geçersiz ' + label), {status: 400}); }
export async function mangaChapters(id, offset = 0, language = 'tr') {
  requireId(id, 'manga');
  const lang = language === 'en' ? 'en' : 'tr';
  const off = Math.max(0, Math.min(9900, Math.floor(Number(offset) || 0)));
  const feed = await mdGet(`/manga/${id}/feed?limit=100&offset=${off}&translatedLanguage[]=${lang}&order[chapter]=asc&order[volume]=asc&contentRating[]=safe&contentRating[]=suggestive`);
  const rows = feed.data || [];
  const chapters = rows.map(c => ({id:c.id, chapter:String(c.attributes?.chapter ?? ''), volume:String(c.attributes?.volume ?? ''), title:String(c.attributes?.title || '').slice(0,80), lang:c.attributes?.translatedLanguage || lang, pages:Number(c.attributes?.pages) || 0,
    externalUrl: /^https:\/\//.test(c.attributes?.externalUrl || '') ? c.attributes.externalUrl : null}));
  const total = Number(feed.total) || 0, nextOffset = off + rows.length;
  return {chapters, total, offset:off, nextOffset, hasMore:rows.length > 0 && nextOffset < total && nextOffset < 10000, language:lang};
}
export async function mangaDetail(id) {
  requireId(id, 'manga');
  const [info, feed] = await Promise.all([mdGet(`/manga/${id}?includes[]=cover_art`), mangaChapters(id)]);
  const m = info.data;
  if (!m?.id) throw Object.assign(Error('Manga bulunamadı'), {status:404});
  return {...mapItem(m), desc:String(m.attributes?.description?.tr || m.attributes?.description?.en || '').replace(/<[^>]+>/g,'').slice(0,600), ...feed};
}

export async function chapterPages(id) {
  requireId(id, 'bölüm');
  const d = await mdGet(`/at-home/server/${id}`);
  const hash = d?.chapter?.hash;
  const saver = Array.isArray(d?.chapter?.dataSaver) && d.chapter.dataSaver.length > 0;
  const files = saver ? d.chapter.dataSaver : d?.chapter?.data || [];
  const base = String(d?.baseUrl || '').replace(/\/+$/, '');
  if (!/^[a-f0-9]+$/i.test(hash || '') || !/^https:\/\/([a-z0-9-]+\.)*(mangadex\.org|mangadex\.network)(?::443)?$/i.test(base) || !files.length) {
    const err = new Error('Bölüm sayfaları alınamadı');
    err.status = 404;
    throw err;
  }
  const folder = saver ? 'data-saver' : 'data';
  return {
    pages: files.filter(f => /^[A-Za-z0-9._-]+$/.test(f)).map(f => `${base}/${folder}/${hash}/${f}`),
  };
}
