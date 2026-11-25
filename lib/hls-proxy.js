// Referer isteyen HLS akışları için imzalı geçit — Cloudflare Worker ve yerel sunucu aynı kodu kullanır.
// Tarayıcı Referer başlığını değiştiremez; bazı Türkçe dublaj kaynakları ise yalnızca kendi oynatıcılarının
// Referer'ıyla akış verir. Bu geçit YALNIZCA bu sitenin imzaladığı adresleri (süreli jeton) aktarır;
// herhangi bir adresi açan açık bir vekil değildir. Oynatma listeleri yeniden yazılır, içindeki her adres de imzalanır.

const enc = new TextEncoder();
const PREFIX = '/api/hls/';
const TTL = 8 * 3600;   // saniye
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const b64u = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(bin, c => c.charCodeAt(0)); };

const KEYS = new Map();
function key(secret) {
  if (!KEYS.has(secret)) KEYS.set(secret, crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']));
  return KEYS.get(secret);
}
async function sign(secret, data) {
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(data)))).slice(0, 27);
}

/** Akış adresi + Referer → bu sitenin geçit yolu ("/api/hls/<jeton>"). */
export async function proxyPath(secret, url, referer, exp = Math.floor(Date.now() / 1000) + TTL) {
  const payload = b64u(enc.encode(`${exp}\n${referer}\n${url}`));
  return `${PREFIX}${payload}.${await sign(secret, payload)}`;
}

async function open(secret, token, target) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || sig !== await sign(secret, payload)) return null;
  const text = new TextDecoder().decode(unb64u(payload));
  const nl = text.indexOf('\n'), nl2 = text.indexOf('\n', nl + 1);
  if (nl < 1 || nl2 < 0) return null;
  const exp = Number(text.slice(0, nl));
  const referer = text.slice(nl + 1, nl2);
  const rest = text.slice(nl2 + 1);
  if (!(exp > Date.now() / 1000) || !/^https:\/\//.test(referer)) return null;
  if (target) {
    let url;
    try { url = new URL(target); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== rest) return null;
    return {exp, referer, url: url.href};
  }
  if (!/^https:\/\/[^/]+\/\S/.test(rest)) return null;
  return {exp, referer, url: rest};
}

async function rewrite(secret, text, base, referer, exp) {
  const gates = new Map();
  const wrap = async ref => {
    let abs;
    try { abs = new URL(ref, base).href; } catch { return ref; }
    if (!/^https:/.test(abs)) return ref;
    const origin = new URL(abs).origin;
    let gate = gates.get(origin);
    if (!gate) {
      const payload = b64u(enc.encode(`${exp}\n${referer}\n${origin}`));
      gate = `${PREFIX}${payload}.${await sign(secret, payload)}`;
      gates.set(origin, gate);
    }
    return `${gate}?u=${encodeURIComponent(abs)}`;
  };
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) out.push(line);
    else if (line.startsWith('#')) {
      const m = line.match(/URI="([^"]+)"/);
      out.push(m ? line.replace(m[0], `URI="${await wrap(m[1])}"`) : line);
    } else out.push(await wrap(line.trim()));
  }
  return out.join('\n');
}

/**
 * path: istek yolu ("/api/hls/<jeton>"), range: istemcinin Range başlığı.
 * Döner: Response (Workers ve Node 20+ fetch Response'u).
 */
export async function handleHlsProxy(secret, path, range, query = '') {
  const target = new URLSearchParams(String(query).replace(/^\?/, '')).get('u');
  const entry = await open(secret, path.slice(PREFIX.length), target);
  if (!entry) return new Response('Bağlantı geçersiz ya da süresi dolmuş', {status: 403});
  let up;
  try {
    up = await fetch(entry.url, {headers: {'user-agent': UA, referer: entry.referer, origin: new URL(entry.referer).origin, accept: '*/*', ...(range ? {range} : {})}, signal: AbortSignal.timeout(25000)});
  } catch { return new Response('Kaynağa ulaşılamadı', {status: 502}); }
  if (!up.ok && up.status !== 206) return new Response('Kaynağa ulaşılamadı', {status: up.status || 502});
  const type = up.headers.get('content-type') || '';
  const cors = {'access-control-allow-origin': '*'};
  const buf = new Uint8Array(await up.arrayBuffer());
  const head = new TextDecoder().decode(buf.subarray(0, 24)).replace(/^\uFEFF/, '').trimStart();
  if (head.startsWith('#EXTM3U')) {
    const text = new TextDecoder().decode(buf);
    return new Response(await rewrite(secret, text, up.url || entry.url, entry.referer, entry.exp), {status: up.status, headers: {'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store', ...cors}});
  }
  if (head.startsWith('WEBVTT')) return new Response(buf, {status: up.status, headers: {'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'public, max-age=3600', ...cors}});
  const headers = {...cors, 'cache-control': 'public, max-age=3600'};
  for (const h of ['content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(h); if (v) headers[h] = v; }
  // Parçalar kasıtlı olarak html, css, js ya da jpeg türüyle gelir; gövde MPEG-TS ya da MP4 ise oynatıcıya doğru türü ver
  const mp4 = buf.length > 11 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
  headers['content-type'] = mp4 ? 'video/mp4' : (/^video\//i.test(type) ? type : 'video/mp2t');
  if (buf[0] === 0x47) headers['content-type'] = 'video/mp2t';
  return new Response(buf, {status: up.status, headers});
}

export const isHlsProxyPath = p => p.startsWith(PREFIX);
