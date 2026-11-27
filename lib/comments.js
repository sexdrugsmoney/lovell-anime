// Başlık yorumları: anahtar sahipleri film / dizi / anime sayfasına yorum yazar.
// Kayıtlar "comments:<tür>:<id>" altında, profil kayıtlarından ayrı tutulur;
// böylece yönetici profil listesine ve hız sıralamasına karışmaz.

export const COMMENT_MAX = 500;
export const COMMENT_LIST_LIMIT = 200;
export const COMMENT_COOLDOWN = 15000;

const limits = new Map();
export function resetCommentLimits() { limits.clear(); }

// Profil başına 10 dakikada en fazla 20 yorum.
function limited(hash) {
  const now = Date.now();
  let row = limits.get(hash);
  if (!row || row.reset < now) {
    if (limits.size > 4000) limits.clear();
    row = {n: 0, reset: now + 10 * 60 * 1000};
    limits.set(hash, row);
  }
  row.n += 1;
  return row.n > 20;
}

export function commentTarget(kind, id) {
  const k = String(kind ?? ''), i = String(id ?? '');
  return /^[a-z]{2,8}$/.test(k) && /^[A-Za-z0-9_-]{1,32}$/.test(i) ? `${k}:${i}` : '';
}

// Kontrol ve yön değiştirme karakterleri atılır; satır sonları korunur ama üçten fazlası birleştirilir.
export function cleanText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const listOf = rec => (Array.isArray(rec?.items) ? rec.items.filter(c => c && c.id && typeof c.text === 'string') : []);

// İstemciye yazarın anahtar özeti hiç gitmez; yalnızca "senin mi" bilgisi gider.
function publicItem(c, hash) {
  return {
    id: c.id,
    name: c.name || 'İzleyici',
    color: Number.isInteger(c.color) ? c.color : 0,
    text: c.text,
    spoiler: c.spoiler === true,
    at: c.at,
    you: !!hash && c.by === hash,
  };
}

const view = (items, hash) => ({items: items.map(c => publicItem(c, hash)), total: items.length});
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

export async function listComments({store, hash, kind, id}) {
  const target = commentTarget(kind, id);
  if (!target) return {status: 400, data: {error: 'Geçersiz başlık'}};
  return {status: 200, data: view(listOf(await store.get(target)), hash)};
}

export async function postComment({store, hash, rec, body}) {
  if (!hash || !rec?.updatedAt) return {status: 401, data: {error: 'Anahtar gerekli'}};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {status: 400, data: {error: 'Geçersiz istek'}};
  const target = commentTarget(body.kind, body.id);
  if (!target) return {status: 400, data: {error: 'Geçersiz başlık'}};
  const text = cleanText(body.text);
  if (!text) return {status: 400, data: {error: 'Yorum boş olamaz'}};
  if (text.length > COMMENT_MAX) return {status: 400, data: {error: `Yorum en fazla ${COMMENT_MAX} karakter olabilir`}};
  if (limited(hash)) return {status: 429, data: {error: 'Çok fazla yorum yazdın. Biraz sonra tekrar dene.'}};
  let out;
  await store.update(target, current => {
    const items = listOf(current);
    const now = Date.now();
    const last = items.find(c => c.by === hash);
    if (last && now - last.at < COMMENT_COOLDOWN) {
      out = {status: 429, data: {error: 'Biraz bekleyip tekrar yaz.'}};
      return null;
    }
    if (items.some(c => c.by === hash && c.text === text)) {
      out = {status: 409, data: {error: 'Bu yorumu zaten yazdın.'}};
      return null;
    }
    const item = {
      id: newId(),
      by: hash,
      name: String(rec.name || '').trim().slice(0, 40) || 'İzleyici',
      color: Number.isInteger(rec.color) ? rec.color : 0,
      text,
      spoiler: body.spoiler === true,
      at: now,
    };
    const next = [item, ...items].slice(0, COMMENT_LIST_LIMIT);
    out = {status: 201, data: {ok: true, item: publicItem(item, hash), ...view(next, hash)}};
    return {items: next};
  });
  return out;
}

export async function deleteComment({store, hash, kind, id, cid}) {
  if (!hash) return {status: 401, data: {error: 'Anahtar gerekli'}};
  const target = commentTarget(kind, id);
  if (!target || !/^[a-f0-9]{8,32}$/.test(String(cid ?? ''))) return {status: 400, data: {error: 'Geçersiz istek'}};
  let out;
  await store.update(target, current => {
    const items = listOf(current);
    const found = items.find(c => c.id === cid);
    if (!found) { out = {status: 404, data: {error: 'Yorum bulunamadı'}}; return null; }
    if (found.by !== hash) { out = {status: 403, data: {error: 'Yalnızca kendi yorumunu silebilirsin'}}; return null; }
    const next = items.filter(c => c.id !== cid);
    out = {status: 200, data: {ok: true, ...view(next, hash)}};
    return {items: next};
  });
  return out;
}

// Worker deposu. KV'de karşılaştır-yaz yok: aynı saniyede gelen iki yorumdan biri
// kaybolabilir. Bu sitenin trafiğinde kabul edilebilir; büyürse Durable Object gerekir.
export function kvCommentStore(kv) {
  const key = target => `comments:${target}`;
  const get = async target => {
    const raw = await kv.get(key(target));
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
  };
  return {
    get,
    async update(target, fn) {
      const next = await fn(await get(target));
      if (next) await kv.put(key(target), JSON.stringify(next));
      return next;
    },
  };
}

// Testler ve geçici kullanım için bellek deposu.
export function memoryCommentStore() {
  const data = new Map();
  let chain = Promise.resolve();
  return {
    async get(target) { return data.get(target) || null; },
    update(target, fn) {
      const job = chain.then(async () => {
        const next = await fn(data.get(target) || null);
        if (next) data.set(target, next);
        return next;
      });
      chain = job.then(() => {}, () => {});
      return job;
    },
  };
}
