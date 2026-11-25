// Yönetici kapısı. Adres sitede yoktur; ADMIN_PATH ve ADMIN_PASSWORD yalnızca ortam değişkenidir.
// Oturum çerezi parolanın HMAC'idir, sunucuda oturum listesi tutulmaz.
import {profileRequest} from './profiles.js';

const enc = new TextEncoder();
const fails = new Map();

export function adminConfig(env = {}) {
  const password = String(env.ADMIN_PASSWORD || '').trim();
  const slug = String(env.ADMIN_PATH || '').trim().replace(/^\/+|\/+$/g, '');
  if (password.length < 12 || password.length > 200 || !/^[a-z0-9]{18,64}$/.test(slug)) return null;
  return {password, path: slug};
}

function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

async function sha(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function passwordOk(expected, given) {
  if (typeof given !== 'string' || given.length < 1 || given.length > 200) return false;
  const a = await sha('lovell-admin-v1:' + expected);
  const b = await sha('lovell-admin-v1:' + given);
  let n = 0;
  for (let i = 0; i < a.length; i++) n |= a[i] ^ b[i];
  return n === 0;
}

export async function adminToken(password, ttl = 12 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(12)));
  const payload = `${exp}.${nonce}`;
  return `${payload}.${await hmac(password, payload)}`;
}

export async function adminTokenOk(password, token) {
  if (!password || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts;
  if (!/^\d{10}$/.test(exp) || !/^[A-Za-z0-9_-]{8,32}$/.test(nonce) || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expect = await hmac(password, `${exp}.${nonce}`);
  if (expect.length !== sig.length) return false;
  let n = 0;
  for (let i = 0; i < expect.length; i++) n |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  return n === 0;
}

export function cookieValue(header, name) {
  const m = String(header || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return ''; }
}

function gateCookie(slug, token, secure, maxAge) {
  return `lovell_gate=${token}; HttpOnly; SameSite=Strict; Path=/${slug}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function locked(ip) {
  const row = fails.get(ip || 'yerel');
  return !!row && row.reset > Date.now() && row.n >= 8;
}

function noteFail(ip) {
  const id = ip || 'yerel';
  const now = Date.now();
  let row = fails.get(id);
  if (!row || row.reset < now) {
    if (fails.size > 4000) fails.clear();
    row = {n: 0, reset: now + 10 * 60 * 1000};
    fails.set(id, row);
  }
  row.n += 1;
}

export function resetAdminLimits() { fails.clear(); }

function page() {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>LOVELL</title>
<style>
  :root { color-scheme: dark; --bg:#090909; --card:#141414; --line:#2c2c2c; --text:#f4f4f4; --dim:#9a9a9a; --red:#e4202b; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
  main { width: min(720px, calc(100% - 32px)); margin: 48px auto; display: grid; gap: 16px; }
  h1 { font-size: 28px; margin: 0; }
  p { margin: 0; color: var(--dim); }
  form, section { display: grid; gap: 12px; padding: 18px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); }
  label { display: grid; gap: 6px; color: var(--dim); font-size: 13px; }
  input { height: 44px; border-radius: 8px; border: 1px solid var(--line); background: #0c0c0c; color: var(--text); padding: 0 12px; font: inherit; }
  button { height: 42px; border: 0; border-radius: 8px; background: var(--red); color: #fff; font-weight: 700; cursor: pointer; }
  button.ghost { background: transparent; border: 1px solid var(--line); color: var(--text); }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
  .row label { flex: 1; min-width: 180px; }
  .key { font-family: ui-monospace, Consolas, monospace; letter-spacing: .04em; word-break: break-all; }
  article { display: grid; gap: 4px; padding: 12px 0; border-top: 1px solid var(--line); }
  article strong { font-size: 16px; }
  article small { color: var(--dim); }
  .err { color: #ff8d96; }
  #gate, #desk { display: none; }
</style>
</head>
<body>
<main>
  <h1>LOVELL</h1>
  <form id="gate">
    <p>Devam etmek için parola.</p>
    <label>Parola<input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit">Giriş</button>
    <p class="err" id="gate-err"></p>
  </form>
  <div id="desk">
    <section>
      <p>Yeni bir izleyici anahtarı. Anahtar bir kez gösterilir.</p>
      <form id="mint" class="row">
        <label>Profil adı<input name="name" maxlength="24" required placeholder="Ad"></label>
        <button type="submit">Anahtar üret</button>
      </form>
      <p id="fresh" class="key" hidden></p>
      <button type="button" class="ghost" id="copy" hidden>Anahtarı kopyala</button>
    </section>
    <section>
      <div class="row"><p>Verilmiş profiller</p><button type="button" class="ghost" id="out">Çıkış</button></div>
      <div id="people"></div>
    </section>
  </div>
</main>
<script>
const here = location.pathname;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function call(body) {
  const res = await fetch(here, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'İstek başarısız'), {status: res.status});
  return data;
}
function show(on) {
  document.getElementById('gate').style.display = on ? 'none' : 'grid';
  document.getElementById('desk').style.display = on ? 'grid' : 'none';
}
async function load() {
  const data = await call({op: 'list'});
  const box = document.getElementById('people');
  box.innerHTML = data.profiles.length ? data.profiles.map(p => \`<article><strong>\${esc(p.name)}</strong><small>\${p.count} başlık\${p.titles.length ? ' · ' + esc(p.titles.join(', ')) : ''}</small><button type="button" class="ghost" data-id="\${esc(p.id)}">Anahtarı iptal et</button></article>\`).join('') : '<p>Henüz profil yok.</p>';
  box.onclick = async e => {
    const id = e.target.dataset?.id;
    if (!id || !confirm('Bu profil ve listesi silinsin mi?')) return;
    await call({op: 'revoke', id});
    load();
  };
}
document.getElementById('gate').onsubmit = async e => {
  e.preventDefault();
  const err = document.getElementById('gate-err');
  err.textContent = '';
  try {
    await call({op: 'login', password: new FormData(e.target).get('password')});
    show(true);
    await load();
  } catch (ex) { err.textContent = ex.message; }
};
let lastKey = '';
document.getElementById('mint').onsubmit = async e => {
  e.preventDefault();
  const data = await call({op: 'create', name: new FormData(e.target).get('name')});
  lastKey = data.key;
  const line = document.getElementById('fresh');
  line.hidden = false;
  line.textContent = data.profile.name + ' · ' + data.key;
  document.getElementById('copy').hidden = false;
  e.target.reset();
  load();
};
document.getElementById('copy').onclick = async () => { try { await navigator.clipboard.writeText(lastKey); } catch { alert(lastKey); } };
document.getElementById('out').onclick = async () => { await call({op: 'logout'}); show(false); };
call({op: 'status'}).then(() => { show(true); load(); }).catch(() => show(false));
</script>
</body>
</html>`;
}

// Eşleşmezse null. Eşleşirse {status, data?, html?, cookie?}.
export async function adminRequest({method, pathname, cookieHeader, body, store, ip, secure, config}) {
  if (!config || pathname !== '/' + config.path) return null;
  const headers = {'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer'};
  if (method === 'GET' || method === 'HEAD') return {status: 200, html: page(), headers};
  if (method !== 'POST') return {status: 404, data: {error: 'Bulunamadı'}, headers};
  const op = body?.op;
  if (op === 'login') {
    if (locked(ip)) return {status: 429, data: {error: 'Çok fazla deneme. Biraz sonra tekrar dene.'}, headers};
    if (!await passwordOk(config.password, body.password || '')) {
      noteFail(ip);
      return {status: 401, data: {error: 'Giriş yapılamadı'}, headers};
    }
    const token = await adminToken(config.password);
    return {status: 200, data: {ok: true}, cookie: gateCookie(config.path, token, secure, 12 * 3600), headers};
  }
  const ok = await adminTokenOk(config.password, cookieValue(cookieHeader, 'lovell_gate'));
  if (!ok) return {status: 401, data: {error: 'Giriş gerekli'}, headers};
  if (op === 'logout') return {status: 200, data: {ok: true}, cookie: gateCookie(config.path, '', secure, 0), headers};
  if (op === 'status') return {status: 200, data: {ok: true}, headers};
  if (op === 'list') return {status: 200, data: {profiles: await store.list()}, headers};
  if (op === 'create') {
    const out = await profileRequest({method: 'POST', body, store, ip, admin: true});
    return {status: out.status, data: out.data, headers};
  }
  if (op === 'revoke') {
    const id = String(body.id || '');
    if (!/^[a-f0-9]{64}$/.test(id)) return {status: 400, data: {error: 'Geçersiz profil'}, headers};
    await store.del(id);
    return {status: 200, data: {ok: true}, headers};
  }
  return {status: 400, data: {error: 'Geçersiz istek'}, headers};
}
