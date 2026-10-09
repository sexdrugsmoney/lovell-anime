// Oynatma kaynakları: kendi bilgisayarındaki video dosyaları (media/ klasörü)
// ve streams.json içinde tanımladığın HTTPS adresleri (MP4/WebM/HLS).
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './env.js';

export const MEDIA_DIR = () => path.resolve(process.env.MEDIA_DIR || path.join(ROOT, 'media'));
const VIDEO = new Set(['.mp4', '.m4v', '.webm', '.mkv', '.m3u8', '.mov']);
const SUB = new Set(['.vtt', '.srt']);
const LANGS = {tr: 'Türkçe', en: 'İngilizce', ja: 'Japonca', de: 'Almanca', fr: 'Fransızca', es: 'İspanyolca', ar: 'Arapça', ru: 'Rusça'};

let scanCache = {at: 0, index: new Map()};

function walk(dir, depth = 0, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) walk(full, depth + 1, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

export function parseEpisode(file, folderSeason = null) {
  const name = path.basename(file, path.extname(file));
  let m = name.match(/S(\d{1,2})\s*[._ -]?\s*E(\d{1,4})/i);
  if (m) return {season: +m[1], episode: +m[2]};
  m = name.match(/(\d{1,2})x(\d{1,4})/i);
  if (m) return {season: +m[1], episode: +m[2]};
  m = name.match(/(?:^|[^a-z])(?:E|EP|Episode|B[öo]l[üu]m)\s*[._ -]?\s*(\d{1,4})/i) || name.match(/(\d{1,4})\s*\.?\s*B[öo]l[üu]m/i) || name.match(/^(\d{1,4})(?!\d)/) || name.match(/[ _-](\d{1,4})(?:[ _.-]|$)(?!.*[ _-]\d{1,4}(?:[ _.-]|$))/);
  if (m) return {season: folderSeason || 1, episode: +m[1]};
  return null;
}

/** media/ klasörünü tarar. Klasör adları: tv-127532, movie-372058, al-21 (ardından istediğin ad gelebilir). */
export function scan(force = false) {
  if (!force && Date.now() - scanCache.at < 15000) return scanCache.index;
  const base = MEDIA_DIR();
  const index = new Map();
  let top = [];
  try { top = fs.readdirSync(base, {withFileTypes: true}).filter(d => d.isDirectory()); } catch {}
  for (const dir of top) {
    const m = dir.name.match(/^(tv|movie|al)[-_ ](\d{1,9})(?!\d)/i);
    if (!m) continue;
    const kind = m[1].toLowerCase(), id = +m[2];
    const files = walk(path.join(base, dir.name));
    const subs = files.filter(f => SUB.has(path.extname(f).toLowerCase()));
    const videos = files.filter(f => VIDEO.has(path.extname(f).toLowerCase())).sort((a, b) => a.localeCompare(b, 'tr', {numeric: true}));
    const eps = [];
    videos.forEach((file, i) => {
      const rel = path.relative(base, file).split(path.sep).join('/');
      const folderSeason = (rel.match(/(?:Season|Sezon)\s*(\d{1,2})/i) || [])[1];
      let pos = parseEpisode(file, folderSeason ? +folderSeason : null);
      if (kind === 'movie') pos = {season: 1, episode: i + 1};
      if (!pos) return;
      const stem = file.slice(0, -path.extname(file).length);
      const subtitles = subs.filter(s => s.startsWith(stem + '.') || s.startsWith(stem + '_') || (kind === 'movie' && videos.length === 1)).map(s => {
        const tag = path.basename(s, path.extname(s)).slice(path.basename(stem).length).replace(/^[._ -]+/, '').toLowerCase();
        const lang = (tag.match(/^[a-z]{2}/) || ['tr'])[0];
        return {label: LANGS[lang] || tag || 'Altyazı', lang, url: '/api/sub?f=' + encodeURIComponent(path.relative(base, s).split(path.sep).join('/'))};
      });
      eps.push({season: pos.season, episode: pos.episode, file: rel, ext: path.extname(file).toLowerCase(), subtitles});
    });
    const key = `${kind}:${id}`;
    index.set(key, [...(index.get(key) || []), ...eps]);
  }
  scanCache = {at: Date.now(), index};
  return index;
}

export function library() {
  return [...scan().entries()].filter(([, eps]) => eps.length).map(([key, eps]) => {
    const [kind, id] = key.split(':');
    return {kind, id: +id, count: eps.length, episodes: eps.map(e => `${e.season}:${e.episode}`)};
  });
}

const safeUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password; } catch { return false; } };
const typeOf = (url, ext) => /\.m3u8(\?|$)/i.test(url) || ext === '.m3u8' ? 'hls' : (ext || path.extname(new URL(url, 'http://x').pathname)).replace('.', '') || 'mp4';

function manifest() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'streams.json'), 'utf8')); } catch { return {}; }
}

export function sources(kind, id, season, episode) {
  const list = [];
  for (const e of scan().get(`${kind}:${id}`) || []) {
    if (kind === 'movie' ? e.episode === episode : e.season === season && e.episode === episode) {
      list.push({name: `Bilgisayarımdan · ${path.basename(e.file)}`, origin: 'local', url: '/media/' + e.file.split('/').map(encodeURIComponent).join('/'), type: typeOf('x' + e.ext, e.ext), subtitles: e.subtitles});
    }
  }
  const m = manifest();
  for (const s of m[`${kind}:${id}:${season}:${episode}`] || m[`${kind}:${id}`] || []) {
    if (!safeUrl(s?.url)) continue;
    list.push({name: String(s.name || 'Bağlantı'), origin: 'manifest', url: s.url, type: typeOf(s.url), subtitles: (s.subtitles || []).filter(t => safeUrl(t.url)).map(t => ({label: String(t.label || 'Altyazı'), lang: String(t.language || 'tr'), url: t.url}))});
  }
  return list;
}

/** media/ altındaki bir dosyanın güvenli tam yolunu döndürür; dışarı taşmaya izin vermez. */
export function resolveMedia(rel) {
  const base = MEDIA_DIR();
  const full = path.resolve(base, rel);
  if (!full.startsWith(base + path.sep)) return null;
  return full;
}

/**
 * VidRift embed URL oluşturur.
 * kind: 'tv' | 'movie' | 'al'
 * id: TMDB/AniList id
 * season, episode: dizi için
 * opts: brandColor, brand gibi .env'den gelen opsiyonlar
 */
export function vidriftUrl(kind, id, season, episode, opts = {}) {
  // VidRift yalnızca TMDB id'lerini destekler; al (AniList) için geri döner null.
  if (kind === 'al') return null;
  const base = kind === 'movie'
    ? `https://embed.vidrift.net/embed/movie/${id}`
    : `https://embed.vidrift.net/embed/tv/${id}/${season}/${episode}`;
  const params = new URLSearchParams();
  if (opts.brand)      params.set('brand', opts.brand.slice(0, 28));
  if (opts.brandColor) params.set('brandColor', opts.brandColor.replace('#', ''));
  if (opts.brandLogo)  params.set('brandLogo', opts.brandLogo);
  params.set('exit', '1');
  return base + '?' + params.toString();
}

// ============================================================
// Embed sağlayıcılar — birden fazla iframe kaynağı üretir.
// Her sağlayıcı { id, name, url, kind:'embed' } döndürür ya da null.
// ============================================================

/**
 * VidPlus — TMDB (film/dizi) + AniList (anime) destekler.
 * https://player.vidplus.to
 */
function vidplusUrl(kind, id, alId, season, episode, opts = {}) {
  const color = (opts.brandColor || 'e4202b').replace('#', '');
  if (kind === 'al' && alId) {
    return `https://player.vidplus.to/embed/anime/${alId}/${episode}?primarycolor=${color}&secondarycolor=1a0000&autonext=true&autoplay=true`;
  }
  if (kind === 'movie') {
    return `https://player.vidplus.to/embed/movie/${id}?primarycolor=${color}&autoplay=true`;
  }
  if (kind === 'tv') {
    return `https://player.vidplus.to/embed/tv/${id}/${season}/${episode}?primarycolor=${color}&autonext=true&autoplay=true`;
  }
  return null;
}

/**
 * MegaPlay (Anikoto) — anime için AniList ID kullanır.
 * https://megaplay.buzz
 */
function megaplayUrl(kind, alId, episode) {
  if (!alId) return null;
  // Film animeleri için episode=1
  return `https://megaplay.buzz/stream/ani/${alId}/${episode}/sub`;
}

/**
 * Vidy.st — TMDB (film/dizi) + AniList (anime) destekler, postMessage progress.
 * https://vidy.st
 */
function vidyUrl(kind, id, alId, season, episode, opts = {}) {
  const color = (opts.brandColor || 'e4202b').replace('#', '');
  if (kind === 'al' && alId) {
    return `https://vidy.st/anime/${alId}/${episode}?color=${color}&episodeSelector=true&autoplayNextEpisode=true`;
  }
  if (kind === 'movie') {
    return `https://vidy.st/movie/${id}?color=${color}&autoplay=true`;
  }
  if (kind === 'tv') {
    return `https://vidy.st/tv/${id}/${season}/${episode}?color=${color}&nextEpisode=true&episodeSelector=true&autoplayNextEpisode=true`;
  }
  return null;
}

/**
 * VidSrc — IMDB veya TMDB ID ile çalışır.
 * https://vidsrc.buzz
 */
function vidsrcUrl(kind, id, season, episode) {
  if (kind === 'al') return null; // TMDB gerekli
  if (kind === 'movie') return `https://vidsrc.buzz/embed/movie/${id}?autoplay=true`;
  if (kind === 'tv') return `https://vidsrc.buzz/embed/tv/${id}/${season}/${episode}?autoplay=true`;
  return null;
}

/**
 * VidRock — anime/dizi/film. TMDB ID bazlı.
 * (URL formatı vidrift benzeri — TMDB id'li)
 */
function vidRockUrl(kind, id, season, episode) {
  if (kind === 'al') return null;
  if (kind === 'movie') return `https://vidrock.to/embed/movie/${id}`;
  if (kind === 'tv') return `https://vidrock.to/embed/tv/${id}/${season}/${episode}`;
  return null;
}

/**
 * CinePro Core — yerel olarak çalışıyorsa OMSS API'den kaynak al.
 * Döndürülen kaynaklar HLS/MP4 URL'leri olarak player'a aktarılır.
 */
const CINEPRO_FALLBACK = 'https://core-5fvt.onrender.com';

async function cineProqueries(kind, id, alId, season, episode) {
  const raw = process.env.CINEPRO_URL || process.env.CINEPRO_CORE_URL || '';
  const base = (!raw || raw.includes('localhost') || raw.includes('127.0.0.1'))
    ? CINEPRO_FALLBACK
    : raw;
  // OMSS endpoint: POST /scrape veya GET /scrape?...
  // CinePro Core OMSS /scrape endpoint: kind, tmdbId, season, episode
  const omssKind = kind === 'movie' ? 'movie' : 'tv';
  const params = new URLSearchParams({
    tmdbId: String(id),
    type: omssKind,
    ...(omssKind === 'tv' ? {season: String(season), episode: String(episode)} : {}),
  });
  const doFetch = () => fetch(`${base}/scrape?${params}`, {
    signal: AbortSignal.timeout(55000),
    headers: {Accept: 'application/json'},
  });
  try {
    let r = await doFetch();
    // Tek retry 503/502 için
    if (r.status === 503 || r.status === 502) {
      await new Promise(res => setTimeout(res, 500));
      r = await doFetch();
    }
    if (!r.ok) return [];
    const data = await r.json();
    // OMSS response: { sources: [{ url, quality, isM3U8, ... }] }
    const raw = data.sources || data.results || data.streams || [];
    return raw.filter(s => safeUrl(s?.url)).map(s => ({
      name: `CinePro · ${s.quality || s.server || s.provider || 'Auto'}`,
      origin: 'cinepro',
      url: s.url,
      type: s.isM3U8 || /\.m3u8(\?|$)/i.test(s.url) ? 'hls' : s.isDASH || /\.mpd(\?|$)/i.test(s.url) ? 'dash' : 'mp4',
      subtitles: (s.subtitles || s.tracks || [])
        .filter(t => safeUrl(t?.url || t?.file))
        .map(t => ({label: t.label || t.lang || 'Altyazı', lang: t.lang || t.language || 'tr', url: t.url || t.file})),
    }));
  } catch {
    return [];
  }
}

/**
 * Tüm embed sağlayıcıları için URL listesi üretir.
 * Döndürülen her eleman: { id, name, url, kind:'embed' }
 */
export function embedSources(kind, id, alId, season, episode) {
  const opts = {
    brandColor: process.env.VIDRIFT_COLOR || 'e4202b',
    brand: process.env.VIDRIFT_BRAND || 'LOVELL',
    brandLogo: process.env.VIDRIFT_LOGO || '',
  };
  const list = [];

  const add = (name, url, embedId) => {
    if (url) list.push({id: embedId, name, url, kind: 'embed', origin: 'embed'});
  };

  // Sıralama: kalite/güvenilirlik önce
  add('VidRift', vidriftUrl(kind, id, season, episode, opts), 'vidrift');
  add('VidPlus', vidplusUrl(kind, id, alId, season, episode, opts), 'vidplus');
  add('Vidy', vidyUrl(kind, id, alId, season, episode, opts), 'vidy');
  add('VidSrc', vidsrcUrl(kind, id, season, episode), 'vidsrc');
  add('VidRock', vidRockUrl(kind, id, season, episode), 'vidrock');
  // MegaPlay yalnızca anime (AniList ID gerekli)
  if (alId) add('MegaPlay', megaplayUrl(kind, alId, episode), 'megaplay');

  return list;
}

/**
 * CinePro Core'dan HLS/MP4 kaynaklarını asenkron olarak çeker.
 */
export { cineProqueries as cineproSources };

export function srtToVtt(text) {
  return 'WEBVTT\n\n' + text.replace(/^﻿/, '').replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').replace(/\{\\[^}]*\}/g, '').trim() + '\n';
}
