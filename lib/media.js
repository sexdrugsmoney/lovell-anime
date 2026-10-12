// Oynatma kaynakları: kendi bilgisayarındaki video dosyaları (media/ klasörü)
// ve streams.json içinde tanımladığın HTTPS adresleri (MP4/WebM/HLS).
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './env.js';
import crypto from 'node:crypto';
import {buildEmbeds, fetchRemoteSources, fetchTrArchive, fetchTurkishSubs, fetchDubSources} from './providers.js';
import trArchiveIndex from '../src/data/tr-archive-index.js';

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
// Embed ve doğrudan akış sağlayıcıları lib/providers.js içindedir (Worker ile ortak).
// ============================================================
const CINEPRO_FALLBACK = 'https://core-5fvt.onrender.com';
const isPrivateHost = url => {
  try { const h = new URL(url).hostname; return h === 'localhost' || h === 'host.docker.internal' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === '::1'; } catch { return true; }
};

export function embedSources(kind, id, alId, season, episode, malId = null, animeEpisode = null) {
  return buildEmbeds(kind, id, alId, season, episode, {
    malId, animeEpisode,
    brandColor: process.env.VIDRIFT_COLOR || 'e4202b',
    brand: process.env.VIDRIFT_BRAND || 'LOVELL',
    brandLogo: process.env.VIDRIFT_LOGO || '',
  });
}

/** Türkçe altyazı (WYZIE_API_KEY tanımlıysa). */
export const turkishSubs = params => fetchTurkishSubs({...params, key: process.env.WYZIE_API_KEY});

// Türkçe fansub arşivi dizini (scripts/build-tr-archive.mjs üretir)
export function trArchiveEmbeds(alId, episode, timeout = 2500) {
  return alId ? fetchTrArchive({index: trArchiveIndex, alId, episode, timeout}).catch(() => []) : Promise.resolve([]);
}

/** Anthology, VidRock çözücü ve CinePro'dan doğrudan akışları süre sınırıyla toplar. */
// Dublaj geçidinin imza anahtarı: PROXY_SECRET yoksa süreç başına rastgele (yeniden başlatınca eski adresler geçersiz olur)
export const PROXY_SECRET = process.env.PROXY_SECRET || crypto.randomBytes(24).toString('hex');

export function remoteSources(params, deadline = 14000, origin = '') {
  const rawCine = (process.env.CINEPRO_URL || process.env.CINEPRO_CORE_URL || '').trim();
  return fetchRemoteSources(params, {
    anthologyUrl: process.env.ANTHOLOGY_SCRAPER_URL,
    vidrockUrl: process.env.VIDROCK_RESOLVER_URL,
    cineproUrl: !rawCine || isPrivateHost(rawCine) ? CINEPRO_FALLBACK : rawCine,
    deadline,
    // Türkçe dublaj (JetFilm, SelcukFlix): akışlar bu sunucunun /api/hls geçidinden oynar
    extra: params.hint?.imdb && origin ? [{id: 'dublaj', run: () => fetchDubSources({...params, imdb: params.hint.imdb, titles: [params.hint.original, params.hint.title], origin, secret: PROXY_SECRET})}] : [],
  });
}

export function srtToVtt(text) {
  return 'WEBVTT\n\n' + text.replace(/^﻿/, '').replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').replace(/\{\\[^}]*\}/g, '').trim() + '\n';
}
