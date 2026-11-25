// Profil anahtarı: ham anahtar yalnızca istemcide durur.
// Sunucu SHA-256 özetini saklar; anahtarı bilen kişi o profilin izleyeceklerim listesini görür.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const KEY_RE = new RegExp(`^[${ALPHABET}]{20}$`);
const ITEM_KEY = /^(tv|movie|al):\d{1,12}$/;
const PROG_KEY = /^(tv|movie|al):\d{1,12}:\d{1,4}:\d{1,4}$/;

const limits = new Map();

export function generateKey() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const raw = [...bytes].map(b => ALPHABET[b & 31]).join('');
  return raw.match(/.{4}/g).join('-');
}

export function normalizeKey(input) {
  const raw = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!KEY_RE.test(raw)) return null;
  return raw.match(/.{4}/g).join('-');
}

export function requestKey(headerKey, cookieHeader) {
  if (headerKey) return String(headerKey);
  const m = String(cookieHeader || '').match(/(?:^|;\s*)lovell_pass=([^;]*)/);
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return ''; }
}

export async function profileOpen(store, key) {
  const hash = await hashKey(key);
  if (!hash) return null;
  const rec = await store.get(hash);
  return rec?.updatedAt ? rec : null;
}

export function passCookie(key, secure) {
  return `lovell_pass=${encodeURIComponent(key)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure ? '; Secure' : ''}`;
}

export function clearPassCookie(secure) {
  return `lovell_pass=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

export async function hashKey(input) {
  const key = normalizeKey(input);
  if (!key) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lovell-profile-v1:' + key));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function cleanName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

const AVATAR_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

export function cleanAvatar(value) {
  if (typeof value !== 'string' || value.length < 24 || value.length > 100000) return '';
  return AVATAR_RE.test(value) ? value : '';
}

function cleanUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return '';
  if (value.startsWith('/api/img?') || value.startsWith('https://') || value.startsWith('http://')) return value;
  return '';
}

function cleanItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind;
  const id = String(raw.id ?? '');
  if (!/^(tv|movie|al)$/.test(kind) || !/^\d{1,12}$/.test(id)) return null;
  const title = String(raw.title ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 140);
  if (!title) return null;
  const score = Number(raw.score);
  const genres = Array.isArray(raw.genres) ? raw.genres.map(g => String(g).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 32)).filter(Boolean).slice(0, 4) : [];
  return {
    kind,
    id,
    title,
    poster: cleanUrl(raw.poster),
    backdrop: cleanUrl(raw.backdrop),
    year: String(raw.year ?? '').slice(0, 8),
    score: Number.isFinite(score) ? Math.max(0, Math.min(10, Math.round(score * 10) / 10)) : null,
    isMovie: !!(raw.isMovie || kind === 'movie'),
    section: raw.section === 'media' ? 'media' : 'anime',
    genres,
  };
}

export function cleanList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const item = cleanItem(raw);
    if (!item) continue;
    const k = `${item.kind}:${item.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
    if (out.length >= 400) break;
  }
  return out;
}

function cleanStamp(raw) {
  const t = Number(raw?.t), d = Number(raw?.d), at = Number(raw?.at);
  if (!(d > 0) || !Number.isFinite(t) || !Number.isFinite(at)) return null;
  return {t: Math.max(0, Math.round(t)), d: Math.max(1, Math.round(d)), at: Math.round(at)};
}

export function cleanProgress(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [k, raw] of Object.entries(value)) {
    if (!PROG_KEY.test(k)) continue;
    const stamp = cleanStamp(raw);
    if (!stamp) continue;
    out[k] = stamp;
    if (Object.keys(out).length >= 600) break;
  }
  return out;
}

export function cleanRecent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [k, raw] of Object.entries(value)) {
    if (!ITEM_KEY.test(k) || !raw || typeof raw !== 'object') continue;
    const item = cleanItem(raw.item);
    const at = Number(raw.at);
    if (!item || !Number.isFinite(at)) continue;
    out[k] = {item, s: clampInt(raw.s, 1, 4000), e: clampInt(raw.e, 1, 4000), at: Math.round(at)};
    if (Object.keys(out).length >= 80) break;
  }
  return out;
}

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function cleanPrefs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const theme = ['dark', 'light', 'system', 'kitty'].includes(value.theme) ? value.theme : '';
  const accent = /^#[0-9A-Fa-f]{6}$/.test(String(value.accent || '')) ? String(value.accent).toLowerCase() : '';
  let wall = '';
  const raw = String(value.wall || '');
  if (raw.length > 24 && raw.length < 90000 && (/^https:\/\/[^\s]+$/i.test(raw) || /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(raw))) {
    wall = raw;
  }
  return {theme, accent, wall};
}

function present(rec) {
  return {
    name: rec.name,
    color: rec.color,
    avatar: rec.avatar || '',
    prefs: rec.prefs && typeof rec.prefs === 'object' ? rec.prefs : {},
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    list: rec.list,
    progress: rec.progress,
    recent: rec.recent,
  };
}

function blank(body = {}) {
  const now = Date.now();
  return {
    name: cleanName(body.name) || 'İzleyici',
    color: crypto.getRandomValues(new Uint8Array(1))[0] % 8,
    avatar: '',
    createdAt: now,
    updatedAt: now,
    list: cleanList(body.list),
    progress: cleanProgress(body.progress),
    recent: cleanRecent(body.recent),
  };
}

function limited(ip, bucket, max, windowMs) {
  const now = Date.now();
  const id = `${bucket}:${ip || 'yerel'}`;
  let row = limits.get(id);
  if (!row || row.reset < now) {
    if (limits.size > 4000) limits.clear();
    row = {n: 0, reset: now + windowMs};
    limits.set(id, row);
  }
  row.n += 1;
  return row.n > max;
}

export function resetProfileLimits() { limits.clear(); }

export function profileSummary(id, rec) {
  const list = Array.isArray(rec?.list) ? rec.list : [];
  return {
    id,
    name: rec?.name || 'İzleyici',
    color: rec?.color || 0,
    createdAt: rec?.createdAt || 0,
    updatedAt: rec?.updatedAt || 0,
    count: list.length,
    titles: list.slice(0, 8).map(a => a?.title).filter(Boolean),
  };
}

// Cloudflare KV. Değer düz metin JSON olarak yazılır.
export function kvProfileStore(kv) {
  const key = hash => `profile:${hash}`;
  return {
    async get(hash) {
      const raw = await kv.get(key(hash));
      if (!raw || typeof raw !== 'string') return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    put(hash, value) { return kv.put(key(hash), JSON.stringify(value)); },
    del(hash) { return kv.delete(key(hash)); },
    async list() {
      if (!kv.list) return [];
      const out = [];
      let cursor;
      do {
        const page = await kv.list({prefix: 'profile:', cursor, limit: 200});
        for (const item of page.keys || []) {
          const hash = String(item.name || '').slice('profile:'.length);
          const rec = await this.get(hash);
          if (rec) out.push(profileSummary(hash, rec));
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      return out.sort((a, b) => b.createdAt - a.createdAt);
    },
    async listRecords() {
      if (!kv.list) return [];
      const out = [];
      let cursor;
      do {
        const page = await kv.list({prefix: 'profile:', cursor, limit: 200});
        for (const item of page.keys || []) {
          const hash = String(item.name || '').slice('profile:'.length);
          const rec = await this.get(hash);
          if (rec?.updatedAt) out.push({id: hash, rec});
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      return out;
    },
  };
}

// store: { get(hash), put(hash, record), del(hash) }
export async function profileRequest({method, key, body, store, ip, admin = false}) {
  if (method === 'POST') {
    if (!admin) return {status: 404, data: {error: 'Bilinmeyen uç nokta'}};
    if (limited(ip, 'new', 30, 10 * 60 * 1000)) return {status: 429, data: {error: 'Çok fazla profil denemesi. Biraz sonra tekrar dene.'}};
    const rec = blank(body);
    const raw = generateKey();
    const hash = await hashKey(raw);
    await store.put(hash, rec);
    return {status: 201, data: {key: raw, profile: present(rec)}};
  }
  if (limited(ip, 'use', 300, 60 * 1000)) return {status: 429, data: {error: 'Çok fazla istek. Biraz sonra tekrar dene.'}};
  const hash = await hashKey(key);
  if (!hash) return {status: 401, data: {error: 'Profil anahtarı gerekli'}};
  const rec = await store.get(hash);
  if (!rec?.updatedAt) return {status: 401, data: {error: 'Bu anahtar bir profile ait değil'}};
  if (method === 'GET') return {status: 200, data: present(rec)};
  if (method === 'DELETE') {
    if (!admin) return {status: 404, data: {error: 'Bilinmeyen uç nokta'}};
    await store.del(hash);
    return {status: 200, data: {ok: true}};
  }
  if (method === 'PUT') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {status: 400, data: {error: 'Geçersiz istek'}};
    if (body.base !== rec.updatedAt) return {status: 409, data: {error: 'Profil başka bir cihazda güncellendi', profile: present(rec)}};
    const next = {
      ...rec,
      name: typeof body.name === 'string' ? (cleanName(body.name) || rec.name) : rec.name,
      updatedAt: Date.now(),
    };
    if (body.avatar === '' || body.avatar === null) next.avatar = '';
    else if (typeof body.avatar === 'string') {
      const avatar = cleanAvatar(body.avatar);
      if (avatar) next.avatar = avatar;
    }
    if (body.color != null) {
      const color = Number(body.color);
      if (Number.isInteger(color) && color >= 0 && color <= 7) next.color = color;
    }
    if (Array.isArray(body.list)) next.list = cleanList(body.list);
    if (body.progress && typeof body.progress === 'object') next.progress = cleanProgress(body.progress);
    if (body.recent && typeof body.recent === 'object') next.recent = cleanRecent(body.recent);
    if (body.prefs && typeof body.prefs === 'object') next.prefs = cleanPrefs(body.prefs);
    await store.put(hash, next);
    return {status: 200, data: present(next)};
  }
  return {status: 405, data: {error: 'Desteklenmeyen istek'}};
}
