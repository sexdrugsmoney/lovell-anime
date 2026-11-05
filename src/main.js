import {externalWatchSites} from './data/external-watch-sites.js';
// LOVELL istemci uygulaması
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
function normTitle(value) {
  return String(value || '').toLocaleLowerCase('en').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|an|season|sezon|part|cour|tv|ova|ona|movie|film)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function looseTitle(value) { return String(value || '').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ''); }
function titleHit(query, candidate) {
  const a = normTitle(query), b = normTitle(candidate);
  if (a.length >= 4 && b.length >= 4) {
    if (a === b) return true;
    const short = a.length <= b.length ? a : b, long = a.length <= b.length ? b : a;
    if (short.length >= 8 && long.startsWith(`${short} `)) return true;
  }
  const c = looseTitle(query), d = looseTitle(candidate);
  if (c.length < 2 || d.length < 2) return false;
  if (c === d) return true;
  const short = c.length <= d.length ? c : d, long = c.length <= d.length ? d : c;
  return short.length >= 6 && long.startsWith(short);
}
function pickHit(query, items, titleOf, altsOf) {
  for (const item of items || []) {
    const names = [titleOf(item), ...(altsOf(item) || [])];
    if (names.some(name => titleHit(query, name))) return item;
  }
  return null;
}
const main = $('#main');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------- Kayıt ----------------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('lovell.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lovell.' + k, JSON.stringify(v)); } catch {} },
};
const keyOf = a => `${a.kind}:${a.id}`;
const slim = a => ({kind: a.kind, id: a.id, title: a.title, poster: a.poster, backdrop: a.backdrop, year: a.year, score: a.score, isMovie: a.isMovie || a.kind === 'movie', section: secOf(a), genres: (a.genres || []).slice(0, 4)});
// Eski kayıtlarda bölüm bilgisi yok: o zamanlar site yalnızca anime içeriyordu.
const secOf = a => a?.section === 'media' ? 'media' : 'anime';
let myList = store.get('list', []);
let progress = store.get('progress', {});   // "kind:id:s:e" -> {t, d, at}
let recent = store.get('recent', {});       // "kind:id" -> {item, s, e, at}
let profileKey = store.get('profileKey', '') || '';
let profile = store.get('profileMeta', null);
let syncBase = store.get('syncBase', 0);
let profileReady = !profileKey;
let syncTimer = 0;
let syncing = false;
let syncAgain = false;

function persistUser() {
  store.set('list', myList);
  store.set('progress', progress);
  store.set('recent', recent);
}
function metaOf(p) {
  return p ? {name: p.name, color: p.color, avatar: p.avatar || '', prefs: p.prefs && typeof p.prefs === 'object' ? p.prefs : {}, createdAt: p.createdAt, updatedAt: p.updatedAt} : null;
}
function avatarMarkup(p, large) {
  const letter = (p?.name || '?').slice(0, 1).toLocaleUpperCase('tr');
  const c = Number.isInteger(p?.color) ? p.color : (Number(p?.color) || 0);
  const img = p?.avatar ? `<img src="${esc(p.avatar)}" alt="">` : esc(letter);
  return `<span class="avatar${large ? ' avatar-lg' : ''}" data-c="${c}">${img}</span>`;
}
function mergeLists(primary, extra) {
  const seen = new Set();
  const out = [];
  for (const a of [...(primary || []), ...(extra || [])]) {
    if (!a) continue;
    const k = keyOf(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out.slice(0, 400);
}
function mergeProgress(local, remote) {
  const out = {...(remote || {}), ...(local || {})};
  for (const [k, stamp] of Object.entries(remote || {})) if ((stamp?.at || 0) > (out[k]?.at || 0)) out[k] = stamp;
  return out;
}
function mergeRecent(local, remote) {
  const out = {...(remote || {}), ...(local || {})};
  for (const [k, row] of Object.entries(remote || {})) if ((row?.at || 0) > (out[k]?.at || 0)) out[k] = row;
  return out;
}
function paintProfile() {
  const chip = $('#profile-chip');
  if (!chip) return;
  const name = profile?.name || '';
  const on = !!profileKey;
  chip.classList.toggle('on', on);
  chip.title = on ? `${name} profili` : 'Profil anahtarı';
  chip.setAttribute('aria-label', on ? `${name} profili` : 'Profil');
  chip.innerHTML = `${avatarMarkup(profile)}<span class="profile-name">${esc(on ? name : 'Profil')}</span>`;
}
async function apiSend(path, method, body, key = profileKey) {
  const headers = {'accept': 'application/json'};
  if (body != null) headers['content-type'] = 'application/json';
  if (key) headers['x-lovell-key'] = key;
  const res = await fetch(path, {method, headers, body: body == null ? undefined : JSON.stringify(body)});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'İstek başarısız');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
function applyRemote(remote) {
  myList = Array.isArray(remote.list) ? remote.list : [];
  progress = remote.progress && typeof remote.progress === 'object' ? remote.progress : {};
  recent = remote.recent && typeof remote.recent === 'object' ? remote.recent : {};
  persistUser();
  profile = metaOf(remote);
  syncBase = remote.updatedAt || 0;
  store.set('profileMeta', profile);
  store.set('syncBase', syncBase);
  store.set('syncDirty', false);
  applyPrefs(profile?.prefs);
  paintProfile();
  updateCount();
  if (typeof syncBottomNav === 'function') syncBottomNav();
}
async function pushOnce(attempt = 0) {
  const body = {base: syncBase, name: profile?.name, color: profile?.color, avatar: profile?.avatar ?? '', prefs: profile?.prefs || skinPrefs(), list: myList, progress, recent};
  try {
    const saved = await apiSend('/api/profile', 'PUT', body);
    syncBase = saved.updatedAt;
    profile = metaOf(saved);
    store.set('syncBase', syncBase);
    store.set('profileMeta', profile);
    store.set('syncDirty', false);
    paintProfile();
  } catch (e) {
    if (e.status === 409 && e.data?.profile && attempt < 3) {
      const remote = e.data.profile;
      myList = mergeLists(myList, remote.list);
      progress = mergeProgress(progress, remote.progress);
      recent = mergeRecent(recent, remote.recent);
      persistUser();
      syncBase = remote.updatedAt;
      const keep = {name: profile?.name, avatar: profile?.avatar, color: profile?.color};
      profile = metaOf(remote);
      if (keep.name) profile.name = keep.name;
      if (typeof keep.avatar === 'string') profile.avatar = keep.avatar;
      if (Number.isInteger(keep.color) && keep.color >= 0 && keep.color <= 7) profile.color = keep.color;
      store.set('profileMeta', profile);
      store.set('syncDirty', true);
      return pushOnce(attempt + 1);
    }
    throw e;
  }
}
async function runSync() {
  if (!profileKey || !profileReady) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  try {
    do {
      syncAgain = false;
      await pushOnce();
    } while (syncAgain);
  } catch {}
  finally { syncing = false; }
}
function scheduleSync() {
  if (!profileKey) return;
  store.set('syncDirty', true);
  if (!profileReady) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, 450);
}
async function loadProfile() {
  paintProfile();
  if (!profileKey) { profileReady = true; return; }
  try {
    const remote = await apiSend('/api/profile', 'GET');
    if (store.get('syncDirty', false)) {
      myList = mergeLists(myList, remote.list);
      progress = mergeProgress(progress, remote.progress);
      recent = mergeRecent(recent, remote.recent);
      persistUser();
      syncBase = remote.updatedAt;
      profile = metaOf(remote);
      store.set('profileMeta', profile);
      profileReady = true;
      await runSync();
      updateCount();
    } else applyRemote(remote);
  } catch (e) {
    if (e.status === 401) {
      profileKey = '';
      profile = null;
      store.set('profileKey', '');
      store.set('profileMeta', null);
      paintProfile();
      toast('Kayıtlı profil anahtarı geçersiz', 'error');
    }
  } finally { profileReady = true; }
}
function validProfileKey(raw) {
  const compact = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{20}$/.test(compact) ? compact.match(/.{4}/g).join('-') : '';
}
let CLOUD = false;                          // Cloudflare Workers sürümü: yerel dosya yok
let SUBS_ON = false;                        // sunucuda Türkçe altyazı servisi (Wyzie) açık mı
let library = new Set();                    // "kind:id" anahtarları (bilgisayardaki dosyalar)
let libraryEpisodes = new Map();            // "kind:id" -> Set("s:e")

function inList(a) { return myList.some(x => keyOf(x) === keyOf(a)); }
function toggleList(a, {quiet = false} = {}) {
  const had = inList(a);
  const at = myList.findIndex(x => keyOf(x) === keyOf(a));
  myList = had ? myList.filter(x => keyOf(x) !== keyOf(a)) : [slim(a), ...myList];
  store.set('list', myList);
  scheduleSync();
  updateCount();
  syncBottomNav();
  syncListButtons(a);
  if (!quiet) toast(had ? 'Listeden çıkarıldı' : 'İzleyeceklerime eklendi', had ? 'info' : 'success', had ? {label: 'Geri al', fn: () => { if (!inList(a)) { myList.splice(Math.max(0, at), 0, slim(a)); store.set('list', myList); scheduleSync(); updateCount(); syncListButtons(a); if (/^#\/listem/.test(location.hash)) route(); } }} : null);
  return !had;
}
// Sayfadaki tüm "listeye ekle" düğmelerini (kartlar, vitrin, detay penceresi) aynı anda günceller.
function syncListButtons(a) {
  const on = inList(a), k = keyOf(a);
  $$(`[data-list="${k}"]`).forEach(b => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? 'Listeden çıkar' : 'Listeye ekle'); if (b.dataset.label) b.innerHTML = on ? CHECK + 'Listende' : PLUS + b.dataset.label; else b.innerHTML = on ? CHECK : PLUS; });
}
function updateCount() {
  const c = $('#list-count');
  const n = myList.filter(x => secOf(x) === section).length;
  c.textContent = n;
  c.hidden = !n;
}

// ---------------- Bölüm yönetimi (Anime | Film & Dizi) ----------------
// Her bölümün kendi teması, menüsü, rafları ve türleri var.
const SECTIONS = {
  anime: {
    label: 'Anime', search: 'Anime ara', placeholder: 'Anime adı yaz (Türkçe, İngilizce ya da Japonca)',
    nav: {home: 'Keşfet', kesfet: 'Seriler', filmler: 'Anime filmleri'},
    tv: 'Anime serileri', movie: 'Anime filmleri', color: '#0d0b16',
    empty: 'Bir animenin sayfasında “Listeye ekle”ye bastığında burada görünür.',
  },
  media: {
    label: 'Film & Dizi', search: 'Film, dizi ara', placeholder: 'Film ya da dizi adı yaz',
    nav: {home: 'Ana sayfa', kesfet: 'Diziler', filmler: 'Filmler'},
    tv: 'Diziler', movie: 'Filmler', color: '#0b0b0b',
    empty: 'Bir film ya da dizinin sayfasında “Listeme ekle”ye bastığında burada görünür.',
  },
};
let section = (() => { const t = store.get('tab', 'anime'); return t === 'media' || t === 'movies' ? 'media' : 'anime'; })();
const S = () => SECTIONS[section];

function setSection(next) {
  section = next === 'media' ? 'media' : 'anime';
  store.set('tab', section);
  const root = document.documentElement;
  root.dataset.section = section;
  syncTabs(section);
  Object.entries(S().nav).forEach(([k, t]) => { const a = $(`[data-nav="${k}"]`); if (a) a.textContent = t; });
  const sl = $('#search-label');
  if (sl) sl.textContent = S().search;
  const si = $('#search-input');
  if (si) si.placeholder = S().placeholder;
  $('#search-dialog')?.setAttribute('aria-label', S().search);
  $('meta[name="theme-color"]')?.setAttribute('content', S().color);
  updateCount();
  if (typeof syncBottomNav === 'function') syncBottomNav();
}
const withSection = path => path + (path.includes('?') ? '&' : '?') + 'section=' + section;

// ---------------- Animasyon yardımcıları ----------------
const TAB_INDEX = {anime: 0, media: 1, livetv: 2};
// Üç bölümlü kayan düğme: seçili sekmeyi ve kaydırıcının yerini ayarlar.
function syncTabs(active) {
  $$('.tab-btn').forEach(b => {
    const on = b.dataset.tab === active;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  $('.tab-bar')?.style.setProperty('--i', TAB_INDEX[active] ?? 0);
}
// Bölüm değişirken tıklanan noktadan yayılan dairesel geçiş (View Transitions API destekleyen tarayıcılarda).
async function withTransition(ev, fn) {
  if (reduceMotion || !document.startViewTransition) return fn();
  const r = ev?.currentTarget?.getBoundingClientRect?.();
  const x = ev?.clientX || (r ? r.left + r.width / 2 : innerWidth / 2), y = ev?.clientY || (r ? r.top + r.height / 2 : 0);
  const root = document.documentElement;
  root.style.setProperty('--vt-x', x + 'px');
  root.style.setProperty('--vt-y', y + 'px');
  root.style.setProperty('--vt-r', Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 'px');
  const t = document.startViewTransition(async () => {
    await fn();
    // Yeni sayfa ilk içeriğini çizene kadar kısa bir süre bekle (en fazla 450 ms).
    await new Promise(res => { const until = Date.now() + 450; const tick = () => (main.querySelector('.loading, .hero-skeleton') && Date.now() < until) ? setTimeout(tick, 40) : res(); tick(); });
  });
  try { await t.finished; } catch {}
}
// Her sayfa geçişinde içeriğin hafifçe yukarı süzülerek gelmesi.
function pageEnter() {
  if (reduceMotion || !main.animate) return;
  main.animate([{opacity: 0, transform: 'translateY(10px)'}, {opacity: 1, transform: 'none'}], {duration: 320, easing: 'cubic-bezier(.2,.7,.2,1)'});
}
// Afiş eğimi kapatıldı: sürekli pointermove kart ızgarasını kilitliyordu.
// Düğmelerde tıklama dalgası.
document.addEventListener('pointerdown', e => {
  const b = e.target.closest?.('.btn, .tab-btn, .chip, .cat-btn, .kind-switch a');
  if (!b || reduceMotion) return;
  const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2;
  const w = document.createElement('span');
  w.className = 'ripple';
  w.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.append(w);
  w.addEventListener('animationend', () => w.remove(), {once: true});
});
function saveProgress(a, s, e, t, d) {
  if (!(t > 0) || !(d > 0)) return;
  progress[`${keyOf(a)}:${s}:${e}`] = {t: Math.round(t), d: Math.round(d), at: Date.now()};
  const keys = Object.keys(progress);
  if (keys.length > 600) keys.sort((x, y) => progress[x].at - progress[y].at).slice(0, 100).forEach(k => delete progress[k]);
  recent[keyOf(a)] = {item: slim(a), s, e, at: Date.now()};
  store.set('progress', progress);
  store.set('recent', recent);
  scheduleSync();
}

// ---------------- Yardımcılar ----------------
let toastTimer;
function toast(msg, type = 'info', action = null) {
  const t = $('#toast');
  t.innerHTML = `<span class="toast-ico" aria-hidden="true">${type === 'success' ? CHECK : type === 'error' ? '<svg class="ln" viewBox="0 0 16 16"><path d="M8 4v5M8 11.5v.5"/></svg>' : '<svg class="ln" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M8 7v4M8 5v.2"/></svg>'}</span><span>${esc(msg)}</span>${action ? `<button type="button" class="toast-act">${esc(action.label)}</button>` : ''}`;
  t.dataset.type = type;
  t.classList.toggle('has-act', !!action);
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  if (action) $('.toast-act', t).onclick = () => { action.fn(); t.classList.remove('show'); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2600);
}
const apiCache = new Map(); // path -> {data, expires}
const CACHE_TTL = {
  '/api/home': 300,
  '/api/genres': 86400,
  '/api/browse': 300,
  '/api/search': 120,
  '/api/title/': 600,
  '/api/episodes/': 600,
};
const apiInflight = new Map(); // aynı isteği iki kez atmamak için (ön yükleme + tıklama)
// Üstte ince yükleme çubuğu: istek 150 ms'den uzun sürerse görünür.
const busy = {n: 0, t: 0};
function busyStart(quiet) {
  if (quiet) return;
  if (++busy.n === 1) { clearTimeout(busy.t); busy.t = setTimeout(() => document.documentElement.classList.add('loading-bar'), 150); }
}
function busyEnd(quiet) {
  if (quiet) return;
  if (--busy.n <= 0) { busy.n = 0; clearTimeout(busy.t); const root = document.documentElement; if (root.classList.contains('loading-bar')) { root.classList.add('loading-done'); setTimeout(() => root.classList.remove('loading-bar', 'loading-done'), 380); } }
}
async function api(path, timeout = 20000, {quiet = false} = {}) {
  const ttl = Object.entries(CACHE_TTL).find(([k]) => path.startsWith(k))?.[1];
  if (ttl) {
    const hit = apiCache.get(path);
    if (hit && hit.expires > Date.now()) return hit.data;
    if (apiInflight.has(path)) return apiInflight.get(path);
  }
  const run = (async () => {
    busyStart(quiet);
    try { return await apiFetch(path, timeout, ttl); } finally { busyEnd(quiet); if (ttl) apiInflight.delete(path); }
  })();
  if (ttl) apiInflight.set(path, run);
  return run;
}
// Arka planda sessizce önceden yükle (hata gösterilmez).
const prefetch = path => api(path, 20000, {quiet: true}).catch(() => {});
async function apiFetch(path, timeout, ttl) {
  const r = await fetch(path, {signal: AbortSignal.timeout(timeout)});
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { profileKey = ''; store.set('profileKey', ''); document.documentElement.dataset.locked = '1'; }
  if (!r.ok) throw Object.assign(Error(data.error || `HTTP ${r.status}`), {data, status: r.status});
  if (ttl) {
    if (apiCache.size >= 200) {
      // LRU basit: en eski girişi sil
      apiCache.delete(apiCache.keys().next().value);
    }
    apiCache.set(path, {data, expires: Date.now() + ttl * 1000});
  }
  return data;
}
const score = n => n ? n.toLocaleString('tr-TR', {minimumFractionDigits: 1, maximumFractionDigits: 1}) : '';
const fmtTime = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fmtDate = d => { try { return new Date(d).toLocaleDateString('tr-TR', {day: 'numeric', month: 'long', year: 'numeric'}); } catch { return ''; } };
const watchHref = (a, s, e) => `#/izle/${a.kind}/${a.id}${s ? `?s=${s}&e=${e}` : ''}`;
const isMovie = a => a.kind === 'movie' || a.isMovie;
const STAR = '<svg class="star" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .8 7.6 4.2l3.7.4-2.8 2.5.8 3.7L6 8.9 2.7 10.8l.8-3.7L.7 4.6l3.7-.4z"/></svg>';
const PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z"/></svg>';
const PLUS = '<svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
const CHECK = '<svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.5 3.2 3L13 4.5"/></svg>';
const SHUFFLE = '<svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.5h2.5c3 0 4 7 7 7H14M2 11.5h2.5c1.3 0 2.2-1.3 3-2.8M10 5.3c.4-.5 1-.8 1.5-.8H14M12 2.5l2 2-2 2M12 9.5l2 2-2 2"/></svg>';
const INFO = '<svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 7.2V11M8 4.8v.2"/></svg>';
const SHARE = '<svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10V2.5M5 5.5l3-3 3 3M3.5 8.5v4.5h9V8.5"/></svg>';
const EYE = '<svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>';
const CAL = '<svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg>';
// Boş durum ikonları (24'lük ızgara, çizgi)
const EMPTY_ICONS = {
  list: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5M8.5 11h5"/>',
  lost: '<circle cx="12" cy="12" r="8.5"/><path d="m14.8 9.2-1.6 4-4 1.6 1.6-4z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  tv: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="m9 2.5 3 3 3-3M8 21h8"/>',
};
function emptyState({icon = 'lost', title, text = '', actions = '', cls = ''}) {
  return `<div class="state state-rich ${cls}"><span class="state-ico" aria-hidden="true"><svg viewBox="0 0 24 24">${EMPTY_ICONS[icon] || EMPTY_ICONS.lost}</svg></span><h2>${esc(title)}</h2>${text ? `<p>${text}</p>` : ''}${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}
// Yayın durumu (TMDB ve AniList değerleri)
const STATUS_TR = {'Returning Series': ['Devam ediyor', 'on'], 'In Production': ['Yapımda', 'soon'], Planned: ['Planlandı', 'soon'], 'Post Production': ['Yapım sonrası', 'soon'], Ended: ['Tamamlandı', ''], Canceled: ['İptal edildi', 'off'], Released: ['Yayında', ''], Rumored: ['Söylenti', 'soon'], RELEASING: ['Devam ediyor', 'on'], FINISHED: ['Tamamlandı', ''], NOT_YET_RELEASED: ['Yakında', 'soon'], CANCELLED: ['İptal edildi', 'off'], HIATUS: ['Ara verdi', 'off']};
const daysUntil = d => Math.round((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 864e5);
const whenLabel = d => { const n = daysUntil(d); return n <= 0 ? 'bugün' : n === 1 ? 'yarın' : n < 7 ? `${n} gün sonra` : fmtDate(d); };
const ago = t => { const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'az önce'; if (m < 60) return `${m} dk önce`; const h = Math.round(m / 60); if (h < 24) return `${h} saat önce`; const d = Math.round(h / 24); return d < 7 ? `${d} gün önce` : fmtDate(t); };
const initials = n => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toLocaleUpperCase('tr');

function imgFallback(root = document) {
  $$('img[data-fb]', root).forEach(img => {
    if (img.dataset.bound) return;
    img.dataset.bound = 1;
    img.addEventListener('error', () => { img.closest('.card-img, .wide-img, .land-img, .hero-bg, .hero-poster, .thumb, .person-img, .stage-skel')?.classList.add('noimg'); img.remove(); }, {once: true});
  });
}

// ---------------- Bileşenler ----------------
const kindLabel = a => isMovie(a) ? 'Film' : secOf(a) === 'anime' ? 'Seri' : 'Dizi';
// Dikey afiş kartı (anime bölümünün varsayılanı)
const ITEMS = new Map(); // "kind:id" -> öğe (hızlı eylemler ve detay penceresi için)
const remember = a => (a && ITEMS.set(keyOf(a), a), a);
const quickActs = (a, cls = '') => `<span class="qa ${cls}"><span class="qa-btn ${inList(a) ? 'on' : ''}" role="button" tabindex="-1" data-list="${keyOf(a)}" aria-pressed="${inList(a)}" aria-label="${inList(a) ? 'Listeden çıkar' : 'Listeye ekle'}">${inList(a) ? CHECK : PLUS}</span><span class="qa-btn" role="button" tabindex="-1" data-info="${keyOf(a)}" aria-label="Ayrıntılar">${INFO}</span></span>`;
function card(a) {
  remember(a);
  return `<a class="card" href="${watchHref(a)}">
    <span class="card-img">${a.poster ? `<img src="${esc(a.poster)}" alt="" loading="lazy" decoding="async" data-fb>` : ''}<span class="card-ph">${esc(a.title)}</span>${a.score ? `<span class="card-score">${STAR}${score(a.score)}</span>` : ''}<span class="card-sheet"><b>${esc(a.title)}</b><small>${[a.year, kindLabel(a)].filter(Boolean).map(esc).join(' · ')}</small></span><span class="card-hover">${PLAY}</span>${quickActs(a)}</span>
    <span class="card-title">${esc(a.title)}</span>
    <span class="card-meta"><span>${esc(a.year || '')}</span><span class="kind">${kindLabel(a)}</span></span>
  </a>`;
}
// Yatay 16:9 kart (Film & Dizi bölümünün varsayılanı) — başlık görselin üstünde
function landCard(a) {
  remember(a);
  const img = a.backdrop || a.poster;
  return `<a class="land" href="${watchHref(a)}">
    <span class="land-img">${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async" data-fb class="${a.backdrop ? '' : 'is-poster'}">` : ''}<span class="land-ph">${esc(a.title)}</span>
      <span class="land-shade"></span>
      <span class="land-body"><span class="land-title">${esc(a.title)}</span>
        <span class="land-meta">${a.score ? `<span class="score">${STAR}${score(a.score)}</span>` : ''}<span>${esc(a.year || '')}</span><span class="kind">${kindLabel(a)}</span></span></span>
      <span class="land-play">${PLAY}</span>${quickActs(a, 'qa-land')}
    </span>
  </a>`;
}
// İlk 10 kartı: büyük numara + afiş
function rankCard(a, i) {
  remember(a);
  return `<a class="rank" href="${watchHref(a)}" aria-label="${i + 1}. ${esc(a.title)}">
    <span class="rank-n" aria-hidden="true">${i + 1}</span>
    <span class="card-img">${a.poster ? `<img src="${esc(a.poster)}" alt="" loading="lazy" decoding="async" data-fb>` : ''}<span class="card-ph">${esc(a.title)}</span>${quickActs(a)}</span>
  </a>`;
}
const gridCard = a => section === 'media' ? landCard(a) : card(a);
function wideCard(r, opts) {
  const a = r.item, p = progress[`${keyOf(a)}:${r.s}:${r.e}`];
  const pct = p ? Math.min(100, p.t / p.d * 100) : 0;
  const done = pct > 90;
  remember(a);
  return `<a class="wide" href="${watchHref(a, r.s, r.e)}">
    <span class="wide-img">${a.backdrop || a.poster ? `<img src="${esc(a.backdrop || a.poster)}" alt="" loading="lazy" decoding="async" data-fb>` : ''}<span class="wide-play">${PLAY}</span>${done ? '<span class="wide-done">İzlendi</span>' : ''}<span class="qa-btn qa-forget" role="button" tabindex="-1" data-forget="${keyOf(a)}" aria-label="Bu satırdan kaldır"><svg class="ln" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></span></span>
    <span class="bar"><i style="width:${pct}%"></i></span>
    <span class="card-title">${esc(a.title)}</span>
    <span class="card-meta">${isMovie(a) ? 'Film' : `${r.s}. sezon, ${r.e}. bölüm`}${opts?.ago ? ` <span>${ago(r.at)}</span>` : p && !done ? ` <span>${fmtTime(p.d - p.t)} kaldı</span>` : ''}</span>
  </a>`;
}
// Oyuncular / karakterler satırı
function castShelf(a) {
  if (!a.cast?.length) return '';
  return `<section class="shelf shelf-cast">
    <div class="shelf-head"><h2>${secOf(a) === 'anime' ? 'Karakterler ve seslendirenler' : 'Oyuncular'}</h2><div class="shelf-tools"><button class="arrow" data-dir="-1" aria-label="Geri kaydır"><svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5"/></svg></button><button class="arrow" data-dir="1" aria-label="İleri kaydır"><svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5"/></svg></button></div></div>
    <div class="row row-cast">${a.cast.map((c, i) => `<div class="person" style="--d:${Math.min(i, 10) * 40}ms"><span class="person-img">${c.photo ? `<img src="${esc(c.photo)}" alt="" loading="lazy" decoding="async" data-fb>` : ''}<span class="person-ph">${esc(initials(c.name))}</span></span><strong>${esc(c.name)}</strong>${c.role ? `<small>${esc(c.role)}</small>` : ''}</div>`).join('')}</div>
  </section>`;
}
function shelf({title, items, more, wide, layout}) {
  if (!items?.length) return '';
  layout = wide ? 'wide' : layout || (section === 'media' ? 'land' : 'poster');
  const render = {wide: wideCard, land: landCard, rank: rankCard, poster: card}[layout] || card;
  return `<section class="shelf shelf-${layout}">
    <div class="shelf-head"><h2>${layout === 'rank' ? '<span class="top10" aria-hidden="true">TOP<b>10</b></span>' : ''}${esc(title)}</h2><div class="shelf-tools">${more ? `<a class="more" href="${more}">Tümünü gör<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg></a>` : ''}<button class="arrow" data-dir="-1" aria-label="Geri kaydır"><svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5"/></svg></button><button class="arrow" data-dir="1" aria-label="İleri kaydır"><svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5"/></svg></button></div></div>
    <div class="row row-${layout}">${items.map(render).join('')}</div>
  </section>`;
}
function bindShelves(root = main) {
  $$('.shelf', root).forEach(s => {
    const row = $('.row', s);
    const update = () => {
      const [prev, next] = $$('.arrow', s);
      prev.disabled = row.scrollLeft < 8;
      next.disabled = row.scrollLeft + row.clientWidth > row.scrollWidth - 8;
    };
    $$('.arrow', s).forEach(b => b.onclick = () => row.scrollBy({left: Number(b.dataset.dir) * row.clientWidth * 0.85, behavior: reduceMotion ? 'auto' : 'smooth'}));
    row.addEventListener('scroll', update, {passive: true});
    requestAnimationFrame(update);
  });
}
function loading(text = 'Yükleniyor') { return `<div class="loading" role="status"><span class="spin"></span>${esc(text)}</div>`; }
function errorBox(e, retry = true) {
  const offline = !navigator.onLine;
  return emptyState({icon: 'lost', title: offline ? 'İnternet bağlantısı yok' : 'Veriler yüklenemedi', text: offline ? 'Bağlantın geri geldiğinde sayfa kendiliğinden yenilenebilir; ya da aşağıdan tekrar dene.' : `${esc(e.message)}. İnternet bağlantını kontrol edip tekrar dene.${CLOUD ? '' : ' Sorun sürerse terminalde <code>npm run doctor</code> komutunu çalıştır.'}`, actions: retry ? '<button class="btn btn-play" type="button" data-retry>Tekrar dene</button>' : ''});
}
// "Tekrar dene" düğmeleri sayfayı baştan yüklemeden yalnızca o görünümü yeniden açar.
document.addEventListener('click', e => { if (e.target.closest?.('[data-retry]')) { apiCache.clear(); route(); } });

// ---------------- Skeleton helpers ----------------
function skeletonGrid(count = 12) {
  return `<div class="grid">${Array.from({length: count}, () => `<div class="card card-skeleton"><span class="card-img skeleton" style="aspect-ratio:2/3"></span><span class="skeleton" style="height:14px;margin-top:8px;border-radius:4px"></span><span class="skeleton" style="height:12px;margin-top:6px;width:60%;border-radius:4px"></span></div>`).join('')}</div>`;
}

// ---------------- IntersectionObserver kart animasyonu ----------------
let _cardIo = null; // observeCards observer — route değişiminde temizlenir
function observeCards(root = document) {
  if (reduceMotion) return;
  // Önceki observer'ı temizle (observer birikimini önle)
  if (_cardIo) { _cardIo.disconnect(); _cardIo = null; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, {threshold: 0.08});
  _cardIo = io;
  // Aynı satırdaki kartlar sırayla (kademeli) belirir.
  $$('.card, .wide, .land, .rank', root).forEach(c => {
    if (c.classList.contains('visible')) return;
    const idx = [...c.parentElement.children].indexOf(c);
    c.style.setProperty('--d', (idx % 8) * 55 + 'ms');
    io.observe(c);
  });
}

// ---------------- Ana sayfa ----------------
let heroTimer;
function heroView(items) {
  if (!items.length) return '';
  return `<section class="hero" aria-roledescription="carousel" aria-label="Öne çıkanlar">
    <div class="hero-bg"></div>
    <div class="hero-shade"></div>
    ${section === 'anime' ? `<div class="petals" aria-hidden="true">${Array.from({length: 14}, (_, k) => `<i style="--k:${k}"></i>`).join('')}</div><p class="hero-native" lang="ja" aria-hidden="true" hidden></p><div class="hero-poster" aria-hidden="true"></div>` : ''}
    <div class="hero-body"></div>
    <div class="hero-strip" role="tablist">${items.map((a, i) => `<button role="tab" class="thumb" data-i="${i}" aria-label="${esc(a.title)}">${a.backdrop ? `<img src="${esc(a.backdrop)}" alt="" data-fb>` : ''}<i></i></button>`).join('')}</div>
  </section>`;
}
function bindHero(items) {
  const hero = $('.hero');
  if (!hero) return;
  let i = 0;
  const show = n => {
    i = (n + items.length) % items.length;
    const a = items[i];
    // Arka plan çapraz geçişle değişir; eski görsel yenisi yüklenince kaybolur.
    const bg = $('.hero-bg', hero);
    if (a.backdrop) {
      const img = document.createElement('img');
      Object.assign(img, {src: a.backdrop, alt: '', decoding: 'async'});
      img.dataset.fb = '';
      img.className = 'hero-img';
      const done = () => { $$('img', bg).forEach(o => o !== img && o.classList.add('out')); setTimeout(() => $$('img.out', bg).forEach(o => o.remove()), 1200); };
      img.addEventListener('load', done, {once: true});
      img.addEventListener('error', done, {once: true});
      bg.append(img);
    } else bg.innerHTML = '';
    const anime = section === 'anime';
    const native = anime && a.original && a.original !== a.title && !/[a-z]/i.test(a.original) ? a.original : '';
    $('.hero-body', hero).innerHTML = `
      <p class="hero-eyebrow">${anime ? `<span class="pill">Bu sezon</span>${String(i + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}` : `<span class="hero-mark">L</span>${kindLabel(a).toLocaleUpperCase('tr')}`}</p>
      <h1 class="hero-title">${esc(a.title)}</h1>
      <p class="hero-meta">${a.score ? `<span class="score">${STAR}${score(a.score)}</span>` : ''}<span>${esc(a.year)}</span>${anime ? '' : `<span>${kindLabel(a)}</span>`}${a.genres?.length ? `<span>${esc(a.genres.slice(0, 3).join(' · '))}</span>` : ''}</p>
      <p class="hero-text">${esc(a.overview)}</p>
      <div class="actions"><a class="btn btn-play" href="${watchHref(a)}">${PLAY}${anime ? 'İzlemeye başla' : 'Oynat'}</a><button class="btn btn-ghost" data-save data-list="${keyOf(a)}" data-label="${anime ? 'Listeye ekle' : 'Listem'}">${inList(a) ? CHECK + 'Listende' : PLUS + (anime ? 'Listeye ekle' : 'Listem')}</button><button class="btn btn-ghost btn-info" type="button" data-info="${keyOf(a)}" aria-label="Daha fazla bilgi">${INFO}<span>Daha fazla bilgi</span></button></div>`;
    remember(a);
    ambientFrom(a.backdrop || a.poster, hero);
    const jp = $('.hero-native', hero);
    if (jp) { jp.textContent = native; jp.hidden = !native; }
    const pc = $('.hero-poster', hero);
    if (pc) pc.innerHTML = anime && a.poster ? `<img src="${esc(a.posterLarge || a.poster)}" alt="" data-fb>` : '';
    $('[data-save]', hero).onclick = e => { e.stopPropagation(); toggleList(a); };
    $$('.thumb', hero).forEach((t, k) => { t.setAttribute('aria-selected', k === i); t.classList.toggle('on', k === i); });
    imgFallback(hero);
    clearTimeout(heroTimer);
    heroTrailer(hero, a, () => i === items.indexOf(a), () => show(i + 1));
    if (!reduceMotion && items.length > 1) heroTimer = setTimeout(() => { if (document.contains(hero) && !hero.matches(':hover, :focus-within')) show(i + 1); else heroTimer = setTimeout(() => show(i + 1), 9000); }, 9000);
  };
  $$('.thumb', hero).forEach(t => t.onclick = () => show(Number(t.dataset.i)));
  // Dokunmatik ekranda sağa / sola kaydırarak vitrini değiştir.
  let sx = null;
  hero.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, {passive: true});
  hero.addEventListener('touchend', e => { if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1)); }, {passive: true});
  show(0);
}

async function viewHome(v) {
  main.innerHTML = loading('Ana sayfa hazırlanıyor');
  let data;
  main.innerHTML = homeSkeleton();
  try { data = await api(withSection('/api/home')); } catch (e) { if (v === routeId) main.innerHTML = errorBox(e); return; }
  if (v !== routeId) return;

  // Her bölüm yalnızca kendi içeriğini gösterir.
  const hero = data.hero || [];
  const shelves = data.shelves || [];
  const recents = Object.values(recent).filter(r => secOf(r.item) === section).sort((a, b) => b.at - a.at).slice(0, 10);
  const listed = myList.filter(a => secOf(a) === section).slice(0, 18);

  main.innerHTML = `${heroView(hero)}
    <div class="page page-home tab-content-enter">
      ${shelf({title: section === 'anime' ? 'Kaldığın bölümden devam et' : 'İzlemeye devam et', items: recents, wide: true})}
      ${shelves.slice(0, 2).map(shelf).join('')}
      ${forYouShelf(shelves, recents, listed)}
      ${shelf({title: 'Listem', items: listed, more: '#/listem', layout: section === 'media' ? 'land' : 'poster'})}
      ${shelves.slice(2, 5).map(shelf).join('')}
      ${genreLinks()}
      ${shelves.slice(5).map(shelf).join('')}
    </div>`;
  bindHero(hero);
  bindShelves();
  imgFallback();
  observeCards();
  setStatus(data.source);
}
let genres = [];
// Tür kutucukları: her türün kendi renk tonu var (bölüm temasıyla karışır).
const GENRE_HUE = {aksiyon: 4, macera: 28, komedi: 48, dram: 330, fantastik: 270, 'bilim-kurgu': 200, gizem: 250, romantik: 340, korku: 0, spor: 140, 'gunluk-yasam': 95, dogaustu: 290, suc: 15, gerilim: 355, animasyon: 175, belgesel: 120, aile: 60, savas: 30, tarih: 38, western: 24, mecha: 210, psikolojik: 265, muzik: 300, isekai: 160, shounen: 12, seinen: 220};
function genreLinks() {
  if (!genres.length) return '';
  const target = g => section === 'media' && !g.tv ? '#/filmler' : '#/kesfet';
  return `<section class="genres"><div class="shelf-head"><h2>${section === 'anime' ? 'Türlere göz at' : 'Kategoriler'}</h2></div><div class="genre-grid">${genres.map((g, i) => `<a href="${target(g)}?tur=${g.slug}" style="--h:${GENRE_HUE[g.slug] ?? i * 37}"><span>${esc(g.name)}</span></a>`).join('')}</div></section>`;
}
function homeSkeleton() {
  const row = n => `<div class="shelf"><span class="skeleton" style="height:22px;width:220px;margin-bottom:16px"></span><div class="row row-${section === 'media' ? 'land' : 'poster'}">${Array.from({length: n}, () => `<span class="skeleton sk-${section === 'media' ? 'land' : 'poster'}"></span>`).join('')}</div></div>`;
  return `<div class="hero hero-skeleton"><div class="hero-shade"></div></div><div class="page page-home" role="status" aria-label="Yükleniyor">${row(8)}${row(8)}</div>`;
}
// "Senin için": listendeki ve izlediklerindeki türlere göre ana sayfadaki başlıkları puanlar.
function forYouShelf(shelves, recents, listed) {
  const seeds = [...listed, ...recents.map(r => r.item)];
  if (!seeds.length) return '';
  const weight = new Map();
  seeds.forEach((a, i) => (a.genres?.length ? a.genres : ITEMS.get(keyOf(a))?.genres || []).forEach(g => weight.set(g, (weight.get(g) || 0) + (i < 6 ? 2 : 1))));
  if (!weight.size) return '';
  const seen = new Set(seeds.map(keyOf)), pool = new Map();
  shelves.forEach(sh => sh.items.forEach(a => { if (!seen.has(keyOf(a)) && !pool.has(keyOf(a))) pool.set(keyOf(a), a); }));
  const ranked = [...pool.values()].map(a => ({a, w: (a.genres || []).reduce((t, g) => t + (weight.get(g) || 0), 0) + (a.score || 0) / 10})).filter(x => x.w >= 1.5).sort((x, y) => y.w - x.w).slice(0, 18).map(x => x.a);
  if (ranked.length < 4) return '';
  const top = [...weight.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([g]) => g.toLocaleLowerCase('tr'));
  return shelf({title: `Senin için: ${top.join(' ve ')} sevenlere`, items: ranked, layout: section === 'media' ? 'land' : 'poster'}).replace('class="shelf ', 'class="shelf shelf-foryou ');
}
async function loadGenres() {
  try { genres = await api(withSection('/api/genres')); } catch { genres = []; }
}

// ---------------- Keşfet / Filmler ----------------
const SORTS = [['popular', 'Popüler'], ['season', 'Yeni çıkanlar'], ['rating', 'En yüksek puan'], ['new', 'En yeni']];
async function viewBrowse(v, kind, params) {
  const genre = params.get('tur') || '', sort = params.get('sirala') || 'popular', q = params.get('ara') || '';
  const base = kind === 'movie' ? '#/filmler' : '#/kesfet';
  const link = o => { const p = new URLSearchParams({tur: genre, sirala: sort, ara: q, ...o}); [...p.keys()].forEach(k => !p.get(k) && p.delete(k)); return base + (p.toString() ? '?' + p : ''); };
  const media = section === 'media';
  const kindGenres = genres.filter(g => g[kind] !== false);
  const sorts = media ? [['popular', 'Popüler'], ['season', kind === 'movie' ? 'Vizyondan yeni' : 'Yeni sezonlar'], ['rating', 'En yüksek puan'], ['new', 'En yeni']] : SORTS;
  const other = kind === 'movie' ? '#/kesfet' : '#/filmler';
  const gName = genres.find(g => g.slug === genre)?.name;
  main.innerHTML = `<div class="page page-browse tab-content-enter">
    <header class="page-head">
      <div><p class="eyebrow">${esc(S().label)}</p><h1>${esc(gName ? `${gName} ${kind === 'movie' ? (media ? 'filmleri' : 'anime filmleri') : (media ? 'dizileri' : 'animeleri')}` : S()[kind])}</h1></div>
      <button class="btn btn-ghost btn-sm shuffle-btn" id="shuffle" type="button" title="Bu sayfadaki başlıklardan birini rastgele aç">${SHUFFLE}Rastgele seç</button>
      <div class="kind-switch" role="tablist" aria-label="Tür">
        <a role="tab" href="${kind === 'tv' ? '#' : other}" aria-selected="${kind === 'tv'}" class="${kind === 'tv' ? 'on' : ''}" ${kind === 'tv' ? 'data-noop' : ''}>${media ? 'Diziler' : 'Seriler'}</a>
        <a role="tab" href="${kind === 'movie' ? '#' : other}" aria-selected="${kind === 'movie'}" class="${kind === 'movie' ? 'on' : ''}" ${kind === 'movie' ? 'data-noop' : ''}>Filmler</a>
      </div>
      <form class="filter-search" role="search"><input name="ara" type="search" value="${esc(q)}" placeholder="${esc(S()[kind])} içinde ara" aria-label="Ara"></form></header>
    <div class="filters">
      <div class="chips" role="list"><a role="listitem" class="chip ${!genre ? 'on' : ''}" href="${link({tur: ''})}">Hepsi</a>${kindGenres.map(g => `<a role="listitem" class="chip ${genre === g.slug ? 'on' : ''}" href="${link({tur: g.slug})}">${esc(g.name)}</a>`).join('')}</div>
      <label class="select">Sırala <select id="sort">${sorts.map(([k, t]) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    <div class="grid ${media ? 'grid-land' : ''}" id="grid"></div>
    <div class="more-wrap" id="more-wrap">${loading()}</div>
  </div>`;
  $$('[data-noop]').forEach(a => a.onclick = e => e.preventDefault());
  bindShuffle();
  $('#sort').onchange = e => location.hash = link({sirala: e.target.value});
  $('.filter-search').onsubmit = e => { e.preventDefault(); location.hash = link({ara: e.target.ara.value.trim()}); };
  let page = 1;
  let loadingMore = false;
  const load = async () => {
    if (loadingMore) return;
    // Temizle: önceki observer varsa bağlantısını kes (observer birikimini önle)
    if (_scrollIo) { _scrollIo.disconnect(); _scrollIo = null; }
    loadingMore = true;
    if (page === 1) {
      $('#grid').innerHTML = media ? Array.from({length: 12}, () => '<span class="skeleton sk-land"></span>').join('') : skeletonGrid().replace(/^<div class="grid">|<\/div>$/g, '');
      $('#more-wrap').innerHTML = '';
    } else {
      $('#more-wrap').innerHTML = loading();
    }
    try {
      const d = await api(`/api/browse?${new URLSearchParams({kind, genre, sort, page, q, section})}`);
      if (v !== routeId) return;
      if (page === 1) $('#grid').innerHTML = '';
      $('#grid').insertAdjacentHTML('beforeend', d.items.map(gridCard).join(''));
      imgFallback($('#grid'));
      observeCards($('#grid'));
      setStatus(d.source);
      const none = page === 1 && !d.items.length;
      if (none) {
        $('#more-wrap').innerHTML = emptyState({icon: 'search', title: q ? `“${esc(q)}” için sonuç yok` : 'Bu filtrede başlık yok', text: q ? 'Yazımı kontrol et ya da orijinal adıyla aramayı dene.' : 'Başka bir tür ya da sıralama dene.', actions: `<a class="btn btn-play" href="${base}">Filtreleri temizle</a>${q ? `<button class="btn btn-ghost" type="button" data-search-q="${esc(q)}">Tüm sitede ara</button>` : ''}`});
        $('[data-search-q]', $('#more-wrap'))?.addEventListener('click', ev => { openSearch(); si.value = ev.currentTarget.dataset.searchQ; si.dispatchEvent(new Event('input')); });
        loadingMore = false;
        return;
      }
      if (d.page < d.pages) {
        // Sonsuz scroll sentinel
        $('#more-wrap').innerHTML = '<div id="scroll-sentinel" style="height:1px"></div>';
        const sentinel = $('#scroll-sentinel');
        _scrollIo = new IntersectionObserver(entries => {
          if (entries[0].isIntersecting && !loadingMore) { page++; load(); }
        }, {rootMargin: '200px'});
        _scrollIo.observe(sentinel);
      } else {
        $('#more-wrap').innerHTML = '';
      }
    } catch (e) {
      if (v === routeId) $('#more-wrap').innerHTML = errorBox(e, false) + '<button class="btn" id="more-retry">Tekrar dene</button>';
      if ($('#more-retry')) $('#more-retry').onclick = () => { loadingMore = false; load(); };
    }
    loadingMore = false;
  };
  load();
}

// ---------------- Listem ----------------
// Listeyi türe göre (dizi / film) bölümlere ayırır.
function listGroups(items) {
  const tv = items.filter(a => !isMovie(a)), mv = items.filter(isMovie);
  const grid = list => `<div class="grid ${section === 'media' ? 'grid-land' : ''}">${list.map(gridCard).join('')}</div>`;
  if (!tv.length || !mv.length) return grid(items);
  return [[section === 'anime' ? 'Seriler' : 'Diziler', tv], ['Filmler', mv]].map(([t, l]) => `<section class="list-group"><h2 class="list-group-head">${t}<small>${l.length}</small></h2>${grid(l)}</section>`).join('');
}
const LIST_SORTS = [['added', 'Son eklenen'], ['title', 'Ada göre'], ['score', 'Puana göre'], ['year', 'Yıla göre']];
// Listem ve İzleme geçmişi aynı sayfada iki sekme olarak durur.
const libTabs = tab => `<div class="kind-switch lib-switch" role="tablist" aria-label="Kitaplık"><a role="tab" href="#/listem" class="${tab === 'list' ? 'on' : ''}" aria-selected="${tab === 'list'}">Listem<small>${myList.filter(x => secOf(x) === section).length}</small></a><a role="tab" href="#/listem?g=gecmis" class="${tab === 'history' ? 'on' : ''}" aria-selected="${tab === 'history'}">İzleme geçmişi<small>${Object.values(recent).filter(r => secOf(r.item) === section).length}</small></a></div>`;
function viewList(v, params = new URLSearchParams()) {
  if (params.get('g') === 'gecmis') return viewHistory(v);
  const sortBy = store.get('listSort', 'added');
  const cmp = {title: (x, y) => x.title.localeCompare(y.title, 'tr'), score: (x, y) => (y.score || 0) - (x.score || 0), year: (x, y) => String(y.year || '').localeCompare(String(x.year || ''))}[sortBy];
  const mine = myList.filter(a => secOf(a) === section);
  if (cmp) mine.sort(cmp);
  const others = myList.length - mine.length;
  const otherName = SECTIONS[section === 'anime' ? 'media' : 'anime'].label;
  const who = profileKey ? `${esc(profile?.name || 'Profil')} profilinin izleyeceklerim listesi. Aynı anahtarla başka cihazda da açılır.` : `Bu liste şimdilik yalnızca bu tarayıcıda. Sana verilen anahtarı <a class="text-btn" href="#/profil">buraya</a> yazarsan her cihazda aynı liste durur.`;
  main.innerHTML = `<div class="page tab-content-enter"><header class="page-head"><div><p class="eyebrow">${profileKey ? esc(profile?.name || 'Profil') : esc(S().label)}</p><h1>İzleyeceklerim</h1></div>${libTabs('list')}${mine.length ? `<div class="head-tools"><label class="select">Sırala <select id="list-sort">${LIST_SORTS.map(([k, t]) => `<option value="${k}" ${k === sortBy ? 'selected' : ''}>${t}</option>`).join('')}</select></label><button class="btn btn-ghost btn-sm" id="shuffle" type="button">${SHUFFLE}Rastgele seç</button></div><p>${mine.length} başlık. ${who}${others ? ` ${otherName} listende ${others} başlık daha var.` : ''}</p>` : ''}</header>
    ${mine.length ? listGroups(mine) : emptyState({icon: 'list', title: 'İzleyeceklerim boş', text: `${S().empty}${profileKey ? '' : ' Anahtarın varsa profiline gir; liste orada durur.'}${others ? ` ${otherName} listende ${others} başlık var.` : ''}`, actions: `<a class="btn btn-play" href="#/kesfet">${section === 'anime' ? 'Serilere göz at' : 'Dizilere göz at'}</a><a class="btn btn-ghost" href="#/filmler">Filmlere göz at</a>${profileKey ? '' : '<a class="btn btn-ghost" href="#/profil">Anahtarımı gir</a>'}`}) + '<div id="suggest"></div>'}
  </div>`;
  if ($('#list-sort')) $('#list-sort').onchange = e => { store.set('listSort', e.target.value); viewList(v, params); };
  bindShuffle();
  imgFallback();
  observeCards();
  if (!mine.length) suggestShelf(v);
}
// Boş sayfalarda "şunlarla başlayabilirsin" rafı
async function suggestShelf(v, title = 'Şunlarla başlayabilirsin') {
  const box = $('#suggest');
  if (!box) return;
  try {
    const d = await api(withSection('/api/home'), 20000, {quiet: true});
    if (v !== routeId || !document.contains(box)) return;
    const src = d.shelves?.find(x => x.layout === 'rank') || d.shelves?.[0];
    if (!src?.items?.length) return;
    box.innerHTML = shelf({title, items: src.items.slice(0, 18), layout: section === 'media' ? 'land' : 'poster'});
    bindShelves(box); imgFallback(box); observeCards(box);
  } catch {}
}
function viewHistory(v) {
  const items = Object.values(recent).filter(r => secOf(r.item) === section).sort((a, b) => b.at - a.at);
  const day = 864e5, start = new Date(new Date().toDateString()).getTime();
  const buckets = [['Bugün', start], ['Dün', start - day], ['Bu hafta', start - 6 * day], ['Bu ay', start - 29 * day], ['Daha önce', -Infinity]];
  const groups = buckets.map(([t, from], i) => [t, items.filter(r => r.at >= from && (i === 0 || r.at < buckets[i - 1][1]))]).filter(([, l]) => l.length);
  main.innerHTML = `<div class="page tab-content-enter"><header class="page-head"><div><p class="eyebrow">${esc(S().label)}</p><h1>İzleme geçmişi</h1></div>${libTabs('history')}${items.length ? `<div class="head-tools"><button class="btn btn-ghost btn-sm" id="clear-history" type="button"><svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>Geçmişi temizle</button></div><p>${items.length} başlık. Bir kartın üzerindeki çarpıyla tek tek de kaldırabilirsin.</p>` : ''}</header>
    ${items.length ? groups.map(([t, l]) => `<section class="list-group"><h2 class="list-group-head">${t}<small>${l.length}</small></h2><div class="grid grid-wide">${l.map(r => wideCard(r, {ago: true})).join('')}</div></section>`).join('') : emptyState({icon: 'history', title: 'Henüz bir şey izlemedin', text: 'İzlemeye başladığın bölümler ve filmler burada, kaldığın yerle birlikte görünür.', actions: '<a class="btn btn-play" href="#/watch">Keşfetmeye başla</a>'}) + '<div id="suggest"></div>'}
  </div>`;
  $('#clear-history')?.addEventListener('click', () => clearHistory());
  imgFallback(); observeCards();
  if (!items.length) suggestShelf(v);
}
// Seçili bölümün geçmişini siler; geri alınabilir.
function clearHistory(all = false) {
  const keep = k => !all && secOf(recent[k]?.item) !== section;
  const backup = {recent: {...recent}, progress: {...progress}};
  const gone = new Set(Object.keys(recent).filter(k => !keep(k)));
  gone.forEach(k => delete recent[k]);
  Object.keys(progress).forEach(k => { if (all || gone.has(k.split(':').slice(0, 2).join(':'))) delete progress[k]; });
  store.set('recent', recent); store.set('progress', progress);
  scheduleSync();
  toast('İzleme geçmişi temizlendi', 'info', {label: 'Geri al', fn: () => { recent = backup.recent; progress = backup.progress; store.set('recent', recent); store.set('progress', progress); scheduleSync(); route(); }});
  if (!location.hash || /^#\/(listem)?(\?|$)/.test(location.hash)) route();
}

// ---------------- Bilgisayarımda ----------------
async function viewLibrary(v) {
  main.innerHTML = `<div class="page"><header class="page-head"><h1>Bilgisayarımdaki videolar</h1><button class="btn btn-ghost" id="rescan">Klasörü yeniden tara</button></header><div id="lib">${loading()}</div>${guide()}</div>`;
  $('#rescan').onclick = async () => { await refreshLibrary(true); toast('Klasör tarandı'); route(); };
  await refreshLibrary(true);
  if (v !== routeId) return;
  const items = await api('/api/library').then(d => d.items).catch(() => []);
  if (!items.length) { $('#lib').innerHTML = emptyState({icon: 'folder', title: 'Henüz video yok', text: 'Aşağıdaki adımlarla proje klasöründeki <code>media</code> klasörüne video ekleyebilirsin.', cls: 'state-left'}); return; }
  const details = await Promise.all(items.map(it => api(`/api/title/${it.kind}/${it.id}`).then(d => ({...d, _count: it.count})).catch(() => ({kind: it.kind, id: it.id, title: `${it.kind}-${it.id}`, _count: it.count}))));
  if (v !== routeId) return;
  $('#lib').innerHTML = `<div class="grid">${details.map(card).join('')}</div>`;
  imgFallback();
  observeCards();
}
function guide(folder) {
  const f = folder || 'tv-127532';
  return `<section class="guide">
    <h2>Video nasıl eklenir</h2>
    <ol>
      <li>Proje klasöründe <code>media</code> adında bir klasör var. İçine animenin klasörünü aç: <code>${esc(f)}</code>. Klasör adı her animenin sayfasında yazar.</li>
      <li>Bölüm dosyalarını <code>S01E01.mp4</code>, <code>S01E02.mp4</code> gibi adlandır. Filmlerde dosya adı serbest.</li>
      <li>Altyazı için aynı adla <code>S01E01.tr.srt</code> ya da <code>.vtt</code> dosyası koy. Türkçe karakterler otomatik düzeltilir.</li>
      <li>MP4 (H.264 + AAC) ve WebM her tarayıcıda açılır. MKV dosyaları tarayıcıya göre açılmayabilir.</li>
    </ol>
  </section>`;
}
async function refreshLibrary(rescan) {
  try {
    const d = await api(rescan ? '/api/rescan' : '/api/library');
    library = new Set(d.items.map(i => `${i.kind}:${i.id}`));
    libraryEpisodes = new Map(d.items.map(i => [`${i.kind}:${i.id}`, new Set(i.episodes)]));
  } catch {}
}

// ---------------- İzleme sayfası ----------------
let player = null;
// İzleme sayfası yüklenirken: karttan bilinen başlık ve görselle iskelet gösterilir.
function watchSkeleton(seed) {
  const bg = seed?.backdrop || seed?.poster;
  const line = (w, h = 14, mt = 8) => `<span class="skeleton" style="width:${w};height:${h}px;margin-top:${mt}px"></span>`;
  return `<div class="watch watch-loading" role="status" aria-label="Yükleniyor">
    <div class="cinema ${store.get('theater', false) ? 'theater' : ''}"><div class="cinema-tools"><span class="skeleton" style="width:128px;height:32px"></span></div>
      <div class="stage"><div class="stage-inner stage-skel">${bg ? `<img class="stage-bg" src="${esc(bg)}" alt="" data-fb>` : ''}${loading(section === 'anime' ? 'Anime bilgileri yükleniyor' : 'Bilgiler yükleniyor')}</div></div>
      <aside class="cinema-panel skel-panel" aria-hidden="true">${Array.from({length: 7}, () => '<span class="skeleton sk-ep"></span>').join('')}</aside>
    </div>
    <div class="page"><div class="watch-grid"><div class="info">${line('30%', 14, 0)}${seed?.title ? `<h1 class="title" style="margin-top:10px">${esc(seed.title)}</h1>` : line('62%', 60, 10)}${line('46%', 16, 22)}${line('92%', 14, 22)}${line('84%')}${line('70%')}<div class="actions" style="margin-top:26px">${line('150px', 44, 0)}${line('120px', 44, 0)}</div></div></div></div>
  </div>`;
}
function externalWatchLinks(a) {
 return externalWatchSites(a).map(s => `<div class="source-help external-watch-site"><div><b>Kaynak sitenin oynatıcısı</b><p>${esc(s.language)} Bu bağlantı yeni sekmede açılır; Lovell içinde oynatılmaz.</p><a class="btn btn-sm btn-ghost" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.site)} · Kaynak sitede aç ↗</a></div></div>`).join('');
}
async function viewWatch(v, kind, id, params) {
  main.innerHTML = watchSkeleton(ITEMS.get(`${kind}:${id}`) || myList.find(x => keyOf(x) === `${kind}:${id}`) || recent[`${kind}:${id}`]?.item);
  imgFallback();
  let a;
  try { a = await api(`/api/title/${kind}/${id}`); } catch (e) { if (v === routeId) main.innerHTML = errorBox(e); return; }
  if (v !== routeId) return;
  // Başlık hangi bölüme aitse o bölümün temasına geç (ör. listeden açılan bir film).
  if (a.section && secOf(a) !== section) { setSection(secOf(a)); loadGenres(); }
  document.title = `${a.title} | LOVELL`;
  const movie = isMovie(a);
  const last = recent[keyOf(a)];
  const seasons = a.seasons?.length ? a.seasons : [{n: 1, name: 'Bölümler', count: 0}];
  let s = Number(params.get('s')) || (last?.s) || seasons[0].n;
  let e = Number(params.get('e')) || (last && last.s === s ? last.e : 1);
  if (movie) { s = 1; e = 1; }
  const ctx = {a, s, e, episodes: [], v};

  main.innerHTML = `<div class="watch">
    <div class="cinema ${store.get('theater', false) ? 'theater' : ''}" id="cinema">
      <div class="cinema-tools">
        <button class="cine-btn" id="theater" type="button" aria-pressed="${store.get('theater', false)}" title="Sinema modu (T)"><svg class="ln" viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="5" width="16" height="10" rx="1.5"/><path d="M6 8v4M14 8v4"/></svg><span>Sinema modu</span></button>
        ${movie ? '' : '<button class="cine-btn" id="panel-toggle" type="button" title="Bölüm listesi"><svg class="ln" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12M4 10h12M4 15h8"/></svg><span>Bölümler</span></button>'}
      </div>
      <div class="stage" id="stage"><div class="stage-inner">${loading('Video aranıyor')}</div></div>
      ${movie ? '' : `<aside class="cinema-panel" id="episodes" aria-label="Bölüm listesi">
        <div class="cinema-panel-head"><span class="eyebrow">Bölümler</span><strong>${a.episodeCount || ''}</strong></div>
        <label class="ep-find"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input id="ep-find" type="search" inputmode="search" placeholder="Bölüm no ya da adı" aria-label="Bölüm ara"></label>
        <div class="ep-tools">
          ${seasons.length > 1 ? `<label class="select">Sezon <select id="season">${seasons.map(x => `<option value="${x.n}" ${x.n === s ? 'selected' : ''}>${x.n}. sezon</option>`).join('')}</select></label>` : ''}
          <span id="range-slot"></span>
        </div>
        <ol class="ep-list cinema-ep-list" id="ep-list">${loading('Bölümler yükleniyor')}</ol>
      </aside>`}
    </div>
    <div class="watch-tools" id="watch-tools">
      <div class="watch-jump" id="watch-jump"></div>
      <div class="stream-audio" id="audio-toggle" role="group" aria-label="Ses">
        <button type="button" data-audio="dub">Türkçe Dublaj</button>
        <button type="button" data-audio="sub">Altyazılı</button>
      </div>
    </div>
    <p class="page note" id="language-status" role="status">Dil bilgisi aranıyor…</p>
    ${movie ? '' : '<div class="ep-strip" id="ep-strip" hidden></div>'}
    <div class="page">
      <div class="watch-grid">
        <div class="info">
          <p class="now" id="now"></p>
          <h1 class="title">${esc(a.title)}</h1>
          ${externalWatchLinks(a)}
          ${a.original && a.original !== a.title ? `<p class="original" ${section === 'anime' ? 'lang="ja"' : ''}>${esc(a.original)}</p>` : ''}
          <p class="facts">${a.score ? `<span class="score">${STAR}${score(a.score)}</span>` : ''}${a.imdbRating ? `<span class="imdb-score" title="IMDb puanı"><svg viewBox="0 0 32 16" width="32" height="16" aria-hidden="true"><rect width="32" height="16" rx="3" fill="#F5C518"/><text x="4" y="12" font-size="10" font-weight="bold" fill="#000">IMDb</text></svg> ${esc(a.imdbRating)}</span>` : ''}${a.rottenTomatoes ? `<span title="Rotten Tomatoes" class="badge-rt"><b>RT</b>${esc(a.rottenTomatoes)}</span>` : ''}${a.metascore ? `<span title="Metascore" class="metascore">${esc(a.metascore)}</span>` : ''}${a.awards ? `<span title="${esc(a.awards)}" class="awards-badge"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h8v3a4 4 0 0 1-8 0zM4 3H2v1a2 2 0 0 0 2 2M12 3h2v1a2 2 0 0 1-2 2M8 9v3M5 14h6"/></svg>Ödüllü</span>` : ''}${a.boxOffice ? `<span title="Gişe" class="badge-box">Gişe ${esc(a.boxOffice)}</span>` : ''}${a.year ? `<span>${esc(a.year)}</span>` : ''}${movie ? `<span>Film${a.runtime ? `, ${a.runtime} dk` : ''}</span>` : a.episodeCount ? `<span>${a.episodeCount} bölüm</span>` : ''}${a.genres?.length ? `<span>${esc(a.genres.join(', '))}</span>` : ''}${a.studios?.length ? `<span>${esc(a.studios.join(', '))}</span>` : ''}${STATUS_TR[a.status] ? `<span class="status-pill ${STATUS_TR[a.status][1]}">${STATUS_TR[a.status][0]}</span>` : ''}</p>
          ${a.tagline ? `<p class="tagline">“${esc(a.tagline)}”</p>` : ''}
          ${!movie && a.nextEpisode && daysUntil(a.nextEpisode.date) >= 0 ? `<p class="next-air">${CAL}<span><b>Yeni bölüm ${whenLabel(a.nextEpisode.date)}</b>${a.nextEpisode.s}. sezon ${a.nextEpisode.e}. bölüm · ${fmtDate(a.nextEpisode.date)}</span></p>` : ''}
          ${a.overview ? `<div class="overview" id="overview"><p>${esc(a.overview).replace(/\n+/g, '</p><p>')}</p></div>${a.overviewLang === 'en' ? '<p class="note">Türkçe özet bulunamadı, İngilizcesi gösteriliyor.</p>' : ''}` : ''}
          ${movie ? '' : '<div class="ep-nav" id="ep-nav" hidden></div>'}
          <div id="title-bridge"></div>
          <div class="actions">
            <button class="btn ${inList(a) ? 'btn-ghost' : ''}" id="save">${inList(a) ? CHECK + 'Listende' : PLUS + 'Listeye ekle'}</button>
            ${a.trailer ? `<button class="btn btn-ghost" id="trailer">${PLAY}Fragman</button>` : ''}
            <button class="btn btn-ghost" id="mark-seen" type="button" aria-pressed="false">${EYE}<span>İzlendi say</span></button>
            <button class="btn btn-ghost btn-icon" id="share" type="button" aria-label="Paylaş" title="Bağlantıyı paylaş">${SHARE}</button>
          </div>
        </div>
      </div>
      ${castShelf(a)}
      ${shelf({title: section === 'anime' ? 'Bunu sevenler bunlara da baktı' : 'Benzer içerikler', items: a.recommendations || []})}
    </div>
  </div>`;
  const ov = $('#overview');
  if (ov && ov.scrollHeight > ov.clientHeight + 4) { ov.classList.add('clamped'); ov.insertAdjacentHTML('afterend', '<button class="text-btn" id="ov-more">Devamını oku</button>'); $('#ov-more').onclick = ev => { ov.classList.toggle('open'); ev.target.textContent = ov.classList.contains('open') ? 'Daha az göster' : 'Devamını oku'; }; }
  $('#save').onclick = ev => { const on = toggleList(a); ev.currentTarget.innerHTML = on ? CHECK + 'Listende' : PLUS + 'Listeye ekle'; ev.currentTarget.classList.toggle('btn-ghost', on); };
  if ($('#trailer')) $('#trailer').onclick = () => openTrailer(a.trailer);
  $('#share').onclick = () => shareTitle(a, movie ? null : ctx);
  $('#mark-seen').onclick = () => toggleSeen(ctx);
  syncSeen(ctx);
  if ($('#season')) $('#season').onchange = ev => go(ctx, Number(ev.target.value), 1);
  bindWatchExtras(ctx);
  updateEpNav(ctx);
  bindShelves();
  imgFallback();
  setStatus(a.source);
  if (!movie) loadEpisodes(ctx);
  loadSources(ctx);
  if (a.section === 'anime') loadMangaBridge(a);
}

async function loadMangaBridge(a) {
  const slot = $('#title-bridge');
  if (!slot) return;
  const queries = [...new Set([a.original, a.title].map(s => String(s || '').trim()).filter(s => s.length >= 2))].slice(0, 2);
  let hit = null;
  for (const q of queries) {
    try {
      const d = await api(`/api/readfy/search?q=${encodeURIComponent(q)}`, 12000, {quiet: true});
      hit = pickHit(q, d.items, m => m.title, m => m.alts);
      if (hit) break;
    } catch {}
  }
  if (!hit || !$('#title-bridge')) return;
  slot.innerHTML = `<a class="bridge" href="#/readfy/${esc(hit.id)}">${hit.cover ? `<img src="${esc(hit.cover)}" alt="">` : ''}<span><small>Mangası</small><b>${esc(hit.title)}</b></span></a>`;
}

async function loadShowBridge(m) {
  const slot = $('#show-bridge');
  if (!slot || !m) return;
  const queries = [...new Set([m.title, ...(m.alts || [])].map(s => String(s || '').trim()).filter(s => s.length >= 2))].slice(0, 3);
  let hit = null;
  for (const q of queries) {
    try {
      const d = await api(`/api/search?q=${encodeURIComponent(q)}&section=anime`, 12000, {quiet: true});
      hit = pickHit(q, d.items, x => x.title, x => [x.original]);
      if (hit) break;
    } catch {}
  }
  if (!hit || !$('#show-bridge')) return;
  slot.innerHTML = `<a class="bridge" href="#/izle/${esc(hit.kind)}/${esc(hit.id)}">${hit.poster ? `<img src="${esc(hit.poster)}" alt="">` : ''}<span><small>Dizisi</small><b>${esc(hit.title)}</b></span></a>`;
}

function dayLabel(date) {
  const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  const tomorrow = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(Date.now() + 86400000));
  const pretty = new Date(`${date}T12:00:00+03:00`).toLocaleDateString('tr-TR', {timeZone: 'Europe/Istanbul', weekday: 'long', day: 'numeric', month: 'long'});
  if (date === today) return `Bugün · ${pretty}`;
  if (date === tomorrow) return `Yarın · ${pretty}`;
  return pretty;
}

async function viewWeek(v) {
  document.title = 'Bu hafta — LOVELL';
  main.innerHTML = `<div class="week">${loading('Bu haftanın bölümleri alınıyor')}</div>`;
  let data;
  try { data = await api('/api/week', 20000); } catch (e) { if (v === routeId) main.innerHTML = `<div class="week">${errorBox(e)}</div>`; return; }
  if (v !== routeId) return;
  const days = data.days || [];
  main.innerHTML = `<div class="week">
    <header class="hub-hero"><p class="eyebrow">Yayın takvimi</p><h1>Bu hafta</h1><p>Önümüzdeki yedi gün. Saatler İstanbul.</p></header>
    ${days.length ? days.map(day => `<section class="week-day"><h2>${esc(dayLabel(day.date))}</h2><div class="week-list">${day.items.map(item => `<a class="week-row${item.past ? ' is-past' : ''}" href="#/izle/al/${esc(item.id)}"><time>${esc(item.time)}</time>${item.poster ? `<img src="${esc(item.poster)}" alt="">` : '<span class="rf-ph"></span>'}<span><b>${esc(item.title)}</b><small>${item.episode ? `${item.episode}. bölüm` : ''}</small></span></a>`).join('')}</div></section>`).join('') : '<p class="muted">Bu hafta listelenecek yayın yok.</p>'}
  </div>`;
  imgFallback();
}


function go(ctx, s, e) { location.hash = watchHref(ctx.a, s, e); }
// Bağlantıyı paylaş: telefonda sistem paylaşım menüsü, masaüstünde panoya kopyalama.
async function shareTitle(a, ctx) {
  const url = location.origin + location.pathname + (ctx ? watchHref(a, ctx.s, ctx.e) : watchHref(a));
  const title = ctx ? `${a.title} · ${ctx.s}. sezon ${ctx.e}. bölüm` : a.title;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({title, url}); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast('Bağlantı panoya kopyalandı', 'success'); } catch { toast(url); }
}
// Bölümü (ya da filmi) elle "izlendi" olarak işaretle / işareti kaldır.
const seenKey = ctx => `${keyOf(ctx.a)}:${ctx.s}:${ctx.e}`;
const isSeen = ctx => { const p = progress[seenKey(ctx)]; return !!p && p.t / p.d > .9; };
function syncSeen(ctx) {
  const b = $('#mark-seen');
  if (!b) return;
  const on = isSeen(ctx);
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('on', on);
  $('span', b).textContent = on ? 'İzlendi' : isMovie(ctx.a) ? 'İzlendi say' : 'Bölümü izlendi say';
}
function toggleSeen(ctx) {
  if (isSeen(ctx)) { delete progress[seenKey(ctx)]; store.set('progress', progress); scheduleSync(); toast('İzlendi işareti kaldırıldı'); }
  else { const d = (ctx.episodes.find(x => x.n === ctx.e)?.runtime || ctx.a.runtime || 24) * 60; saveProgress(ctx.a, ctx.s, ctx.e, d, d); toast(isMovie(ctx.a) ? 'Film izlendi olarak işaretlendi' : `${ctx.e}. bölüm izlendi olarak işaretlendi`, 'success'); }
  syncSeen(ctx);
  if (!isMovie(ctx.a) && $('#ep-list')) renderEpisodes(ctx, Number($('#range')?.value || 0));
}

async function loadEpisodes(ctx) {
  let d;
  try { d = await api(`/api/episodes/${ctx.a.kind}/${ctx.a.id}?season=${ctx.s}`); } catch { d = {episodes: []}; }
  if (ctx.v !== routeId) return;
  ctx.episodes = d.episodes || [];
  renderEpisodes(ctx, Math.floor(Math.max(0, ctx.episodes.findIndex(x => x.n === ctx.e)) / 50));
  updateNow(ctx);
  updateEpNav(ctx);
}
function renderEpisodes(ctx, page = 0) {
  const list = $('#ep-list');
  if (!list) return;
  const eps = ctx.episodes;
  if (!eps.length) { list.innerHTML = '<li class="muted">Bölüm listesine şu an ulaşılamıyor.</li>'; return; }
  const pages = Math.ceil(eps.length / 50);
  $('#range-slot').innerHTML = pages > 1 ? `<label class="select">Aralık <select id="range">${Array.from({length: pages}, (_, i) => `<option value="${i}" ${i === page ? 'selected' : ''}>${eps[i * 50].n}–${eps[Math.min(eps.length, (i + 1) * 50) - 1].n}</option>`).join('')}</select></label>` : '';
  if ($('#range')) $('#range').onchange = ev => renderEpisodes(ctx, Number(ev.target.value));
  const localEps = libraryEpisodes.get(keyOf(ctx.a));
  list.classList.toggle('no-stills', !eps.some(x => x.still));
  list.innerHTML = eps.slice(page * 50, page * 50 + 50).map(ep => {
    const p = progress[`${keyOf(ctx.a)}:${ctx.s}:${ep.n}`];
    const pct = p ? Math.min(100, p.t / p.d * 100) : 0;
    const cur = ep.n === ctx.e;
    const has = localEps?.has(`${ctx.s}:${ep.n}`);
    return `<li><a class="ep ${cur ? 'cur' : ''} ${pct > 90 ? 'seen' : ''}" href="${watchHref(ctx.a, ctx.s, ep.n)}" ${cur ? 'aria-current="true"' : ''}>
      <span class="ep-n">${ep.n}</span>
      <span class="ep-thumb thumb">${ep.still ? `<img src="${esc(ep.still)}" alt="" loading="lazy" decoding="async" data-fb>` : ''}${pct ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ''}</span>
      <span class="ep-body"><span class="ep-title">${esc(ep.title)}</span>
        <span class="ep-meta">${ep.runtime ? `<span>${ep.runtime} dk</span>` : ''}${ep.date ? `<span>${fmtDate(ep.date)}</span>` : ''}${pct > 90 ? '<span>İzlendi</span>' : ''}</span>
        ${ep.overview ? `<span class="ep-text">${esc(ep.overview)}</span>` : ''}</span>
    </a></li>`;
  }).join('');
  imgFallback(list);
  const strip = $('#ep-strip');
  if (strip) {
    strip.hidden = eps.length < 2;
    strip.innerHTML = `<span>Bölümler <b>${eps.length}</b></span><div class="ep-strip-list">${eps.map(ep => `<a href="${watchHref(ctx.a, ctx.s, ep.n)}" class="${ep.n === ctx.e ? 'on' : ''}">${ep.n}</a>`).join('')}</div>`;
    strip.querySelector('.on')?.scrollIntoView({inline: 'center', block: 'nearest', behavior: 'auto'});
  }
}
function updateNow(ctx) {
  const el = $('#now');
  if (!el) return;
  if (isMovie(ctx.a)) { el.textContent = ''; return; }
  const ep = ctx.episodes.find(x => x.n === ctx.e);
  el.textContent = `${ctx.s}. sezon, ${ctx.e}. bölüm${ep && !/^Bölüm \d+$/.test(ep.title) ? `: ${ep.title}` : ''}`;
}
function nextOf(ctx) {
  const i = ctx.episodes.findIndex(x => x.n === ctx.e);
  if (i >= 0 && i < ctx.episodes.length - 1) return {s: ctx.s, e: ctx.episodes[i + 1].n};
  const seasons = ctx.a.seasons || [];
  const si = seasons.findIndex(x => x.n === ctx.s);
  if (i === ctx.episodes.length - 1 && si >= 0 && si < seasons.length - 1) return {s: seasons[si + 1].n, e: 1};
  return null;
}

// Kaynaklar iki aşamada gelir: (1) yerel dosyalar + embed adresleri anında, (2) Anthology / VidRock / CinePro
// gibi doğrudan akış (HLS/MP4) bulan servisler arka planda. Kullanıcı ikincisini beklemeden izlemeye başlar.
// TMDB animelerinde her sezon AniList'te ayrı kayıttır; sunucunun çıkardığı sezon zincirini kullan.
// TMDB sezonları AniList kayıtlarıyla birebir örtüşüyorsa sezon → kayıt; TMDB sezonları birleştirmişse
// (ör. 47 bölümlük tek sezon ya da One Piece'in 23 sezonu) mutlak bölüm numarasını bölüm sayılarıyla dağıt.
function animeIds(a, s, e) {
  const chain = a.animeSeasons;
  if (!Array.isArray(chain) || !chain.length) return a.anilistId ? {al: a.anilistId, mal: a.malId || null, ep: e} : null;
  if (isMovie(a)) return {...chain[0], ep: 1};
  const seasons = (a.seasons || []).filter(x => x.n > 0);
  if (seasons.length > 1 && chain.length >= seasons.length) return chain[s - 1] ? {...chain[s - 1], ep: e} : null;
  let abs = e;
  for (const x of seasons) if (x.n < s) abs += x.count || 0;
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i];
    if (!c.eps || abs <= c.eps || i === chain.length - 1) return {...c, ep: abs};
    abs -= c.eps;
  }
  return null;
}
// Türkçe kaynak seçimi: dublaj tercihi açıksa önce Türkçe dublaj, sonra diğer Türkçe kaynaklar.
function trIndex(list, wantDub = store.get('preferDub', true)) {
  const preferred = list.findIndex(x => x.lang === 'tr' && !!x.dub === wantDub);
  return preferred >= 0 ? preferred : list.findIndex(x => x.lang === 'tr');
}
const playPath = (ctx, phase) => { const ids = animeIds(ctx.a, ctx.s, ctx.e); return `/api/play/${ctx.a.kind}/${ctx.a.id}?s=${ctx.s}&e=${ctx.e}${ids?.al ? `&alId=${ids.al}` : ''}${ids?.mal ? `&malId=${ids.mal}` : ''}${ids?.ep && ids.ep !== ctx.e ? `&aep=${ids.ep}` : ''}&phase=${phase}`; };
function wantsDub(ctx) { return store.get(secOf(ctx.a) === 'anime' ? 'preferDubAnime' : 'preferDub', secOf(ctx.a) !== 'anime'); }
function sourceLanguageCounts(ctx) {
  const direct = ctx.sources || [], embeds = ctx.embeds || [];
  const tr = t => /^(tr|tur)(?:[-_]|$)/i.test(t?.lang || t?.language || '');
  const dub = s => s.dub === true && tr(s);
  const sub = s => (s.subtitles || []).some(tr) || (s.tr === true && s.lang === 'sub');
  return {direct:direct.length, embeds:embeds.length, dub:direct.filter(dub).length + embeds.filter(dub).length, sub:direct.filter(sub).length + embeds.filter(sub).length};
}
function paintSourceAvailability(ctx) {
  const el = $('#language-status'); if (!el || ctx.v !== routeId) return;
  const c = sourceLanguageCounts(ctx), anime = secOf(ctx.a) === 'anime', count = anime ? c.sub : c.dub;
  const label = anime ? 'Türkçe altyazı' : 'Türkçe dublaj';
  el.textContent = `${label}: ${count ? count + ' kaynak bildiriyor; oynatma ve dil henüz doğrulanmadı.' : ctx.remote === 'loading' ? 'aranıyor…' : 'bu bölüm için bu dili bildiren kaynak bulunamadı.'} ${c.direct} doğrudan, ${c.embeds} gömülü kaynak.`;
}
function viewToolsDownload() {
  document.title = 'Lovell Tools - LOVELL';
  main.innerHTML = `<div class="page tools-download"><header class="hub-hero"><p class="eyebrow">LOVELL / MASAÜSTÜ</p><h1>Lovell Tools</h1><p>Masaüstü uygulamasının indirme ve sürüm merkezi.</p></header>
    <section class="tools-release" aria-labelledby="tools-release-title"><div class="tools-art" aria-hidden="true"><span>LT</span><small>LOVELL TOOLS</small><div class="tools-art-lines"><i></i><i></i><i></i></div></div>
    <div class="tools-release-info"><span class="tools-status">Henüz yayımlanmadı</span><h2 id="tools-release-title">Windows için Lovell Tools</h2><p>İndirme sayfası hazır. Doğrulanmış bir kurulum paketi henüz eklenmedi.</p><button class="btn btn-primary" type="button" disabled aria-describedby="tools-download-note">İndirme henüz hazır değil</button><p id="tools-download-note" class="tools-note">Kullanılabilir bir sürüm yayımlandığında indirme bağlantısı burada açılacak.</p>
    <dl class="tools-meta"><div><dt>Platform</dt><dd>Windows</dd></div><div><dt>Sürüm</dt><dd>Henüz yok</dd></div><div><dt>Dosya boyutu</dt><dd>—</dd></div><div><dt>SHA-256</dt><dd>Paket eklendiğinde</dd></div></dl></div></section>
    <section class="tools-details"><h2>Sürüm notları</h2><p>Henüz indirilebilir bir sürüm bulunmuyor. Kurulum adımları ve değişiklikler ilk sürümle birlikte burada yer alacak.</p></section></div>`;
}

async function loadSources(ctx) {
  $('#stage').querySelector('.stage-inner').innerHTML = `<div class="loading" role="status"><span class="spin"></span>Kaynaklar hazırlanıyor…</div>`;
  let d;
  try { d = await api(playPath(ctx, 'fast'), 20000); } catch { d = {sources: [], embeds: [], folder: `${ctx.a.kind}-${ctx.a.id}`}; }
  if (ctx.v !== routeId) return;
  // Oynatıcı yalnızca kullanıcının kendi veya yayın izni olan video adreslerini açar.
  ctx.sources = d.sources || [];
  ctx.embeds = rankEmbeds(d.embeds || []);
  ctx.folder = d.folder;
  ctx.vidrift = d.vidrift || ctx.embeds.find(e => e.id === 'vidrift')?.url || null;
  ctx.mode = null;
  ctx.remote = ctx.sources.length ? 'skip' : 'loading';
  paintSourceAvailability(ctx);   // kendi dosyan varsa başka kaynak aramaya gerek yok
  if (ctx.sources.length) return mountPlayer(ctx, Math.max(0, trIndex(ctx.sources, wantsDub(ctx))));
  // İki sorgu: kısa bütçeli olan hızlı kaynakları (çoğu Türkçe) 2-3 saniyede getirir, tam sorgu yavaşları bekler.
  const quick = store.get('preferTr', true) ? fetchRemote(ctx, 3500) : Promise.resolve();
  fetchRemote(ctx);
  // Türkçe doğrudan kaynak kısa sürede gelirse onunla başla; gelmezse embed ile devam et (arama sürer).
  if (store.get('preferTr', true) && ctx.embeds.length) {
    ctx.deciding = true;
    $('#stage .stage-inner').innerHTML = `<div class="loading" role="status"><span class="spin"></span>Türkçe kaynaklar aranıyor…</div>`;
    await Promise.race([quick, new Promise(r => setTimeout(r, 5000))]);
    ctx.deciding = false;
    if (ctx.v !== routeId || ctx.mode) return;
  }
  const mem = srcMemory.get(ctx.a);
  const memIdx = mem?.kind === 'source' ? ctx.sources.findIndex(x => x.name === mem.name) : -1;
  const tr = store.get('preferTr', true) ? trIndex(ctx.sources, wantsDub(ctx)) : -1;
  if (memIdx >= 0) mountPlayer(ctx, memIdx);
  else if (tr >= 0) mountPlayer(ctx, tr);
  else if (ctx.embeds.length) mountEmbed(ctx, preferredEmbed(ctx));
  else if (ctx.sources.length) mountPlayer(ctx, 0);
  else if (ctx.remote !== 'loading') emptyStage(ctx);
}
async function fetchRemote(ctx, budget = 0) {
  let d;
  try { d = await api(playPath(ctx, 'remote') + (budget ? `&budget=${budget}` : ''), budget ? budget + 6000 : 40000, {quiet: true}); } catch { d = {sources: []}; }
  if (ctx.v !== routeId) return;
  // İmzalı adresler her istekte değişebilir; aynı kaynak + ad ikinci kez eklenmez.
  const sig = x => `${x.origin || ''}|${x.name}`;
  const known = new Set((ctx.sources || []).flatMap(x => [x.url, sig(x)]));
  const fresh = (d.sources || []).filter(x => !known.has(x.url) && !known.has(sig(x)) && known.add(sig(x)));
  const knownEmbed = new Set((ctx.embeds || []).map(e => e.url));
  const freshEmbeds = (d.embeds || []).filter(e => e?.url && !knownEmbed.has(e.url));
  if (freshEmbeds.length) {
    const combined = [...(ctx.embeds || []), ...freshEmbeds];
    // Açık iframe'in indeksi ve olay dinleyicileri arka plan sorgusuyla değişmemeli.
    ctx.embeds = ctx.mode === 'embed' ? combined : rankEmbeds(combined);
  }
  const firstFresh = ctx.sources.length;
  ctx.sources = [...(ctx.sources || []), ...fresh];
  paintSourceAvailability(ctx);
  // Yeni gelenler arasında Türkçe dublaj varsa bildirim onu açar.
  const dubAt = fresh.findIndex(x => x.dub);
  const announce = () => {
    if (!fresh.length) return;
    const at = dubAt >= 0 ? firstFresh + dubAt : firstFresh;
    toast(dubAt >= 0 ? 'Türkçe dublaj bulundu' : `${fresh.length} doğrudan kaynak bulundu`, 'success', {label: 'Şimdi izle', fn: () => { if (ctx.v === routeId) mountPlayer(ctx, at); }});
  };
  // Kısa sorgu yalnızca eldekini ekler; arama durumunu tam sorgu kapatır.
  const offerDizi = () => {
    const freshPin = freshEmbeds.find(e => e.pin && !ctx.failedSources?.has(sourceIdentity('embed', e))); 
    if (!freshPin || ctx.v !== routeId) return;
    const at = ctx.embeds.findIndex(e => e.url === freshPin.url);
    if (at < 0 || (ctx.mode === 'embed' && ctx.index === at)) return;
    if (!ctx.played && (ctx.autoSkips > 0 || ctx.mode !== 'embed')) { mountEmbed(ctx, at); return; }
    toast(`${freshPin.name} oynatıcısı bulundu`, 'success', {label: 'Şimdi izle', fn: () => { if (ctx.v === routeId) mountEmbed(ctx, at); }});
  };
  if (budget) {
    if ((fresh.length || freshEmbeds.length) && ctx.mode) refreshSrcBar(ctx);
    if (ctx.mode === 'embed') { announce(); offerDizi(); }
    return;
  }
  ctx.remote = ctx.sources.some(x => x.origin !== 'local' && x.origin !== 'manifest') ? 'done' : 'none';
  paintSourceAvailability(ctx);
  if (ctx.mode === 'embed') {
    refreshSrcBar(ctx);
    announce();
    offerDizi();
  } else if (!ctx.mode && !ctx.deciding) {
    // Hiç embed yoktu: bulunanı aç, yoksa boş durumu göster
    if (ctx.sources.length) mountPlayer(ctx, 0); else emptyStage(ctx);
  } else if (ctx.mode === 'player') {
    refreshSrcBar(ctx);
    // Doğrudan kaynaklar açılmadan düştüyse Dizi78 hazır olduğunda ona geç.
    if (!ctx.played && ((ctx.autoSkips || 0) > 0 || ctx.failShown)) offerDizi();
  }
}
// Tercihleri hatırla: son seçilen embed ve (anime için) altyazılı / dublaj.
// Başlık başına kaynak hafızası: en son gerçekten oynayan kaynak (oynatıcı ilerleme bildirdiğinde kaydedilir).
const srcMemory = {
  get: a => store.get('srcMem', {})[keyOf(a)] || null,
  set(a, kind, name) {
    const all = store.get('srcMem', {});
    if (all[keyOf(a)]?.name === name) return;
    all[keyOf(a)] = {kind, name, at: Date.now()};
    const keys = Object.keys(all);
    if (keys.length > 300) keys.sort((x, y) => all[x].at - all[y].at).slice(0, 50).forEach(k => delete all[k]);
    store.set('srcMem', all);
  },
};
// Oynatıcı sağlığı (bu tarayıcıda öğrenilir): ilerleme bildiren ya da uzun süre izlenen embed puan kazanır,
// hata bildiren ya da açıldıktan hemen sonra bırakılan puan kaybeder. Eski kayıtlar zamanla etkisini yitirir.
const embedHealth = {
  all: () => store.get('embedHealth', {}),
  score(id) {
    const h = this.all()[id];
    if (!h) return 0;
    const decay = Math.pow(0.5, (Date.now() - h.at) / (14 * 864e5));   // iki haftada yarıya iner
    return (h.ok - 1.5 * h.fail) * decay;
  },
  mark(id, ok) {
    if (!id) return;
    const all = this.all(), h = all[id] || {ok: 0, fail: 0, at: 0};
    const decay = h.at ? Math.pow(0.5, (Date.now() - h.at) / (14 * 864e5)) : 1;
    all[id] = {ok: Math.min(h.ok * decay + (ok ? 1 : 0), 20), fail: Math.min(h.fail * decay + (ok ? 0 : 1), 20), at: Date.now()};
    store.set('embedHealth', all);
  },
};
// Gruplar (Türkçe fansub → anime → genel) korunur; grup içinde sağlık puanı yüksek olan öne alınır.
function rankEmbeds(list) {
  const group = e => e.tr ? 0 : e.anime ? 1 : 2;
  return list.map((e, i) => ({e, i, s: embedHealth.score(e.id) - (e.backup ? 0.5 : 0)}))
    .sort((a, b) => group(a.e) - group(b.e) || (Math.abs(b.s - a.s) > 0.01 ? b.s - a.s : a.i - b.i)).map(x => x.e);
}
function preferredEmbed(ctx) {
  const pref = store.get('embedPref', null);
  const list = ctx.embeds || [];
  const mem = srcMemory.get(ctx.a);
  if (mem?.kind === 'embed') { const i = list.findIndex(e => e.name === mem.name); if (i >= 0) return i; }
  // Türkçe öncelik açıksa anime için Türkçe fansub arşivi önce gelir
  if (store.get('preferTr', true)) { const i = list.findIndex(e => e.tr); if (i >= 0) return i; }
  if (pref?.id) { const i = list.findIndex(e => e.id === pref.id); if (i >= 0) return i; }
  if (pref?.lang) { const i = list.findIndex(e => e.anime && e.lang === pref.lang); if (i >= 0) return i; }
  return 0;
}
const EMBED_SHOWN = 6;
function srcBarHtml(ctx, mode, index) {
  const direct = ctx.sources || [], embeds = ctx.embeds || [];
  const chip = (cls, attr, text) => `<button class="source-chip ${cls}" type="button" ${attr} title="${esc(text)}">${esc(text)}</button>`;
  const status = ctx.remote === 'loading' ? '<span class="src-status" role="status"><span class="spin"></span>Doğrudan kaynaklar aranıyor…</span>' : '';
  const own = direct.length && direct.every(x => x.origin === 'local' || x.origin === 'manifest');

  // Türkçe dublaj doğrudan kaynaklar en öne; diğerleri arkada
  const dubDirect  = direct.filter(x => x.dub || x.lang === 'tr');
  const restDirect = direct.filter(x => !x.dub && x.lang !== 'tr');

  // Embed'leri kategorize et: tr fansub, pin (Türkçe dublaj embed), anime, genel, backup
  const trList   = embeds.map((e,i)=>[e,i]).filter(([e])=>e.tr);
  const pinList  = embeds.map((e,i)=>[e,i]).filter(([e])=>e.pin && !e.tr);
  const aniList  = embeds.map((e,i)=>[e,i]).filter(([e])=>e.anime && !e.pin && !e.tr);
  const genList  = embeds.map((e,i)=>[e,i]).filter(([e])=>!e.anime && !e.tr && !e.pin && !e.backup);
  const bakList  = embeds.map((e,i)=>[e,i]).filter(([e])=>e.backup);

  // Doğrudan kaynaklar için kısa isim: "SinemaCX" değil de uzun sağlayıcı + etiket
  const srcName = x => {
    const base = x.name || '';
    if (x.dub && !/dublaj/i.test(base)) return `${base} · TR Dublaj`;
    return base;
  };

  const allDirect = [...dubDirect, ...restDirect];

  return `${allDirect.length ? `<span class="source-label">${own ? 'Dosya' : 'Doğrudan'}</span><div class="source-list">${allDirect.map((x,i) => {
    const realIdx = direct.indexOf(x);
    return chip(`${mode==='player'&&realIdx===index?'on':''} ${x.lang==='tr'?'is-tr':''} ${x.dub?'is-dub':''}`, `data-source="${realIdx}"`, srcName(x));
  }).join('')}</div>` : ''}
    ${pinList.length ? `<span class="source-label">Türkçe</span><div class="source-list">${pinList.map(([e,i])=>chip(`${mode==='embed'&&i===index?'on':''} is-dub`,`data-embed="${i}"`,e.name)).join('')}</div>` : ''}
    ${trList.length ? `<span class="source-label">Türkçe fansub</span><div class="source-list">${trList.map(([e,i])=>chip(`${mode==='embed'&&i===index?'on':''} is-tr`,`data-embed="${i}"`,e.name)).join('')}</div>` : ''}
    ${aniList.length ? `<span class="source-label">Anime</span><div class="source-list">${aniList.map(([e,i])=>chip(`${mode==='embed'&&i===index?'on':''}`,`data-embed="${i}"`,e.name)).join('')}</div>` : ''}
    ${genList.length ? `<span class="source-label">Embed</span><div class="source-list">${genList.map(([e,i],k)=>(k<EMBED_SHOWN||ctx.moreEmbeds||(mode==='embed'&&i===index))?chip(`${mode==='embed'&&i===index?'on':''}`,`data-embed="${i}"`,e.name):'').join('')}${genList.length>EMBED_SHOWN?`<button class="source-chip source-chip-dim" type="button" data-more-embeds>${ctx.moreEmbeds?'Daha az':`+${genList.length-EMBED_SHOWN}`}</button>`:''}</div>` : ''}
    ${bakList.length&&ctx.moreEmbeds ? `<span class="source-label">Yedek</span><div class="source-list">${bakList.map(([e,i])=>chip(`${mode==='embed'&&i===index?'on':''} is-backup`,`data-embed="${i}"`,e.name)).join('')}</div>` : ''}
    ${status}`;
}
function bindSrcBar(ctx) {
  const bar = $('#src-bar');
  if (!bar) return;
  bar.querySelectorAll('[data-source]').forEach(b => b.onclick = () => { ctx.autoSkips = 0; ctx.failShown = false; mountPlayer(ctx, Number(b.dataset.source)); });
  $('[data-more-embeds]', bar)?.addEventListener('click', () => { ctx.moreEmbeds = !ctx.moreEmbeds; refreshSrcBar(ctx); });
  bar.querySelectorAll('[data-embed]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.embed), e = ctx.embeds[i];
    ctx.autoSkips = 0; ctx.failShown = false;
    if (e) store.set('embedPref', {id: e.id, lang: e.anime ? e.lang : store.get('embedPref', null)?.lang});
    mountEmbed(ctx, i);
  });
}
function refreshSrcBar(ctx) {
  const bar = $('#src-bar');
  if (!bar) return;
  bar.innerHTML = srcBarHtml(ctx, ctx.mode, ctx.index);
  bindSrcBar(ctx);
}
// Mevcut kaynak çalışmadığında sıradakine geç (doğrudan kaynaklar, sonra embed'ler).
function sourceIdentity(mode, source) { return mode + ':' + (source?.url || source?.name || ''); }
function nextCandidate(ctx) {
  const failed = ctx.failedSources || new Set();
  const direct = (ctx.sources || []).map((source, index) => ({mode: 'player', source, index}));
  const embeds = (ctx.embeds || []).map((source, index) => ({mode: 'embed', source, index}));
  const ordered = ctx.mode === 'player' ? [...direct.slice(ctx.index + 1), ...embeds, ...direct.slice(0, ctx.index)] : [...embeds.slice(ctx.index + 1), ...direct, ...embeds.slice(0, ctx.index)];
  return ordered.find(x => !failed.has(sourceIdentity(x.mode, x.source)));
}
function nextSource(ctx) {
  const current = (ctx.mode === 'player' ? ctx.sources : ctx.embeds)?.[ctx.index];
  (ctx.failedSources ||= new Set()).add(sourceIdentity(ctx.mode, current));
  const next = nextCandidate(ctx);
  if (!next) { toast('Başka kaynak kalmadı; yeniden deneyebilir veya daha sonra açabilirsin'); return; }
  if (next.mode === 'player') mountPlayer(ctx, next.index); else mountEmbed(ctx, next.index);
}

function emptyStage(ctx) {
  const a = ctx.a;
  const label = isMovie(a) ? 'Bu film' : `${ctx.s}. sezon ${ctx.e}. bölüm`;

  $('#stage').innerHTML = `<div class="stage-inner stage-empty">
    ${a.backdrop ? `<img class="stage-bg" src="${esc(a.backdrop)}" alt="" data-fb>` : ''}
    <div class="stage-msg">
      <h2>${label} için video dosyası yok</h2>
      <p>Bu bölüm için sitede oynatılabilir bir kaynak bulunamadı.</p>
      <div class="actions">
        ${a.trailer ? `<button class="btn btn-ghost" data-trailer>${PLAY}Fragmanı izle</button>` : ''}
      </div>
    </div></div>`;
  const st = $('#stage');
  $('[data-trailer]', st)?.addEventListener('click', () => openTrailer(a.trailer));
  imgFallback(st);
  $('#now') && updateNow(ctx);
}

// ---------------- Embed iframe oynatıcı (VidRift, VidPlus, Vidy, VidSrc, VidRock, MegaPlay) ----------------
// Oynatıcıların gönderdiği olayları tek biçime çevirir: {time, duration, ended, failed, episode, exit}
// Desteklenenler: VidRift, Vidy, PLAYER_EVENT ailesi (VidFast, VixSrc, VidUP, VidZee, Vidrock, TryEmbed, AniFlow),
// VidSrc.sh (player_status), MoviesAPI, Zokoanime, watching-log (AniFlow, MegaPlay), Viduki, VidCore, Videasy (çift JSON).
function parsePlayerMessage(raw) {
  let d = raw;
  for (let i = 0; i < 2 && typeof d === 'string'; i++) { try { d = JSON.parse(d); } catch { return /^(ended|complete)$/i.test(d) ? {ended: true} : null; } }
  if (!d || typeof d !== 'object') return null;
  const num = v => (typeof v === 'number' && isFinite(v) ? v : Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : undefined);
  if (typeof d.type === 'string' && d.type.startsWith('vidrift:')) {
    if (d.type === 'vidrift:progress') return {time: num(d.currentTime), duration: num(d.duration)};
    if (d.type === 'vidrift:ended') return {ended: true};
    if (d.type === 'vidrift:episode') return {episode: {s: num(d.season), e: num(d.episode)}};
    if (d.type === 'vidrift:exit') return {exit: true};
    if (d.type === 'vidrift:error') return {failed: true};
    return null;
  }
  if (d.type === 'PLAYER_EVENT' && d.data && typeof d.data === 'object') {
    const x = d.data;
    if (x.player_status) return {time: num(x.player_progress), duration: num(x.player_duration), ended: x.player_status === 'completed', failed: /^(error|failed)$/.test(x.player_status)};
    const ev = x.event || x.type;
    return {time: num(x.currentTime), duration: num(x.duration), ended: ev === 'ended' || ev === 'complete', failed: ev === 'error'};
  }
  if (d.source === 'moviesapi-player') { const x = d.data || d; const ev = d.event || d.type; return {time: num(x.currentTime), duration: num(x.duration), ended: ev === 'ended'}; }
  if (d.channel === 'zokoanime') { const x = d.data || d; return {time: num(x.position ?? x.currentTime), duration: num(x.duration), ended: d.type === 'ended' || d.type === 'complete', failed: d.type === 'error'}; }
  if (d.type === 'watching-log') return {time: num(d.currentTime), duration: num(d.duration)};
  if (d.type === 'viduki:all-servers-failed') return {failed: true};
  if (d.type === 'vidcore:ended') return {ended: true};
  if (d.event === 'timeupdate' && 'currentTime' in d) return {time: num(d.currentTime), duration: num(d.duration)};
  if (d.event === 'ended') return {ended: true};
  return null;
}
// Kaldığı yerden başlat: oynatıcı destekliyorsa kayıtlı saniyeyi adrese ekler.
function embedUrlFor(ctx, embed) {
  const saved = progress[`${keyOf(ctx.a)}:${ctx.s}:${ctx.e}`];
  if (!embed.resume || !store.get('resume', true) || !saved || saved.t < 10 || saved.t > saved.d - 30) return embed.url;
  try { const u = new URL(embed.url); u.searchParams.set(embed.resume, String(Math.floor(saved.t))); return u.href; } catch { return embed.url; }
}

function mountEmbed(ctx, index) {
  const embeds = ctx.embeds || [];
  const embed = embeds[index];
  if (!embed) { emptyStage(ctx); return; }
  destroyPlayer();
  const stage = $('#stage');
  ctx.mode = 'embed'; ctx.index = index; ctx.failShown = false; ctx.played = false;
  const src = embedUrlFor(ctx, embed);

  stage.innerHTML = `<div class="stage-inner vidrift-wrap">
    <iframe
      class="vidrift-frame"
      src="${esc(src)}"
      allowfullscreen
      allow="autoplay; fullscreen; encrypted-media *; autoplay *; fullscreen *; picture-in-picture *"
      title="${esc(ctx.a.title)}"
      referrerpolicy="${embed.referrer === 'no-referrer' ? 'no-referrer' : 'strict-origin-when-cross-origin'}"
    ></iframe>
    <div class="next-up" id="next-up" hidden></div>
  </div>
  <div class="src-bar" id="src-bar">${srcBarHtml(ctx, 'embed', index)}</div>`;

  bindSrcBar(ctx);

  // iframe load olayı 404 sayfasında da çalışır; oynatma kanıtı değildir.
  const iframeEl = stage.querySelector('.vidrift-frame');
  const help = document.createElement('div');
  help.className = 'source-help';
  help.innerHTML = '<span role="status">Görüntü yok veya hata mı var?</span><button type="button" class="btn btn-sm btn-ghost" data-retry-source>Yeniden dene</button><button type="button" class="btn btn-sm btn-play" data-next-src>Sonraki kaynağı dene</button>';
  stage.append(help);
  $('[data-next-src]', help).onclick = () => { markHealth(false); nextSource(ctx); };
  $('[data-retry-source]', help).onclick = () => mountEmbed(ctx, index);
  const embedErrorTimer = setTimeout(() => {
    if (ctx.v !== routeId || ctx.mode !== 'embed' || ctx.index !== index || ctx.played) return;
    $('[role="status"]', help).textContent = 'Görüntü başlamadıysa başka kaynağı deneyebilirsin.';
  }, 15000);

  // Oynatıcı olayları: ilerlemeyi kaydet, bitince sonraki bölüm, "tüm sunucular başarısız" olunca sıradaki kaynak.
  const embedOrigin = (() => { try { return new URL(embed.url).origin; } catch { return ''; } })();
  let lastSave = 0, endedOnce = false, failedOnce = false, healthMarked = false;
  const mountedAt = Date.now(), view = ctx.v;
  const markHealth = ok => { if (!healthMarked) { healthMarked = true; embedHealth.mark(embed.id, ok); } };
  // Sağlık puanı yalnızca gerçek oynatma ilerlemesiyle yükselir.
  const onMessage = e => {
    // Yalnızca bu iframe'den (ya da aynı sağlayıcının iç çerçevesinden) gelen mesajlar
    if (!iframeEl || (e.source !== iframeEl.contentWindow && e.origin !== embedOrigin)) return;
    const ev = parsePlayerMessage(e.data);
    if (!ev) return;
    if (ev.time > 5) markHealth(true);
    if (ev.failed) markHealth(false);
    if (ev.time > 0 && ev.duration > 0 && Date.now() - lastSave > 4000) { lastSave = Date.now(); saveProgress(ctx.a, ctx.s, ctx.e, ev.time, ev.duration); srcMemory.set(ctx.a, 'embed', embed.name); }
    if (ev.episode?.s && ev.episode?.e) { history.replaceState(null, '', watchHref(ctx.a, ev.episode.s, ev.episode.e)); ctx.s = ev.episode.s; ctx.e = ev.episode.e; updateNow(ctx); }
    if (ev.exit) history.back();
    if (ev.ended && !endedOnce && !(ev.duration > 0 && ev.time > 0 && ev.duration - ev.time > 90)) {
      endedOnce = true;
      if (ev.duration > 0) saveProgress(ctx.a, ctx.s, ctx.e, ev.duration, ev.duration);
      const n = nextOf(ctx);
      if (n) nextUp(ctx, n);
    }
    if (ev.time > 2) ctx.played = true;
    if (ev.failed && !failedOnce && ctx.mode === 'embed' && ctx.index === index) {
      failedOnce = true;
      stageError(ctx, 'Bu kaynak videoyu açamadı. Başka bir kaynak deneyebilirsin.');
    }
  };
  window.addEventListener('message', onMessage);
  player = {
    video: null, hls: null, art: null, dash: null,
    cleanup: [
      () => window.removeEventListener('message', onMessage),
      () => clearTimeout(embedErrorTimer),
      // Aynı sayfada 30 saniye dolmadan başka kaynağa geçildiyse bu oynatıcı açılmamış sayılır
      () => { if (ctx.v === view && ctx.v === routeId && Date.now() - mountedAt < 30000) markHealth(false); },
    ]
  };

  $('#now') && updateNow(ctx);
}
function bindLocalHint(ctx) {
  const hint = $('#add-local-hint');
  if (!hint) return;
  hint.onclick = () => {
    const stage = $('#stage');
    const details = document.createElement('details');
    details.className = 'addfile';
    details.innerHTML = `<summary>Kendi dosyamı nasıl eklerim?</summary>
      <p>Videoyu proje içindeki <code>media/${esc(ctx.folder)}/</code> klasörüne ${isMovie(ctx.a) ? 'koy' : `<code>S${String(ctx.s).padStart(2, '0')}E${String(ctx.e).padStart(2, '0')}.mp4</code> adıyla koy`}.</p>
      <div class="actions"><button class="btn btn-ghost btn-sm" data-copy="${esc(ctx.folder)}">Klasör adını kopyala</button><button class="btn btn-ghost btn-sm" data-rescan>Yeniden tara</button></div>`;
    stage.querySelector('.src-bar')?.after(details);
    $('[data-copy]', details)?.addEventListener('click', ev => navigator.clipboard?.writeText(ev.target.dataset.copy).then(() => toast('Kopyalandı'), () => toast(ev.target.dataset.copy)));
    $('[data-rescan]', details)?.addEventListener('click', async () => { await refreshLibrary(true); loadSources(ctx); toast(library.has(keyOf(ctx.a)) ? 'Klasör tarandı' : 'Bu anime için dosya bulunamadı'); });
    hint.remove();
  };
}

// Geriye dönük uyumluluk
function mountVidrift(ctx) { mountEmbed(ctx, 0); }

// ArtPlayer (https://artplayer.org) ve hls.js sitenin kendi dosyalarından bir kez yüklenir; yüklenemezse tarayıcının kendi oynatıcısı kullanılır.
const loadScript = url => new Promise((res, rej) => {
  const s = document.createElement('script');
  const finish = error => { clearTimeout(timer); s.onload = s.onerror = null; if (error) { s.remove(); rej(error); } else res(); };
  const timer = setTimeout(() => finish(Error('Oynatıcı yükleme zaman aşımı')), 8000);
  s.src = url; s.async = true; s.onload = () => finish(); s.onerror = () => finish(Error('Oynatıcı yüklenemedi'));
  document.head.append(s);
});
let artReady, hlsReady, dashReady;
const getArt = () => artReady ||= loadScript('/public/vendor/artplayer-5.2.3.js').then(() => window.Artplayer).catch(() => { artReady = null; return null; });
const getHls = () => hlsReady ||= loadScript('/public/vendor/hls-1.5.20.min.js').then(() => window.Hls).catch(() => { hlsReady = null; return null; });
const getDash = () => dashReady ||= loadScript('/public/vendor/dash-5.2.1.min.js').then(() => window.dashjs).catch(() => { dashReady = null; return null; });
const ART_TR = {'Video Info': 'Video bilgisi', Close: 'Kapat', 'Video Load Failed': 'Video yüklenemedi', Volume: 'Ses', Play: 'Oynat', Pause: 'Duraklat', Rate: 'Hız', Mute: 'Sesi kapat', 'Video Flip': 'Çevir', Horizontal: 'Yatay', Vertical: 'Dikey', Reconnect: 'Yeniden bağlan', 'Show Setting': 'Ayarlar', 'Hide Setting': 'Ayarları gizle', Screenshot: 'Ekran görüntüsü', 'Play Speed': 'Oynatma hızı', 'Aspect Ratio': 'En boy oranı', Default: 'Varsayılan', Normal: 'Normal', Open: 'Aç', 'Switch Video': 'Video değiştir', 'Switch Subtitle': 'Altyazı', Fullscreen: 'Tam ekran', 'Exit Fullscreen': 'Tam ekrandan çık', 'Web Fullscreen': 'Pencere tam ekran', 'Exit Web Fullscreen': 'Pencere tam ekrandan çık', 'Mini Player': 'Mini oynatıcı', 'PIP Mode': 'Resim içinde resim', 'Exit PIP Mode': 'Resim içinde resimden çık', 'PIP Not Supported': 'Desteklenmiyor', 'Fullscreen Not Supported': 'Tam ekran desteklenmiyor', 'Subtitle Offset': 'Altyazı kaydırma', 'Last Seen': 'Son izlenen', 'Jump Play': 'Oraya git', AirPlay: 'AirPlay', 'AirPlay Not Available': 'AirPlay yok', 'Subtitle': 'Altyazı', 'Off': 'Kapalı'};

async function mountPlayer(ctx, index) {
  destroyPlayer();
  ctx.failShown = false; ctx.played = false;
  const src = ctx.sources[index];
  const stage = $('#stage');
  ctx.mode = 'player'; ctx.index = index;
  stage.innerHTML = `<div class="stage-inner"><div class="art" id="art">${loading('Oynatıcı hazırlanıyor')}</div>
    <div class="next-up" id="next-up" hidden></div></div>
    <div class="src-bar" id="src-bar">${srcBarHtml(ctx, 'player', index)}</div>`;
  bindSrcBar(ctx);
  const p = {video: null, hls: null, art: null, cleanup: []};
  player = p;
  const isHls = src.type === 'hls';
  const isDash = src.type === 'dash';
  const [Art, Hls, Dash] = await Promise.all([getArt(), isHls ? getHls() : null, isDash ? getDash() : null]);
  if (player !== p) return;
  const subs = src.subtitles || [];
  // Dublajlı kaynakta altyazı kendiliğinden açılmaz (listede kalır)
  const firstSub = src.dub ? null : subs.find(t => t.lang === 'tr') || subs[0];
  const attachHls = (video, url) => {
    // hls.js önce: Chrome'un yeni yerleşik HLS desteği bazı akışlarda takılıyor ve ses izi seçimi sunmuyor.
    // Yerleşik oynatıcı yalnızca hls.js'in çalışmadığı yerlerde (iOS Safari) kullanılır.
    if (!Hls?.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = url; return; }
      stageError(ctx, 'HLS oynatıcısı yüklenemedi. İnternet bağlantını kontrol et.'); return;
    }
    p.hls = new Hls({maxBufferLength: 30, capLevelToPlayerSize: true});
    p.hls.loadSource(url);
    p.hls.attachMedia(video);
    let recovered = 0;
    p.hls.on(Hls.Events.MANIFEST_PARSED, () => {
      const levels = p.hls?.levels || [];
      const ok = levels.map((l, i) => ({l, i})).filter(({l}) => !/hvc1|hev1|dvh1|av01/i.test(`${l.videoCodec || ''} ${l.attrs?.CODECS || ''}`) && (!l.height || l.height <= 1080));
      if (ok.length && p.hls) p.hls.currentLevel = ok[ok.length - 1].i;
      if (levels.length > 1 && p.art) {
        const label = (l, i) => l.height ? `${l.height}p` : `Seviye ${i + 1}`;
        const setting = {name: 'quality', html: 'Kalite', tooltip: 'Otomatik', selector: [{html: 'Otomatik', auto: true}, ...levels.map((l, i) => ({html: label(l, i), i, default: p.hls.currentLevel === i}))],
          onSelect(item) { if (p.hls) p.hls.currentLevel = item.auto ? -1 : item.i; return item.html; }};
        try { p.art.setting.add(setting); } catch {}
      }
    });
    p.hls.on(Hls.Events.ERROR, (_, d) => {
      if (player !== p || !d.fatal || !p.hls) return;
      if (recovered < 1 && d.type === Hls.ErrorTypes.MEDIA_ERROR) { recovered++; p.hls.recoverMediaError(); return; }
      if (recovered < 1 && d.type === Hls.ErrorTypes.NETWORK_ERROR) { recovered++; p.hls.startLoad(); return; }
      try { p.hls.destroy(); } catch {}
      p.hls = null;
      stageError(ctx, 'Akış oynatılamadı.');
    });
    // Çok sesli akışlar (ör. dublaj kaynaklarında Türkçe + İngilizce): tercihe göre ses izini seç, ayarlara "Ses" ekle
    p.hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, d) => {
      if (player !== p || !p.hls) return;
      const tracks = d.audioTracks || [];
      if (tracks.length < 2) return;
      const isTr = isTurkishAudio;
      const trI = tracks.findIndex(isTr);
      const want = wantsDub(ctx) ? trI : tracks.findIndex(t => !isTr(t));
      if (want >= 0 && p.hls.audioTrack !== want) p.hls.audioTrack = want;
      const label = (t, i) => t.name || t.lang || `Ses ${i + 1}`;
      const setting = {name: 'audio', html: 'Ses', tooltip: label(tracks[p.hls.audioTrack] || tracks[0], p.hls.audioTrack),
        selector: tracks.map((t, i) => ({html: label(t, i), i, default: i === p.hls.audioTrack})),
        onSelect(item) { if (player !== p || !p.hls) return item.html; p.hls.audioTrack = item.i; store.set('preferDub', isTr(tracks[item.i])); paintWatchOpts(ctx); return item.html; }};
      setTimeout(() => { try { if (!p.art) return; if (p.audioSetting) p.art.setting.update(setting); else p.art.setting.add(setting); p.audioSetting = true; } catch {} }, 0);
    });
  };
  const attachDash = (video, url) => {
    if (!Dash?.MediaPlayer) { stageError(ctx, 'DASH oynatıcısı yüklenemedi. İnternet bağlantını kontrol et.'); return; }
    p.dash = Dash.MediaPlayer().create();
    p.dash.initialize(video, url, false);
    p.dash.on(Dash.MediaPlayer.events.ERROR, () => { if (player === p) stageError(ctx, 'Akış oynatılamadı (DASH hatası).'); });
  };
  let video;
  if (Art) {
    $('#art').innerHTML = '';
    Art.NOTICE_TIME = 0;
    p.art = new Art({
      container: '#art', url: src.url, poster: ctx.a.backdrop || '', type: isHls ? 'm3u8' : isDash ? 'mpd' : '',
      customType: {m3u8: (v, url) => attachHls(v, url), mpd: (v, url) => attachDash(v, url)},
      theme: getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#ff4f5e',
      lang: 'tr', i18n: {tr: ART_TR},
      volume: Number(store.get('volume', 0.8)), autoplay: false, autoSize: false, autoMini: false,
      setting: true, playbackRate: true, aspectRatio: true, pip: true, fullscreen: true, fullscreenWeb: true,
      hotkey: true, mutex: true, backdrop: true, playsInline: true, miniProgressBar: true, lock: true, fastForward: true, autoOrientation: true,
      subtitle: firstSub ? {url: firstSub.url, type: firstSub.type || 'vtt', encoding: 'utf-8', escape: true, style: {fontSize: 'clamp(16px, 2.6vw, 30px)', textShadow: '0 1px 3px #000, 0 0 2px #000'}} : {style: {fontSize: 'clamp(16px, 2.6vw, 30px)', textShadow: '0 1px 3px #000, 0 0 2px #000'}},
      settings: subs.length ? [subtitleSetting(p, subs, firstSub)] : [],
      controls: nextOf(ctx) ? [{position: 'left', index: 15, html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 5v14l9-7zM16 5h2v14h-2z"/></svg>', tooltip: 'Sonraki bölüm', click: () => { const n = nextOf(ctx); if (n) go(ctx, n.s, n.e); }}] : [],
    });
    p.art.on('video:volumechange', () => store.set('volume', p.art.volume));
    p.art.on('play', () => {
      if (!store.get('autoFs', false) || p.fsTried) return;
      p.fsTried = true;
      try { p.art.fullscreen = true; } catch { try { p.art.fullscreenWeb = true; } catch {} }
    });
    video = p.art.video;
    p.cleanup.push(() => p.art.destroy(false));
  } else {
    $('#art').innerHTML = `<video id="video" controls playsinline preload="metadata" ${ctx.a.backdrop ? `poster="${esc(ctx.a.backdrop)}"` : ''}></video>`;
    video = $('#video');
    for (const t of subs) {
      const tr = document.createElement('track');
      Object.assign(tr, {kind: 'subtitles', label: t.label, srclang: t.lang, src: t.url});
      if (t === firstSub) tr.default = true;
      video.append(tr);
    }
    if (isHls) attachHls(video, src.url); else if (isDash) attachDash(video, src.url); else video.src = src.url;
  }
  p.video = video;
  const selectNativeAudio = () => { if (player === p && !p.hls) selectPlayerAudio(p, wantsDub(ctx)); };
  video.addEventListener('loadedmetadata', selectNativeAudio);
  video.audioTracks?.addEventListener('addtrack', selectNativeAudio);
  p.cleanup.push(() => { video.removeEventListener('loadedmetadata', selectNativeAudio); video.audioTracks?.removeEventListener('addtrack', selectNativeAudio); });
  setupSkip(ctx, video, p);
  // Türkçe altyazısı olmayan yabancı kaynaklara Türkçe altyazı ekle (sunucuda Wyzie anahtarı varsa)
  if (p.art && SUBS_ON && src.lang !== 'tr' && !subs.some(t => t.lang === 'tr') && !isAnimeArchive(src)) addTurkishSubs(ctx, p, subs);
  video.addEventListener('timeupdate', () => { if (video.currentTime > 2) ctx.played = true; if (video.currentTime > 20) srcMemory.set(ctx.a, 'source', src.name); }, {once: false, passive: true});

  const k = `${keyOf(ctx.a)}:${ctx.s}:${ctx.e}`;
  let lastSave = 0;
  video.addEventListener('loadedmetadata', () => {
    const saved = progress[k];
    if (store.get('resume', true) && saved && saved.t > 5 && saved.t < video.duration - 20) { video.currentTime = saved.t; toast(`${fmtTime(saved.t)} noktasından devam ediliyor`); }
  });
  const persist = () => saveProgress(ctx.a, ctx.s, ctx.e, video.currentTime, video.duration);
  video.addEventListener('timeupdate', () => { if (Date.now() - lastSave > 5000) { lastSave = Date.now(); persist(); } });
  video.addEventListener('pause', persist);
  video.addEventListener('error', () => { if (player === p && (!isHls && !isDash || isHls && !p.hls)) stageError(ctx, src.type === 'mkv' ? 'Bu MKV dosyası tarayıcıda açılamadı. MP4 (H.264 + AAC) olarak dönüştürmeyi dene.' : 'Video açılamadı.'); });
  video.addEventListener('ended', () => { persist(); const n = nextOf(ctx); if (n) nextUp(ctx, n); });
  p.cleanup.push(persist);
}
// ArtPlayer altyazı ayarı (vtt ve srt)
function subtitleSetting(p, list, current) {
  return {name: 'subs', html: 'Altyazı', tooltip: current?.label || 'Kapalı', selector: [{html: 'Kapalı', off: true}, ...list.map(t => ({html: t.label, url: t.url, type: t.type || 'vtt', default: t === current}))],
    onSelect(item) { if (item.off) p.art.subtitle.show = false; else { p.art.subtitle.show = true; p.art.subtitle.switch(item.url, {name: item.html, type: item.type}); } return item.html; }};
}
const isAnimeArchive = src => src.origin === 'local' || src.origin === 'manifest';
async function addTurkishSubs(ctx, p, existing) {
  let d;
  try { d = await api(`/api/subs/${ctx.a.kind}/${ctx.a.id}?s=${ctx.s}&e=${ctx.e}`, 15000, {quiet: true}); } catch { return; }
  const extra = d?.subtitles || [];
  if (!extra.length || player !== p || !p.art) return;
  const all = [...extra, ...existing];
  try {
    if (existing.length) p.art.setting.update(subtitleSetting(p, all, extra[0]));
    else p.art.setting.add(subtitleSetting(p, all, extra[0]));
    p.art.subtitle.show = true;
    p.art.subtitle.switch(extra[0].url, {name: extra[0].label, type: extra[0].type});
    toast('Türkçe altyazı eklendi', 'success');
  } catch {}
}
// AniSkip: anime bölümlerinde giriş / bitiş / özet aralıkları (MAL id + bölüm). Düğmeyle ya da ayara göre otomatik atlar.
function setupSkip(ctx, video, p) {
  if (secOf(ctx.a) !== 'anime' || isMovie(ctx.a)) return;
  const ids = animeIds(ctx.a, ctx.s, ctx.e);
  if (!ids?.mal) return;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'skip-btn'; btn.hidden = true;
  $('#stage .stage-inner')?.append(btn);
  let ranges = [];
  const label = t => /op/.test(t) ? 'Girişi atla' : /ed/.test(t) ? 'Bitişi atla' : 'Özeti atla';
  video.addEventListener('loadedmetadata', async () => {
    try {
      const r = await fetch(`https://api.aniskip.com/v2/skip-times/${ids.mal}/${ids.ep}?types=op&types=ed&types=mixed-op&types=mixed-ed&types=recap&episodeLength=${Math.round(video.duration) || 0}`, {signal: AbortSignal.timeout(8000)});
      const d = await r.json();
      ranges = (d.results || []).map(x => ({type: x.skipType, start: x.interval.startTime, end: x.interval.endTime})).filter(x => x.end > x.start);
    } catch {}
  }, {once: true});
  const done = new Set();
  let meta = false;
  video.addEventListener('loadedmetadata', () => { meta = true; }, {once: true});
  const onTime = () => {
    const t = video.currentTime, cur = ranges.find(x => t >= x.start && t < x.end - 1);
    if (!cur && meta && !ranges.length && t > 4 && t < 90) {
      btn.hidden = false;
      btn.textContent = 'İntroyu atla ›';
      btn.onclick = () => { video.currentTime = 90; btn.hidden = true; };
      return;
    }
    if (!cur) { btn.hidden = true; return; }
    if (store.get('autoSkip', false) && !done.has(cur.start)) { done.add(cur.start); video.currentTime = cur.end; toast(`${label(cur.type).replace(' atla', '')} atlandı`); return; }
    btn.hidden = false;
    btn.textContent = `${label(cur.type)} ›`;
    btn.onclick = () => { video.currentTime = cur.end; btn.hidden = true; };
  };
  video.addEventListener('timeupdate', onTime);
  p.cleanup.push(() => { video.removeEventListener('timeupdate', onTime); btn.remove(); });
}
function nextUp(ctx, n) {
  const box = $('#next-up');
  if (!box) return;
  box.hidden = false;
  // Otomatik geçiş kapalıysa yalnızca "sonraki bölüm hazır" kartı gösterilir.
  if (!store.get('autoNext', true)) {
    box.innerHTML = `<p>Sonraki bölüm hazır: ${n.s}. sezon ${n.e}. bölüm</p><div class="actions"><a class="btn btn-play btn-sm" href="${watchHref(ctx.a, n.s, n.e)}">${PLAY}Oynat</a><button class="btn btn-ghost btn-sm" id="next-cancel">Kapat</button></div>`;
    $('#next-cancel').onclick = () => { box.hidden = true; };
    return;
  }
  let left = 8;
  const draw = () => box.innerHTML = `<p>Sonraki bölüm ${left} saniye içinde başlıyor</p><div class="actions"><a class="btn btn-play btn-sm" href="${watchHref(ctx.a, n.s, n.e)}">${PLAY}Şimdi oynat</a><button class="btn btn-ghost btn-sm" id="next-cancel">Vazgeç</button></div>`;
  draw();
  const t = setInterval(() => { left--; if (left <= 0) { clearInterval(t); go(ctx, n.s, n.e); } else { draw(); $('#next-cancel').onclick = cancel; } }, 1000);
  const cancel = () => { clearInterval(t); box.hidden = true; };
  $('#next-cancel').onclick = cancel;
  player?.cleanup.push(() => clearInterval(t));
}
function stageError(ctx, msg) {
  if (ctx.v !== routeId || ctx.failShown) return;
  ctx.failShown = true;
  const more = nextCandidate(ctx), at = ctx.index, p = player;
  if (more && ctx.mode === 'player' && !ctx.played && !(p?.video?.currentTime > 1) && (ctx.autoSkips || 0) < 1) {
    ctx.autoSkips = (ctx.autoSkips || 0) + 1;
    const timer = setTimeout(() => {
      if (player === p && ctx.index === at && ctx.v === routeId) nextSource(ctx);
    }, 300);
    p?.cleanup.push(() => clearTimeout(timer));
    return;
  }
  const box = document.createElement('div');
  box.className = 'stage-error'; box.setAttribute('role', 'alert');
  box.innerHTML = `<p>${esc(msg)}</p><button type="button" class="btn btn-sm btn-ghost" data-retry-source>Yeniden dene</button>${more ? '<button type="button" class="btn btn-sm btn-play" data-next-src>Sonraki kaynağı dene</button>' : ''}`;
  $('[data-next-src]', box)?.addEventListener('click', () => nextSource(ctx));
  $('[data-retry-source]', box).addEventListener('click', () => ctx.mode === 'player' ? mountPlayer(ctx, ctx.index) : mountEmbed(ctx, ctx.index));
  $('#stage .stage-inner')?.append(box);
}

function destroyPlayer() {
  if (!player) return;
  const previous = player; player = null;
  previous.cleanup.slice().reverse().forEach(f => { try { f(); } catch {} });
  try { previous.hls?.destroy(); } catch {}
  try { previous.dash?.reset(); } catch {}
  if (!previous.art && previous.video) { try { previous.video.pause(); previous.video.removeAttribute('src'); previous.video.load(); } catch {} }
  player = null;
}

// ---------------- Fragman ----------------
function openTrailer(t) {
  if (!t?.key) return;
  $('#trailer-frame').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.key)}?autoplay=1&rel=0&modestbranding=1" title="Fragman" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
  player?.video?.pause();
  $('#trailer-dialog').showModal();
}
$('#trailer-close').onclick = () => $('#trailer-dialog').close();
$('#trailer-dialog').addEventListener('close', () => { $('#trailer-frame').innerHTML = ''; });
$('#trailer-dialog').addEventListener('click', e => { if (e.target.id === 'trailer-dialog') e.target.close(); });

// ---------------- Arama ----------------
const sd = $('#search-dialog'), si = $('#search-input'), sr = $('#search-results');
let searchSeq = 0, searchTimer;
function openSearch() {
  const app = document.documentElement.dataset.app;
  if (app === 'hub' || app === 'lovellify') return;
  const live = $('#livetv-search');
  if (live && document.documentElement.dataset.section === 'livetv') { live.focus(); live.scrollIntoView({block: 'center', behavior: reduceMotion ? 'auto' : 'smooth'}); return; }
  if (!sd.open) sd.showModal();
  si.select();
  if (si.value.trim().length < 2) searchIdle();
}
$('#search-open').onclick = openSearch;
$('#search-close').onclick = () => sd.close();
sd.addEventListener('click', e => { if (e.target === sd) sd.close(); });
si.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = si.value.trim(), seq = ++searchSeq;
  if (q.length < 2) { searchIdle(); return; }
  sr.innerHTML = loading('Aranıyor');
  searchTimer = setTimeout(async () => {    try {
      const d = await api(withSection(`/api/search?q=${encodeURIComponent(q)}`));
      if (seq !== searchSeq) return;
      const top = d.items.slice(0, 14);
      const row = (a, i) => `<a class="result" role="option" href="${watchHref(a)}" data-i="${i}" style="--d:${i * 30}ms">
          <span class="result-img thumb">${a.poster ? `<img src="${esc(a.poster)}" alt="" data-fb>` : ''}</span>
          <span><strong>${esc(a.title)}</strong><small>${[a.year, kindLabel(a), a.score ? score(a.score) + ' puan' : ''].filter(Boolean).join(', ')}</small></span></a>`;
      // Sonuçlar dizi / film olarak gruplanır.
      const tvR = top.filter(a => !isMovie(a)), mvR = top.filter(isMovie);
      sr.innerHTML = top.length ? [[section === 'anime' ? 'Seriler' : 'Diziler', tvR], ['Filmler', mvR]].filter(([, l]) => l.length).map(([t, l]) => `<p class="result-group">${t}<small>${l.length}</small></p>${l.map(row).join('')}`).join('') + `<a class="result-all" href="#/kesfet?ara=${encodeURIComponent(q)}">“${esc(q)}” için tüm sonuçları gör</a>`
        : `<p class="muted pad">“${esc(q)}” için ${esc(S().label)} bölümünde sonuç yok. ${section === 'anime' ? 'Japonca ya da İngilizce adını dene, ya da Film & Dizi bölümünde ara.' : 'Orijinal adını dene; anime arıyorsan Anime bölümüne geç.'}</p>`;
      imgFallback(sr);
    } catch (e) { if (seq === searchSeq) sr.innerHTML = `<p class="muted pad">Arama yapılamadı: ${esc(e.message)}</p>`; }
  }, 300);
});
si.addEventListener('keydown', e => {
  const items = $$('.result', sr);
  if (!items.length || !['ArrowDown', 'ArrowUp'].includes(e.key)) { if (e.key === 'Enter' && items[0]) { e.preventDefault(); items[0].click(); } return; }
  e.preventDefault();
  items[0].focus();
});
sr.addEventListener('keydown', e => {
  const items = $$('.result', sr), i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); i <= 0 ? si.focus() : items[i - 1].focus(); }
});
sr.addEventListener('click', e => {
  const chip = e.target.closest('[data-q]');
  if (chip) { si.value = chip.dataset.q; si.dispatchEvent(new Event('input')); si.focus(); return; }
  if (e.target.closest('[data-clear-recent]')) { store.set('searches', []); searchIdle(); return; }
  if (e.target.closest('a')) { rememberSearch(si.value); sd.close(); }
});
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if ($('.livetv-modal')) return;
  if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); openSearch(); }
  // Hamburger menüyü Escape ile kapat
  if (e.key === 'Escape' && mainNav && mainNav.classList.contains('open')) {
    mainNav.classList.remove('open');
    hamburger?.setAttribute('aria-expanded', 'false');
    hamburger?.focus();
  }
});

// ---------------- Hamburger menü ----------------
const hamburger = $('#hamburger');
const mainNav = $('#main-nav');
const sideToggle = $('#side-toggle');
function paintSide(rail) {
  document.documentElement.dataset.side = rail ? 'rail' : 'open';
  sideToggle?.setAttribute('aria-expanded', String(!rail));
  sideToggle?.setAttribute('aria-label', rail ? 'Menüyü aç' : 'Menüyü daralt');
}
if (sideToggle) {
  paintSide(!!store.get('sideRail', false));
  sideToggle.onclick = () => {
    const rail = document.documentElement.dataset.side !== 'rail';
    store.set('sideRail', rail);
    paintSide(rail);
  };
}
$('#side')?.addEventListener('click', e => {
  if (e.target.closest('a') && matchMedia('(max-width: 860px)').matches) {
    $('#side')?.classList.remove('open');
    mainNav?.classList.remove('open');
    hamburger?.setAttribute('aria-expanded', 'false');
  }
});
if (hamburger && mainNav) {
  hamburger.onclick = () => {
    const open = mainNav.classList.toggle('open');
    $('#side')?.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
    // aria-modal yalnızca role="dialog" üzerinde anlamlı; <nav> üzerinde kullanılmaz.
    // Odak yönetimi: menü açıldığında ilk nav linkine odaklan
    if (open) {
      const firstLink = mainNav.querySelector('a');
      if (firstLink) firstLink.focus();
    }
  };
  // Nav link'e tıklandığında menü kapanır
  mainNav.addEventListener('click', e => {
    if (e.target.closest('a')) {
      mainNav.classList.remove('open');
      $('#side')?.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    }
  });
  // Focus-trap: Tab / Shift+Tab döngüsü nav içinde kalır (menü açıkken)
  mainNav.addEventListener('keydown', e => {
    if (!mainNav.classList.contains('open') || e.key !== 'Tab') return;
    const focusable = [...mainNav.querySelectorAll('a, button, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

// ---------------- Tema ----------------
function themeLabel() {
  const t = document.documentElement.dataset.theme;
  const label = t === 'kitty' ? 'Koyu temaya geç' : t === 'light' ? 'Hello Kitty temasına geç' : 'Açık temaya geç';
  $('#theme')?.setAttribute('aria-label', label);
  if ($('#theme')) $('#theme').title = t === 'kitty' ? 'Hello Kitty' : t === 'light' ? 'Açık tema' : 'Koyu tema';
}
const sysLight = matchMedia('(prefers-color-scheme: light)');
const themeMode = () => { try { const t = localStorage.getItem('lovell.theme'); return ['system', 'light', 'dark', 'kitty'].includes(t) ? t : 'dark'; } catch { return 'dark'; } };
function applyTheme(mode, persist = true) {
  try { localStorage.setItem('lovell.theme', mode); } catch {}
  document.documentElement.dataset.theme = mode === 'kitty' ? 'kitty' : mode === 'light' || (mode === 'system' && sysLight.matches) ? 'light' : 'dark';
  themeLabel();
  if (persist && profile) {
    profile.prefs = {...(profile.prefs || {}), ...skinPrefs(), theme: mode};
    store.set('profileMeta', profile);
    scheduleSync();
  }
}
function skinPrefs() {
  return {theme: themeMode(), accent: store.get('accent', '') || '', wall: store.get('wall', '') || ''};
}
function applySkin(accent, wall) {
  const root = document.documentElement;
  const acc = /^#[0-9A-Fa-f]{6}$/.test(accent || '') ? accent : '';
  store.set('accent', acc);
  if (acc) { root.style.setProperty('--user-accent', acc); root.dataset.accent = '1'; }
  else { root.style.removeProperty('--user-accent'); delete root.dataset.accent; }
  const okWall = wall && (String(wall).startsWith('https://') || String(wall).startsWith('data:image/')) ? wall : '';
  store.set('wall', okWall);
  if (okWall) { root.style.setProperty('--user-wall', `url("${okWall.replace(/"/g, '')}")`); root.dataset.wall = '1'; }
  else { root.style.removeProperty('--user-wall'); delete root.dataset.wall; }
}
function applyPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') return;
  if (prefs.theme) applyTheme(prefs.theme, false);
  applySkin(prefs.accent, prefs.wall);
}
sysLight.addEventListener('change', () => { if (themeMode() === 'system') applyTheme('system'); });
$('#theme').onclick = () => {
  const now = document.documentElement.dataset.theme;
  applyTheme(now === 'dark' ? 'light' : now === 'light' ? 'kitty' : 'dark');
};
themeLabel();

// ---------------- Durum ----------------
function setStatus(source) {
  const el = $('#data-status');
  if (!el || !source) return;
  el.dataset.src = source;
  el.textContent = source === 'TMDB' ? 'Veri kaynağı: TMDB' : source === 'AniList' ? 'TMDB kullanılamıyor, AniList gösteriliyor' : 'TMDB ve AniList kullanılamıyor, yerel seçki gösteriliyor';
}

// ---------------- Canlı TV ----------------
const M3U_URL = 'https://raw.githubusercontent.com/falsisdev/anthology/main/providers/M3U/Liste/canli.m3u';
const IPTV_ORG_TR = 'https://iptv-org.github.io/iptv/countries/tr.m3u';
let liveCache = null;     // {at, list}
// iptv-org kategorileri İngilizce; Türkçe gruplara çevir, adlardaki "(720p)", "[Not 24/7]" gibi ekleri temizle.
const IPTV_GROUP = {news: '🇹🇷 HABER KANALLARI', sports: '🇹🇷 SPOR KANALLARI', movies: '🇹🇷 SİNEMA KANALLARI', music: '🇹🇷 MÜZİK KANALLARI', documentary: '🇹🇷 BELGESEL KANALLARI', kids: '🇹🇷 BELGESEL KANALLARI', education: '🇹🇷 BELGESEL KANALLARI', animation: '🇹🇷 BELGESEL KANALLARI'};
function fromIptvOrg(ch) {
  const first = String(ch.group || '').split(';')[0].trim().toLowerCase();
  return {...ch, name: ch.name.replace(/\s*\((\d{3,4}p|\d+i)\)/gi, '').replace(/\s*\[[^\]]*\]/g, '').trim(), group: IPTV_GROUP[first] || '🇹🇷 Yerel & Diğer', extra: true};
}
const chKey = n => String(n || '').toLocaleLowerCase('tr').replace(/\b(hd|sd|fhd|uhd|4k|tv|türk|turk)\b/g, '').replace(/[^a-z0-9çğıöşü]+/g, '');
function mergeChannels(primary, extra) {
  const seen = new Set(primary.flatMap(c => [chKey(c.name), c.url]));
  // Yalnızca HTTPS akışlar (site HTTPS'ten sunulduğu için HTTP akışlar tarayıcıda engellenir)
  return [...primary, ...extra.filter(c => /^https:/.test(c.url) && c.name && !seen.has(chKey(c.name)) && !seen.has(c.url) && (seen.add(chKey(c.name)), true))];
}
let liveOrder = [];       // ekrandaki sırayla tüm kanallar (kanal değiştirme için)
// Kanal listesi oturum boyunca önbellekte tutulur; her girişte GitHub'dan yeniden indirilmez.
async function fetchChannels() {
  if (liveCache && Date.now() - liveCache.at < 15 * 60e3) return liveCache.list;
  try { const c = JSON.parse(sessionStorage.getItem('lovell.m3u')); if (c?.list?.length && Date.now() - c.at < 30 * 60e3) return (liveCache = c).list; } catch {}
  busyStart();
  try {
    // İki açık liste birlikte okunur: Anthology listesi (öncelikli) + iptv-org'un Türkiye arşivi.
    const get = url => fetch(url, {signal: AbortSignal.timeout(15000)}).then(r => r.ok ? r.text() : Promise.reject(Error(`HTTP ${r.status}`)));
    const [main, extra] = await Promise.allSettled([get(M3U_URL), get(IPTV_ORG_TR)]);
    if (main.status === 'rejected' && extra.status === 'rejected') throw Error(`Kanal listesi alınamadı (${main.reason?.message || 'bağlantı yok'})`);
    const list = mergeChannels(main.status === 'fulfilled' ? parseM3U(main.value) : [], extra.status === 'fulfilled' ? parseM3U(extra.value).map(fromIptvOrg) : []);
    if (!list.length) throw Error('Kanal listesi boş geldi');
    liveCache = {at: Date.now(), list};
    try { sessionStorage.setItem('lovell.m3u', JSON.stringify(liveCache)); } catch {}
    return list;
  } finally { busyEnd(); }
}
function liveSkeleton() {
  return `<div class="page livetv-page" role="status" aria-label="Kanallar yükleniyor">
    <header class="live-head"><div><p class="live-badge"><i></i>CANLI</p><h1>Canlı TV</h1><span class="skeleton" style="width:240px;height:16px;margin-top:14px"></span></div><span class="skeleton" style="width:min(340px,100%);height:46px;border-radius:999px"></span></header>
    <div class="livetv-cats">${Array.from({length: 7}, (_, i) => `<span class="skeleton" style="width:${[80, 96, 84, 92, 100, 150, 140][i]}px;height:38px;border-radius:999px;flex:none"></span>`).join('')}</div>
    <div class="ch-group"><span class="skeleton" style="width:180px;height:28px;margin-bottom:16px"></span><div class="livetv-grid">${Array.from({length: 14}, () => '<span class="skeleton sk-ch"></span>').join('')}</div></div>
  </div>`;
}
async function viewLiveTV(v) {
  main.innerHTML = liveSkeleton();
  let channels = [];
  try { channels = await fetchChannels(); } catch (e) {
    if (v !== routeId) return;
    main.innerHTML = `<div class="page">${emptyState({icon: 'tv', title: navigator.onLine ? 'Kanal listesi alınamadı' : 'İnternet bağlantısı yok', text: `${esc(e.name === 'TimeoutError' ? 'Kanal listesi zamanında yanıt vermedi' : e.message)}. Biraz sonra tekrar dene.`, actions: '<button class="btn btn-play" type="button" data-retry>Tekrar dene</button>'})}</div>`;
    return;
  }
  if (v !== routeId) return;
  renderLiveTV(channels);
}

// Kanal kategorileri: M3U'daki "🇹🇷 SPOR KANALLARI" gibi başlıkları sadeleştirip sıralar.
const LIVE_GROUPS = [
  {key: 'ULUSAL', name: 'Ulusal', icon: '<path d="M3 5h14v9H3zM7 17h6"/>', h: 210},
  {key: 'SPOR', name: 'Spor', icon: '<circle cx="10" cy="10" r="7"/><path d="M10 3v14M3 10h14M5 5c3 3 7 3 10 0M5 15c3-3 7-3 10 0"/>', h: 140},
  {key: 'HABER', name: 'Haber', icon: '<path d="M3 4h11v12H5a2 2 0 0 1-2-2zM14 7h3v7a2 2 0 0 1-2 2M6 7h5M6 10h5M6 13h3"/>', h: 0},
  {key: 'SİNEMA', name: 'Sinema', icon: '<rect x="3" y="4" width="14" height="12" rx="1"/><path d="M7 4v12M13 4v12M3 8h4M3 12h4M13 8h4M13 12h4"/>', h: 275},
  {key: 'BELGESEL', name: 'Belgesel & Çocuk', icon: '<path d="M10 3c4 0 7 3 7 7s-3 7-7 7-7-3-7-7 3-7 7-7zM3 10h14M10 3c2 2 3 4.5 3 7s-1 5-3 7c-2-2-3-4.5-3-7s1-5 3-7z"/>', h: 95},
  {key: 'MÜZİK', name: 'Müzik & Eğlence', icon: '<path d="M7 15V4l10-2v11"/><circle cx="5" cy="15" r="2"/><circle cx="15" cy="13" r="2"/>', h: 320},
];
const liveGroupOf = raw => {
  const up = String(raw || '').toLocaleUpperCase('tr');
  return LIVE_GROUPS.find(g => up.includes(g.key)) || {key: 'DIGER', name: String(raw || 'Diğer').replace(/^[^\p{L}\d]+/u, '').trim() || 'Diğer', icon: '<circle cx="10" cy="10" r="6"/>', h: 40};
};
const FAV_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.8l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5L2.8 8l5-.6z"/></svg>';
const liveFavs = () => store.get('liveFav', []);
const liveIcon = g => `<svg viewBox="0 0 20 20" aria-hidden="true">${g.icon}</svg>`;

function renderLiveTV(channels) {
  const groups = new Map();
  channels.forEach(ch => {
    const g = liveGroupOf(ch.group);
    ch.cat = g.name;
    if (!groups.has(g.name)) groups.set(g.name, {...g, items: []});
    groups.get(g.name).items.push(ch);
  });
  const ordered = [...groups.values()].sort((x, y) => {
    const xi = LIVE_GROUPS.findIndex(g => g.name === x.name), yi = LIVE_GROUPS.findIndex(g => g.name === y.name);
    return (xi < 0 ? 99 : xi) - (yi < 0 ? 99 : yi);
  });
  const recentLive = store.get('liveRecent', []).filter(r => channels.some(c => c.url === r.url)).slice(0, 8);
  main.innerHTML = `
    <div class="page livetv-page">
      <header class="live-head">
        <div>
          <p class="live-badge"><i></i>CANLI</p>
          <h1>Canlı TV</h1>
          <p class="live-sub">${channels.length} kanal · ${ordered.length} kategori · kesintisiz yayın</p>
        </div>
        <label class="live-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input id="livetv-search" type="search" placeholder="Kanal ara" autocomplete="off" aria-label="Kanal ara"></label>
      </header>
      <nav class="livetv-cats" id="livetv-cats" aria-label="Kanal kategorileri">
        <button class="cat-btn active" data-cat="" type="button">Tümü <small>${channels.length}</small></button>
        ${ordered.map(g => `<button class="cat-btn" data-cat="${esc(g.name)}" type="button" style="--h:${g.h}">${liveIcon(g)}${esc(g.name)} <small>${g.items.length}</small></button>`).join('')}
      </nav>
      <section class="ch-group ch-recent ch-favs" data-group="__recent" id="live-favs" ${favList().length ? '' : 'hidden'}>${favSection()}</section>
      ${recentLive.length ? `<section class="ch-group ch-recent" data-group="__recent"><h2 class="ch-group-head"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/></svg>Son izlediklerin</h2><div class="livetv-grid">${recentLive.map((ch, i) => channelCard(ch, i)).join('')}</div></section>` : ''}
      <div id="livetv-grid">
        ${ordered.map(g => `<section class="ch-group" data-group="${esc(g.name)}" style="--h:${g.h}">
          <h2 class="ch-group-head">${liveIcon(g)}${esc(g.name)}<small>${g.items.length} kanal</small></h2>
          <div class="livetv-grid">${g.items.map((ch, i) => channelCard(ch, i)).join('')}</div>
        </section>`).join('')}
      </div>
      <div class="state" id="livetv-empty" hidden><h2>Kanal bulunamadı</h2><p>Başka bir ad dene ya da kategoriyi değiştir.</p></div>
    </div>`;
  const page = $('.livetv-page');
  liveOrder = ordered.flatMap(g => g.items);
  const open = card => card && openLiveChannel(card.dataset.url);
  // Favori yıldızı: kanalı açmadan favorilere ekler / çıkarır.
  const toggleFav = star => {
    const url = star.closest('.ch-card').dataset.url;
    const favs = liveFavs(), on = !favs.includes(url);
    store.set('liveFav', on ? [url, ...favs] : favs.filter(u => u !== url));
    $$('.ch-card', page).forEach(c => { if (c.dataset.url === url) { const st = $('.ch-fav', c); st.classList.toggle('on', on); st.setAttribute('aria-pressed', String(on)); } });
    const box = $('#live-favs');
    box.innerHTML = favSection();
    box.hidden = !favList().length;
    toast(on ? 'Favorilere eklendi' : 'Favorilerden çıkarıldı', on ? 'success' : 'info');
  };
  function favList() { return liveFavs().map(u => channels.find(c => c.url === u)).filter(Boolean); }
  function favSection() { const l = favList(); return l.length ? `<h2 class="ch-group-head"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.8l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5L2.8 8l5-.6z"/></svg>Favorilerin<small>${l.length} kanal</small></h2><div class="livetv-grid">${l.map((ch, i) => channelCard(ch, i)).join('')}</div>` : ''; }
  page.addEventListener('click', e => { const star = e.target.closest('.ch-fav'); if (star) { e.stopPropagation(); return toggleFav(star); } open(e.target.closest('.ch-card')); });
  page.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.ch-fav')) { e.preventDefault(); return toggleFav(e.target); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.ch-card')) { e.preventDefault(); open(e.target); }
  });
  let cat = '';
  const apply = () => {
    const q = $('#livetv-search').value.toLocaleLowerCase('tr').trim();
    let shown = 0;
    $$('.ch-group', page).forEach(sec => {
      const isRecent = sec.dataset.group === '__recent';
      let n = 0;
      $$('.ch-card', sec).forEach(c => { const ok = (!q || c.dataset.name.toLocaleLowerCase('tr').includes(q)); c.hidden = !ok; if (ok) n++; });
      sec.hidden = isRecent ? !!(q || cat) || !n : (cat && sec.dataset.group !== cat) || !n;
      if (!sec.hidden && !isRecent) shown += n;
    });
    $('#livetv-empty').hidden = shown > 0;
  };
  $('#livetv-cats').addEventListener('click', e => {
    const btn = e.target.closest('.cat-btn');
    if (!btn) return;
    $$('.cat-btn').forEach(b => b.classList.toggle('active', b === btn));
    cat = btn.dataset.cat;
    apply();
    if (cat) window.scrollTo({top: Math.max(0, page.offsetTop - 70), behavior: reduceMotion ? 'auto' : 'smooth'});
  });
  $('#livetv-search').addEventListener('input', apply);
  $$('.ch-logo img', page).forEach(img => img.addEventListener('error', () => { img.replaceWith(Object.assign(document.createElement('span'), {className: 'ch-ph', textContent: img.closest('.ch-card').dataset.name.slice(0, 2)})); }, {once: true}));
}

function parseM3U(text) {
  const lines = text.split('\n');
  const channels = [];
  let current = null;
  for (const line of lines) {
    const l = line.trim();
    if (l.startsWith('#EXTINF:')) {
      current = {name: '', logo: '', group: '', url: ''};
      const nameM = l.match(/,(.+)$/);
      if (nameM) current.name = nameM[1].trim();
      const logoM = l.match(/tvg-logo="([^"]+)"/);
      if (logoM) current.logo = logoM[1];
      const groupM = l.match(/group-title="([^"]+)"/);
      if (groupM) current.group = groupM[1];
    } else if (l && !l.startsWith('#') && current) {
      current.url = l;
      if (current.url.startsWith('http')) channels.push(current);
      current = null;
    }
  }
  return channels;
}

function channelCard(ch, i = 0) {
  const g = liveGroupOf(ch.group);
  return `<div class="ch-card" data-url="${esc(ch.url)}" data-name="${esc(ch.name)}" data-logo="${esc(ch.logo)}" data-group="${esc(ch.group)}" role="button" tabindex="0" aria-label="${esc(ch.name)} canlı izle" style="--h:${g.h};--d:${Math.min(i, 16) * 25}ms">
    <div class="ch-logo">${ch.logo ? `<img src="${esc(ch.logo)}" alt="" loading="lazy" decoding="async">` : `<span class="ch-ph">${esc(ch.name.slice(0, 2))}</span>`}<span class="ch-live"><i></i>CANLI</span><span class="ch-play">${PLAY}</span><span class="ch-fav ${liveFavs().includes(ch.url) ? 'on' : ''}" role="button" tabindex="0" aria-pressed="${liveFavs().includes(ch.url)}" aria-label="Favorilere ekle">${FAV_ICON}</span></div>
    <div class="ch-name">${esc(ch.name)}</div>
  </div>`;
}

// Canlı yayın oynatıcısı: kanal değiştirme (önceki / sonraki, liste), bağlantı durumu, hata ve yeniden deneme.
let liveModal = null;
function openLiveChannel(url) {
  const start = Math.max(0, liveOrder.findIndex(c => c.url === url));
  if (!liveOrder.length) return;
  if (liveModal) liveModal.close(true);
  const modal = document.createElement('div');
  modal.id = 'livetv-player-modal';
  modal.className = 'livetv-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <div class="livetv-modal-inner">
      <div class="livetv-modal-head">
        <span class="livetv-modal-logo-wrap"></span>
        <span class="livetv-modal-title"></span>
        <span class="live-badge live-badge-sm"><i></i>CANLI</span>
        <div class="zap">
          <button class="icon-btn" type="button" data-zap="-1" aria-label="Önceki kanal" title="Önceki kanal (↑)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
          <button class="icon-btn" type="button" data-zap="1" aria-label="Sonraki kanal" title="Sonraki kanal (↓)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
          <button class="icon-btn" type="button" data-side aria-label="Kanal listesi" aria-pressed="false" title="Kanal listesi (L)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg></button>
        </div>
        <button class="icon-btn livetv-modal-close" type="button" aria-label="Kapat" title="Kapat (Esc)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <div class="livetv-modal-main">
        <div class="livetv-modal-body">
          <video id="livetv-video" controls autoplay playsinline></video>
          <div class="livetv-status" id="livetv-status"></div>
        </div>
        <aside class="livetv-side" aria-label="Kanal listesi"><label class="ep-find"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input type="search" placeholder="Kanal ara" aria-label="Listede kanal ara"></label><ol class="livetv-side-list"></ol></aside>
      </div>
      <p class="livetv-keys"><span><kbd>↑</kbd><kbd>↓</kbd> kanal değiştir</span><span><kbd>L</kbd> liste</span><span><kbd>F</kbd> tam ekran</span><span><kbd>M</kbd> ses</span><span><kbd>Esc</kbd> kapat</span></p>
    </div>`;
  document.body.appendChild(modal);
  document.documentElement.classList.add('modal-open');
  const video = $('video', modal), status = $('#livetv-status', modal), side = $('.livetv-side', modal), sideList = $('.livetv-side-list', modal);
  const lastFocus = document.activeElement;
  let i = start, hls = null, stallTimer = 0;
  const setStatus = (kind, text, acts = '') => {
    status.dataset.kind = kind;
    status.innerHTML = kind === 'ok' ? '' : `<div class="livetv-status-box">${kind === 'load' ? '<span class="spin"></span>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.2v.3"/></svg>'}<p>${esc(text)}</p>${acts ? `<div class="actions">${acts}</div>` : ''}</div>`;
  };
  const drawSide = () => {
    const q = $('input', side).value.toLocaleLowerCase('tr').trim();
    sideList.innerHTML = liveOrder.map((c, k) => (!q || c.name.toLocaleLowerCase('tr').includes(q)) ? `<li><button type="button" data-tune="${k}" class="${k === i ? 'on' : ''}" ${k === i ? 'aria-current="true"' : ''}><span class="side-logo">${c.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy">` : esc(c.name.slice(0, 2))}</span><span>${esc(c.name)}<small>${esc(c.cat || '')}</small></span></button></li>` : '').join('') || '<li class="muted pad">Kanal bulunamadı</li>';
    $$('img', sideList).forEach(img => img.addEventListener('error', () => img.remove(), {once: true}));
  };
  const fail = msg => { clearTimeout(stallTimer); setStatus('err', msg, '<button class="btn btn-ghost btn-sm" type="button" data-again>Tekrar dene</button><button class="btn btn-play btn-sm" type="button" data-next>Sonraki kanal</button>'); };
  const tune = k => {
    i = (k + liveOrder.length) % liveOrder.length;
    const ch = liveOrder[i];
    store.set('liveRecent', [{url: ch.url, name: ch.name, logo: ch.logo, group: ch.group}, ...store.get('liveRecent', []).filter(r => r.url !== ch.url)].slice(0, 8));
    $('.livetv-modal-logo-wrap', modal).innerHTML = ch.logo ? `<img src="${esc(ch.logo)}" alt="" class="livetv-modal-logo">` : `<span class="livetv-modal-logo ch-ph-sm">${esc(ch.name.slice(0, 2))}</span>`;
    $('img.livetv-modal-logo', modal)?.addEventListener('error', e => e.target.remove(), {once: true});
    $('.livetv-modal-title', modal).innerHTML = `${esc(ch.name)}<small>${esc(liveGroupOf(ch.group).name)} · ${i + 1} / ${liveOrder.length}</small>`;
    modal.setAttribute('aria-label', `${ch.name} canlı yayın`);
    drawSide();
    $('[aria-current]', sideList)?.scrollIntoView({block: 'nearest'});
    try { hls?.destroy(); } catch {}
    hls = null;
    clearTimeout(stallTimer);
    setStatus('load', `${ch.name} bağlanıyor…`);
    // 20 saniyede görüntü gelmezse kullanıcıya seçenek sun.
    stallTimer = setTimeout(() => { if (status.dataset.kind === 'load') fail('Yayın yanıt vermiyor.'); }, 20000);
    video.removeAttribute('src');
    getHls().then(Hls => {
      if (!document.contains(modal) || liveOrder[i] !== ch) return;
      if (Hls?.isSupported()) {
        hls = new Hls({maxBufferLength: 30, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 2});
        hls.loadSource(ch.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) fail(d.type === 'networkError' ? 'Yayına bağlanılamadı. Kanal şu an kapalı olabilir.' : 'Yayın çözümlenemedi.'); });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = ch.url;
      else return fail('Bu kanal bu tarayıcıda oynatılamıyor.');
      video.play?.().catch(() => { if (status.dataset.kind === 'load') setStatus('err', 'Oynatmak için dokun.', '<button class="btn btn-play btn-sm" type="button" data-play>Oynat</button>'); });
    });
  };
  video.addEventListener('playing', () => { clearTimeout(stallTimer); setStatus('ok'); });
  video.addEventListener('waiting', () => { if (status.dataset.kind === 'ok') setStatus('load', 'Arabelleğe alınıyor…'); });
  video.addEventListener('error', () => { if (!hls && video.getAttribute('src')) fail('Yayın açılamadı.'); });
  const close = quick => {
    clearTimeout(stallTimer);
    try { hls?.destroy(); } catch {}
    video.pause(); video.removeAttribute('src'); video.load();
    document.removeEventListener('keydown', onKey, true);
    document.documentElement.classList.remove('modal-open');
    liveModal = null;
    if (quick || reduceMotion) modal.remove(); else { modal.classList.remove('open'); setTimeout(() => modal.remove(), 300); }
    if (!quick) lastFocus?.focus?.();
  };
  const onKey = e => {
    if (e.target.matches?.('input')) { if (e.key === 'Escape') { e.target.blur(); e.stopPropagation(); } return; }
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!document.fullscreenElement) close(); }
    else if (k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); tune(i - 1); }
    else if (k === 'ArrowDown' || k === 'PageDown') { e.preventDefault(); tune(i + 1); }
    else if (k.toLowerCase() === 'f') { e.preventDefault(); document.fullscreenElement ? document.exitFullscreen() : $('.livetv-modal-body', modal).requestFullscreen?.(); }
    else if (k.toLowerCase() === 'm') { video.muted = !video.muted; toast(video.muted ? 'Ses kapalı' : 'Ses açık'); }
    else if (k.toLowerCase() === 'l') $('[data-side]', modal).click();
    else if (k === 'Tab') { // odak pencerenin içinde kalır
      const f = $$('button, input, video, [tabindex]:not([tabindex="-1"])', modal).filter(x => x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  modal.addEventListener('click', e => {
    if (e.target === modal) return close();
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('.livetv-modal-close')) close();
    else if (t.dataset.zap) tune(i + Number(t.dataset.zap));
    else if (t.dataset.tune) { tune(Number(t.dataset.tune)); if (innerWidth < 760) $('[data-side]', modal).click(); }
    else if (t.hasAttribute('data-side')) { const on = modal.classList.toggle('side-open'); t.setAttribute('aria-pressed', String(on)); if (on) $('[aria-current]', sideList)?.scrollIntoView({block: 'center'}); }
    else if (t.hasAttribute('data-again')) tune(i);
    else if (t.hasAttribute('data-next')) tune(i + 1);
    else if (t.hasAttribute('data-play')) { setStatus('load', 'Bağlanıyor…'); video.play().catch(() => {}); }
  });
  $('input', side).addEventListener('input', drawSide);
  // Dokunmatikte videoyu sağa / sola kaydırarak kanal değiştir.
  let sx = null;
  const body = $('.livetv-modal-body', modal);
  body.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, {passive: true});
  body.addEventListener('touchend', e => { if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 70) tune(i + (dx < 0 ? 1 : -1)); }, {passive: true});
  if (innerWidth >= 1100) { modal.classList.add('side-open'); $('[data-side]', modal).setAttribute('aria-pressed', 'true'); }
  liveModal = {close};
  tune(i);
  requestAnimationFrame(() => modal.classList.add('open'));
  $('.livetv-modal-close', modal).focus();
}

// =====================================================================
// GELİŞMİŞ ARAYÜZ (v9): detay penceresi, ortam ışığı, alt menü, kısayollar
// =====================================================================

// ---- Ortam ışığı: görselin baskın rengini çıkarıp çevresine yayar ----
const ambientCache = new Map();
function ambientColor(url) {
  // Yalnızca aynı kaynaktan gelen görseller okunabilir (/api/img ve /public).
  if (!url || !/^\/(api|public)\//.test(url)) return Promise.resolve(null);
  if (ambientCache.has(url)) return ambientCache.get(url);
  const p = new Promise(res => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 24; c.height = 14;
        const g = c.getContext('2d', {willReadFrequently: true});
        g.drawImage(img, 0, 0, 24, 14);
        const d = g.getImageData(0, 0, 24, 14).data;
        let r = 0, gg = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
          const wt = 1 + (mx - mn) / 32 + (mx > 30 && mx < 235 ? 1 : 0); // canlı renklere ağırlık ver
          r += d[i] * wt; gg += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
        }
        // Rengi biraz doyur ve parlaklığı orta seviyeye çek.
        let [h, sat, l] = rgb2hsl(r / w, gg / w, b / w);
        sat = Math.max(sat, .45); l = Math.min(Math.max(l, .38), .55);
        res(hsl2rgb(h, sat, l).map(Math.round).join(' '));
      } catch { res(null); }
    };
    img.onerror = () => res(null);
    img.src = url;
  });
  ambientCache.set(url, p);
  return p;
}
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hsl2rgb(h, s, l) {
  const f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [f(0), f(8), f(4)];
}
async function ambientFrom(url, el) {
  const c = await ambientColor(url);
  if (c && el && document.contains(el)) el.style.setProperty('--amb', c);
}

// ---- Görseller yüklenince yumuşakça belirir ----
document.addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ld'); }, true);

// ---- Kartlardaki hızlı eylemler (listeye ekle, ayrıntılar, devam et satırından kaldır) ----
document.addEventListener('click', e => {
  const el = e.target.closest?.('.qa-btn[data-list], [data-info], [data-forget]');
  if (!el) return;
  e.preventDefault(); e.stopPropagation();
  if (el.dataset.info) {
    const card = el.closest('.card, .land, .rank');
    if (card && !el.closest('.peek')) return showPeek(card);
    hidePeek(true);
    return openInfo(el.dataset.info);
  }
  if (el.dataset.list) { const a = ITEMS.get(el.dataset.list) || myList.find(x => keyOf(x) === el.dataset.list); if (a) toggleList(a); return; }
  if (el.dataset.forget) {
    const k = el.dataset.forget, saved = recent[k];
    delete recent[k]; store.set('recent', recent); scheduleSync();
    const cardEl = el.closest('.wide');
    cardEl?.classList.add('leaving');
    setTimeout(() => { const row = cardEl?.closest('.shelf, .list-group'); cardEl?.remove(); if (row && !$('.wide', row)) row.remove(); }, reduceMotion ? 0 : 260);
    toast('Devam et satırından kaldırıldı', 'info', {label: 'Geri al', fn: () => { recent[k] = saved; store.set('recent', recent); scheduleSync(); route(); }});
  }
}, true);

// ---- Rastgele seç ----
function bindShuffle() {
  const b = $('#shuffle');
  if (!b) return;
  b.onclick = () => {
    const links = $$('#main .grid a[href^="#/izle"]');
    if (!links.length) return toast('Seçilecek başlık yok');
    const pick = links[Math.floor(Math.random() * links.length)];
    pick.scrollIntoView({block: 'center', behavior: reduceMotion ? 'auto' : 'smooth'});
    pick.classList.add('picked');
    setTimeout(() => { location.hash = pick.getAttribute('href'); }, reduceMotion ? 0 : 650);
  };
}

// ---- Detay penceresi (Netflix'teki "Daha fazla bilgi") ----
let qvSeq = 0;
function closeInfo(silent) {
  const d = $('#qv');
  if (d?.open) { silent ? d.close() : d.classList.add('closing'); if (silent) d.classList.remove('closing'); else setTimeout(() => { d.close(); d.classList.remove('closing'); }, reduceMotion ? 0 : 180); }
}
async function openInfo(key) {
  const [kind, id] = String(key).split(':');
  if (!/^(tv|movie|al)$/.test(kind) || !/^\d+$/.test(id)) return;
  let d = $('#qv');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'qv'; d.className = 'qv';
    d.setAttribute('aria-label', 'Ayrıntılar');
    document.body.append(d);
    d.addEventListener('click', e => { if (e.target === d) closeInfo(); });
    d.addEventListener('cancel', e => { e.preventDefault(); closeInfo(); });
  }
  const seq = ++qvSeq;
  const seed = ITEMS.get(key) || {kind, id: Number(id), title: ''};
  const draw = (a, full) => {
    const movie = isMovie(a);
    const seasons = a.seasons?.length ? a.seasons : [];
    d.innerHTML = `<article class="qv-card">
      <button class="qv-close icon-btn" type="button" aria-label="Kapat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="qv-banner">${a.backdrop || a.poster ? `<img src="${esc(a.backdrop || a.posterLarge || a.poster)}" alt="" data-fb>` : ''}<span class="qv-shade"></span>
        <div class="qv-head">
          <h2 class="qv-title">${esc(a.title)}</h2>
          <div class="actions">
            <a class="btn btn-play" href="${watchHref(a)}">${PLAY}${secOf(a) === 'anime' ? 'İzlemeye başla' : 'Oynat'}</a>
            <button class="btn btn-ghost" type="button" data-list="${keyOf(a)}" data-label="Listeye ekle" data-qv-list>${inList(a) ? CHECK + 'Listende' : PLUS + 'Listeye ekle'}</button>
            ${a.trailer ? `<button class="btn btn-ghost" type="button" data-qv-trailer>${PLAY}Fragman</button>` : ''}
          </div>
        </div>
      </div>
      <div class="qv-body">
        <div class="qv-main">
          <p class="qv-facts">${a.score ? `<span class="score">${STAR}${score(a.score)}</span>` : ''}${a.year ? `<span>${esc(a.year)}</span>` : ''}<span class="kind-pill">${kindLabel(a)}</span>${movie ? (a.runtime ? `<span>${a.runtime} dk</span>` : '') : a.episodeCount ? `<span>${a.episodeCount} bölüm</span>` : seasons.length ? `<span>${seasons.length} sezon</span>` : ''}</p>
          ${full ? (a.overview ? `<p class="qv-text">${esc(a.overview)}</p>` : '<p class="qv-text muted">Bu başlık için özet yok.</p>') : '<p class="qv-text"><span class="skeleton" style="height:14px;width:92%"></span><span class="skeleton" style="height:14px;width:80%;margin-top:8px"></span><span class="skeleton" style="height:14px;width:60%;margin-top:8px"></span></p>'}
        </div>
        <dl class="qv-side">
          ${a.genres?.length ? `<div><dt>Türler</dt><dd>${a.genres.map(g => `<span>${esc(g)}</span>`).join('')}</dd></div>` : ''}
          ${a.studios?.length ? `<div><dt>${secOf(a) === 'anime' ? 'Stüdyo' : 'Yapım'}</dt><dd>${esc(a.studios.join(', '))}</dd></div>` : ''}
          ${a.original && a.original !== a.title ? `<div><dt>Orijinal adı</dt><dd>${esc(a.original)}</dd></div>` : ''}
        </dl>
      </div>
      ${full && !movie && seasons.length ? `<section class="qv-eps"><div class="qv-sec-head"><h3>Bölümler</h3>${seasons.length > 1 ? `<label class="select"><select id="qv-season" aria-label="Sezon">${seasons.map(x => `<option value="${x.n}">${x.n}. sezon${x.count ? ` (${x.count} bölüm)` : ''}</option>`).join('')}</select></label>` : ''}</div><ol class="qv-ep-list" id="qv-eps">${loading('Bölümler yükleniyor')}</ol></section>` : ''}
      ${full && a.recommendations?.length ? `<section class="qv-recs"><div class="qv-sec-head"><h3>Benzerleri</h3></div><div class="qv-rec-grid">${a.recommendations.slice(0, 9).map(r => { remember(r); return `<a class="qv-rec" href="${watchHref(r)}"><span class="qv-rec-img">${r.backdrop || r.poster ? `<img src="${esc(r.backdrop || r.poster)}" alt="" loading="lazy" data-fb>` : ''}<span class="qv-rec-t">${esc(r.title)}</span></span><span class="qv-rec-meta">${r.score ? `<span class="score">${STAR}${score(r.score)}</span>` : ''}<span>${esc(r.year || '')}</span><span class="qa-btn ${inList(r) ? 'on' : ''}" role="button" tabindex="0" data-list="${keyOf(r)}" aria-label="Listeye ekle">${inList(r) ? CHECK : PLUS}</span></span></a>`; }).join('')}</div></section>` : ''}
    </article>`;
    $('.qv-close', d).onclick = () => closeInfo();
    $('[data-qv-list]', d).onclick = e => { e.stopPropagation(); toggleList(a); };
    const tr = $('[data-qv-trailer]', d);
    if (tr) tr.onclick = () => { closeInfo(true); openTrailer(a.trailer); };
    imgFallback(d);
    ambientFrom(a.backdrop || a.poster, d);
    if (full && $('#qv-eps', d)) {
      const loadEps = async sn => {
        const list = $('#qv-eps', d);
        list.innerHTML = loading('Bölümler yükleniyor');
        let r; try { r = await api(`/api/episodes/${a.kind}/${a.id}?season=${sn}`); } catch { r = {episodes: []}; }
        if (seq !== qvSeq || !document.contains(list)) return;
        const eps = r.episodes || [];
        list.innerHTML = eps.length ? eps.slice(0, 60).map(ep => {
          const pr = progress[`${keyOf(a)}:${sn}:${ep.n}`], pct = pr ? Math.min(100, pr.t / pr.d * 100) : 0;
          return `<li><a href="${watchHref(a, sn, ep.n)}" class="qv-ep ${ep.still ? '' : 'no-still'}"><span class="qv-ep-n">${ep.n}</span>${ep.still ? `<span class="qv-ep-img"><img src="${esc(ep.still)}" alt="" loading="lazy" data-fb>${pct ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ''}</span>` : ''}<span class="qv-ep-body"><strong>${esc(ep.title)}</strong>${ep.overview ? `<span>${esc(ep.overview)}</span>` : ''}</span>${ep.runtime ? `<span class="qv-ep-rt">${ep.runtime} dk</span>` : ''}</a></li>`;
        }).join('') + (eps.length > 60 ? `<li class="qv-more"><a class="text-btn" href="${watchHref(a, sn, 61)}">Tüm ${eps.length} bölümü izleme sayfasında gör</a></li>` : '') : '<li class="muted">Bölüm listesine şu an ulaşılamıyor.</li>';
        imgFallback(list);
      };
      const last = recent[keyOf(a)];
      const start = last?.s && seasons.some(x => x.n === last.s) ? last.s : seasons[0].n;
      if ($('#qv-season', d)) { $('#qv-season', d).value = start; $('#qv-season', d).onchange = e => loadEps(Number(e.target.value)); }
      loadEps(start);
    }
  };
  draw(seed, false);
  if (!d.open) d.showModal();
  d.scrollTop = 0;
  try {
    const full = await api(`/api/title/${kind}/${id}`);
    if (seq !== qvSeq || !d.open) return;
    remember(full);
    draw(full, true);
  } catch (e) {
    if (seq !== qvSeq) return;
    $('.qv-text', d).outerHTML = `<p class="qv-text muted">Ayrıntılar yüklenemedi: ${esc(e.message)}</p>`;
  }
}

// ---- Mobil alt menü ----
function syncBottomNav(part = (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'home')) {
  const bar = $('#bottom-nav');
  if (!bar) return;
  const n = myList.filter(x => secOf(x) === section).length;
  if (part === 'canli') {
    bar.innerHTML = [['canli', '#/canli', 'Kanallar', '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="m9 2.5 3 3 3-3"/>'], ['fav', null, 'Favoriler', '<path d="M12 3.5l2.6 5.4 5.9.7-4.4 4 1.2 5.9L12 16.6l-5.3 2.9 1.2-5.9-4.4-4 5.9-.7z"/>'], ['ara', null, 'Kanal ara', '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'], ['anime', null, 'Anime', '<path d="M12 3.5l2.3 5.6 6 .5-4.6 3.9 1.4 5.9L12 16.3l-5.1 3.1 1.4-5.9-4.6-3.9 6-.5z"/>'], ['media', null, 'Film & Dizi', '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>']]
      .map(([k, href, label, icon]) => { const inner = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${esc(label)}</span>`; return href ? `<a href="${href}" aria-current="page">${inner}</a>` : `<button type="button" data-bn="${k}">${inner}</button>`; }).join('');
    $$('[data-bn]', bar).forEach(b => b.onclick = () => {
      const k = b.dataset.bn;
      if (k === 'ara') openSearch();
      else if (k === 'fav') { const f = $('#live-favs'); if (f && !f.hidden) f.scrollIntoView({behavior: reduceMotion ? 'auto' : 'smooth', block: 'start'}); else toast('Kanal kartındaki yıldızla favori ekleyebilirsin'); }
      else $(`.tab-btn[data-tab="${k}"]`)?.click();
    });
    return;
  }
  const items = [
    ['home', '#/watch', S().nav.home, '<path d="M3 10.5 12 4l9 6.5V20h-6v-5H9v5H3z"/>'],
    ['kesfet', '#/kesfet', S().nav.kesfet, '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>'],
    ['filmler', '#/filmler', section === 'anime' ? 'Filmler' : S().nav.filmler, '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8h16M4 16h16M9 3v5M15 3v5M9 16v5M15 16v5"/>'],
    ['ara', null, 'Ara', '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'],
    ['listem', '#/listem', 'Listem', '<path d="M6 3h12v18l-6-4-6 4z"/>'],
  ];
  bar.innerHTML = items.map(([k, href, label, icon]) => {
    const inner = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${esc(label)}</span>${k === 'listem' && n ? `<b>${n}</b>` : ''}`;
    return href ? `<a href="${href}" ${k === part ? 'aria-current="page"' : ''}>${inner}</a>` : `<button type="button" data-bn-search>${inner}</button>`;
  }).join('');
  $('[data-bn-search]', bar).onclick = openSearch;
}

// ---- İzleme sayfası: sinema modu, bölüm arama, önceki / sonraki bölüm ----
function bindWatchExtras(ctx) {
  const cin = $('#cinema');
  ambientFrom(ctx.a.backdrop || ctx.a.poster, cin);
  $('#theater')?.addEventListener('click', () => {
    const on = !cin.classList.contains('theater');
    cin.classList.toggle('theater', on);
    $('#theater').setAttribute('aria-pressed', String(on));
    store.set('theater', on);
    toast(on ? 'Sinema modu açık' : 'Sinema modu kapalı');
  });
  $('#panel-toggle')?.addEventListener('click', () => cin.classList.toggle('no-panel'));
  paintWatchOpts(ctx);
  const find = $('#ep-find');
  if (find) find.addEventListener('input', () => {
    const q = find.value.trim().toLocaleLowerCase('tr');
    const eps = ctx.episodes;
    if (!eps.length) return;
    const match = ep => !q || String(ep.n) === q || ep.title.toLocaleLowerCase('tr').includes(q);
    const first = eps.findIndex(match);
    if (first < 0) { $$('#ep-list > li').forEach(li => li.hidden = true); return; }
    const page = Math.floor(first / 50);
    if (Number($('#range')?.value || 0) !== page) { renderEpisodes(ctx, page); if ($('#range')) $('#range').value = page; }
    $$('#ep-list > li').forEach(li => { const n = Number(li.querySelector('.ep-n')?.textContent); const ep = eps.find(x => x.n === n); li.hidden = !!q && !(ep && match(ep)); });
    if (/^\d+$/.test(q)) $(`#ep-list .ep[href*="&e=${q}"]`)?.scrollIntoView({block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth'});
  });
}
function prevOf(ctx) {
  const i = ctx.episodes.findIndex(x => x.n === ctx.e);
  return i > 0 ? {s: ctx.s, e: ctx.episodes[i - 1].n} : null;
}
function updateEpNav(ctx) {
  const nav = $('#ep-nav');
  if (!nav) return;
  const p = prevOf(ctx), n = nextOf(ctx);
  const t = x => { const ep = x && x.s === ctx.s ? ctx.episodes.find(y => y.n === x.e) : null; return ep && !/^Bölüm \d+$/.test(ep.title) ? ep.title : ''; };
  nav.hidden = !p && !n;
  nav.innerHTML = `${p ? `<a class="ep-step prev" href="${watchHref(ctx.a, p.s, p.e)}"><svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg><span><small>Önceki bölüm</small><b>${p.s}. sezon ${p.e}. bölüm${t(p) ? ` · ${esc(t(p))}` : ''}</b></span></a>` : ''}${n ? `<a class="ep-step next" href="${watchHref(ctx.a, n.s, n.e)}"><span><small>Sonraki bölüm</small><b>${n.s}. sezon ${n.e}. bölüm${t(n) ? ` · ${esc(t(n))}` : ''}</b></span><svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg></a>` : ''}`;
  const jump = $('#watch-jump');
  if (jump) jump.innerHTML = `${p ? `<a class="btn btn-ghost btn-sm" href="${watchHref(ctx.a, p.s, p.e)}">‹ Önceki</a>` : ''}<span class="badge-ep">${isMovie(ctx.a) ? 'Film' : `${ctx.e}. bölüm`}</span>${n ? `<a class="btn btn-play btn-sm" href="${watchHref(ctx.a, n.s, n.e)}">Sonraki ›</a>` : ''}`;
}

function paintWatchOpts(ctx) {
  const dub = wantsDub(ctx);
  $$('#audio-toggle [data-audio]').forEach(b => b.classList.toggle('on', (b.dataset.audio === 'dub') === dub));
  $$('#audio-toggle [data-audio]').forEach(b => b.onclick = () => applyAudio(ctx, b.dataset.audio));
}

function isTurkishAudio(t) {
  return /^(tr|tur)(?:[-_]|$)/i.test(t.lang || t.language || '') || /türk|turk/i.test(t.name || t.label || '');
}
function selectPlayerAudio(p, wantDub) {
  if (!p) return false;
  const tracks = p.hls?.audioTracks || Array.from(p.video?.audioTracks || []);
  const index = tracks.findIndex(t => isTurkishAudio(t) === wantDub);
  if (index < 0) return false;
  if (p.hls) p.hls.audioTrack = index;
  else tracks.forEach((t, i) => { t.enabled = i === index; });
  return true;
}
function applyAudio(ctx, lang) {
  const wantDub = lang === 'dub';
  store.set(secOf(ctx.a) === 'anime' ? 'preferDubAnime' : 'preferDub', wantDub);
  paintWatchOpts(ctx);
  if (ctx.mode === 'player' && selectPlayerAudio(player, wantDub)) {
    if (wantDub && player.art) player.art.subtitle.show = false;
    toast(wantDub ? 'Türkçe ses seçildi' : 'Orijinal ses seçildi');
    return;
  }
  const direct = ctx.sources || [];
  const sourceIndex = direct.findIndex(s => wantDub ? s.dub === true : !s.dub && s.lang === 'tr');
  if (sourceIndex >= 0) { if (ctx.mode !== 'player' || ctx.index !== sourceIndex) mountPlayer(ctx, sourceIndex); return; }
  const list = ctx.embeds || [];
  const i = list.findIndex(e => wantDub ? (e.lang === 'tr-dub' || (e.dub && (e.lang === 'tr' || e.tr))) : (e.lang === 'sub' || (e.tr && !e.dub)));
  if (i < 0) { paintWatchOpts(ctx); toast(ctx.remote === 'loading' ? 'Kaynak araması sürüyor; tamamlandığında tekrar deneyebilirsin' : wantDub ? 'Bu bölümde doğrulanmış Türkçe dublaj kaynağı yok' : 'Türkçe altyazılı kaynak yok'); return; }
  const e = list[i];
  store.set('embedPref', {id: e.id, lang: e.lang || (wantDub ? 'dub' : 'sub')});
  paintWatchOpts(ctx);
  mountEmbed(ctx, i);
}

// ---- Arama: boşken son aramalar ve öne çıkanlar ----
function rememberSearch(q) {
  q = String(q || '').trim();
  if (q.length < 2) return;
  store.set('searches', [q, ...store.get('searches', []).filter(x => x.toLocaleLowerCase('tr') !== q.toLocaleLowerCase('tr'))].slice(0, 8));
}
async function searchIdle() {
  const recentQ = store.get('searches', []);
  const head = `${recentQ.length ? `<div class="search-idle"><p class="result-group">Son aramalar<button type="button" class="text-btn" data-clear-recent>Temizle</button></p><div class="search-chips">${recentQ.map(q => `<button type="button" class="chip" data-q="${esc(q)}"><svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/></svg>${esc(q)}</button>`).join('')}</div></div>` : ''}`;
  sr.innerHTML = head + `<p class="result-group">${section === 'anime' ? 'Şu an popüler animeler' : 'Şu an popüler'}</p><div id="search-pop">${loading('')}</div>`;
  try {
    const d = await api(withSection('/api/home'));
    const pop = $('#search-pop');
    if (!pop || si.value.trim().length >= 2) return;
    const items = (d.shelves?.find(x => x.layout === 'rank') || d.shelves?.[0])?.items?.slice(0, 6) || [];
    pop.innerHTML = items.map((a, i) => `<a class="result" role="option" href="${watchHref(a)}" style="--d:${i * 30}ms"><span class="result-img thumb">${a.poster ? `<img src="${esc(a.poster)}" alt="" data-fb>` : ''}</span><span><strong>${esc(a.title)}</strong><small>${[a.year, kindLabel(a), a.score ? score(a.score) + ' puan' : ''].filter(Boolean).join(', ')}</small></span><span class="result-rank">${i + 1}</span></a>`).join('') || '<p class="muted pad">En az iki harf yaz.</p>';
    imgFallback(pop);
  } catch { const pop = $('#search-pop'); if (pop) pop.innerHTML = '<p class="muted pad">En az iki harf yaz.</p>'; }
}

// ---- Klavye kısayolları ----
// Her satır: [tuş grupları ("|" ile ayrılır, "+" birlikte basılır), açıklama]
const SHORTCUTS = [['/|Ctrl+K', 'Ara'], ['1|2|3', 'Anime, Film & Dizi, Canlı TV'], ['I', 'Vitrindeki başlığın ayrıntıları'], ['T', 'Sinema modu (izleme sayfasında)'], ['Shift+N|Shift+P', 'Sonraki, önceki bölüm'], ['G', 'İzleme geçmişi'], [',', 'Ayarlar'], ['↑|↓', 'Canlı TV oynatıcısında kanal değiştir'], ['Esc', 'Pencereyi kapat'], ['?', 'Bu listeyi göster']];
function openShortcuts() {
  let d = $('#keys');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'keys'; d.className = 'keys';
    d.setAttribute('aria-label', 'Klavye kısayolları');
    d.innerHTML = `<div class="keys-card"><h2>Klavye kısayolları</h2><dl>${SHORTCUTS.map(([k, t]) => `<div><dt>${k.split('|').map(g => g.split('+').map(x => `<kbd>${esc(x)}</kbd>`).join('<i>+</i>')).join('<span>ya da</span>')}</dt><dd>${esc(t)}</dd></div>`).join('')}</dl><button class="btn btn-ghost btn-sm" type="button">Kapat</button></div>`;
    document.body.append(d);
    $('button', d).onclick = () => d.close();
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
  }
  d.showModal();
}
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (typing || e.ctrlKey || e.metaKey || e.altKey || $('dialog[open], .livetv-modal')) return;
  const watch = /^#\/izle\//.test(location.hash);
  const app = document.documentElement.dataset.app;
  if (e.key === '?') { e.preventDefault(); openShortcuts(); }
  else if (e.key === ',') { e.preventDefault(); openSettings(); }
  else if (app === 'hub' || app === 'lovellify' || app === 'speedfy') return;
  else if (e.key.toLowerCase() === 'g' && !watch) location.hash = '#/listem?g=gecmis';
  else if (['1', '2', '3'].includes(e.key)) $(`.tab-btn[data-tab="${['anime', 'media', 'livetv'][Number(e.key) - 1]}"]`)?.click();
  else if (e.key.toLowerCase() === 't' && watch) $('#theater')?.click();
  else if (e.key.toLowerCase() === 'i' && !watch) $('.hero .btn-info')?.click();
  else if (e.shiftKey && watch && (e.key === 'N' || e.key === 'P')) $(`#ep-nav .ep-step.${e.key === 'N' ? 'next' : 'prev'}`)?.click();
});

// ---- Yukarı çık düğmesi ----
const toTop = document.createElement('button');
toTop.className = 'to-top'; toTop.type = 'button'; toTop.setAttribute('aria-label', 'Sayfanın başına dön');
toTop.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg>';
toTop.onclick = () => window.scrollTo({top: 0, behavior: reduceMotion ? 'auto' : 'smooth'});
document.body.append(toTop);
addEventListener('scroll', () => toTop.classList.toggle('show', scrollY > 1400), {passive: true});

// ---- Raflarda fareyle sürükleyerek kaydırma ----
document.addEventListener('dragstart', e => { if (e.target.closest?.('.row')) e.preventDefault(); });
document.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  const row = e.target.closest?.('.row');
  if (!row || e.target.closest('.qa-btn')) return;
  const x0 = e.clientX, s0 = row.scrollLeft;
  let moved = false;
  const move = ev => {
    const dx = ev.clientX - x0;
    if (!moved && Math.abs(dx) > 6) { moved = true; row.classList.add('dragging'); }
    if (moved) row.scrollLeft = s0 - dx;
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    if (moved) {
      row.classList.remove('dragging');
      // Sürükleme bitince tıklamayı yut, kart açılmasın.
      const stop = ev => { ev.preventDefault(); ev.stopPropagation(); };
      row.addEventListener('click', stop, {capture: true, once: true});
      setTimeout(() => row.removeEventListener('click', stop, {capture: true}), 50);
    }
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
});

// ---- Yatay kartlarda imleci izleyen ışık ----
document.addEventListener('pointermove', e => {
  const li = e.target.closest?.('.land-img');
  if (!li) return;
  const r = li.getBoundingClientRect();
  li.style.setProperty('--mx', (e.clientX - r.left) + 'px');
  li.style.setProperty('--my', (e.clientY - r.top) + 'px');
}, {passive: true});

// ---- Vitrinde sessiz fragman (Netflix gibi): birkaç saniye sonra arka planda oynar ----
let trailerTimer = 0, trailerMuted = true;
const heroVisible = new WeakMap();
function heroTrailer(hero, a, stillCurrent, next) {
  clearTimeout(trailerTimer);
  $('.hero-trailer', hero)?.remove();
  hero.classList.remove('trailer-on');
  const conn = navigator.connection;
  if (reduceMotion || innerWidth < 900 || conn?.saveData || /2g/.test(conn?.effectiveType || '') || store.get('heroTrailer', true) === false) return;
  if (!heroVisible.has(hero)) {
    heroVisible.set(hero, true);
    new IntersectionObserver(([en]) => {
      heroVisible.set(hero, en.isIntersecting);
      const f = $('.hero-trailer iframe', hero);
      if (f) ytCmd(f, en.isIntersecting ? 'playVideo' : 'pauseVideo');
    }, {threshold: .35}).observe(hero);
  }
  trailerTimer = setTimeout(async () => {
    if (!document.contains(hero) || !stillCurrent() || document.hidden || !heroVisible.get(hero)) return;
    let d;
    try { d = await api(`/api/title/${a.kind}/${a.id}`, 15000, {quiet: true}); } catch { return; }
    const key = d?.trailer?.site === 'youtube' || d?.trailer?.key ? d.trailer.key : null;
    if (!key || !document.contains(hero) || !stillCurrent()) return;
    const box = document.createElement('div');
    box.className = 'hero-trailer';
    box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&mute=1&controls=0&loop=1&playlist=${encodeURIComponent(key)}&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3&disablekb=1&fs=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}" title="" allow="autoplay; encrypted-media" tabindex="-1" aria-hidden="true"></iframe>`;
    $('.hero-bg', hero).append(box);
    const f = $('iframe', box);
    f.addEventListener('load', () => setTimeout(() => {
      if (!document.contains(box)) return;
      hero.classList.add('trailer-on');
      if (!trailerMuted) ytCmd(f, 'unMute');
      clearTimeout(heroTimer);
      // Fragman oynarken vitrin kendiliğinden değişmez; 40 sn sonra sıradakine geçer.
      heroTimer = setTimeout(() => { if (document.contains(hero) && !hero.matches(':hover, :focus-within')) next(); }, 40000);
    }, 1400), {once: true});
    let mute = $('.hero-mute', hero);
    if (!mute) {
      mute = document.createElement('button');
      mute.type = 'button'; mute.className = 'hero-mute';
      hero.append(mute);
      mute.onclick = () => { trailerMuted = !trailerMuted; const fr = $('.hero-trailer iframe', hero); if (fr) ytCmd(fr, trailerMuted ? 'mute' : 'unMute'); drawMute(mute); };
    }
    drawMute(mute);
  }, 2800);
}
function drawMute(b) {
  b.setAttribute('aria-label', trailerMuted ? 'Fragmanın sesini aç' : 'Fragmanın sesini kapat');
  b.innerHTML = trailerMuted
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m17 9 4 6M21 9l-4 6"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12"/></svg>';
}
function ytCmd(f, func) { try { f.contentWindow?.postMessage(JSON.stringify({event: 'command', func, args: []}), '*'); } catch {} }
document.addEventListener('visibilitychange', () => { const f = $('.hero-trailer iframe'); if (f) ytCmd(f, document.hidden ? 'pauseVideo' : 'playVideo'); });

// ---- Bir karta basılınca ayrıntıları hemen yüklemeye başla (sayfa daha hızlı açılır) ----
document.addEventListener('pointerdown', e => {
  const m = e.target.closest?.('a[href^="#/izle/"]')?.getAttribute('href').match(/#\/izle\/(tv|movie|al)\/(\d+)/);
  if (m) prefetch(`/api/title/${m[1]}/${m[2]}`);
}, {passive: true});

// ---- Üzerine gelince büyüyen önizleme kartı (yalnızca fareyle) ----
const peek = {el: null, src: null, timer: 0, hideTimer: 0, key: ''};
function peekEl() {
  if (peek.el) return peek.el;
  const el = document.createElement('div');
  el.className = 'peek'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Önizleme');
  el.addEventListener('mouseenter', () => clearTimeout(peek.hideTimer));
  el.addEventListener('mouseleave', () => hidePeekSoon());
  document.body.append(el);
  return (peek.el = el);
}
function hidePeek(now) {
  clearTimeout(peek.timer); clearTimeout(peek.hideTimer);
  const el = peek.el;
  if (!el || !el.classList.contains('open')) return;
  peek.src?.classList.remove('peeking');
  const done = () => { el.classList.remove('open'); el.style.visibility = ''; };
  if (now || reduceMotion || !el.animate) return done();
  const r = peek.src?.getBoundingClientRect(), b = el.getBoundingClientRect();
  const to = r && r.width ? `translate(${r.left + r.width / 2 - (b.left + b.width / 2)}px, ${r.top + r.height / 2 - (b.top + b.height / 2)}px) scale(${r.width / b.width})` : 'scale(.92)';
  el.animate([{transform: 'none', opacity: 1}, {transform: to, opacity: 0}], {duration: 200, easing: 'cubic-bezier(.4,0,.6,1)'}).onfinish = done;
  peek.key = '';
}
function hidePeekSoon() { clearTimeout(peek.hideTimer); peek.hideTimer = setTimeout(() => hidePeek(), 140); }
function showPeek(src) {
  const href = src.getAttribute('href') || '';
  const m = href.match(/#\/izle\/(tv|movie|al)\/(\d+)/);
  if (!m || !document.contains(src)) return;
  const key = `${m[1]}:${m[2]}`, a = ITEMS.get(key);
  if (!a) return;
  prefetch(`/api/title/${m[1]}/${m[2]}`);
  const el = peekEl();
  peek.src?.classList.remove('peeking');
  peek.src = src; peek.key = key;
  src.classList.add('peeking');
  const img = a.backdrop || a.poster;
  const genres = (a.genres || []).slice(0, 3);
  el.innerHTML = `<a class="peek-media" href="${href}" tabindex="-1">${img ? `<img src="${esc(img)}" alt="" class="${a.backdrop ? '' : 'is-poster'}">` : `<span class="peek-ph">${esc(a.title)}</span>`}<span class="peek-shade"></span><span class="peek-title">${esc(a.title)}</span></a>
    <div class="peek-body">
      <div class="peek-acts">
        <a class="peek-play" href="${href}" aria-label="Oynat">${PLAY}</a>
        <span class="qa-btn ${inList(a) ? 'on' : ''}" role="button" tabindex="0" data-list="${key}" aria-label="${inList(a) ? 'Listeden çıkar' : 'Listeye ekle'}">${inList(a) ? CHECK : PLUS}</span>
        <span class="qa-btn peek-more" role="button" tabindex="0" data-info="${key}" aria-label="Ayrıntılar"><svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></span>
      </div>
      <p class="peek-meta">${a.score ? `<span class="peek-score">${STAR}${score(a.score)}</span>` : ''}${a.year ? `<span>${esc(a.year)}</span>` : ''}<span class="kind-pill">${kindLabel(a)}</span></p>
      ${genres.length ? `<p class="peek-genres">${genres.map(g => `<span>${esc(g)}</span>`).join('')}</p>` : ''}
      ${a.overview ? `<p class="peek-text">${esc(a.overview)}</p>` : ''}
    </div>`;
  // Konum: kartın ortasına göre, ekrandan taşmayacak şekilde.
  const r = src.getBoundingClientRect();
  const w = Math.round(Math.min(Math.max(r.width * 1.45, 320), 420));
  el.style.width = w + 'px';
  el.style.visibility = 'hidden';
  el.classList.add('open');
  const h = el.offsetHeight;
  const left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - w - 12);
  const top = Math.min(Math.max(76, r.top + r.height / 2 - h * 0.42), innerHeight - h - 12);
  el.style.left = left + scrollX + 'px';
  el.style.top = top + scrollY + 'px';
  el.style.visibility = '';
  ambientFrom(img, el);
  if (!reduceMotion && el.animate) {
    const from = `translate(${r.left + r.width / 2 - (left + w / 2)}px, ${r.top + r.height / 2 - (top + h / 2)}px) scale(${r.width / w})`;
    el.animate([{transform: from, opacity: .4}, {transform: 'none', opacity: 1}], {duration: 360, easing: 'cubic-bezier(.22,1,.36,1)'});
    $$('.peek-body > *', el).forEach((c, i) => c.animate([{opacity: 0, transform: 'translateY(8px)'}, {opacity: 1, transform: 'none'}], {duration: 320, delay: 120 + i * 45, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards'}));
  }
}
document.addEventListener('click', e => {
  if (!peek.key) return;
  if (e.target.closest?.('.peek, [data-info]')) return;
  hidePeek(true);
});
addEventListener('scroll', () => peek.key && hidePeek(true), {passive: true});
addEventListener('blur', () => hidePeek(true));
addEventListener('hashchange', () => hidePeek(true));
document.addEventListener('keydown', e => { if (e.key === 'Escape') hidePeek(); });
// Satırlar yatay kayınca da kapat.
document.addEventListener('scroll', e => { if (peek.key && e.target.classList?.contains('row')) hidePeek(true); }, {capture: true, passive: true});

// ---- Ayarlar penceresi: tema, oynatma tercihleri, verileri dışa / içe aktarma ----
const PREFS = [
  ['heroTrailer', 'Vitrinde fragmanı otomatik oynat', 'Ana sayfadaki büyük vitrinde birkaç saniye sonra sessiz fragman başlar.'],
  ['autoNext', 'Sonraki bölüme otomatik geç', 'Bölüm bitince 8 saniyelik geri sayımla sıradakini açar.'],
  ['resume', 'Kaldığım yerden devam et', 'Bir videoyu yeniden açtığında son izlediğin saniyeden başlar.'],
  ['autoSkip', 'Anime giriş ve bitişini otomatik atla', 'AniSkip verisi olan bölümlerde açılış / kapanış şarkısını kendiliğinden geçer (doğrudan kaynaklarda).', false],
  ['preferTr', 'Türkçe kaynakları önce aç', 'Türkçe altyazılı ya da dublajlı doğrudan kaynak bulunursa oynatma onunla başlar.'],
  ['preferDub', 'Türkçe dublajı altyazıya tercih et', 'Hem dublaj hem altyazılı Türkçe kaynak varsa dublajlı olan açılır.'],
];
const THEMES = [['system', 'Sistem'], ['dark', 'Koyu'], ['light', 'Açık'], ['kitty', 'Hello Kitty']];
function openSettings() {
  let d = $('#settings');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'settings'; d.className = 'settings';
    d.setAttribute('aria-labelledby', 'settings-title');
    document.body.append(d);
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
  }
  const favs = liveFavs().length, hist = Object.keys(recent).length, list = myList.length;
  d.innerHTML = `<div class="settings-card">
    <header class="settings-head"><h2 id="settings-title">Ayarlar</h2><button class="icon-btn" type="button" data-close aria-label="Kapat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>
    <section class="set-sec"><h3>Görünüm</h3>
      <div class="set-row"><span><strong>Tema</strong><small>Koyu, açık veya Hello Kitty. Sistem cihazın ayarını izler.</small></span><div class="seg" role="radiogroup" aria-label="Tema">${THEMES.map(([k, t]) => `<button type="button" role="radio" aria-checked="${themeMode() === k}" data-theme-set="${k}">${t}</button>`).join('')}</div></div>
      <label class="set-row"><span><strong>Renk paleti</strong><small>Bu anahtara özel vurgu rengi.</small></span><input type="color" id="set-accent" value="${esc(store.get('accent', '') || '#d61e2b')}"></label>
      <label class="set-row"><span><strong>Arkaplan</strong><small>İsteğe bağlı bir görsel. Yalnızca bu profilde durur.</small></span><span class="actions"><input type="file" accept="image/jpeg,image/png,image/webp" id="set-wall" hidden><button class="btn btn-ghost btn-sm" type="button" data-wall-pick>Görsel seç</button><button class="btn btn-ghost btn-sm" type="button" data-wall-clear>Kaldır</button></span></label>
    </section>
    <section class="set-sec"><h3>Oynatma</h3>
      ${PREFS.map(([k, t, sub, def = true]) => `<label class="set-row"><span><strong>${t}</strong><small>${sub}</small></span><input type="checkbox" role="switch" class="switch" data-pref="${k}" ${store.get(k, def) ? 'checked' : ''}></label>`).join('')}
    </section>
    <section class="set-sec"><h3>Profil</h3>
      <p class="set-note">${profileKey ? `İzleyeceklerim listesi <b>${esc(profile?.name || 'Profil')}</b> anahtarına bağlı. Anahtarı bilen her cihaz aynı listeyi görür.` : 'Anahtarın yokken liste yalnızca bu tarayıcıda durur. Anahtar sana verilir; kendin üretemezsin.'}</p>
      <div class="actions"><a class="btn btn-ghost btn-sm" href="#/profil">${profileKey ? 'Profili aç' : 'Anahtarımı gir'}</a></div>
    </section>
    <section class="set-sec"><h3>Verilerin</h3>
      <p class="set-stats"><span><b>${list}</b> başlık listende</span><span><b>${hist}</b> başlık geçmişte</span><span><b>${favs}</b> favori kanal</span></p>
      <p class="set-note">${profileKey ? 'Yedek dosyası anahtarın yanında durur. Başka bir profile aktarmak için de kullanabilirsin.' : 'Başka bir cihaza dosyayla taşımak için dışa aktarıp orada içe aktar.'}</p>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" type="button" data-export><svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8M5 7l3 3 3-3M3 12.5h10"/></svg>Dışa aktar</button>
        <label class="btn btn-ghost btn-sm"><svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10V2M5 5l3-3 3 3M3 12.5h10"/></svg>İçe aktar<input type="file" accept="application/json,.json" data-import hidden></label>
        <button class="btn btn-ghost btn-sm" type="button" data-clear-hist ${hist ? '' : 'disabled'}>Geçmişi temizle</button>
        <button class="btn btn-ghost btn-sm" type="button" data-clear-search>Arama geçmişini sil</button>
        <button class="btn btn-ghost btn-sm" type="button" data-clear-health title="Oynatıcılar varsayılan sıraya döner, başlık başına hatırlanan kaynaklar silinir">Kaynak sıralamasını sıfırla</button>
      </div>
    </section>
    <footer class="settings-foot"><button class="text-btn" type="button" data-keys>Klavye kısayolları</button><button class="btn btn-play btn-sm" type="button" data-close>Tamam</button></footer>
  </div>`;
  d.onclick = e => {
    if (e.target === d) return d.close();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-close')) d.close();
    else if (b.dataset.themeSet) { applyTheme(b.dataset.themeSet); $$('[data-theme-set]', d).forEach(x => x.setAttribute('aria-checked', String(x === b))); }
    else if (b.hasAttribute('data-wall-pick')) $('#set-wall')?.click();
    else if (b.hasAttribute('data-wall-clear')) { applySkin(store.get('accent', ''), ''); if (profile) { profile.prefs = skinPrefs(); store.set('profileMeta', profile); scheduleSync(); } toast('Arkaplan kaldırıldı', 'success'); }
    else if (b.hasAttribute('data-export')) exportData();
    else if (b.hasAttribute('data-clear-hist')) { d.close(); clearHistory(true); }
    else if (b.hasAttribute('data-clear-search')) { store.set('searches', []); toast('Arama geçmişi silindi', 'success'); }
    else if (b.hasAttribute('data-clear-health')) { store.set('embedHealth', {}); store.set('srcMem', {}); store.set('embedPref', null); toast('Kaynak sıralaması sıfırlandı', 'success'); }
    else if (b.hasAttribute('data-keys')) { d.close(); openShortcuts(); }
  };
  $$('[data-pref]', d).forEach(c => c.onchange = () => { store.set(c.dataset.pref, c.checked); if (c.dataset.pref === 'heroTrailer' && !c.checked) { $('.hero-trailer')?.remove(); $('.hero')?.classList.remove('trailer-on'); } });
  $('#set-accent')?.addEventListener('input', e => {
    applySkin(e.target.value, store.get('wall', ''));
    if (profile) { profile.prefs = {...skinPrefs(), theme: themeMode()}; store.set('profileMeta', profile); scheduleSync(); }
  });
  $('#set-wall')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (!f || f.size > 70000) { if (f) toast('Görsel 70 KB’dan küçük olsun', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      applySkin(store.get('accent', ''), String(reader.result || ''));
      if (profile) { profile.prefs = {...skinPrefs(), theme: themeMode()}; store.set('profileMeta', profile); scheduleSync(); }
      toast('Arkaplan kaydedildi', 'success');
    };
    reader.readAsDataURL(f);
  });
  $('[data-import]', d).onchange = e => { const f = e.target.files?.[0]; if (f) importData(f).then(() => { d.close(); }); };
  if (!d.open) d.showModal();
}
function exportData() {
  const data = {app: 'lovell', version: 1, exportedAt: new Date().toISOString(), list: myList, progress, recent, liveFav: liveFavs()};
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], {type: 'application/json'}));
  const a = Object.assign(document.createElement('a'), {href: url, download: `lovell-yedek-${new Date().toISOString().slice(0, 10)}.json`});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Yedek dosyası indirildi', 'success');
}
async function importData(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d?.app !== 'lovell' || !Array.isArray(d.list)) throw Error('Bu bir LOVELL yedeği değil');
    const valid = a => a && /^(tv|movie|al)$/.test(a.kind) && /^\d+$/.test(String(a.id)) && typeof a.title === 'string';
    const known = new Set(myList.map(keyOf));
    const added = d.list.filter(valid).filter(a => !known.has(keyOf(a))).map(a => ({...slim(a), section: secOf(a)}));
    myList = [...myList, ...added];
    if (d.progress && typeof d.progress === 'object') for (const [k, p] of Object.entries(d.progress)) if (p?.d > 0 && !(progress[k]?.at > p.at)) progress[k] = {t: Number(p.t) || 0, d: Number(p.d), at: Number(p.at) || 0};
    if (d.recent && typeof d.recent === 'object') for (const [k, r] of Object.entries(d.recent)) if (valid(r?.item) && !(recent[k]?.at > r.at)) recent[k] = {item: slim(r.item), s: Number(r.s) || 1, e: Number(r.e) || 1, at: Number(r.at) || 0};
    if (Array.isArray(d.liveFav)) store.set('liveFav', [...new Set([...liveFavs(), ...d.liveFav.filter(u => typeof u === 'string')])]);
    store.set('list', myList); store.set('progress', progress); store.set('recent', recent);
    scheduleSync();
    updateCount(); syncBottomNav();
    toast(`${added.length} yeni başlık listene eklendi`, 'success');
    route();
  } catch (e) { toast(`İçe aktarılamadı: ${e.message}`, 'error'); }
}

// ---- Profil ----
const AVATAR_COLORS = ['#e4202b', '#7c5cff', '#1f8a70', '#d97706', '#2563eb', '#db2777', '#0f766e', '#b45309'];
function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) { reject(new Error('Yalnızca JPEG, PNG veya WebP seç')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const side = Math.min(img.width, img.height) || 1;
      canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 128, 128);
      const data = canvas.toDataURL('image/jpeg', 0.72);
      if (!data.startsWith('data:image/jpeg') || data.length > 80000) reject(new Error('Fotoğraf çok büyük'));
      else resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Fotoğraf okunamadı')); };
    img.src = url;
  });
}
function viewProfile() {
  document.title = 'Profil — LOVELL';
  if (!profileKey) {
    main.innerHTML = `<div class="page profile-page"><header class="page-head"><div><p class="eyebrow">Hesap</p><h1>Profil anahtarı</h1></div><p>Anahtarı sana veren kişi üretir. Buraya yapıştırınca izleyeceklerim listen o profile bağlanır ve başka cihazda da açılır.</p></header>
      <form class="profile-card" id="profile-join">
        <h2>Anahtarını gir</h2>
        <label class="field">Anahtar<input name="key" required placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autocapitalize="characters" spellcheck="false" autocomplete="off"></label>
        <button class="btn btn-play" type="submit">Bu anahtarla aç</button>
      </form>
    </div>`;
    $('#profile-join').onsubmit = async e => {
      e.preventDefault();
      const formatted = validProfileKey(new FormData(e.target).get('key'));
      if (!formatted) { toast('Anahtar 20 karakter olmalı. I, O, 0 ve 1 kullanılmaz.', 'error'); return; }
      const btn = $('button', e.target);
      btn.disabled = true;
      const prev = profileKey;
      profileKey = formatted;
      try {
        const remote = await apiSend('/api/profile', 'GET');
        myList = mergeLists(myList, remote.list);
        progress = mergeProgress(progress, remote.progress);
        recent = mergeRecent(recent, remote.recent);
        persistUser();
        profile = metaOf(remote);
        syncBase = remote.updatedAt;
        store.set('profileKey', profileKey);
        store.set('profileMeta', profile);
        store.set('syncBase', syncBase);
        profileReady = true;
        paintProfile();
        await pushOnce();
        toast(`${profile.name} profili açıldı`, 'success');
        updateCount();
        viewProfile();
      } catch (err) {
        profileKey = prev;
        store.set('profileKey', prev);
        if (!prev) { profile = null; store.set('profileMeta', null); }
        paintProfile();
        toast(err.message, 'error');
        btn.disabled = false;
      }
    };
    return;
  }
  const swatches = AVATAR_COLORS.map((c, i) => `<button type="button" class="swatch" style="background:${c}" data-color="${i}" role="radio" aria-checked="${Number(profile?.color) === i}" aria-label="Renk ${i + 1}"></button>`).join('');
  main.innerHTML = `<div class="page profile-page"><header class="page-head"><div><p class="eyebrow">Profil</p><h1>${esc(profile?.name || 'Profil')}</h1></div><p>İzleyeceklerim listesi bu anahtara göre durur. Ad, fotoğraf ve renk de aynı anahtarla diğer cihazlara gider.</p></header>
    <section class="profile-card profile-live">
      <div class="profile-id">${avatarMarkup(profile, true)}
        <div class="profile-customize">
          <form id="profile-name" class="profile-rename"><label class="field">Görünen ad<input name="name" maxlength="24" value="${esc(profile?.name || '')}" required></label><button class="btn btn-ghost btn-sm" type="submit">Kaydet</button></form>
          <div class="profile-photo">
            <label class="btn btn-ghost btn-sm">Fotoğraf seç<input id="profile-photo" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>
            ${profile?.avatar ? '<button class="btn btn-ghost btn-sm" type="button" id="profile-photo-clear">Fotoğrafı kaldır</button>' : ''}
          </div>
          <div class="swatches" role="radiogroup" aria-label="Profil rengi">${swatches}</div>
        </div>
      </div>
      <p class="set-stats"><span><b>${myList.length}</b> izleyeceklerim</span><span><b>${Object.keys(recent).length}</b> geçmiş</span></p>
      <label class="field">Profil anahtarın<input id="profile-key" readonly value="${esc(profileKey)}"></label>
      <div class="actions">
        <button class="btn btn-play btn-sm" type="button" id="copy-key">Anahtarı kopyala</button>
        <a class="btn btn-ghost btn-sm" href="#/listem">İzleyeceklerim</a>
        <button class="btn btn-ghost btn-sm" type="button" id="profile-leave">Bu cihazdan çık</button>
      </div>
    </section>
  </div>`;
  $('#profile-name').onsubmit = e => {
    e.preventDefault();
    const name = String(new FormData(e.target).get('name') || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!name) return;
    profile = {...profile, name};
    store.set('profileMeta', profile);
    paintProfile();
    scheduleSync();
    toast('Ad kaydediliyor', 'success');
    $('h1', main).textContent = name;
    if (!profile.avatar) {
      const big = $('.profile-id .avatar');
      if (big) big.textContent = name.slice(0, 1).toLocaleUpperCase('tr');
    }
  };
  $('#profile-photo').onchange = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const avatar = await fileToAvatar(file);
      profile = {...profile, avatar};
      store.set('profileMeta', profile);
      paintProfile();
      scheduleSync();
      toast('Fotoğraf kaydediliyor', 'success');
      viewProfile();
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#profile-photo-clear')?.addEventListener('click', () => {
    profile = {...profile, avatar: ''};
    store.set('profileMeta', profile);
    paintProfile();
    scheduleSync();
    toast('Fotoğraf kaldırılıyor', 'success');
    viewProfile();
  });
  $$('.swatch', main).forEach(btn => btn.addEventListener('click', () => {
    const color = Number(btn.dataset.color);
    profile = {...profile, color};
    store.set('profileMeta', profile);
    paintProfile();
    $$('.swatch', main).forEach(b => b.setAttribute('aria-checked', b === btn ? 'true' : 'false'));
    const big = $('.profile-id .avatar');
    if (big) big.dataset.c = String(color);
    scheduleSync();
  }));
  $('#copy-key').onclick = async () => {
    try { await navigator.clipboard.writeText(profileKey); toast('Anahtar kopyalandı', 'success'); }
    catch { $('#profile-key')?.select?.(); toast('Anahtarı seçip kopyala', 'info'); }
  };
  $('#profile-leave').onclick = () => {
    profileKey = '';
    profile = null;
    store.set('profileKey', '');
    store.set('profileMeta', null);
    store.set('syncDirty', false);
    paintProfile();
    fetch('/api/profile', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{"leave":true}'}).catch(() => {});
    document.documentElement.dataset.locked = '1';
    const err = $('#entry-err'); if (err) err.textContent = '';
    const text = $('#entry-text'); if (text) text.textContent = 'Araç kutusuna girmek için anahtarını yaz.';
  };
}

// ---- Araç kutusu ----
const TOOLS = [
  {id: 'watch', href: '#/watch', kicker: 'İzle', title: 'İzle', mark: '01', line: 'Anime, film, dizi ve canlı yayın.'},
  {id: 'lovellify', href: '#/lovellify', kicker: 'Müzik', title: 'Lovellify', mark: '02', line: 'ISRC, etiket, dağıtımcı.'},
  {id: 'speedfy', href: '#/speedfy', kicker: 'Hız', title: 'Speedfy', mark: '03', line: 'WPM ve doğruluk.'},
  {id: 'readfy', href: '#/readfy', kicker: 'Manga', title: 'Readfy', mark: '04', line: 'Kaldığın sayfadan devam.'},
  {id: 'tavsiye', href: '#/tavsiye', kicker: 'Ruh hali', title: 'Tavsiye', mark: '05', line: 'Bugün ne izleyeceğin.'},
];
const DIST_SRC = {
  youtube_provided_line: 'YouTube teslim satırı',
  youtube_distribution_line: 'YouTube dağıtım satırı',
  catalog_distribution_line: 'Katalog teslim satırı',
  catalog_distribution_map: 'Katalog eşlemesi',
  songstats_isrc: 'Songstats · ISRC',
  metadata_consensus: 'Çoklu kaynak uzlaşması',
  deezer_isrc: 'Deezer · ISRC',
  deezer_catalog: 'Deezer katalog',
  itunes_upc: 'iTunes · UPC',
  itunes_catalog: 'iTunes katalog',
  isrc_prefix: 'ISRC öneki',
  spotify_label: 'Spotify etiketi',
  spotify_licensor: 'Spotify lisansörü',
  not_found: 'Dağıtımcı doğrulanamadı',
};
let musicState = {q: '', result: null, items: null, error: '', loading: false};
let musicAudio = null;

function setApp(app) {
  document.documentElement.dataset.app = app;
  if (app !== 'watch') document.documentElement.dataset.section = app;
  if (app !== 'speedfy') delete document.documentElement.dataset.sf;
}

const TOOL_APPS = new Set(['lovellify', 'speedfy', 'readfy', 'tavsiye', 'tools']);

function stopMusic() {
  if (!musicAudio) return;
  musicAudio.pause();
  musicAudio = null;
}

function viewHub() {
  document.title = 'LOVELL';
  const name = profile?.name || 'LOVELL';
  main.innerHTML = `<div class="hub">
    <header class="hub-hero">
      <p class="eyebrow">Araç kutusu</p>
      <h1>${esc(name)}</h1>
      <p>Beş araç. Bir anahtar.</p>
    </header>
    <div class="hub-grid">${TOOLS.map(t => `
      <a class="hub-card" href="${t.href}" data-tool="${t.id}">
        <span class="hub-n">${esc(t.mark)}</span>
        <span class="hub-kicker">${esc(t.kicker)}</span>
        <h2>${esc(t.title)}</h2>
        <p>${esc(t.line)}</p>
      </a>`).join('')}
    </div>
  </div>`;
}

function fmtMs(ms) {
  const n = Math.max(0, Number(ms) || 0);
  return `${Math.floor(n / 60000)}:${String(Math.floor((n % 60000) / 1000)).padStart(2, '0')}`;
}
function musicCopy(value, label) {
  if (!value || value === 'Unknown') return;
  navigator.clipboard.writeText(value).then(() => toast(`${label} kopyalandı`, 'success')).catch(() => toast('Kopyalanamadı', 'error'));
}
function musicResultHtml(r) {
  const q = encodeURIComponent(`${r.artists || ''} ${r.trackName || ''}`.trim());
  const dist = r.distributor && r.distributor !== 'Unknown' ? r.distributor : 'Doğrulanamadı';
  const label = r.label && r.label !== 'Unknown' ? r.label : 'Belirlenemedi';
  const rights = r.rightsHolder && r.rightsHolder !== 'Unknown' ? r.rightsHolder : 'Belirlenemedi';
  const conf = Math.max(0, Math.min(100, Number(r.distributorScore) || 0));
  const platforms = [
    ['Spotify', r.spotifyUrl || `https://open.spotify.com/search/${q}`],
    ['YouTube', r.youtubeEvidenceUrl || `https://www.youtube.com/results?search_query=${q}`],
    ['YouTube Music', `https://music.youtube.com/search?q=${q}`],
    ['Apple Music', `https://music.apple.com/search?term=${q}`],
    ['Deezer', `https://www.deezer.com/search/${q}`],
  ];
  const album = r.albumDetails || {};
  const artists = Array.isArray(r.artistDetails) ? r.artistDetails : [];
  return `<article class="lf-result">
    <div class="lf-track">
      <div class="lf-cover">${r.coverUrl ? `<img src="${esc(r.coverUrl)}" alt="">` : ''}</div>
      <div class="lf-heading">
        <span class="eyebrow">Kayıt</span>
        <h1>${esc(r.trackName || 'Parça')}</h1>
        <p>${esc(r.artists || '')}</p>
        <div class="lf-mini"><span>${fmtMs(r.durationMs)}</span><span>${esc((r.releaseDate || '').slice(0, 4) || '—')}</span><span>${esc(album.name || r.albumName || '')}</span></div>
        <div class="actions">
          ${r.previewUrl ? `<button class="btn btn-play" type="button" id="lf-play">Önizleme</button>` : ''}
          ${r.spotifyUrl ? `<a class="btn btn-ghost" href="${esc(r.spotifyUrl)}" target="_blank" rel="noreferrer">Spotify</a>` : ''}
          <button class="btn btn-ghost" type="button" id="lf-again">Yeni arama</button>
        </div>
      </div>
    </div>
    <section class="lf-signal">
      <div class="lf-signal-top">
        <div>
          <span class="eyebrow">Dağıtımcı</span>
          <h2>${esc(dist)}</h2>
          <p>${esc(DIST_SRC[r.distributorSource] || DIST_SRC.not_found)}</p>
        </div>
        <div class="lf-conf" aria-label="Güven ${conf}%"><b>${conf}</b><small>%</small></div>
      </div>
      <dl class="lf-meta">
        <div><dt>Etiket</dt><dd>${esc(label)}</dd></div>
        <div><dt>Hak sahibi</dt><dd>${esc(rights)}</dd></div>
        <div><dt>Kanıt</dt><dd>${esc(r.distributorEvidence || r.youtubeProvider || 'Açık satır yok')}</dd></div>
      </dl>
    </section>
    <section class="lf-ids">
      <button type="button" data-copy="${esc(r.isrc || '')}" data-copy-label="ISRC"><span>ISRC</span><strong>${esc(r.isrc || '—')}</strong></button>
      <button type="button" data-copy="${esc(r.upc || '')}" data-copy-label="UPC"><span>UPC / EAN</span><strong>${esc(r.upc || '—')}</strong></button>
    </section>
    <section class="lf-platforms">
      <h3>Kaynak ağı</h3>
      <div class="lf-links">${platforms.map(([name, href]) => `<a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(name)}</a>`).join('')}</div>
    </section>
    ${artists.length ? `<section class="lf-artists">${artists.map(a => `<a class="lf-artist" href="${esc(a.spotifyUrl || `https://open.spotify.com/search/${encodeURIComponent(a.name || '')}`)}" target="_blank" rel="noreferrer">${a.imageUrl ? `<img src="${esc(a.imageUrl)}" alt="">` : ''}<span>${esc(a.name || '')}</span></a>`).join('')}</section>` : ''}
  </article>`;
}
function bindMusicResult(r) {
  $('#lf-again')?.addEventListener('click', () => {
    stopMusic();
    musicState = {q: '', result: null, items: null, error: '', loading: false};
    viewLovellify();
  });
  const play = $('#lf-play');
  if (play && r.previewUrl) {
    play.onclick = () => {
      if (!musicAudio) {
        musicAudio = new Audio(r.previewUrl);
        musicAudio.addEventListener('ended', () => { play.textContent = 'Önizleme'; });
      }
      if (musicAudio.paused) { musicAudio.play().catch(() => toast('Önizleme açılamadı', 'error')); play.textContent = 'Durdur'; }
      else { musicAudio.pause(); play.textContent = 'Önizleme'; }
    };
  }
  $$('[data-copy]', main).forEach(btn => btn.addEventListener('click', () => musicCopy(btn.dataset.copy, btn.dataset.copyLabel || 'Değer')));
}
function viewLovellify() {
  document.title = 'Lovellify — LOVELL';
  if (musicState.loading) {
    main.innerHTML = `<div class="lf"><form class="lf-search is-docked" id="lf-form"><input name="q" value="${esc(musicState.q)}" autocomplete="off" spellcheck="false" placeholder="Spotify bağlantısı veya sanatçı + şarkı"><button class="btn btn-play" type="submit" disabled>Aranıyor</button></form><div class="lf-status"><span class="spin"></span> Dağıtım kaydı taranıyor<div class="muted">SPOTIFY · ISRC · YOUTUBE · ETİKET</div></div></div>`;
    return;
  }
  if (musicState.error) {
    main.innerHTML = `<div class="lf"><form class="lf-search is-docked" id="lf-form"><input name="q" value="${esc(musicState.q)}" autocomplete="off" spellcheck="false" required placeholder="Spotify bağlantısı veya sanatçı + şarkı"><button class="btn btn-play" type="submit">Ara</button></form><div class="lf-status lf-error"><span class="eyebrow">Arama tamamlanamadı</span><h2>Kayıt eşleşmedi</h2><p>${esc(musicState.error)}</p><button class="btn btn-ghost" type="button" id="lf-retry">Tekrar dene</button></div></div>`;
    $('#lf-retry').onclick = () => { musicState.error = ''; viewLovellify(); };
  } else if (musicState.items?.length) {
    main.innerHTML = `<div class="lf has-result"><form class="lf-search is-docked" id="lf-form"><input name="q" value="${esc(musicState.q)}" autocomplete="off" spellcheck="false" required placeholder="Spotify albüm, çalma listesi veya parça"><button class="btn btn-play" type="submit">Ara</button></form>
      <section class="lf-batch"><span class="eyebrow">Toplu sorgu</span><h2>${musicState.items.length} parça</h2>
      <table class="lf-table"><thead><tr><th>Parça</th><th>ISRC</th><th>Dağıtımcı</th></tr></thead><tbody>
        ${musicState.items.map(r => `<tr><td><b>${esc(r.trackName || '')}</b><div class="muted">${esc(r.artists || '')}</div></td><td>${esc(r.isrc || '—')}</td><td>${esc(r.distributor && r.distributor !== 'Unknown' ? r.distributor : '—')}</td></tr>`).join('')}
      </tbody></table></section></div>`;
  } else if (musicState.result) {
    main.innerHTML = `<div class="lf has-result"><form class="lf-search is-docked" id="lf-form"><input name="q" value="${esc(musicState.q)}" autocomplete="off" spellcheck="false" required placeholder="Spotify bağlantısı veya sanatçı + şarkı"><button class="btn btn-play" type="submit">Ara</button></form>${musicResultHtml(musicState.result)}</div>`;
    bindMusicResult(musicState.result);
  } else {
    main.innerHTML = `<div class="lf is-landing">
      <div class="lf-hero">
        <div class="lf-copy">
          <span class="eyebrow">Müzik kaydı</span>
          <h1><b>LOVELL</b><em>IFY</em></h1>
          <p>Bir parçanın arkasındaki etiketi, dağıtımcıyı ve ISRC izini tek aramada bul. Searchify altyapısı, LOVELL arayüzü.</p>
        </div>
        <div class="lf-object" aria-hidden="true">
          <div class="lf-vinyl"></div>
          <div class="lf-note">♪</div>
        </div>
      </div>
      <form class="lf-search is-center" id="lf-form">
        <input name="q" value="${esc(musicState.q)}" autocomplete="off" spellcheck="false" required placeholder="Spotify parça, albüm veya sanatçı bağlantısı — ya da Sanatçı + Şarkı" autofocus>
        <button class="btn btn-play" type="submit">Ara</button>
      </form>
    </div>`;
  }
  const form = $('#lf-form');
  if (!form) return;
  form.onsubmit = async e => {
    e.preventDefault();
    const q = String(new FormData(form).get('q') || '').trim();
    if (!q || musicState.loading) return;
    stopMusic();
    musicState = {q, result: null, items: null, error: '', loading: true};
    viewLovellify();
    try {
      const out = await apiSend('/api/music/lookup', 'POST', {urlOrId: q});
      musicState = {q, result: out.data, items: out.collection ? out.items : null, error: '', loading: false};
    } catch (err) {
      musicState = {q, result: null, items: null, error: err.message || 'Parça bilgisi alınamadı.', loading: false};
    }
    if (document.documentElement.dataset.app === 'lovellify') viewLovellify();
  };
}

const SF_WORDS = {
  tr: 'bir ve olmak bu için o ben demek çok yapmak ne gibi daha almak var kendi gelmek ile vermek ama sonra kadar yer en insan değil her istemek yıl çıkmak görmek gün biz gitmek iş şey ara ki bilmek el zaman ya çocuk iki bakmak çalışmak içinde büyük yok başlamak yol kalmak neden siz konu yapılmak iyi kadın ev ise diye bulunmak söylemek göz gerekmek dünya baş durum yan geçmek sen onlar yeni önce başka hal orta su girmek ülke yemek hiç bile nasıl bütün karşı bulmak böyle yaşamak düşünmek aynı iç ancak kişi bunlar veya ilk göre ön son biri şekil önemli yüz hem göstermek etmek alt getirmek kullanmak çünkü taraf şimdi adam onun diğer artık üzerinde ses hep doğru durmak kız tüm çekmek konuşmak para anlamak anne az bazı baba hayat sadece küçük fazla bilgi an sormak bunun öyle yine sağlamak sonuç dış ad yani süre dönmek açmak oturmak anlatmak bırakmak hemen saat yaş sorun devlet sahip sıra yazmak yüzde ay atmak tutmak bunu olay düşmek duymak söz güzel sevmek biraz zor çıkarmak şu koymak tek sistem birlikte kim genç kapı kitap üzerine burada gece alan işte beklemek uzun hiçbir bugün dönem arkadaş ürün aile üç okumak erkek herkes güç belki gerçek tam ilgili ilişki çevre eski aramak yaşam halk yakın sokak tarih özellik bölüm özel akıl kimse'.split(' '),
  en: 'the be of and a to in he have it that for they i with as not on she at by this we you do but from or which one would all will there say who make when can more if no man out other so what time up go about than into could state only new year some take come these know see use get like then first any work now may such give over think most even find day also after way many must look before great back through long where much should well people down own just because good each those feel seem how high too place little world very still nation hand old life tell write become here show house both between need mean call develop under last right move thing general school never same another begin while number part turn real leave might want point form off child few small since against ask late home interest large person end open public follow during present without again hold around possible head consider word program problem however lead system set order eye plan run keep face fact group play stand increase early course change help line'.split(' '),
};
const SF_DURATIONS = [15, 30, 60];
let speedTimer = 0;
let speedState = null;

function stopSpeed() {
  clearInterval(speedTimer);
  speedTimer = 0;
  if (speedState?.status === 'run') speedState = sfFresh({duration: speedState.duration, lang: speedState.lang});
}

function sfPick(lang, n = 90) {
  const list = SF_WORDS[lang] || SF_WORDS.tr;
  const out = [];
  let last = '';
  while (out.length < n) {
    const w = list[Math.floor(Math.random() * list.length)];
    if (w && w !== last) { out.push(w); last = w; }
  }
  return out;
}

function sfFresh(partial = {}) {
  const duration = SF_DURATIONS.includes(partial.duration) ? partial.duration : (store.get('speedDuration', 30) || 30);
  const lang = partial.lang === 'en' || partial.lang === 'tr' ? partial.lang : (store.get('speedLang', 'tr') || 'tr');
  store.set('speedDuration', duration);
  store.set('speedLang', lang);
  return {
    duration,
    lang,
    words: sfPick(lang),
    typed: [''],
    startedAt: 0,
    left: duration,
    status: 'idle',
    result: null,
    board: partial.board || [],
    me: partial.me || null,
    total: partial.total || 0,
    error: '',
    saving: false,
    liveWpm: 0,
  };
}

function sfTally(words, typed, duration) {
  let correct = 0, incorrect = 0, extra = 0, missed = 0;
  const miss = {};
  const last = typed.length - 1;
  typed.forEach((t, i) => {
    const w = words[i] || '';
    const submitted = i < last;
    const len = Math.max(w.length, t.length);
    for (let c = 0; c < len; c++) {
      if (c >= w.length) extra++;
      else if (c >= t.length) { if (submitted) missed++; }
      else if (t[c] === w[c]) correct++;
      else { incorrect++; miss[w[c]] = (miss[w[c]] || 0) + 1; }
    }
    if (submitted) {
      if (t === w) correct++;
      else incorrect++;
    }
  });
  const minutes = duration / 60;
  const wpm = minutes > 0 ? Math.round((correct / 5) / minutes) : 0;
  const raw = minutes > 0 ? Math.round(((correct + incorrect + extra) / 5) / minutes) : 0;
  const total = correct + incorrect + extra;
  const acc = total > 0 ? Math.round((correct / total) * 100) : 0;
  return {correct, incorrect, extra, missed, wpm, raw, acc, miss};
}
function sfSpark(hist) {
  const pts = (hist || []).slice(0, 12).reverse();
  if (pts.length < 2) return '';
  const max = Math.max(...pts.map(p => p.wpm), 1);
  const d = pts.map((p, i) => `${((i / (pts.length - 1)) * 100).toFixed(1)},${(100 - (p.wpm / max) * 88).toFixed(1)}`).join(' ');
  return `<svg class="sf-spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="3" points="${d}"/></svg>`;
}

function sfWordsHtml(st) {
  const cur = st.typed.length - 1;
  return st.words.map((w, i) => {
    const t = st.typed[i] || '';
    if (i > cur) return `<span class="sf-word">${esc(w)}</span>`;
    const chars = [];
    const n = i === cur ? Math.max(w.length, t.length) : Math.max(w.length, t.length);
    for (let c = 0; c < n; c++) {
      const expect = w[c] || '';
      const got = t[c];
      if (i === cur && c === t.length) chars.push(`<span class="sf-caret"></span>`);
      if (got == null) chars.push(`<span>${esc(expect)}</span>`);
      else if (!expect) chars.push(`<span class="extra">${esc(got)}</span>`);
      else if (got === expect) chars.push(`<span class="ok">${esc(expect)}</span>`);
      else chars.push(`<span class="bad">${esc(expect)}</span>`);
    }
    if (i === cur && t.length >= w.length) chars.push(`<span class="sf-caret"></span>`);
    return `<span class="sf-word${i === cur ? ' is-on' : ''}${i < cur ? (t === w ? ' is-ok' : ' is-bad') : ''}">${chars.join('')}</span>`;
  }).join('');
}

function sfBoardHtml(st) {
  const rows = st.board || [];
  if (!rows.length && !st.me) return `<p class="sf-empty">Bu modda henüz kayıt yok. İlk sırayı sen aç.</p>`;
  const meOff = st.me && !rows.some(r => r.you) ? `<tr class="is-you"><td>${st.me.rank}</td><td>${esc(st.me.name)}</td><td>${st.me.wpm}</td><td>${st.me.acc}%</td></tr>` : '';
  return `<table class="sf-table"><thead><tr><th>#</th><th>İsim</th><th>WPM</th><th>Doğruluk</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${r.you ? 'is-you' : ''}"><td>${r.rank}</td><td>${esc(r.name)}${r.you ? ' <small>sen</small>' : ''}</td><td>${r.wpm}</td><td>${r.acc}%</td></tr>`).join('')}
    ${meOff}
  </tbody></table>`;
}

function sfAlign() {
  const rail = $('.sf-rail');
  const track = $('#sf-words');
  const on = track?.querySelector('.sf-word.is-on');
  if (!track || !on || !rail) return;
  const margin = Math.round(rail.clientWidth * 0.12);
  track.style.transform = `translate3d(${margin - on.offsetLeft}px,0,0)`;
}
function paintSpeedWords() {
  const el = $('#sf-words');
  if (!el || !speedState) return;
  el.innerHTML = sfWordsHtml(speedState);
  sfAlign();
}
function paintSpeedHud() {
  if (!speedState) return;
  const t = $('#sf-timer');
  if (t) t.textContent = String(speedState.left);
  const w = $('#sf-live');
  if (w) w.textContent = String(speedState.liveWpm);
}

function sfStartClock() {
  clearInterval(speedTimer);
  speedState.startedAt = Date.now();
  speedState.status = 'run';
  document.documentElement.dataset.sf = 'run';
  $('#sf-stage')?.classList.remove('is-idle');
  $('.sf')?.classList.add('is-run');
  $('.sf-hint')?.remove();
  $$('[data-sf-dur], [data-sf-lang]').forEach(b => { b.disabled = true; });
  speedTimer = setInterval(() => {
    if (!speedState || speedState.status !== 'run') return;
    const elapsed = (Date.now() - speedState.startedAt) / 1000;
    speedState.left = Math.max(0, Math.ceil(speedState.duration - elapsed));
    const live = sfTally(speedState.words, speedState.typed, Math.max(1, elapsed));
    speedState.liveWpm = live.wpm;
    paintSpeedHud();
    if (elapsed >= speedState.duration) sfFinish();
  }, 100);
}

async function sfFinish() {
  if (!speedState || speedState.status === 'done') return;
  clearInterval(speedTimer);
  speedTimer = 0;
  speedState.left = 0;
  speedState.status = 'done';
  const stats = sfTally(speedState.words, speedState.typed, speedState.duration);
  speedState.result = stats;
  const hist = store.get('speedHistory', []);
  hist.unshift({at: Date.now(), wpm: stats.wpm, acc: stats.acc, raw: stats.raw, duration: speedState.duration, lang: speedState.lang, miss: stats.miss});
  store.set('speedHistory', hist.slice(0, 24));
  speedState.saving = true;
  viewSpeedfy();
  try {
    const out = await apiSend('/api/speed/result', 'POST', {
      duration: speedState.duration,
      lang: speedState.lang,
      wpm: stats.wpm,
      acc: stats.acc,
      raw: stats.raw,
      chars: {correct: stats.correct, incorrect: stats.incorrect, extra: stats.extra, missed: stats.missed},
    });
    if (speedState) {
      speedState.board = out.board || [];
      speedState.me = out.me;
      speedState.total = out.total || 0;
      speedState.improved = !!out.improved;
      speedState.saving = false;
      speedState.error = '';
    }
  } catch (err) {
    if (speedState) {
      speedState.saving = false;
      speedState.error = err.message || 'Sıralama kaydedilemedi.';
    }
  }
  if (document.documentElement.dataset.app === 'speedfy') viewSpeedfy();
}

async function loadSpeedBoard() {
  if (!speedState) return;
  try {
    const out = await api(`/api/speed/board?duration=${speedState.duration}&lang=${speedState.lang}`, 12000, {quiet: true});
    if (!speedState || speedState.status === 'run') return;
    speedState.board = out.board || [];
    speedState.me = out.me;
    speedState.total = out.total || 0;
    const box = $('#sf-board');
    if (box) box.innerHTML = sfBoardHtml(speedState);
    const hint = $('#sf-rank-hint');
    if (hint) hint.textContent = speedState.me ? `Sıralaman: #${speedState.me.rank} · ${speedState.me.wpm} WPM` : 'Bu modda henüz kaydın yok.';
  } catch {}
}

function bindSpeedfy() {
  if (!speedState) return;
  $$('[data-sf-dur]').forEach(btn => btn.onclick = () => {
    if (speedState.status === 'run') return;
    speedState = sfFresh({duration: Number(btn.dataset.sfDur), lang: speedState.lang});
    viewSpeedfy();
    loadSpeedBoard();
  });
  $$('[data-sf-lang]').forEach(btn => btn.onclick = () => {
    if (speedState.status === 'run') return;
    speedState = sfFresh({duration: speedState.duration, lang: btn.dataset.sfLang});
    viewSpeedfy();
    loadSpeedBoard();
  });
  const restart = () => {
    speedState = sfFresh({duration: speedState.duration, lang: speedState.lang, board: speedState.board, me: speedState.me, total: speedState.total});
    viewSpeedfy();
    loadSpeedBoard();
  };
  $('#sf-restart')?.addEventListener('click', restart);
  const input = $('#sf-input');
  const stage = $('#sf-stage');
  if (!input) return;
  const focus = () => input.focus({preventScroll: true});
  stage?.addEventListener('click', focus);
  requestAnimationFrame(() => { focus(); sfAlign(); });
  if (!window._sfResize) {
    window._sfResize = () => { if (document.documentElement.dataset.app === 'speedfy') sfAlign(); };
    addEventListener('resize', window._sfResize);
  }
  input.onkeydown = e => {
    if (e.key === 'Tab') { e.preventDefault(); restart(); return; }
    if (speedState.status === 'done') return;
    if (e.key === 'Backspace') {
      e.preventDefault();
      const cur = speedState.typed.length - 1;
      if (speedState.typed[cur]) speedState.typed[cur] = speedState.typed[cur].slice(0, -1);
      else if (cur > 0) speedState.typed.pop();
      paintSpeedWords();
    }
  };
  input.oninput = () => {
    if (!speedState || speedState.status === 'done') { input.value = ''; return; }
    const raw = input.value;
    input.value = '';
    if (!raw) return;
    if (speedState.status === 'idle') sfStartClock();
    for (const ch of raw) {
      if (ch === ' ' || ch === '\n') {
        if (!speedState.typed[speedState.typed.length - 1]) continue;
        speedState.typed.push('');
        if (speedState.typed.length > speedState.words.length - 20) speedState.words.push(...sfPick(speedState.lang, 40));
      } else if (ch.length === 1 && ch !== '\t') {
        const i = speedState.typed.length - 1;
        if (speedState.typed[i].length < 28) speedState.typed[i] += ch;
      }
    }
    paintSpeedWords();
  };
}

function viewSpeedfy() {
  document.title = 'Speedfy — LOVELL';
  if (!speedState) speedState = sfFresh();
  const st = speedState;
  document.documentElement.dataset.sf = st.status === 'run' ? 'run' : st.status === 'done' ? 'done' : 'idle';
  const durBtns = SF_DURATIONS.map(n => `<button type="button" class="sf-chip${st.duration === n ? ' on' : ''}" data-sf-dur="${n}" ${st.status === 'run' ? 'disabled' : ''}>${n}s</button>`).join('');
  const langBtns = [['tr', 'Türkçe'], ['en', 'English']].map(([id, label]) => `<button type="button" class="sf-chip${st.lang === id ? ' on' : ''}" data-sf-lang="${id}" ${st.status === 'run' ? 'disabled' : ''}>${label}</button>`).join('');
  if (st.status === 'done' && st.result) {
    const r = st.result;
    main.innerHTML = `<div class="sf is-done">
      <div class="sf-bar"><div class="sf-modes">${durBtns}<span class="sf-sep"></span>${langBtns}</div><button class="btn btn-ghost" type="button" id="sf-restart">Yeniden (Tab)</button></div>
      <div class="sf-score">
        <div><span class="eyebrow">WPM</span><b>${r.wpm}</b></div>
        <div><span class="eyebrow">Doğruluk</span><b>${r.acc}<small>%</small></b></div>
        <div><span class="eyebrow">Ham</span><b>${r.raw}</b></div>
        <div><span class="eyebrow">Sıra</span><b>${st.saving ? '…' : (st.me ? '#' + st.me.rank : '—')}</b><small>${st.total ? st.total + ' kişi' : ''}</small></div>
      </div>
      ${st.improved ? '<p class="sf-best">Bu modda kişisel rekor.</p>' : ''}
      ${st.error ? `<p class="sf-warn">${esc(st.error)}</p>` : ''}
      ${(() => {
        const hist = store.get('speedHistory', []);
        const miss = Object.entries(st.result.miss || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
        return `<section class="sf-insight">
          <div><span class="eyebrow">Eğri</span>${sfSpark(hist) || '<p class="muted">Birkaç testten sonra eğri oluşur.</p>'}</div>
          <div><span class="eyebrow">Takıldığın harfler</span>${miss.length ? `<p class="sf-miss">${miss.map(([ch, n]) => `<b>${esc(ch)}</b><small>×${n}</small>`).join('')}</p>` : '<p class="muted">Bu turda harf hatası yok.</p>'}</div>
        </section>`;
      })()}
      <section class="sf-board-wrap">
        <header><span class="eyebrow">Anahtar sahipleri</span><h2>${st.duration}s · ${st.lang === 'en' ? 'English' : 'Türkçe'}</h2></header>
        <div id="sf-board">${st.saving ? '<p class="sf-empty">Sıralama kaydediliyor…</p>' : sfBoardHtml(st)}</div>
      </section>
      <input id="sf-input" class="sf-hidden" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" aria-label="Yeniden başlat">
    </div>`;
    bindSpeedfy();
    return;
  }
  main.innerHTML = `<div class="sf is-test${st.status === 'run' ? ' is-run' : ''}">
    <div class="sf-bar">
      <div class="sf-modes">${durBtns}<span class="sf-sep"></span>${langBtns}</div>
      <div class="sf-hud"><span id="sf-timer">${st.left}</span></div>
      <button class="sf-restart" type="button" id="sf-restart" title="Yenile" aria-label="Yenile">↻</button>
    </div>
    <div class="sf-stage${st.status === 'idle' ? ' is-idle' : ''}" id="sf-stage">
      <div class="sf-rail">
        <div class="sf-words" id="sf-words">${sfWordsHtml(st)}</div>
      </div>
      <input id="sf-input" class="sf-hidden" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" aria-label="Yazma alanı">
    </div>
    ${st.status === 'idle' ? '<p class="sf-hint">Yazmaya başla</p>' : ''}
  </div>`;
  bindSpeedfy();
}

let readfyState = {q: '', items: [], suggest: [], total: 0, offset: 0, all: false, boot: false, manga: null, chapter: null, pages: [], page: 0, loading: false, error: ''};
let rfRequest = 0;
const rfActive = () => document.documentElement.dataset.app === 'readfy';
async function openReadfyChapter(id, resume = true) {
  const st = readfyState, mangaId = st.manga?.id, gen = ++rfRequest;
  if (!mangaId) return;
  st.loading = true; st.error = ''; st.pages = []; viewReadfy();
  try {
    const d = await api(`/api/readfy/chapter/${id}`, 15000);
    if (gen !== rfRequest || !rfActive() || st.manga?.id !== mangaId) return;
    if (!d.pages?.length) throw Error('Bu bölümde okunabilir sayfa yok.');
    st.chapter = id; st.pages = d.pages;
    const saved = mangaProgress()[mangaId];
    st.page = Math.max(0, Math.min(st.pages.length - 1, resume && saved?.chapterId === id ? Number(saved.page) || 0 : 0));
    saveMangaProgress(mangaId, id, st.page, st.manga);
  } catch (e) { if (gen !== rfRequest || !rfActive()) return; st.error = e.message || 'Bölüm açılamadı.'; }
  if (gen === rfRequest && rfActive()) { st.loading = false; viewReadfy(); }
}
async function loadReadfyChapters(language, more = false) {
  const st = readfyState, manga = st.manga, gen = ++rfRequest;
  if (!manga) return;
  st.loading = true; st.error = ''; viewReadfy();
  try {
    const d = await api(`/api/readfy/manga/${manga.id}/chapters?lang=${language}&offset=${more ? manga.nextOffset || 0 : 0}`, 15000);
    if (gen !== rfRequest || !rfActive() || st.manga !== manga) return;
    const chapters = more ? [...manga.chapters, ...d.chapters] : d.chapters;
    const seen = new Set();
    Object.assign(manga, d, {chapters: chapters.filter(c => !seen.has(c.id) && seen.add(c.id))});
  } catch (e) { if (gen !== rfRequest || !rfActive()) return; st.error = e.message || 'Bölümler yüklenemedi.'; }
  if (gen === rfRequest && rfActive()) { st.loading = false; viewReadfy(); }
}

function mangaProgress() { return store.get('mangaProgress', {}); }
function saveMangaProgress(mangaId, chapterId, page, meta = {}) {
  const all = mangaProgress();
  const prev = all[mangaId] || {};
  all[mangaId] = {
    chapterId: chapterId || prev.chapterId || '',
    page,
    at: Date.now(),
    title: meta.title || prev.title || '',
    cover: meta.cover || prev.cover || '',
  };
  store.set('mangaProgress', all);
}
function rfCards(list) {
  return `<div class="rf-grid">${list.map(m => `<button class="rf-card" type="button" data-mg="${esc(m.id)}">${m.cover ? `<img src="${esc(m.cover)}" alt="">` : '<span class="rf-ph"></span>'}<span>${esc(m.title)}</span></button>`).join('')}</div>`;
}
async function viewReadfy() {
  document.title = 'Readfy — LOVELL';
  main.onkeydown = null;
  const st = readfyState;
  const wanted = (location.hash.match(/^#\/readfy\/([a-f0-9-]{16,48})/i) || [])[1] || '';
  if (!wanted && (st.manga || st.pages.length) && st.fromHash) {
    st.manga = null; st.pages = []; st.chapter = null; st.fromHash = false;
  }
  if (wanted && st.manga?.id !== wanted && st.failedManga !== wanted) {
    if (st.pendingManga === wanted) return;
    const gen = ++rfRequest; st.pendingManga = wanted;
    st.fromHash = true;
    st.pages = []; st.chapter = null; st.manga = null; st.loading = true; st.error = '';
    main.innerHTML = `<div class="rf">${loading('Manga açılıyor')}</div>`;
    try { const manga = await api(`/api/readfy/manga/${wanted}`); if (gen !== rfRequest || !rfActive()) return; st.manga = manga; st.failedManga = ''; saveMangaProgress(st.manga.id, mangaProgress()[st.manga.id]?.chapterId || '', mangaProgress()[st.manga.id]?.page || 0, st.manga); }
    catch (err) { if (gen !== rfRequest || !rfActive()) return; st.error = err.message || 'Manga açılamadı.'; st.failedManga = wanted; }
    st.pendingManga = ''; st.loading = false;
    if (document.documentElement.dataset.app === 'readfy') viewReadfy();
    return;
  }
  if (wanted && st.failedManga === wanted && !st.manga) {
    main.innerHTML = `<div class="rf"><p class="sf-warn" role="alert">${esc(st.error || 'Manga açılamadı.')}</p><button class="btn" id="rf-retry-manga">Yeniden dene</button><a class="btn btn-ghost" href="#/readfy">Aramaya dön</a></div>`;
    $('#rf-retry-manga').onclick = () => { st.failedManga = ''; viewReadfy(); };
    return;
  }
  if (st.pages.length) {
    st.page = Math.max(0, Math.min(st.pages.length - 1, st.page));
    const src = st.pages[st.page];
    const chapters = (st.manga?.chapters || []).filter(c => c.pages > 0 && !c.externalUrl);
    const current = chapters.findIndex(c => c.id === st.chapter);
    const next = current >= 0 ? chapters.slice(current + 1).find(c => c.chapter !== chapters[current].chapter || !c.chapter) : null;
    main.innerHTML = `<div class="rf rf-reader" tabindex="0" aria-label="Manga okuyucu">
      <div class="rf-bar"><button class="btn btn-ghost btn-sm" type="button" id="rf-back">Bölümler</button><span>${st.page + 1} / ${st.pages.length}</span><div class="actions"><button class="btn btn-ghost btn-sm" type="button" id="rf-prev" ${st.page === 0 ? 'disabled' : ''}>Önceki</button><button class="btn btn-play btn-sm" type="button" id="rf-next" ${st.page === st.pages.length - 1 ? 'disabled' : ''}>Sonraki</button>${next ? '<button class="btn btn-ghost btn-sm" id="rf-next-chapter">Sonraki bölüm</button>' : ''}</div></div>
      <p id="rf-page-error" class="sf-warn" role="alert" hidden>Sayfa yüklenemedi. <button class="btn btn-sm" id="rf-refresh-pages">Sayfaları yenile</button></p>
      <img class="rf-page" src="${esc(src)}" alt="${st.page + 1}. manga sayfası" id="rf-img">
    </div>`;
    const go = n => {
      st.page = Math.max(0, Math.min(st.pages.length - 1, n));
      if (st.manga) saveMangaProgress(st.manga.id, st.chapter, st.page, st.manga);
      viewReadfy();
    };
    $('#rf-back').onclick = () => { st.pages = []; st.chapter = null; viewReadfy(); };
    $('#rf-prev').onclick = () => go(st.page - 1);
    $('#rf-next').onclick = () => go(st.page + 1);
    $('#rf-next-chapter')?.addEventListener('click', () => openReadfyChapter(next.id, false));
    $('#rf-refresh-pages').onclick = () => openReadfyChapter(st.chapter);
    $('#rf-img').onerror = () => { $('#rf-page-error').hidden = false; };
    $('#rf-img').onclick = () => go(st.page + 1);
    main.onkeydown = e => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(st.page + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(st.page - 1); }
      else if (e.key === 'Escape') { st.pages = []; st.chapter = null; viewReadfy(); }
    };
    $('.rf-reader').focus({preventScroll:true});
    return;
  }
  if (st.manga) {
    const m = st.manga, lang = m.language || 'tr';
    main.innerHTML = `<div class="rf"><button class="text-btn" type="button" id="rf-home">← Arama</button>
      <header class="rf-head">${m.cover ? `<img src="${esc(m.cover)}" alt="">` : ''}<div><span class="eyebrow">Readfy</span><h1>${esc(m.title)}</h1><div id="show-bridge"></div><p>${esc(m.desc || '')}</p></div></header>
      <label>Bölüm dili <select id="rf-language" ${st.loading ? 'disabled' : ''}><option value="tr" ${lang === 'tr' ? 'selected' : ''}>Türkçe</option><option value="en" ${lang === 'en' ? 'selected' : ''}>İngilizce</option></select></label>
      ${st.loading ? '<p class="muted" role="status">Bölüm yükleniyor…</p>' : ''}
      ${st.error ? `<p class="sf-warn" role="alert">${esc(st.error)}</p>` : ''}
      <ol class="rf-ch">${(m.chapters || []).map(c => `<li>${c.externalUrl ? `<a href="${esc(c.externalUrl)}" target="_blank" rel="noopener noreferrer">${esc(c.lang.toUpperCase())} · ${esc(c.chapter || '?')} · Yayıncıda aç ↗</a>` : `<button type="button" data-ch="${esc(c.id)}" ${st.loading || !c.pages ? 'disabled' : ''}>${esc(c.lang.toUpperCase())} · ${esc(c.chapter || '?')}${c.title ? ' · ' + esc(c.title) : ''}${!c.pages ? ' · Sayfa yok' : ''}</button>`}</li>`).join('') || `<li class="muted">${lang === 'tr' ? 'Türkçe bölüm bulunamadı. İstersen İngilizce bölümleri seçebilirsin.' : 'İngilizce bölüm bulunamadı.'}</li>`}</ol>
      <p class="muted">${m.chapters?.length || 0} / ${m.total || 0} bölüm</p>${m.hasMore ? `<button class="btn btn-ghost" id="rf-more-chapters" ${st.loading ? 'disabled' : ''}>Daha fazla bölüm</button>` : ''}
    </div>`;
    $('#rf-home').onclick = () => { ++rfRequest; st.manga = null; st.pages = []; st.fromHash = false; location.hash = '#/readfy'; };
    $('#rf-language').onchange = e => loadReadfyChapters(e.target.value);
    $('#rf-more-chapters')?.addEventListener('click', () => loadReadfyChapters(lang, true));
    loadShowBridge(m);
    $$('[data-ch]').forEach(b => b.onclick = () => openReadfyChapter(b.dataset.ch));
    return;
  }

  const cont = Object.entries(mangaProgress()).map(([id, v]) => ({id, ...v})).filter(x => x.title).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 8);
  const shelf = st.q ? st.items : (st.all ? st.suggest : st.suggest.slice(0, 12));
  const more = !st.q && st.suggest.length < st.total;
  main.innerHTML = `<div class="rf">
    <header class="hub-hero"><p class="eyebrow">Manga</p><h1>Readfy</h1><p>MangaDex arşivinden oku. Kaldığın sayfa bu tarayıcıda durur.</p></header>
    <form class="lf-search is-center" id="rf-form"><input name="q" value="${esc(st.q)}" placeholder="Manga adı" autocomplete="off"><button class="btn btn-play" type="submit"${st.loading ? ' disabled' : ''}>${st.loading ? 'Aranıyor' : 'Ara'}</button></form>
    ${st.loading ? '<p class="muted">MangaDex taranıyor…</p>' : ''}
    ${st.error ? `<p class="sf-warn">${esc(st.error)}</p>` : ''}
    ${!st.q && cont.length ? `<section class="rf-shelf"><header><h2>Kaldığın yer</h2></header>${rfCards(cont)}</section>` : ''}
    <section class="rf-shelf"><header><h2>${st.q ? 'Arama' : 'Önerilen'}</h2>${!st.q && !st.all && st.suggest.length > 12 ? '<button class="text-btn" type="button" id="rf-all">Hepsini gör</button>' : ''}${st.q ? '<button class="text-btn" type="button" id="rf-clear">Öneriler</button>' : ''}</header>
      ${shelf.length ? rfCards(shelf) : (st.loading ? '' : '<p class="muted">Liste boş.</p>')}
      ${more ? `<div class="rf-more"><button class="btn btn-ghost btn-sm" type="button" id="rf-more">${st.all ? 'Daha fazla' : 'Hepsini gör'}</button></div>` : ''}
    </section>
  </div>`;
  $('#rf-form').onsubmit = async e => {
    e.preventDefault();
    const q = String(new FormData(e.target).get('q') || '').trim();
    if (q.length < 2) return;
    const gen = ++rfRequest;
    st.q = q; st.loading = true; st.error = ''; viewReadfy();
    try {
      const d = await api(`/api/readfy/search?q=${encodeURIComponent(q)}`);
      if (gen !== rfRequest || !rfActive()) return;
      st.items = d.items || [];
      if (!st.items.length) st.error = 'Sonuç yok.';
    } catch (err) { if (gen !== rfRequest || !rfActive()) return; st.error = err.message || 'Arama başarısız.'; }
    st.loading = false;
    viewReadfy();
  };
  $('#rf-all')?.addEventListener('click', () => { st.all = true; viewReadfy(); });
  $('#rf-clear')?.addEventListener('click', () => { st.q = ''; st.items = []; st.error = ''; viewReadfy(); });
  $('#rf-more')?.addEventListener('click', () => {
    if (!st.all && st.suggest.length > 12) { st.all = true; viewReadfy(); return; }
    st.all = true;
    loadSuggest();
  });
  $$('[data-mg]').forEach(b => b.onclick = openManga);
  if (!st.q && !st.suggest.length && !st.boot) { st.boot = true; loadSuggest(); }
}

let rfGen = 0;
async function loadSuggest() {
  const st = readfyState;
  if (st.loading) return;
  const gen = ++rfGen;
  st.loading = true; st.error = '';
  viewReadfy();
  try {
    const d = await api(`/api/readfy/popular?offset=${st.offset}`);
    if (gen !== rfGen) return;
    const seen = new Set(st.suggest.map(x => x.id));
    st.suggest.push(...(d.items || []).filter(x => x?.id && !seen.has(x.id)));
    st.total = Number(d.total) || st.suggest.length;
    st.offset += (d.items || []).length || 18;
  } catch (err) { if (gen === rfGen) st.error = err.message || 'Öneriler alınamadı.'; }
  if (gen !== rfGen) return;
  st.loading = false;
  if (document.documentElement.dataset.app === 'readfy' && !readfyState.manga && !readfyState.pages.length) viewReadfy();
}

function openManga(e) {
  const id = e.currentTarget?.dataset?.mg;
  if (id) location.hash = `#/readfy/${id}`;
}

const MOODS = [
  {id: 'tired', label: 'Çok yorgunum ama uykum yok', hint: 'Hafif, sıcak, kafa dağıtan.', genre: 'gunluk-yasam', sort: 'popular', kind: 'tv', section: 'anime'},
  {id: 'sharp', label: 'Zihnim açılsın, karmaşık bir şey', hint: 'Gizem ve zeka.', genre: 'gizem', sort: 'rating', kind: 'tv', section: 'anime'},
  {id: 'rain', label: 'Yağmurlu ve melankolik', hint: 'Yavaş, duygusal.', genre: 'dram', sort: 'rating', kind: 'movie', section: 'anime'},
  {id: 'fire', label: 'Aksiyon istiyorum, şimdi', hint: 'Hızlı kesitler.', genre: 'aksiyon', sort: 'popular', kind: 'tv', section: 'anime'},
  {id: 'laugh', label: 'Gülmem lazım', hint: 'Komedi.', genre: 'komedi', sort: 'popular', kind: 'tv', section: 'anime'},
  {id: 'cozy', label: 'Battaniye + film', hint: 'Sinemalık bir film.', genre: 'fantastik', sort: 'rating', kind: 'movie', section: 'media'},
];
let moodState = {pick: null, spinning: false};
async function viewTavsiye() {
  document.title = 'TavsiyerVerKnk — LOVELL';
  const p = moodState.pick;
  main.innerHTML = `<div class="mood">
    <header class="hub-hero"><p class="eyebrow">Ruh hali</p><h1>TavsiyerVerKnk</h1><p>Ne izleyeceğine karar veremiyorsan ruh halini seç. Sana bir başlık çekilir.</p></header>
    <div class="mood-grid">${MOODS.map(m => `<button type="button" class="mood-card" data-mood="${m.id}"><b>${esc(m.label)}</b><span>${esc(m.hint)}</span></button>`).join('')}</div>
    ${moodState.spinning ? '<div class="mood-reveal is-spin"><span class="spin"></span> Zar atılıyor…</div>' : ''}
    ${p ? `<a class="mood-reveal" href="#/izle/${p.kind}/${p.id}"><img src="${esc(p.backdrop || p.poster || '')}" alt=""><div><span class="eyebrow">Bugünkü çekiliş</span><h2>${esc(p.title)}</h2><p>${esc((p.overview || '').slice(0, 180))}</p><span class="btn btn-play">İzlemeye geç</span></div></a>` : ''}
  </div>`;
  $$('[data-mood]').forEach(b => b.onclick = async () => {
    const spec = MOODS.find(m => m.id === b.dataset.mood);
    if (!spec || moodState.spinning) return;
    moodState.spinning = true; moodState.pick = null; viewTavsiye();
    try {
      const d = await api(`/api/browse?${new URLSearchParams({kind: spec.kind, genre: spec.genre, sort: spec.sort, page: '1', section: spec.section})}`);
      const pool = (d.items || []).filter(i => i.backdrop || i.poster);
      moodState.pick = pool[Math.floor(Math.random() * pool.length)] || null;
      if (!moodState.pick) toast('Bu ruh haline uygun başlık bulunamadı', 'error');
    } catch (e) { toast(e.message || 'Çekiliş yapılamadı', 'error'); }
    moodState.spinning = false;
    viewTavsiye();
  });
}

// ---- 404 ----
function viewNotFound() {
  main.innerHTML = `<div class="page">${emptyState({icon: 'lost', title: 'Bu sayfa bulunamadı', text: 'Adres değişmiş ya da yanlış yazılmış olabilir. Ana sayfaya dönebilir ya da aradığını arayabilirsin.', actions: '<a class="btn btn-play" href="#/">Araç kutusuna dön</a><a class="btn btn-ghost" href="#/watch">İzlemeye geç</a>', cls: 'state-404'})}</div>`;
}

// ---- Bağlantı durumu ----
addEventListener('offline', () => { document.documentElement.classList.add('is-offline'); toast('İnternet bağlantısı kesildi', 'error'); });
addEventListener('online', () => { document.documentElement.classList.remove('is-offline'); toast('Bağlantı geri geldi', 'success'); if (main.querySelector('[data-retry]')) { apiCache.clear(); route(); } });

// ---- Alt bilgideki bağlantılar ----
document.addEventListener('click', e => {
  const t = e.target.closest?.('[data-foot-tab], [data-open-settings], [data-open-keys]');
  if (!t) return;
  if (t.dataset.footTab) {
    e.preventDefault();
    if (t.dataset.footTab === section && !/^#\/canli/.test(location.hash)) location.hash = '#/watch';
    else { $(`.tab-btn[data-tab="${t.dataset.footTab}"]`)?.click(); setTimeout(() => { if (!/^#\/watch(\?|$)/.test(location.hash) && !/^#\/?$/.test(location.hash)) location.hash = '#/watch'; }, 50); }
    scrollTo({top: 0, behavior: reduceMotion ? 'auto' : 'smooth'});
  } else if (t.hasAttribute('data-open-settings')) openSettings();
  else openShortcuts();
});
$('#settings-open').onclick = openSettings;

// ---------------- Yönlendirme ----------------
let routeId = 0;
let _scrollIo = null; // viewBrowse sonsuz scroll observer — route değişiminde temizlenir
async function route() {
  if (document.documentElement.dataset.locked) return;
  const v = ++routeId;
  ++rfRequest; ++rfGen; readfyState.loading = false; readfyState.pendingManga = '';
  destroyPlayer();
  main.onkeydown = null;
  if (_scrollIo) { _scrollIo.disconnect(); _scrollIo = null; }
  if (_cardIo) { _cardIo.disconnect(); _cardIo = null; }
  clearTimeout(heroTimer);
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  const part = parts[0] || 'home';
  const app = part === 'home' ? 'hub' : (TOOL_APPS.has(part) ? part : 'watch');
  setApp(app);
  if (app !== 'lovellify') stopMusic();
  if (app !== 'speedfy') stopSpeed();
  const navPart = part === 'watch' ? 'home' : part;
  $$('[data-nav], [data-side-nav]').forEach(a => a.toggleAttribute('aria-current', (a.dataset.nav || a.dataset.sideNav) === navPart));
  document.title = app === 'hub' || app === 'watch' ? 'LOVELL' : `${({lovellify: 'Lovellify', speedfy: 'Speedfy', readfy: 'Readfy', tavsiye: 'TavsiyerVerKnk'})[app] || 'LOVELL'} — LOVELL`;
  window.scrollTo(0, 0);
  // Canlı TV kendi temasıyla açılır; diğer sayfalarda seçili bölümün temasına dönülür.
  const live = part === 'canli';
  if (app === 'watch') {
    document.documentElement.dataset.section = live ? 'livetv' : section;
    syncTabs(live ? 'livetv' : section);
    syncBottomNav(navPart);
    $('#search-label').textContent = live ? 'Kanal ara' : S().search;
  }
  if (liveModal && !live) liveModal.close(true);
  closeInfo(true);
  $$('dialog[open]').forEach(d => d.close());
  if (part === 'home') viewHub();
  else if (part === 'lovellify') viewLovellify();
  else if (part === 'speedfy') { viewSpeedfy(); loadSpeedBoard(); }
  else if (part === 'readfy') viewReadfy();
  else if (part === 'tools') viewToolsDownload();
  else if (part === 'hafta') location.replace('#/watch');
  else if (part === 'tavsiye') viewTavsiye();
  else if (part === 'watch') await viewHome(v);
  else if (part === 'izle' && /^(tv|movie|al)$/.test(parts[1]) && /^\d+$/.test(parts[2])) await viewWatch(v, parts[1], parts[2], params);
  else if (live) await viewLiveTV(v);
  else if (part === 'kesfet') await viewBrowse(v, 'tv', params);
  else if (part === 'filmler') await viewBrowse(v, 'movie', params);
  else if (part === 'listem') viewList(v, params);
  else if (part === 'profil') viewProfile();
  else if (part === 'bilgisayarim') location.replace('#/watch');
  else viewNotFound();
  if (v === routeId) {
    if (part === 'speedfy') $('#sf-input')?.focus({preventScroll: true});
    else main.focus({preventScroll: true});
    pageEnter();
  }
}
// Eski adresleri (#watch?type=tv&id=1) yeni biçime çevir.
if (/^#watch\?/.test(location.hash)) { const p = new URLSearchParams(location.hash.split('?')[1]); location.replace(`#/izle/${p.get('type') === 'movie' ? 'movie' : 'tv'}/${p.get('id')}`); }

window.addEventListener('hashchange', route);
window.addEventListener('pagehide', destroyPlayer);
updateCount();
// Bölüm değiştirici: tema, menü, türler ve içerik birlikte değişir.
$$('.tab-btn').forEach(b => b.addEventListener('click', async ev => {
  const tab = b.dataset.tab;
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const part = path.split('/').filter(Boolean)[0] || 'home';
  if (tab === 'livetv') { if (part !== 'canli') withTransition(ev, () => { location.hash = '#/canli'; }); return; }
  if (tab === section && part !== 'canli') return;
  await withTransition(ev, async () => {
    setSection(tab);
    if ($('#search-dialog').open) { si.dispatchEvent(new Event('input')); }
    await loadGenres();
    // İzleme / Canlı TV sayfasından ya da bölüme özgü bir filtreden ayrılıp yeni bölüme git.
    if (part === 'izle' || part === 'canli' || part === 'home' || part === 'lovellify') location.hash = '#/watch';
    else if (query && /tur=/.test(query)) location.hash = `#/${part}`;
    else await route();
  });
}));
// Film & Dizi bölümünde üst çubuk vitrinin üstünde şeffaf durur, kaydırınca koyulaşır.
const topBar = $('.top');
const onScroll = () => topBar.classList.toggle('scrolled', scrollY > 24);
addEventListener('scroll', onScroll, {passive: true});
onScroll();
let booted = false;
function startApp() {
  if (document.documentElement.dataset.locked) return;
  if (booted) { route(); return; }
  booted = true;
  setSection(section);
  Promise.all([
    loadGenres(),
    api('/api/status').then(s => { CLOUD = s.mode === 'cloud'; SUBS_ON = !!s.subs; document.documentElement.dataset.mode = CLOUD ? 'cloud' : 'local'; }).catch(() => {}),
  ]).finally(route);
}
async function enterWithKey(raw) {
  const formatted = validProfileKey(raw);
  const err = $('#entry-err');
  if (!formatted) { if (err) err.textContent = 'Anahtar 20 karakter olmalı. I, O, 0 ve 1 kullanılmaz.'; return; }
  const prev = profileKey;
  profileKey = formatted;
  try {
    const remote = await apiSend('/api/profile', 'GET');
    myList = mergeLists(myList, remote.list);
    progress = mergeProgress(progress, remote.progress);
    recent = mergeRecent(recent, remote.recent);
    persistUser();
    profile = metaOf(remote);
    syncBase = remote.updatedAt;
    store.set('profileKey', profileKey);
    store.set('profileMeta', profile);
    store.set('syncBase', syncBase);
    store.set('syncDirty', false);
    profileReady = true;
    paintProfile();
    updateCount();
    delete document.documentElement.dataset.locked;
    if (err) err.textContent = '';
    startApp();
  } catch (e) {
    profileKey = prev;
    if (!prev) { profile = null; store.set('profileKey', ''); store.set('profileMeta', null); }
    document.documentElement.dataset.locked = '1';
    if (err) err.textContent = e.status === 401 || /ait değil|gerekli/i.test(e.message || '') ? 'Bu anahtar geçersiz.' : (e.message || 'Giriş yapılamadı');
  }
}
$('#entry-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const btn = $('button', e.target);
  if (btn) btn.disabled = true;
  enterWithKey(new FormData(e.target).get('key')).finally(() => { if (btn) btn.disabled = false; });
});
(async () => {
  document.documentElement.dataset.locked = '1';
  if (!profileKey) {
    const text = $('#entry-text'); if (text) text.textContent = 'Araç kutusuna girmek için anahtarını yaz.';
    return;
  }
  const text = $('#entry-text'); if (text) text.textContent = 'Anahtar kontrol ediliyor…';
  await loadProfile();
  if (!profileKey) {
    if (text) text.textContent = 'Kayıtlı anahtar artık geçersiz. Yenisini gir.';
    return;
  }
  delete document.documentElement.dataset.locked;
  startApp();
})();
addEventListener('pagehide', () => {
  if (!profileKey || !store.get('syncDirty', false)) return;
  fetch('/api/profile', {method: 'PUT', keepalive: true, headers: {'content-type': 'application/json', 'x-lovell-key': profileKey}, body: JSON.stringify({base: syncBase, name: profile?.name, color: profile?.color, avatar: profile?.avatar ?? '', list: myList, progress, recent})}).catch(() => {});
});
