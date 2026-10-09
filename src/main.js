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
const slim = a => ({kind: a.kind, id: a.id, title: a.title, poster: a.poster, backdrop: a.backdrop, year: a.year, score: a.score, isMovie: a.isMovie || a.kind === 'movie'});
let myList = store.get('list', []);
let progress = store.get('progress', {});   // "kind:id:s:e" -> {t, d, at}
let recent = store.get('recent', {});       // "kind:id" -> {item, s, e, at}
let CLOUD = false;                          // Cloudflare Workers sürümü: yerel dosya yok
let library = new Set();                    // "kind:id" anahtarları (bilgisayardaki dosyalar)
let libraryEpisodes = new Map();            // "kind:id" -> Set("s:e")

function inList(a) { return myList.some(x => keyOf(x) === keyOf(a)); }
function toggleList(a) {
  const had = inList(a);
  myList = had ? myList.filter(x => keyOf(x) !== keyOf(a)) : [slim(a), ...myList];
  store.set('list', myList);
  updateCount();
  toast(had ? 'Listeden çıkarıldı' : 'Listeye eklendi');
  return !had;
}
function updateCount() {
  const c = $('#list-count');
  c.textContent = myList.length;
  c.hidden = !myList.length;
}
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
function toast(msg, type = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.dataset.type = type;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
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

function imgFallback(root = document) {
  $$('img[data-fb]', root).forEach(img => {
    if (img.dataset.bound) return;
    img.dataset.bound = 1;
    img.addEventListener('error', () => { img.closest('.card-img, .wide-img, .hero-bg, .thumb')?.classList.add('noimg'); img.remove(); }, {once: true});
  });
}

// ---------------- Bileşenler ----------------
function card(a) {
  const local = library.has(keyOf(a));
  return `<a class="card" href="${watchHref(a)}">
    <span class="card-img">${a.poster ? `<img src="${esc(a.poster)}" alt="" loading="lazy" decoding="async" data-fb>` : ''}<span class="card-ph">${esc(a.title)}</span>${local ? '<span class="flag" title="Bilgisayarında video dosyası var">Dosyan var</span>' : ''}</span>
    <span class="card-title">${esc(a.title)}</span>
    <span class="card-meta"><span>${esc(a.year || '')}${isMovie(a) ? ' film' : ''}</span>${a.score ? `<span class="score">${STAR}${score(a.score)}</span>` : ''}</span>
  </a>`;
}
function wideCard(r) {
  const a = r.item, p = progress[`${keyOf(a)}:${r.s}:${r.e}`];
  const pct = p ? Math.min(100, p.t / p.d * 100) : 0;
  return `<a class="wide" href="${watchHref(a, r.s, r.e)}">
    <span class="wide-img">${a.backdrop || a.poster ? `<img src="${esc(a.backdrop || a.poster)}" alt="" loading="lazy" decoding="async" data-fb>` : ''}<span class="wide-play">${PLAY}</span></span>
    <span class="bar"><i style="width:${pct}%"></i></span>
    <span class="card-title">${esc(a.title)}</span>
    <span class="card-meta">${isMovie(a) ? 'Film' : `${r.s}. sezon, ${r.e}. bölüm`}${p ? ` <span>${fmtTime(p.d - p.t)} kaldı</span>` : ''}</span>
  </a>`;
}
function shelf({title, items, more, wide}) {
  if (!items?.length) return '';
  return `<section class="shelf">
    <div class="shelf-head"><h2>${esc(title)}</h2><div class="shelf-tools">${more ? `<a class="more" href="${more}">Tümünü gör</a>` : ''}<button class="arrow" data-dir="-1" aria-label="Geri kaydır"><svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5"/></svg></button><button class="arrow" data-dir="1" aria-label="İleri kaydır"><svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5"/></svg></button></div></div>
    <div class="row ${wide ? 'row-wide' : ''}">${items.map(wide ? wideCard : card).join('')}</div>
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
function observeCards(root = document) {
  if (reduceMotion) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, {threshold: 0.08});
  $$('.card, .wide', root).forEach(c => io.observe(c));
}

// ---------------- Ana sayfa ----------------
let heroTimer;
function heroView(items) {
  if (!items.length) return '';
  return `<section class="hero" aria-roledescription="carousel" aria-label="Öne çıkanlar">
    <div class="hero-bg"></div>
    <div class="hero-shade"></div>
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
    $('.hero-bg', hero).innerHTML = a.backdrop ? `<img src="${esc(a.backdrop)}" alt="" loading="eager" fetchpriority="high" data-fb>` : '';
    $('.hero-body', hero).innerHTML = `
      <h1 class="hero-title">${esc(a.title)}</h1>
      <p class="hero-meta">${a.score ? `<span class="score">${STAR}${score(a.score)}</span>` : ''}<span>${esc(a.year)}</span>${a.genres?.length ? `<span>${esc(a.genres.slice(0, 3).join(', '))}</span>` : ''}</p>
      <p class="hero-text">${esc(a.overview)}</p>
      <div class="actions"><a class="btn btn-play" href="${watchHref(a)}">${PLAY}İzle</a><button class="btn btn-ghost" data-save>${inList(a) ? CHECK + 'Listende' : PLUS + 'Listeye ekle'}</button></div>`;
    $('[data-save]', hero).onclick = e => { const on = toggleList(a); e.currentTarget.innerHTML = on ? CHECK + 'Listende' : PLUS + 'Listeye ekle'; };
    $$('.thumb', hero).forEach((t, k) => { t.setAttribute('aria-selected', k === i); t.classList.toggle('on', k === i); });
    imgFallback(hero);
    clearTimeout(heroTimer);
    if (!reduceMotion && items.length > 1) heroTimer = setTimeout(() => { if (document.contains(hero) && !hero.matches(':hover, :focus-within')) show(i + 1); else heroTimer = setTimeout(() => show(i + 1), 9000); }, 9000);
  };
  $$('.thumb', hero).forEach(t => t.onclick = () => show(Number(t.dataset.i)));
  show(0);
}

async function viewHome(v) {
  main.innerHTML = loading('Ana sayfa hazırlanıyor');
  let data;
  try { data = await api('/api/home'); } catch (e) { if (v === routeId) main.innerHTML = errorBox(e); return; }
  if (v !== routeId) return;
  const recents = Object.values(recent).sort((a, b) => b.at - a.at).slice(0, 10);
  const listed = myList.slice(0, 18);
  main.innerHTML = `${heroView(data.hero)}
    <div class="page">
      ${shelf({title: 'Kaldığın yerden', items: recents, wide: true})}
      ${data.shelves.slice(0, 1).map(shelf).join('')}
      ${shelf({title: 'Listendekiler', items: listed, more: '#/listem'})}
      ${data.shelves.slice(1).map(shelf).join('')}
      ${genreLinks()}
    </div>`;
  bindHero(data.hero);
  bindShelves();
  imgFallback();
  observeCards();
  setStatus(data.source);
}
let genres = [];
function genreLinks() {
  if (!genres.length) return '';
  return `<section class="genres"><h2>Türe göre</h2><div class="genre-grid">${genres.map(g => `<a href="#/kesfet?tur=${g.slug}">${esc(g.name)}</a>`).join('')}</div></section>`;
}

// ---------------- Keşfet / Filmler ----------------
const SORTS = [['popular', 'Popüler'], ['season', 'Yeni çıkanlar'], ['rating', 'En yüksek puan'], ['new', 'En yeni']];
async function viewBrowse(v, kind, params) {
  const genre = params.get('tur') || '', sort = params.get('sirala') || 'popular', q = params.get('ara') || '';
  const base = kind === 'movie' ? '#/filmler' : '#/kesfet';
  const link = o => { const p = new URLSearchParams({tur: genre, sirala: sort, ara: q, ...o}); [...p.keys()].forEach(k => !p.get(k) && p.delete(k)); return base + (p.toString() ? '?' + p : ''); };
  main.innerHTML = `<div class="page">
    <header class="page-head"><h1>${kind === 'movie' ? 'Anime filmleri' : 'Anime dizileri'}</h1>
      <form class="filter-search" role="search"><input name="ara" type="search" value="${esc(q)}" placeholder="${kind === 'movie' ? 'Filmlerde ara' : 'Dizilerde ara'}" aria-label="Ara"></form></header>
    <div class="filters">
      <div class="chips" role="list"><a role="listitem" class="chip ${!genre ? 'on' : ''}" href="${link({tur: ''})}">Hepsi</a>${genres.map(g => `<a role="listitem" class="chip ${genre === g.slug ? 'on' : ''}" href="${link({tur: g.slug})}">${esc(g.name)}</a>`).join('')}</div>
      <label class="select">Sırala <select id="sort">${SORTS.map(([k, t]) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    <div class="grid" id="grid"></div>
    <div class="more-wrap" id="more-wrap">${loading()}</div>
  </div>`;
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
      $('#grid').innerHTML = skeletonGrid();
      $('#more-wrap').innerHTML = '';
    } else {
      $('#more-wrap').innerHTML = loading();
    }
    try {
      const d = await api(`/api/browse?${new URLSearchParams({kind, genre, sort, page, q})}`);
      if (v !== routeId) return;
      if (page === 1) $('#grid').innerHTML = '';
      $('#grid').insertAdjacentHTML('beforeend', d.items.map(card).join(''));
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
function viewList() {
  main.innerHTML = `<div class="page"><header class="page-head"><h1>Listem</h1>${myList.length ? `<p>${myList.length} başlık. Liste bu tarayıcıda saklanır.</p>` : ''}</header>
    ${myList.length ? `<div class="grid">${myList.map(card).join('')}</div>` : `<div class="state"><h2>Listen boş</h2><p>Bir animenin sayfasında “Listeye ekle”ye bastığında burada görünür.</p><a class="btn" href="#/kesfet">Dizilere göz at</a></div>`}
  </div>`;
  imgFallback();
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
  main.innerHTML = loading('Anime bilgileri yükleniyor');
  let a;
  try { a = await api(`/api/title/${kind}/${id}`); } catch (e) { if (v === routeId) main.innerHTML = errorBox(e); return; }
  if (v !== routeId) return;
  document.title = `${a.title} | LOVELL`;
  const movie = isMovie(a);
  const last = recent[keyOf(a)];
  const seasons = a.seasons?.length ? a.seasons : [{n: 1, name: 'Bölümler', count: 0}];
  let s = Number(params.get('s')) || (last?.s) || seasons[0].n;
  let e = Number(params.get('e')) || (last && last.s === s ? last.e : 1);
  if (movie) { s = 1; e = 1; }
  const ctx = {a, s, e, episodes: [], v};

  main.innerHTML = `<div class="watch">
    <div class="cinema">
      <div class="stage" id="stage"><div class="stage-inner">${loading('Video aranıyor')}</div></div>
      ${movie ? '' : `<aside class="cinema-panel" id="episodes" aria-label="Bölüm listesi">
        <div class="cinema-panel-head"><span class="eyebrow">Bölümler</span><strong>${a.episodeCount || ''}</strong></div>
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
          ${a.original && a.original !== a.title ? `<p class="original" lang="ja">${esc(a.original)}</p>` : ''}
          <p class="facts">${a.score ? `<span class="score">${STAR}${score(a.score)}</span>` : ''}${a.year ? `<span>${esc(a.year)}</span>` : ''}${movie ? `<span>Film${a.runtime ? `, ${a.runtime} dk` : ''}</span>` : a.episodeCount ? `<span>${a.episodeCount} bölüm</span>` : ''}${a.genres?.length ? `<span>${esc(a.genres.join(', '))}</span>` : ''}${a.studios?.length ? `<span>${esc(a.studios.join(', '))}</span>` : ''}</p>
          ${a.overview ? `<div class="overview" id="overview"><p>${esc(a.overview).replace(/\n+/g, '</p><p>')}</p></div>${a.overviewLang === 'en' ? '<p class="note">Türkçe özet bulunamadı, İngilizcesi gösteriliyor.</p>' : ''}` : ''}
          <div class="actions">
            <button class="btn ${inList(a) ? 'btn-ghost' : ''}" id="save">${inList(a) ? CHECK + 'Listende' : PLUS + 'Listeye ekle'}</button>
            ${a.trailer ? `<button class="btn btn-ghost" id="trailer">${PLAY}Fragman</button>` : ''}
          </div>
        </div>
        ${whereToWatch(a)}
      </div>
      ${shelf({title: 'Bunu sevenler bunlara da baktı', items: a.recommendations || []})}
    </div>
  </div>`;
  const ov = $('#overview');
  if (ov && ov.scrollHeight > ov.clientHeight + 4) { ov.classList.add('clamped'); ov.insertAdjacentHTML('afterend', '<button class="text-btn" id="ov-more">Devamını oku</button>'); $('#ov-more').onclick = ev => { ov.classList.toggle('open'); ev.target.textContent = ov.classList.contains('open') ? 'Daha az göster' : 'Devamını oku'; }; }
  $('#save').onclick = ev => { const on = toggleList(a); ev.currentTarget.innerHTML = on ? CHECK + 'Listende' : PLUS + 'Listeye ekle'; ev.currentTarget.classList.toggle('btn-ghost', on); };
  if ($('#trailer')) $('#trailer').onclick = () => openTrailer(a.trailer);
  if ($('#season')) $('#season').onchange = ev => go(ctx, Number(ev.target.value), 1);
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
  $('#stage').querySelector('.stage-inner').innerHTML = `<div class="loading" role="status"><span class="spin"></span>Kaynaklar aranıyor…<br><small style="color:#888;font-size:13px">(İlk açılışta 50 saniyeye kadar sürebilir)</small></div>`;
  try {
    d = await api(`/api/play/${ctx.a.kind}/${ctx.a.id}?s=${ctx.s}&e=${ctx.e}${alId ? `&alId=${alId}` : ''}`);
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

  stage.innerHTML = `<div class="stage-inner vidrift-wrap">
    <iframe
      class="vidrift-frame"
      src="${esc(embed.url)}"
      allowfullscreen
      allow="autoplay; fullscreen; encrypted-media *; autoplay *; fullscreen *"
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
function openSearch() { sd.showModal(); si.select(); if (!si.value) sr.innerHTML = '<p class="muted pad">En az iki harf yaz.</p>'; }
$('#search-open').onclick = openSearch;
$('#search-close').onclick = () => sd.close();
sd.addEventListener('click', e => { if (e.target === sd) sd.close(); });
si.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = si.value.trim(), seq = ++searchSeq;
  if (q.length < 2) { sr.innerHTML = '<p class="muted pad">En az iki harf yaz.</p>'; return; }
  sr.innerHTML = loading('Aranıyor');
  searchTimer = setTimeout(async () => {    try {
      const d = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (seq !== searchSeq) return;
      sr.innerHTML = d.items.length ? d.items.slice(0, 14).map((a, i) => `<a class="result" role="option" href="${watchHref(a)}" data-i="${i}">
          <span class="result-img thumb">${a.poster ? `<img src="${esc(a.poster)}" alt="" data-fb>` : ''}</span>
          <span><strong>${esc(a.title)}</strong><small>${[a.year, isMovie(a) ? 'Film' : 'Dizi', a.score ? score(a.score) + ' puan' : ''].filter(Boolean).join(', ')}</small></span></a>`).join('')
        : `<p class="muted pad">“${esc(q)}” için sonuç yok. Japonca ya da İngilizce adını dene.</p>`;
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
sr.addEventListener('click', e => { if (e.target.closest('a')) sd.close(); });
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
    mainNav.setAttribute('aria-modal', open ? 'true' : 'false');
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
      mainNav.setAttribute('aria-modal', 'false');
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

// ---------------- Yönlendirme ----------------
let routeId = 0;
let _scrollIo = null; // viewBrowse sonsuz scroll observer — route değişiminde temizlenir
async function route() {
  const v = ++routeId;
  destroyPlayer();
  if (_scrollIo) { _scrollIo.disconnect(); _scrollIo = null; }
  clearTimeout(heroTimer);
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  const section = parts[0] || 'home';
  $$('[data-nav]').forEach(a => a.toggleAttribute('aria-current', a.dataset.nav === section));
  document.title = 'LOVELL';
  window.scrollTo(0, 0);
  if (section === 'izle' && /^(tv|movie|al)$/.test(parts[1]) && /^\d+$/.test(parts[2])) await viewWatch(v, parts[1], parts[2], params);
  else if (section === 'kesfet') await viewBrowse(v, 'tv', params);
  else if (section === 'filmler') await viewBrowse(v, 'movie', params);
  else if (section === 'listem') viewList();
  else if (section === 'bilgisayarim') await viewLibrary(v);
  else await viewHome(v);
  if (v === routeId) main.focus({preventScroll: true});
}
// Eski adresleri (#watch?type=tv&id=1) yeni biçime çevir.
if (/^#watch\?/.test(location.hash)) { const p = new URLSearchParams(location.hash.split('?')[1]); location.replace(`#/izle/${p.get('type') === 'movie' ? 'movie' : 'tv'}/${p.get('id')}`); }

window.addEventListener('hashchange', route);
window.addEventListener('pagehide', destroyPlayer);
updateCount();
Promise.all([
  api('/api/genres').then(g => genres = g).catch(() => {}),
  api('/api/status').then(s => { CLOUD = s.mode === 'cloud'; document.documentElement.dataset.mode = CLOUD ? 'cloud' : 'local'; }).catch(() => {}),
  refreshLibrary(false),
]).finally(route);
