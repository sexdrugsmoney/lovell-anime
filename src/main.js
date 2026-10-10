// LOVELL istemci uygulaması
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const main = $('#main');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------- Kayıt ----------------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('lovell.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lovell.' + k, JSON.stringify(v)); } catch {} },
};
const keyOf = a => `${a.kind}:${a.id}`;
const slim = a => ({kind: a.kind, id: a.id, title: a.title, poster: a.poster, backdrop: a.backdrop, year: a.year, score: a.score, isMovie: a.isMovie || a.kind === 'movie', section: secOf(a)});
// Eski kayıtlarda bölüm bilgisi yok: o zamanlar site yalnızca anime içeriyordu.
const secOf = a => a?.section === 'media' ? 'media' : 'anime';
let myList = store.get('list', []);
let progress = store.get('progress', {});   // "kind:id:s:e" -> {t, d, at}
let recent = store.get('recent', {});       // "kind:id" -> {item, s, e, at}
let CLOUD = false;                          // Cloudflare Workers sürümü: yerel dosya yok
let library = new Set();                    // "kind:id" anahtarları (bilgisayardaki dosyalar)
let libraryEpisodes = new Map();            // "kind:id" -> Set("s:e")

function inList(a) { return myList.some(x => keyOf(x) === keyOf(a)); }
function toggleList(a, {quiet = false} = {}) {
  const had = inList(a);
  const at = myList.findIndex(x => keyOf(x) === keyOf(a));
  myList = had ? myList.filter(x => keyOf(x) !== keyOf(a)) : [slim(a), ...myList];
  store.set('list', myList);
  updateCount();
  syncBottomNav();
  syncListButtons(a);
  if (!quiet) toast(had ? 'Listeden çıkarıldı' : 'Listeye eklendi', had ? 'info' : 'success', had ? {label: 'Geri al', fn: () => { if (!inList(a)) { myList.splice(Math.max(0, at), 0, slim(a)); store.set('list', myList); updateCount(); syncListButtons(a); if (/^#\/listem/.test(location.hash)) route(); } }} : null);
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
  $('#foot-section') && ($('#foot-section').textContent = section === 'anime' ? 'Anime bilgileri TMDB ve AniList’ten gelir.' : 'Film ve dizi bilgileri TMDB’den gelir.');
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
// Afişlere 3B eğim + parıltı (yalnızca fareyle).
if (!reduceMotion && matchMedia('(hover: hover) and (pointer: fine)').matches) {
  let tilted = null;
  const reset = el => { if (el) { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); el.classList.remove('tilting'); } };
  document.addEventListener('pointermove', e => {
    const img = e.target.closest?.('.card .card-img, .rank .card-img, .hero-poster');
    if (img !== tilted) { reset(tilted); tilted = img; }
    if (!img) return;
    const r = img.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    img.classList.add('tilting');
    img.style.setProperty('--rx', ((0.5 - py) * 10).toFixed(2) + 'deg');
    img.style.setProperty('--ry', ((px - 0.5) * 12).toFixed(2) + 'deg');
    img.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
    img.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
  }, {passive: true});
  document.addEventListener('pointerleave', () => { reset(tilted); tilted = null; });
}
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
};
async function api(path, timeout = 20000) {
  const ttl = Object.entries(CACHE_TTL).find(([k]) => path.startsWith(k))?.[1];
  if (ttl) {
    const hit = apiCache.get(path);
    if (hit && hit.expires > Date.now()) return hit.data;
  }
  const r = await fetch(path, {signal: AbortSignal.timeout(timeout)});
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(Error(data.error || `HTTP ${r.status}`), {data});
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

function imgFallback(root = document) {
  $$('img[data-fb]', root).forEach(img => {
    if (img.dataset.bound) return;
    img.dataset.bound = 1;
    img.addEventListener('error', () => { img.closest('.card-img, .wide-img, .land-img, .hero-bg, .hero-poster, .thumb')?.classList.add('noimg'); img.remove(); }, {once: true});
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
  const local = library.has(keyOf(a));
  return `<a class="card" href="${watchHref(a)}">
    <span class="card-img">${a.poster ? `<img src="${esc(a.poster)}" alt="" loading="lazy" decoding="async" data-fb>` : ''}<span class="card-ph">${esc(a.title)}</span>${local ? '<span class="flag" title="Bilgisayarında video dosyası var">Dosyan var</span>' : ''}${a.score ? `<span class="card-score">${STAR}${score(a.score)}</span>` : ''}<span class="card-hover">${PLAY}</span>${quickActs(a)}</span>
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
function wideCard(r) {
  const a = r.item, p = progress[`${keyOf(a)}:${r.s}:${r.e}`];
  const pct = p ? Math.min(100, p.t / p.d * 100) : 0;
  remember(a);
  return `<a class="wide" href="${watchHref(a, r.s, r.e)}">
    <span class="wide-img">${a.backdrop || a.poster ? `<img src="${esc(a.backdrop || a.poster)}" alt="" loading="lazy" decoding="async" data-fb>` : ''}<span class="wide-play">${PLAY}</span><span class="qa-btn qa-forget" role="button" tabindex="-1" data-forget="${keyOf(a)}" aria-label="Bu satırdan kaldır"><svg class="ln" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></span></span>
    <span class="bar"><i style="width:${pct}%"></i></span>
    <span class="card-title">${esc(a.title)}</span>
    <span class="card-meta">${isMovie(a) ? 'Film' : `${r.s}. sezon, ${r.e}. bölüm`}${p ? ` <span>${fmtTime(p.d - p.t)} kaldı</span>` : ''}</span>
  </a>`;
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
  return `<div class="state"><h2>Veriler yüklenemedi</h2><p>${esc(e.message)}. İnternet bağlantını kontrol edip tekrar dene. Sorun sürerse terminalde <code>npm run doctor</code> komutunu çalıştır.</p>${retry ? '<button class="btn" onclick="location.reload()">Tekrar dene</button>' : ''}</div>`;
}

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
const GENRE_HUE = {aksiyon: 4, macera: 28, komedi: 48, dram: 330, fantastik: 270, 'bilim-kurgu': 200, gizem: 250, romantik: 340, korku: 0, spor: 140, 'gunluk-yasam': 95, dogaustu: 290, suc: 15, gerilim: 355, animasyon: 175, belgesel: 120, aile: 60, savas: 30, tarih: 38, western: 24};
function genreLinks() {
  if (!genres.length) return '';
  const target = g => section === 'media' && !g.tv ? '#/filmler' : '#/kesfet';
  return `<section class="genres"><div class="shelf-head"><h2>${section === 'anime' ? 'Türlere göz at' : 'Kategoriler'}</h2></div><div class="genre-grid">${genres.map((g, i) => `<a href="${target(g)}?tur=${g.slug}" style="--h:${GENRE_HUE[g.slug] ?? i * 37}"><span>${esc(g.name)}</span></a>`).join('')}</div></section>`;
}
function homeSkeleton() {
  const row = n => `<div class="shelf"><span class="skeleton" style="height:22px;width:220px;margin-bottom:16px"></span><div class="row row-${section === 'media' ? 'land' : 'poster'}">${Array.from({length: n}, () => `<span class="skeleton sk-${section === 'media' ? 'land' : 'poster'}"></span>`).join('')}</div></div>`;
  return `<div class="hero hero-skeleton"><div class="hero-shade"></div></div><div class="page page-home" role="status" aria-label="Yükleniyor">${row(8)}${row(8)}</div>`;
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
        $('#more-wrap').innerHTML = `<div class="state"><h2>Sonuç yok</h2><p>Başka bir tür ya da arama dene.</p><a class="btn" href="${base}">Filtreleri temizle</a></div>`;
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
function viewList() {
  const sortBy = store.get('listSort', 'added');
  const cmp = {title: (x, y) => x.title.localeCompare(y.title, 'tr'), score: (x, y) => (y.score || 0) - (x.score || 0), year: (x, y) => String(y.year || '').localeCompare(String(x.year || ''))}[sortBy];
  const mine = myList.filter(a => secOf(a) === section);
  if (cmp) mine.sort(cmp);
  const others = myList.length - mine.length;
  const otherName = SECTIONS[section === 'anime' ? 'media' : 'anime'].label;
  main.innerHTML = `<div class="page tab-content-enter"><header class="page-head"><div><p class="eyebrow">${esc(S().label)}</p><h1>Listem</h1></div>${mine.length ? `<div class="head-tools"><label class="select">Sırala <select id="list-sort">${LIST_SORTS.map(([k, t]) => `<option value="${k}" ${k === sortBy ? 'selected' : ''}>${t}</option>`).join('')}</select></label><button class="btn btn-ghost btn-sm" id="shuffle" type="button">${SHUFFLE}Rastgele seç</button></div><p>${mine.length} başlık. Liste bu tarayıcıda saklanır; kartın üzerindeki işaretle çıkarabilirsin.${others ? ` ${otherName} listende ${others} başlık daha var.` : ''}</p>` : ''}</header>
    ${mine.length ? listGroups(mine) : `<div class="state"><h2>Listen boş</h2><p>${S().empty}${others ? ` ${otherName} listende ${others} başlık var.` : ''}</p><a class="btn" href="#/kesfet">${section === 'anime' ? 'Serilere göz at' : 'Dizilere göz at'}</a></div>`}
  </div>`;
  if ($('#list-sort')) $('#list-sort').onchange = e => { store.set('listSort', e.target.value); viewList(); };
  bindShuffle();
  imgFallback();
  observeCards();
}

// ---------------- Bilgisayarımda ----------------
async function viewLibrary(v) {
  main.innerHTML = `<div class="page"><header class="page-head"><h1>Bilgisayarımdaki videolar</h1><button class="btn btn-ghost" id="rescan">Klasörü yeniden tara</button></header><div id="lib">${loading()}</div>${guide()}</div>`;
  $('#rescan').onclick = async () => { await refreshLibrary(true); toast('Klasör tarandı'); route(); };
  await refreshLibrary(true);
  if (v !== routeId) return;
  const items = await api('/api/library').then(d => d.items).catch(() => []);
  if (!items.length) { $('#lib').innerHTML = `<div class="state state-left"><h2>Henüz video yok</h2><p>Aşağıdaki adımlarla proje klasöründeki <code>media</code> klasörüne video ekleyebilirsin.</p></div>`; return; }
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
async function viewWatch(v, kind, id, params) {
  main.innerHTML = loading(section === 'anime' ? 'Anime bilgileri yükleniyor' : 'Bilgiler yükleniyor');
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
    <div class="page">
      <div class="watch-grid">
        <div class="info">
          <p class="now" id="now"></p>
          <h1 class="title">${esc(a.title)}</h1>
          ${a.original && a.original !== a.title ? `<p class="original" ${section === 'anime' ? 'lang="ja"' : ''}>${esc(a.original)}</p>` : ''}
          <p class="facts">${a.score ? `<span class="score">${STAR}${score(a.score)}</span>` : ''}${a.imdbRating ? `<span class="imdb-score" title="IMDb puanı"><svg viewBox="0 0 32 16" width="32" height="16" aria-hidden="true"><rect width="32" height="16" rx="3" fill="#F5C518"/><text x="4" y="12" font-size="10" font-weight="bold" fill="#000">IMDb</text></svg> ${esc(a.imdbRating)}</span>` : ''}${a.rottenTomatoes ? `<span title="Rotten Tomatoes" class="badge-rt"><b>RT</b>${esc(a.rottenTomatoes)}</span>` : ''}${a.metascore ? `<span title="Metascore" class="metascore">${esc(a.metascore)}</span>` : ''}${a.awards ? `<span title="${esc(a.awards)}" class="awards-badge"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h8v3a4 4 0 0 1-8 0zM4 3H2v1a2 2 0 0 0 2 2M12 3h2v1a2 2 0 0 1-2 2M8 9v3M5 14h6"/></svg>Ödüllü</span>` : ''}${a.boxOffice ? `<span title="Gişe" class="badge-box">Gişe ${esc(a.boxOffice)}</span>` : ''}${a.year ? `<span>${esc(a.year)}</span>` : ''}${movie ? `<span>Film${a.runtime ? `, ${a.runtime} dk` : ''}</span>` : a.episodeCount ? `<span>${a.episodeCount} bölüm</span>` : ''}${a.genres?.length ? `<span>${esc(a.genres.join(', '))}</span>` : ''}${a.studios?.length ? `<span>${esc(a.studios.join(', '))}</span>` : ''}</p>
          ${a.overview ? `<div class="overview" id="overview"><p>${esc(a.overview).replace(/\n+/g, '</p><p>')}</p></div>${a.overviewLang === 'en' ? '<p class="note">Türkçe özet bulunamadı, İngilizcesi gösteriliyor.</p>' : ''}` : ''}
          ${movie ? '' : '<div class="ep-nav" id="ep-nav" hidden></div>'}
          <div class="actions">
            <button class="btn ${inList(a) ? 'btn-ghost' : ''}" id="save">${inList(a) ? CHECK + 'Listende' : PLUS + 'Listeye ekle'}</button>
            ${a.trailer ? `<button class="btn btn-ghost" id="trailer">${PLAY}Fragman</button>` : ''}
          </div>
        </div>
        ${whereToWatch(a)}
      </div>
      ${shelf({title: section === 'anime' ? 'Bunu sevenler bunlara da baktı' : 'Benzer içerikler', items: a.recommendations || []})}
    </div>
  </div>`;
  const ov = $('#overview');
  if (ov && ov.scrollHeight > ov.clientHeight + 4) { ov.classList.add('clamped'); ov.insertAdjacentHTML('afterend', '<button class="text-btn" id="ov-more">Devamını oku</button>'); $('#ov-more').onclick = ev => { ov.classList.toggle('open'); ev.target.textContent = ov.classList.contains('open') ? 'Daha az göster' : 'Devamını oku'; }; }
  $('#save').onclick = ev => { const on = toggleList(a); ev.currentTarget.innerHTML = on ? CHECK + 'Listende' : PLUS + 'Listeye ekle'; ev.currentTarget.classList.toggle('btn-ghost', on); };
  if ($('#trailer')) $('#trailer').onclick = () => openTrailer(a.trailer);
  if ($('#season')) $('#season').onchange = ev => go(ctx, Number(ev.target.value), 1);
  bindWatchExtras(ctx);
  bindShelves();
  imgFallback();
  setStatus(a.source);
  if (!movie) loadEpisodes(ctx);
  loadSources(ctx);
}

function whereToWatch(a) {
  const p = a.providers;
  const groups = p ? [['Abonelikle', p.stream], ['Ücretsiz', p.free], ['Kirala', p.rent], ['Satın al', p.buy]].filter(([, l]) => l?.length) : [];
  const links = a.links || [];
  const tmdbWatch = ['tv', 'movie'].includes(a.kind) ? `https://www.themoviedb.org/${a.kind}/${encodeURIComponent(a.id)}/watch?locale=TR` : null;
  const providerLink = p?.link || tmdbWatch;
  const body = groups.length || links.length
    ? `${groups.map(([t, l]) => `<div class="prov-group"><h3>${t}</h3><ul class="prov">${l.map(x => `<li><a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">${x.logo ? `<img src="${esc(x.logo)}" alt="" width="36" height="36" loading="lazy" decoding="async" data-fb>` : ''}<span>${esc(x.name)}</span></a></li>`).join('')}</ul></div>`).join('')}
       ${links.length ? `<div class="prov-group"><h3>Resmî yayın sayfaları</h3><ul class="links">${links.map(l => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.name)}${l.language ? ` <small>${esc(l.language)}</small>` : ''}</a></li>`).join('')}</ul></div>` : ''}
       ${providerLink ? `<a class="text-btn" href="${esc(providerLink)}" target="_blank" rel="noopener noreferrer">Tüm resmî izleme seçenekleri</a>` : ''}`
    : `<p class="muted">${a.source === 'TMDB' ? 'Türkiye için yayın platformu verisi bulunamadı.' : 'Yayın platformu bilgisi şu an alınamıyor (TMDB bağlantısı yok).'}</p>${providerLink ? `<a class="btn btn-ghost btn-sm" href="${esc(providerLink)}" target="_blank" rel="noopener noreferrer">TMDB’de izleme seçeneklerini kontrol et</a>` : ''}`;
  return `<aside class="where"><h2>Yasal olarak nerede izlenir</h2>${body}${p ? `<p class="credit">Türkiye verisi: JustWatch</p>` : ''}</aside>`;
}

function go(ctx, s, e) { location.hash = watchHref(ctx.a, s, e); }

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
        <span class="ep-meta">${ep.runtime ? `<span>${ep.runtime} dk</span>` : ''}${ep.date ? `<span>${fmtDate(ep.date)}</span>` : ''}${has ? '<span class="has">Dosyan var</span>' : ''}${pct > 90 ? '<span>İzlendi</span>' : ''}</span>
        ${ep.overview ? `<span class="ep-text">${esc(ep.overview)}</span>` : ''}</span>
    </a></li>`;
  }).join('');
  imgFallback(list);
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

async function loadSources(ctx) {
  let d;
  const alId = ctx.a.anilistId || '';
  $('#stage').querySelector('.stage-inner').innerHTML = `<div class="loading" role="status"><span class="spin"></span>Kaynaklar aranıyor…</div>`;
  try {
    d = await api(`/api/play/${ctx.a.kind}/${ctx.a.id}?s=${ctx.s}&e=${ctx.e}${alId ? `&alId=${alId}` : ''}`, 65000);
  } catch {
    d = {sources: [], embeds: [], folder: `${ctx.a.kind}-${ctx.a.id}`};
  }
  if (ctx.v !== routeId) return;
  // Oynatıcı yalnızca kullanıcının kendi veya yayın izni olan video adreslerini açar.
  ctx.sources = d.sources || [];
  ctx.embeds  = d.embeds  || [];
  ctx.folder  = d.folder;
  ctx.vidrift  = d.vidrift || ctx.embeds.find(e => e.id === 'vidrift')?.url || null;
  if (ctx.sources.length) mountPlayer(ctx, 0);
  else if (ctx.embeds.length) mountEmbed(ctx, 0);
  else emptyStage(ctx);
}

function emptyStage(ctx) {
  const a = ctx.a;
  const first = a.providers?.stream?.[0] || a.providers?.free?.[0];
  const official = a.links?.[0];
  const label = isMovie(a) ? 'Bu film' : `${ctx.s}. sezon ${ctx.e}. bölüm`;

  $('#stage').innerHTML = `<div class="stage-inner stage-empty">
    ${a.backdrop ? `<img class="stage-bg" src="${esc(a.backdrop)}" alt="" data-fb>` : ''}
    <div class="stage-msg">
      <h2>${label} için video dosyası yok</h2>
      <p>${CLOUD ? 'Bu bölüm için sitede oynatılabilir bir kaynak yok. Yasal bir platformda izleyebilir ya da fragmana bakabilirsin.' : 'LOVELL kendi bilgisayarındaki videoları oynatır. Bu bölümü yasal bir platformda izleyebilir ya da dosyanı ekleyebilirsin.'}</p>
      <div class="actions">
        ${first && a.providers?.link ? `<a class="btn btn-play" href="${esc(a.providers.link)}" target="_blank" rel="noopener noreferrer">${esc(first.name)} üzerinde aç</a>` : official ? `<a class="btn btn-play" href="${esc(official.url)}" target="_blank" rel="noopener noreferrer">${esc(official.name)} üzerinde aç</a>` : ''}
        ${a.trailer ? `<button class="btn btn-ghost" data-trailer>${PLAY}Fragmanı izle</button>` : ''}
      </div>
      ${CLOUD ? '' : `<details class="addfile"><summary>Bilgisayarımdaki dosyayı ekle</summary>
        <p>Videoyu proje içindeki <code>media/${esc(ctx.folder)}/</code> klasörüne ${isMovie(a) ? 'koy' : `<code>S${String(ctx.s).padStart(2, '0')}E${String(ctx.e).padStart(2, '0')}.mp4</code> adıyla koy`}. Sonra yeniden tara.</p>
        <div class="actions"><button class="btn btn-ghost btn-sm" data-copy="${esc(ctx.folder)}">Klasör adını kopyala</button><button class="btn btn-ghost btn-sm" data-rescan>Yeniden tara</button></div>
      </details>`}
    </div></div>`;
  const st = $('#stage');
  $('[data-trailer]', st)?.addEventListener('click', () => openTrailer(a.trailer));
  if ($('[data-copy]', st)) $('[data-copy]', st).onclick = ev => navigator.clipboard?.writeText(ev.target.dataset.copy).then(() => toast('Kopyalandı'), () => toast(ev.target.dataset.copy));
  if ($('[data-rescan]', st)) $('[data-rescan]', st).onclick = async () => { await refreshLibrary(true); loadSources(ctx); if (!isMovie(a)) renderEpisodes(ctx, Math.floor(Math.max(0, ctx.episodes.findIndex(x => x.n === ctx.e)) / 50)); toast(library.has(keyOf(a)) ? 'Klasör tarandı' : 'Bu anime için dosya bulunamadı'); };
  imgFallback(st);
  $('#now') && updateNow(ctx);
}

// ---------------- Embed iframe oynatıcı (VidRift, VidPlus, Vidy, VidSrc, VidRock, MegaPlay) ----------------
function mountEmbed(ctx, index) {
  const embeds = ctx.embeds || [];
  const embed = embeds[index];
  if (!embed) { emptyStage(ctx); return; }
  destroyPlayer();
  const stage = $('#stage');
  const hasLocal = !CLOUD;

  // VidRift ve bazı sağlayıcılar sandbox'ı reddeder
  const noSandbox = ['vidrift', 'vidsrc', 'vidsrcio', 'vidsrcto', 'vidsrcmov', 'vidrock', 'yapgrid', 'streamflizo', 'megaplay', 'vidhawk', 'justplay', 'aniembed'];
  const useSandbox = !noSandbox.includes(embed.id);

  stage.innerHTML = `<div class="stage-inner vidrift-wrap">
    <iframe
      class="vidrift-frame"
      src="${esc(embed.url)}"
      allowfullscreen
      allow="autoplay; fullscreen; encrypted-media *; autoplay *; fullscreen *; picture-in-picture *"
      ${useSandbox ? 'sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-fullscreen"' : ''}
      title="${esc(ctx.a.title)}"
      referrerpolicy="strict-origin-when-cross-origin"
    ></iframe>
    <div class="next-up" id="next-up" hidden></div>
  </div>
  <div class="src-bar">
    <span class="source-label">Embed</span>
    <div class="source-list">
      ${embeds.map((e, i) => `<button class="source-chip ${i === index ? 'on' : ''}" type="button" data-embed="${i}" title="${esc(e.name)}">${esc(e.name)}</button>`).join('')}
      ${hasLocal ? `<button class="source-chip source-chip-dim" type="button" id="add-local-hint" title="Kendi dosyanı ekle">+ Dosyam</button>` : ''}
    </div>
  </div>`;

  stage.querySelectorAll('[data-embed]').forEach(btn => btn.onclick = () => mountEmbed(ctx, Number(btn.dataset.embed)));

  // Embed iframe hata tespiti: X-Frame-Options vb. engelinde kullanıcıya uyarı göster.
  // İframe load olayını 15 saniye dinle; tetiklenmezse uyarı ekle.
  const iframeEl = stage.querySelector('.vidrift-frame');
  let embedLoaded = false;
  if (iframeEl) {
    iframeEl.addEventListener('load', () => { embedLoaded = true; }, {once: true});
  }
  const embedErrorTimer = setTimeout(() => {
    if (!document.contains(stage)) return;
    if (embedLoaded) return;
    const warn = document.createElement('div');
    warn.className = 'stage-error';
    warn.setAttribute('role', 'alert');
    warn.innerHTML = '<p>Bu kaynak yüklenemedi. Farklı bir kaynak deneyin.</p>';
    stage.querySelector('.stage-inner')?.prepend(warn);
  }, 15000);

  // VidRift postMessage
  const vidriftOrigin = 'https://embed.vidrift.net';
  const onVidrift = e => {
    if (e.origin !== vidriftOrigin) return;
    const d = e.data;
    if (d.type === 'vidrift:progress') saveProgress(ctx.a, ctx.s, ctx.e, d.currentTime, d.duration);
    if (d.type === 'vidrift:episode') { history.replaceState(null, '', watchHref(ctx.a, d.season, d.episode)); ctx.s = d.season; ctx.e = d.episode; updateNow(ctx); }
    if (d.type === 'vidrift:ended') { const n = nextOf(ctx); if (n) nextUp(ctx, n); }
    if (d.type === 'vidrift:exit') history.back();
  };
  // Vidy.st postMessage
  const vidyOrigin = 'https://vidy.st';
  const onVidy = e => {
    if (e.origin !== vidyOrigin) return;
    try {
      const p = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (p?.event === 'timeupdate') saveProgress(ctx.a, ctx.s, ctx.e, p.currentTime, p.duration);
      if (p?.event === 'ended') { const n = nextOf(ctx); if (n) nextUp(ctx, n); }
    } catch {}
  };
  window.addEventListener('message', onVidrift);
  window.addEventListener('message', onVidy);
  player = {
    video: null, hls: null, art: null, dash: null,
    cleanup: [
      () => window.removeEventListener('message', onVidrift),
      () => window.removeEventListener('message', onVidy),
      () => clearTimeout(embedErrorTimer),
    ]
  };

  if ($('#add-local-hint')) {
    $('#add-local-hint').onclick = () => {
      const details = document.createElement('details');
      details.className = 'addfile';
      details.innerHTML = `<summary>Kendi dosyamı nasıl eklerim?</summary>
        <p>Videoyu proje içindeki <code>media/${esc(ctx.folder)}/</code> klasörüne ${isMovie(ctx.a) ? 'koy' : `<code>S${String(ctx.s).padStart(2, '0')}E${String(ctx.e).padStart(2, '0')}.mp4</code> adıyla koy`}.</p>
        <div class="actions"><button class="btn btn-ghost btn-sm" data-copy="${esc(ctx.folder)}">Klasör adını kopyala</button><button class="btn btn-ghost btn-sm" data-rescan>Yeniden tara</button></div>`;
      stage.querySelector('.src-bar')?.after(details);
      $('[data-copy]', details)?.addEventListener('click', ev => navigator.clipboard?.writeText(ev.target.dataset.copy).then(() => toast('Kopyalandı'), () => toast(ev.target.dataset.copy)));
      $('[data-rescan]', details)?.addEventListener('click', async () => { await refreshLibrary(true); loadSources(ctx); toast(library.has(keyOf(ctx.a)) ? 'Klasör tarandı' : 'Bu anime için dosya bulunamadı'); });
      $('#add-local-hint').remove();
    };
  }
  $('#now') && updateNow(ctx);
}

// Geriye dönük uyumluluk
function mountVidrift(ctx) { mountEmbed(ctx, 0); }

// ArtPlayer (https://artplayer.org) ve hls.js CDN'den bir kez yüklenir; yüklenemezse tarayıcının kendi oynatıcısı kullanılır.
const loadScript = url => new Promise((res, rej) => { const s = document.createElement('script'); s.src = url; s.async = true; s.onload = res; s.onerror = rej; document.head.append(s); });
let artReady, hlsReady, dashReady;
const getArt = () => artReady ||= loadScript('https://cdn.jsdelivr.net/npm/artplayer@5.2.3/dist/artplayer.js').then(() => window.Artplayer).catch(() => { artReady = null; return null; });
const getHls = () => hlsReady ||= loadScript('https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js').then(() => window.Hls).catch(() => { hlsReady = null; return null; });
const getDash = () => dashReady ||= loadScript('https://cdn.dashjs.org/v5.2.1/modern/umd/dash.all.min.js').then(() => window.dashjs).catch(() => { dashReady = null; return null; });
const ART_TR = {'Video Info': 'Video bilgisi', Close: 'Kapat', 'Video Load Failed': 'Video yüklenemedi', Volume: 'Ses', Play: 'Oynat', Pause: 'Duraklat', Rate: 'Hız', Mute: 'Sesi kapat', 'Video Flip': 'Çevir', Horizontal: 'Yatay', Vertical: 'Dikey', Reconnect: 'Yeniden bağlan', 'Show Setting': 'Ayarlar', 'Hide Setting': 'Ayarları gizle', Screenshot: 'Ekran görüntüsü', 'Play Speed': 'Oynatma hızı', 'Aspect Ratio': 'En boy oranı', Default: 'Varsayılan', Normal: 'Normal', Open: 'Aç', 'Switch Video': 'Video değiştir', 'Switch Subtitle': 'Altyazı', Fullscreen: 'Tam ekran', 'Exit Fullscreen': 'Tam ekrandan çık', 'Web Fullscreen': 'Pencere tam ekran', 'Exit Web Fullscreen': 'Pencere tam ekrandan çık', 'Mini Player': 'Mini oynatıcı', 'PIP Mode': 'Resim içinde resim', 'Exit PIP Mode': 'Resim içinde resimden çık', 'PIP Not Supported': 'Desteklenmiyor', 'Fullscreen Not Supported': 'Tam ekran desteklenmiyor', 'Subtitle Offset': 'Altyazı kaydırma', 'Last Seen': 'Son izlenen', 'Jump Play': 'Oraya git', AirPlay: 'AirPlay', 'AirPlay Not Available': 'AirPlay yok', 'Subtitle': 'Altyazı', 'Off': 'Kapalı'};

async function mountPlayer(ctx, index) {
  destroyPlayer();
  const src = ctx.sources[index];
  const stage = $('#stage');
  stage.innerHTML = `<div class="stage-inner"><div class="art" id="art">${loading('Oynatıcı hazırlanıyor')}</div>
    <div class="next-up" id="next-up" hidden></div></div>
    <div class="src-bar"><span class="source-label">Kaynak</span><div class="source-list">${ctx.sources.map((x, i) => `<button class="source-chip ${i === index ? 'on' : ''}" type="button" data-source="${i}">${esc(x.name)}</button>`).join('')}${(ctx.embeds||[]).map((e, i) => `<button class="source-chip" type="button" data-embed="${i}" title="${esc(e.name)}">${esc(e.name)}</button>`).join('')}</div></div>`;
  stage.querySelectorAll('[data-source]').forEach(button => button.onclick = () => mountPlayer(ctx, Number(button.dataset.source)));
  stage.querySelectorAll('[data-embed]').forEach(btn => btn.onclick = () => mountEmbed(ctx, Number(btn.dataset.embed)));
  const p = {video: null, hls: null, art: null, cleanup: []};
  player = p;
  const isHls = src.type === 'hls';
  const isDash = src.type === 'dash';
  const [Art, Hls, Dash] = await Promise.all([getArt(), isHls ? getHls() : null, isDash ? getDash() : null]);
  if (player !== p) return;
  const subs = src.subtitles || [];
  const firstSub = subs.find(t => t.lang === 'tr') || subs[0];
  const attachHls = (video, url) => {
    if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = url; return; }
    if (!Hls?.isSupported()) { stageError(ctx, 'HLS oynatıcısı yüklenemedi. İnternet bağlantını kontrol et.'); return; }
    p.hls = new Hls({maxBufferLength: 60});
    p.hls.loadSource(url);
    p.hls.attachMedia(video);
    p.hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) stageError(ctx, 'Akış oynatılamadı (HLS hatası).'); });
  };
  const attachDash = (video, url) => {
    if (!Dash?.MediaPlayer) { stageError(ctx, 'DASH oynatıcısı yüklenemedi. İnternet bağlantını kontrol et.'); return; }
    p.dash = Dash.MediaPlayer().create();
    p.dash.initialize(video, url, false);
    p.dash.on(Dash.MediaPlayer.events.ERROR, () => stageError(ctx, 'Akış oynatılamadı (DASH hatası).'));
  };
  let video;
  if (Art) {
    $('#art').innerHTML = '';
    Art.NOTICE_TIME = 2500;
    p.art = new Art({
      container: '#art', url: src.url, poster: ctx.a.backdrop || '', type: isHls ? 'm3u8' : isDash ? 'mpd' : '',
      customType: {m3u8: (v, url) => attachHls(v, url), mpd: (v, url) => attachDash(v, url)},
      theme: getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#ff4f5e',
      lang: 'tr', i18n: {tr: ART_TR},
      volume: Number(store.get('volume', 0.8)), autoplay: false, autoSize: false, autoMini: false,
      setting: true, playbackRate: true, aspectRatio: true, pip: true, fullscreen: true, fullscreenWeb: true,
      hotkey: true, mutex: true, backdrop: true, playsInline: true, miniProgressBar: true, lock: true, fastForward: true, autoOrientation: true,
      subtitle: firstSub ? {url: firstSub.url, type: 'vtt', encoding: 'utf-8', escape: true, style: {fontSize: 'clamp(16px, 2.6vw, 30px)', textShadow: '0 1px 3px #000, 0 0 2px #000'}} : {},
      settings: subs.length ? [{html: 'Altyazı', tooltip: firstSub?.label || 'Kapalı', selector: [{html: 'Kapalı', off: true}, ...subs.map(t => ({html: t.label, url: t.url, default: t === firstSub}))], onSelect(item) { if (item.off) { p.art.subtitle.show = false; } else { p.art.subtitle.show = true; p.art.subtitle.switch(item.url, {name: item.html}); } return item.html; }}] : [],
      controls: nextOf(ctx) ? [{position: 'left', index: 15, html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 5v14l9-7zM16 5h2v14h-2z"/></svg>', tooltip: 'Sonraki bölüm', click: () => { const n = nextOf(ctx); if (n) go(ctx, n.s, n.e); }}] : [],
    });
    p.art.on('video:volumechange', () => store.set('volume', p.art.volume));
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

  const k = `${keyOf(ctx.a)}:${ctx.s}:${ctx.e}`;
  let lastSave = 0;
  video.addEventListener('loadedmetadata', () => {
    const saved = progress[k];
    if (saved && saved.t > 5 && saved.t < video.duration - 20) { video.currentTime = saved.t; toast(`${fmtTime(saved.t)} noktasından devam ediliyor`); }
  });
  const persist = () => saveProgress(ctx.a, ctx.s, ctx.e, video.currentTime, video.duration);
  video.addEventListener('timeupdate', () => { if (Date.now() - lastSave > 5000) { lastSave = Date.now(); persist(); } });
  video.addEventListener('pause', persist);
  video.addEventListener('error', () => stageError(ctx, src.type === 'mkv' ? 'Bu MKV dosyası tarayıcıda açılamadı. MP4 (H.264 + AAC) olarak dönüştürmeyi dene.' : 'Video açılamadı. Dosya biçimi tarayıcı tarafından desteklenmiyor olabilir.'));
  video.addEventListener('ended', () => { persist(); const n = nextOf(ctx); if (n) nextUp(ctx, n); });
  p.cleanup.push(persist);
}
function nextUp(ctx, n) {
  const box = $('#next-up');
  let left = 8;
  box.hidden = false;
  const draw = () => box.innerHTML = `<p>Sonraki bölüm ${left} saniye içinde başlıyor</p><div class="actions"><a class="btn btn-play btn-sm" href="${watchHref(ctx.a, n.s, n.e)}">${PLAY}Şimdi oynat</a><button class="btn btn-ghost btn-sm" id="next-cancel">Vazgeç</button></div>`;
  draw();
  const t = setInterval(() => { left--; if (left <= 0) { clearInterval(t); go(ctx, n.s, n.e); } else { draw(); $('#next-cancel').onclick = cancel; } }, 1000);
  const cancel = () => { clearInterval(t); box.hidden = true; };
  $('#next-cancel').onclick = cancel;
  player?.cleanup.push(() => clearInterval(t));
}
function stageError(ctx, msg) {
  const box = document.createElement('div');
  box.className = 'stage-error';
  box.innerHTML = `<p>${esc(msg)}</p>`;
  $('#stage .stage-inner')?.append(box);
}
function destroyPlayer() {
  if (!player) return;
  player.cleanup.slice().reverse().forEach(f => { try { f(); } catch {} });
  try { player.hls?.destroy(); } catch {}
  try { player.dash?.reset(); } catch {}
  if (!player.art && player.video) { try { player.video.pause(); player.video.removeAttribute('src'); player.video.load(); } catch {} }
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
function openSearch() { sd.showModal(); si.select(); if (si.value.trim().length < 2) searchIdle(); }
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
if (hamburger && mainNav) {
  hamburger.onclick = () => {
    const open = mainNav.classList.toggle('open');
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
  const light = document.documentElement.dataset.theme === 'light';
  $('#theme').setAttribute('aria-label', light ? 'Koyu temaya geç' : 'Açık temaya geç');
  $('#theme').title = light ? 'Koyu tema' : 'Açık tema';
}
$('#theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('lovell.theme', next); } catch {}
  themeLabel();
};
themeLabel();

// ---------------- Durum ----------------
function setStatus(source) {
  const el = $('#data-status');
  if (!source) return;
  el.dataset.src = source;
  el.textContent = source === 'TMDB' ? 'Veri kaynağı: TMDB' : source === 'AniList' ? 'TMDB kullanılamıyor, AniList gösteriliyor' : 'TMDB ve AniList kullanılamıyor, yerel seçki gösteriliyor';
  if (source !== 'TMDB') api('/api/status').then(s => {
    if (s.tmdb === 'anahtar geçersiz') el.textContent += '. Sebep: TMDB API anahtarı geçersiz, .env dosyasına kendi anahtarını yaz.';
    else if (s.dataErrors?.[0]) el.textContent += `. Sebep: ${s.dataErrors.find(x => x.source === 'TMDB')?.error || s.dataErrors[0].error}`;
  }).catch(() => {});
}

// ---------------- Canlı TV ----------------
async function viewLiveTV(v) {
  main.innerHTML = loading('Kanallar yükleniyor');
  const M3U_URL = 'https://raw.githubusercontent.com/falsisdev/anthology/main/providers/M3U/Liste/canli.m3u';
  let channels = [];
  try {
    const res = await fetch(M3U_URL, {signal: AbortSignal.timeout(15000)});
    const text = await res.text();
    channels = parseM3U(text);
  } catch(e) {
    if (v !== routeId) return;
    main.innerHTML = errorBox(e, true);
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
  const open = card => card && openLiveChannel(card.dataset.url, card.dataset.name, card.dataset.logo, card.dataset.group);
  page.addEventListener('click', e => open(e.target.closest('.ch-card')));
  page.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.ch-card')) { e.preventDefault(); open(e.target); } });
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
    <div class="ch-logo">${ch.logo ? `<img src="${esc(ch.logo)}" alt="" loading="lazy" decoding="async">` : `<span class="ch-ph">${esc(ch.name.slice(0, 2))}</span>`}<span class="ch-live"><i></i>CANLI</span><span class="ch-play">${PLAY}</span></div>
    <div class="ch-name">${esc(ch.name)}</div>
  </div>`;
}

function openLiveChannel(url, name, logo, group = '') {
  // Son izlenen kanalları hatırla (en fazla 8).
  store.set('liveRecent', [{url, name, logo, group}, ...store.get('liveRecent', []).filter(r => r.url !== url)].slice(0, 8));
  const existing = $('#livetv-player-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'livetv-player-modal';
  modal.className = 'livetv-modal';
  modal.innerHTML = `
    <div class="livetv-modal-inner">
      <div class="livetv-modal-head">
        ${logo ? `<img src="${esc(logo)}" alt="" class="livetv-modal-logo">` : ''}
        <span class="livetv-modal-title">${esc(name)}<small>${esc(liveGroupOf(group).name)}</small></span>
        <span class="live-badge live-badge-sm"><i></i>CANLI</span>
        <button class="icon-btn livetv-modal-close" aria-label="Kapat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <div class="livetv-modal-body">
        <video id="livetv-video" controls autoplay playsinline style="width:100%;height:100%;background:#000"></video>
        <div id="livetv-status" class="livetv-status"></div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('.livetv-modal-close').onclick = () => {
    const vid = modal.querySelector('video');
    if (vid) { vid.pause(); vid.src = ''; }
    modal.remove();
  };
  modal.addEventListener('click', e => { if (e.target === modal) modal.querySelector('.livetv-modal-close').click(); });
  const onKey = e => { if (e.key === 'Escape') modal.querySelector('.livetv-modal-close')?.click(); };
  document.addEventListener('keydown', onKey);
  new MutationObserver((_, mo) => { if (!document.body.contains(modal)) { document.removeEventListener('keydown', onKey); modal._hls?.destroy?.(); mo.disconnect(); } }).observe(document.body, {childList: true});
  requestAnimationFrame(() => modal.classList.add('open'));
  modal.querySelector('.livetv-modal-close').focus();
  const video = modal.querySelector('#livetv-video');
  const status = modal.querySelector('#livetv-status');
  const tryHls = () => {
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({maxBufferLength: 30});
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (d.fatal) { status.textContent = 'Yayın yüklenemedi: ' + (d.details || 'Hata'); }
      });
      modal._hls = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
    } else {
      status.textContent = 'Bu kanal bu tarayıcıda oynatılamıyor.';
    }
  };
  if (typeof Hls === 'undefined') {
    getHls().then(tryHls);
  } else {
    tryHls();
  }
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
  if (el.dataset.info) return openInfo(el.dataset.info);
  if (el.dataset.list) { const a = ITEMS.get(el.dataset.list) || myList.find(x => keyOf(x) === el.dataset.list); if (a) toggleList(a); return; }
  if (el.dataset.forget) {
    const k = el.dataset.forget, saved = recent[k];
    delete recent[k]; store.set('recent', recent);
    const cardEl = el.closest('.wide');
    cardEl?.classList.add('leaving');
    setTimeout(() => { const row = cardEl?.closest('.shelf'); cardEl?.remove(); if (row && !$('.wide', row)) row.remove(); }, reduceMotion ? 0 : 260);
    toast('Devam et satırından kaldırıldı', 'info', {label: 'Geri al', fn: () => { recent[k] = saved; store.set('recent', recent); route(); }});
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
  const items = [
    ['home', '#/', S().nav.home, '<path d="M3 10.5 12 4l9 6.5V20h-6v-5H9v5H3z"/>'],
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
  nav.innerHTML = `${p ? `<a class="ep-step prev" href="${watchHref(ctx.a, p.s, p.e)}"><svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg><span><small>Önceki bölüm</small>${p.s}. sezon ${p.e}. bölüm${t(p) ? ` · ${esc(t(p))}` : ''}</span></a>` : '<span></span>'}${n ? `<a class="ep-step next" href="${watchHref(ctx.a, n.s, n.e)}"><span><small>Sonraki bölüm</small>${n.s}. sezon ${n.e}. bölüm${t(n) ? ` · ${esc(t(n))}` : ''}</span><svg class="ln" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg></a>` : ''}`;
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
const SHORTCUTS = [['/|Ctrl+K', 'Ara'], ['1|2|3', 'Anime, Film & Dizi, Canlı TV'], ['I', 'Vitrindeki başlığın ayrıntıları'], ['T', 'Sinema modu (izleme sayfasında)'], ['Shift+N|Shift+P', 'Sonraki, önceki bölüm'], ['Esc', 'Pencereyi kapat'], ['?', 'Bu listeyi göster']];
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
  if (typing || e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]')) return;
  const watch = /^#\/izle\//.test(location.hash);
  if (e.key === '?') { e.preventDefault(); openShortcuts(); }
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

// ---------------- Yönlendirme ----------------
let routeId = 0;
let _scrollIo = null; // viewBrowse sonsuz scroll observer — route değişiminde temizlenir
async function route() {
  const v = ++routeId;
  destroyPlayer();
  if (_scrollIo) { _scrollIo.disconnect(); _scrollIo = null; }
  if (_cardIo) { _cardIo.disconnect(); _cardIo = null; }
  clearTimeout(heroTimer);
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  const part = parts[0] || 'home';
  $$('[data-nav]').forEach(a => a.toggleAttribute('aria-current', a.dataset.nav === part));
  document.title = 'LOVELL';
  window.scrollTo(0, 0);
  // Canlı TV kendi temasıyla açılır; diğer sayfalarda seçili bölümün temasına dönülür.
  const live = part === 'canli';
  document.documentElement.dataset.section = live ? 'livetv' : section;
  syncTabs(live ? 'livetv' : section);
  syncBottomNav(part);
  closeInfo(true);
  if (part === 'izle' && /^(tv|movie|al)$/.test(parts[1]) && /^\d+$/.test(parts[2])) await viewWatch(v, parts[1], parts[2], params);
  else if (live) await viewLiveTV(v);
  else if (part === 'kesfet') await viewBrowse(v, 'tv', params);
  else if (part === 'filmler') await viewBrowse(v, 'movie', params);
  else if (part === 'listem') viewList();
  else if (part === 'bilgisayarim') await viewLibrary(v);
  else await viewHome(v);
  if (v === routeId) { main.focus({preventScroll: true}); pageEnter(); }
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
    if (part === 'izle' || part === 'canli') location.hash = '#/';
    else if (query && /tur=/.test(query)) location.hash = `#/${part}`;
    else await route();
  });
}));
setSection(section);
// Film & Dizi bölümünde üst çubuk vitrinin üstünde şeffaf durur, kaydırınca koyulaşır.
const topBar = $('.top');
const onScroll = () => topBar.classList.toggle('scrolled', scrollY > 24);
addEventListener('scroll', onScroll, {passive: true});
onScroll();
Promise.all([
  loadGenres(),
  api('/api/status').then(s => { CLOUD = s.mode === 'cloud'; document.documentElement.dataset.mode = CLOUD ? 'cloud' : 'local'; }).catch(() => {}),
  refreshLibrary(false),
]).finally(route);
