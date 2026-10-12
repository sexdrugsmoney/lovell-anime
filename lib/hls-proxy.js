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

async function open(secret, token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || sig !== await sign(secret, payload)) return null;
  const [exp, referer, url] = new TextDecoder().decode(unb64u(payload)).split('\n');
  if (!(Number(exp) > Date.now() / 1000) || !/^https:\/\//.test(url) || !/^https:\/\//.test(referer)) return null;
  return {exp: Number(exp), referer, url};
}

async function rewrite(secret, text, base, referer, exp) {
  const wrap = async ref => { try { const abs = new URL(ref, base).href; return /^https:/.test(abs) ? await proxyPath(secret, abs, referer, exp) : ref; } catch { return ref; } };
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
export async function handleHlsProxy(secret, path, range) {
  const entry = await open(secret, path.slice(PREFIX.length));
  if (!entry) return new Response('Bağlantı geçersiz ya da süresi dolmuş', {status: 403});
  let up;
  try {
    up = await fetch(entry.url, {headers: {'user-agent': UA, referer: entry.referer, origin: new URL(entry.referer).origin, accept: '*/*', ...(range ? {range} : {})}, signal: AbortSignal.timeout(25000)});
  } catch { return new Response('Kaynağa ulaşılamadı', {status: 502}); }
  const type = up.headers.get('content-type') || '';
  const cors = {'access-control-allow-origin': '*'};
  // Oynatma listesi: içerik türü ya da ilk satır "#EXTM3U" (bazı kaynaklar uzantısız / text/plain döner)
  if (/mpegurl|text\/|json/i.test(type) || /\.m3u8(\?|$)/i.test(entry.url)) {
    const text = await up.text();
    if (!text.trimStart().startsWith('#EXTM3U')) return new Response(text, {status: up.status, headers: {'content-type': type || 'text/plain', ...cors}});
    return new Response(await rewrite(secret, text, up.url || entry.url, entry.referer, entry.exp), {status: up.status, headers: {'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store', ...cors}});
  }
  const headers = {...cors, 'cache-control': 'public, max-age=3600'};
  for (const h of ['content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(h); if (v) headers[h] = v; }
  // Bazı kaynaklar TS parçalarını resim gibi (image/jpeg) sunar; oynatıcı için doğru türü ver
  headers['content-type'] = /^image\//i.test(type) ? 'video/mp2t' : (type || 'application/octet-stream');
  return new Response(up.body, {status: up.status, headers});
}

export const isHlsProxyPath = p => p.startsWith(PREFIX);
