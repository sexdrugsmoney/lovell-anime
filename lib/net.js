// TMDB'ye engellere dayanıklı erişim.
//
// Türkiye'de bazı servis sağlayıcılar api.themoviedb.org adresini DNS düzeyinde
// engelliyor (alan adı 127.0.0.1 veya bir uyarı sayfasına çözülüyor). Bu modül
// sırasıyla şu yolları dener ve çalışanı hatırlar:
//   1. TMDB_PROXY_URL (kendi Cloudflare Worker / vekil adresin, isteğe bağlı)
//   2. Sistem DNS'i (yerel/özel IP dönerse atlanır)
//   3. DNS-over-HTTPS: Cloudflare 1.1.1.1 ve Google 8.8.8.8 (IP ile, DNS gerektirmez)
// Her yol hem api.themoviedb.org hem de TMDB'nin resmî diğer alan adı api.tmdb.org
// için denenir. TLS doğrulaması her zaman açıktır; sahte bir engel sayfası sertifika
// kontrolünden geçemez ve bir sonraki yola geçilir.
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';
import {isIP} from 'node:net';

const PRIVATE = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|2[3-5]\d\.)/;
const DOH = [
  {id: 'doh-cloudflare', label: 'DoH · Cloudflare 1.1.1.1', url: n => `https://1.1.1.1/dns-query?name=${n}&type=A`},
  {id: 'doh-google', label: 'DoH · Google 8.8.8.8', url: n => `https://8.8.8.8/resolve?name=${n}&type=A`},
  {id: 'doh-cloudflare-alt', label: 'DoH · Cloudflare 1.0.0.1', url: n => `https://1.0.0.1/dns-query?name=${n}&type=A`},
];
export const HOSTS = {
  api: ['api.themoviedb.org', 'api.tmdb.org'],
  image: ['image.tmdb.org', 'media.themoviedb.org'],
};
const MAX_BODY = 12 * 1024 * 1024;

const dnsCache = new Map();      // `${resolver}:${host}` -> {addrs, until}
const preferred = new Map();     // group -> route
const failures = [];             // son hatalar (teşhis için)
let downUntil = 0;
let lastOk = null;
let authProblem = null;

function note(route, error) {
  failures.unshift({at: new Date().toISOString(), route, error: String(error?.message || error)});
  failures.length = Math.min(failures.length, 12);
}

async function resolveWith(resolver, host) {
  const cacheKey = `${resolver}:${host}`;
  const hit = dnsCache.get(cacheKey);
  if (hit && hit.until > Date.now()) return hit.addrs;
  let addrs = [];
  let ttl = 300;
  if (resolver === 'system') {
    const found = await dns.lookup(host, {all: true, family: 4});
    addrs = found.map(a => a.address);
  } else {
    const doh = DOH.find(d => d.id === resolver);
    const res = await fetch(doh.url(host), {headers: {accept: 'application/dns-json'}, signal: AbortSignal.timeout(4000)});
    if (!res.ok) throw Error(`${doh.label} HTTP ${res.status}`);
    const json = await res.json();
    const answers = (json.Answer || []).filter(a => a.type === 1 && isIP(a.data) === 4);
    addrs = answers.map(a => a.data);
    if (answers.length) ttl = Math.max(60, Math.min(...answers.map(a => a.TTL || 300)));
  }
  addrs = addrs.filter(a => !PRIVATE.test(a));
  if (!addrs.length) throw Error(`${host} için ${resolver} genel bir IP döndürmedi (engellenmiş olabilir)`);
  dnsCache.set(cacheKey, {addrs, until: Date.now() + ttl * 1000});
  return addrs;
}

function rawGet(url, {headers = {}, addrs, timeout = 7000} = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const options = {
      method: 'GET',
      headers: {'accept-encoding': 'identity', 'user-agent': 'LovellAnime/2.0', ...headers},
      timeout,
    };
    if (addrs) {
      options.lookup = (hostname, opts, cb) => {
        if (hostname !== target.hostname) return cb(Error('Beklenmeyen alan adı'));
        if (opts?.all) return cb(null, addrs.map(address => ({address, family: 4})));
        cb(null, addrs[0], 4);
      };
    }
    const client = target.protocol === 'http:' ? http : https;
    const req = client.get(target, options, res => {
      let size = 0;
      const chunks = [];
      res.on('data', c => {
        size += c.length;
        if (size > MAX_BODY) { res.destroy(Error('Yanıt çok büyük')); return; }
        chunks.push(c);
      });
      res.on('error', reject);
      res.on('end', () => resolve({status: res.statusCode, type: res.headers['content-type'] || '', body: Buffer.concat(chunks)}));
    });
    req.on('timeout', () => req.destroy(Error('Zaman aşımı')));
    req.on('error', reject);
  });
}

function routesFor(group) {
  const list = [];
  const proxy = process.env.TMDB_PROXY_URL?.trim().replace(/\/+$/, '');
  // "query" biçimi: https://x.workers.dev/?endpoint=/discover/tv&... ve görseller /image/w342/...
  // "path" biçimi (varsayılan, scripts/cloudflare-worker.js): https://x.workers.dev/3/discover/tv?...
  const style = (process.env.TMDB_PROXY_STYLE || 'path').trim().toLowerCase() === 'query' ? 'query' : 'path';
  if (proxy && group === 'api') list.push({id: 'proxy', label: 'TMDB_PROXY_URL', base: proxy, style});
  const imgProxy = process.env.TMDB_IMAGE_PROXY_URL?.trim().replace(/\/+$/, '') || (style === 'query' ? proxy : '');
  if (group === 'image' && imgProxy) list.push({id: 'proxy', label: 'TMDB_IMAGE_PROXY_URL', base: imgProxy, style});
  for (const host of HOSTS[group]) {
    for (const resolver of ['system', ...DOH.map(d => d.id)]) list.push({id: `${host}|${resolver}`, host, resolver, label: `${host} · ${resolver === 'system' ? 'sistem DNS' : DOH.find(d => d.id === resolver).label}`});
  }
  const pref = preferred.get(group);
  if (pref) {
    const i = list.findIndex(r => r.id === pref);
    if (i > 0) list.unshift(...list.splice(i, 1));
  }
  return list;
}

async function attempt(route, pathAndQuery, headers) {
  if (route.base) {
    if (route.style !== 'query') return rawGet(route.base + pathAndQuery, {headers});
    if (pathAndQuery.startsWith('/t/p/')) return rawGet(route.base + '/image/' + pathAndQuery.slice(5), {headers});
    const [p, q = ''] = pathAndQuery.split('?');
    const sp = new URLSearchParams(q);
    sp.delete('api_key');
    const out = new URLSearchParams({endpoint: p.replace(/^\/3/, '')});
    for (const [k, v] of sp) out.append(k, v);
    return rawGet(`${route.base}/?${out}`, {headers});
  }
  const addrs = await resolveWith(route.resolver, route.host);
  return rawGet(`https://${route.host}${pathAndQuery}`, {headers, addrs});
}

/**
 * Bir TMDB grubuna (api | image) dayanıklı GET isteği. Bağlantı/TLS hatalarında
 * sıradaki yolu dener; HTTP yanıtı (401, 404 dahil) geldiğinde durur.
 */
export async function tmdbGet(group, pathAndQuery, headers = {}) {
  if (group === 'api' && downUntil > Date.now()) throw Object.assign(Error('TMDB şu anda erişilemiyor (bekleme süresinde)'), {offline: true});
  const deadline = Date.now() + 16000;
  const tried = new Set();
  let lastError;
  for (const route of routesFor(group)) {
    if (Date.now() > deadline) break;
    try {
      // Aynı IP kümesini iki kez denemeyelim.
      if (!route.base) {
        const addrs = await resolveWith(route.resolver, route.host);
        const sig = route.host + addrs.slice().sort().join(',');
        if (tried.has(sig)) continue;
        tried.add(sig);
      }
      const res = await attempt(route, pathAndQuery, headers);
      if (res.status >= 500) throw Error(`HTTP ${res.status}`);
      // Araya giren bir engel/vekil sayfası TMDB yanıtı gibi kabul edilmesin.
      if (group === 'api' && !/json/i.test(res.type)) throw Error(`TMDB olmayan yanıt (HTTP ${res.status})`);
      if (group === 'image' && ![200, 404].includes(res.status)) throw Error(`HTTP ${res.status}`);
      preferred.set(group, route.id);
      if (group === 'api') { downUntil = 0; lastOk = {at: new Date().toISOString(), route: route.label}; }
      return res;
    } catch (e) {
      lastError = e;
      note(route.label, e);
    }
  }
  if (group === 'api') downUntil = Date.now() + 90_000;
  throw Object.assign(Error(`TMDB'ye hiçbir yoldan ulaşılamadı: ${lastError?.message || 'bilinmeyen hata'}`), {offline: true});
}

export function tmdbAuth() {
  const token = process.env.TMDB_READ_TOKEN?.trim();
  const key = process.env.TMDB_API_KEY?.trim() || '8264db167971762da596258280f479b0';
  return {headers: token ? {authorization: `Bearer ${token}`, accept: 'application/json'} : {accept: 'application/json'}, key: token ? null : key};
}

export async function tmdbJson(endpoint, params = {}) {
  const {headers, key} = tmdbAuth();
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  if (key) q.set('api_key', key);
  const res = await tmdbGet('api', `/3/${endpoint}?${q}`, headers);
  let json;
  try { json = JSON.parse(res.body.toString('utf8')); } catch { throw Error('TMDB geçersiz yanıt döndürdü'); }
  if (res.status === 401) {
    authProblem = {at: new Date().toISOString(), message: json?.status_message || 'API anahtarı reddedildi'};
    throw Object.assign(Error('TMDB API anahtarı geçersiz. .env dosyasına kendi TMDB_API_KEY değerini yaz.'), {status: 401});
  }
  if (res.status !== 200) throw Object.assign(Error(json?.status_message || `TMDB HTTP ${res.status}`), {status: res.status});
  authProblem = null;
  return json;
}

export function netStatus() {
  return {
    tmdb: authProblem ? 'anahtar geçersiz' : downUntil > Date.now() ? 'erişilemiyor' : lastOk ? 'bağlı' : 'henüz denenmedi',
    authProblem,
    lastSuccess: lastOk,
    preferredRoutes: Object.fromEntries(preferred),
    recentErrors: failures,
    proxy: Boolean(process.env.TMDB_PROXY_URL),
    auth: process.env.TMDB_READ_TOKEN ? 'okuma jetonu (v4)' : process.env.TMDB_API_KEY ? 'kendi API anahtarın' : 'projedeki varsayılan anahtar',
  };
}

// Teşhis: her yolu tek tek dener (npm run doctor).
export async function probeAll() {
  const out = [];
  const {headers, key} = tmdbAuth();
  for (const group of ['api', 'image']) {
    for (const route of routesFor(group)) {
      const started = Date.now();
      const path = group === 'api' ? `/3/configuration${key ? `?api_key=${key}` : ''}` : '/t/p/w92/wwemzKWzjKYJFfCeiB57q3r4Bcm.png';
      try {
        const res = await attempt(route, path, group === 'api' ? headers : {});
        const ok = group === 'api' ? /json/i.test(res.type) && res.status < 500 : [200, 404].includes(res.status);
        out.push({group, route: route.label, ok, status: res.status, ms: Date.now() - started, error: ok ? undefined : 'TMDB olmayan yanıt'});
      } catch (e) {
        out.push({group, route: route.label, ok: false, error: e.message, ms: Date.now() - started});
      }
    }
  }
  return out;
}

// AniList ve diğer genel uç noktalar için basit, zaman aşımlı GET/POST.
export async function plainFetch(url, init = {}, timeout = 8000) {
  const res = await fetch(url, {...init, signal: AbortSignal.timeout(timeout)});
  return res;
}
