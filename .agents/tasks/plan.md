# Implementation Plan

## Context

- **Project:** `c:\Users\bexte\Desktop\lovell anime` — Cloudflare Workers + Vanilla JS anime/film sitesi
- **Build/Test:** `npm test` (node --test), no bundler; files served as-is from Workers Static Assets
- **Key files:** `index.html`, `src/main.js` (947 lines), `src/style.css` (765 lines), `worker/index.js`
- **Tab system:** `$$('.tab-btn')` forEach listener calls `setSection(b.dataset.tab)` and then `route()`. The `section` variable inside `route()` is **derived from the URL hash path**, NOT from `currentTab` — so `livetv` tab must NOT go through `setSection`/`route`, it must call `viewLiveTV` directly.
- **Route function:** reads `location.hash`, maps path prefixes to view functions. Adding `livetv` as a hash-driven route is unnecessary; it will be handled purely in the tab click handler.
- **VidRock block in worker:** ends at `return json({sources: [...sources, ...vidRockSources], embeds, vidrift, folder: \`\${kind}-\${id}\`, cloud: true});` — the Anthology sources must be inserted BEFORE this return.

---

- [ ] 1. **GÖREV A — index.html: 3. tab butonu ekle**

  Mevcut `<button class="tab-btn" … data-tab="media">` butonundan hemen sonra, `</div>` (tab-bar kapanışı) satırından önce yeni butonu ekle:
  ```html
  <button class="tab-btn" role="tab" aria-selected="false" data-tab="livetv" type="button">📺 Canlı TV</button>
  ```
  Tab glider CSS `--i` değerini etkilememesi için yeni buton üçüncü pozisyonda olacak; `setSection` onu görmeyecek (çünkü tab click handler'da `livetv` için `setSection` çağrılmayacak).

  **Files:** `index.html`
  **Verify:** Dosyayı aç, 3 `.tab-btn` bulunduğunu doğrula. `npm test` (mevcut testler geçmeli).

---

- [ ] 2. **GÖREV A — src/main.js: Canlı TV fonksiyonları ekle**

  `// ---------------- Yönlendirme ----------------` yorumundan hemen önce, şu dört fonksiyonu ekle (sırasıyla):
  - `parseM3U(text)` — M3U metnini parse eder, `{name, logo, group, url}` dizisi döndürür
  - `channelCard(ch)` — HTML string döndürür (`ch-card` div)
  - `openLiveChannel(url, name, logo)` — modal oluşturur, HLS.js ile oynatır
  - `viewLiveTV(v)` — M3U fetch eder, gruplar, arama/filtre bağlar

  Bu fonksiyonlar görev tanımındaki kodla birebir eşleşmeli. `openLiveChannel` içindeki `esc()` zaten global scope'ta mevcut. `getHls()` zaten tanımlı (`hlsReady` lazy loader).

  **Tab click handler güncelleme:** `$$('.tab-btn').forEach(b => b.addEventListener('click', async () => {` bloğunu bul. İlk satırda `if (b.dataset.tab === section) return;` kontrolü var. Bundan **önce** (yani en başa) şunu ekle:
  ```js
  if (b.dataset.tab === 'livetv') { viewLiveTV(++routeId); return; }
  ```
  Bu sayede `livetv` tab'ına tıklanınca `setSection` ve `route()` tetiklenmez, sadece `viewLiveTV` çalışır.

  **Files:** `src/main.js`
  **Verify:** `npm test` geçmeli. Tarayıcıda `📺 Canlı TV` tab'ına tıklanınca kanal grid yüklenmeli (manuel doğrulama notu olarak belirt).

---

- [ ] 3. **GÖREV A — src/style.css: Canlı TV stilleri ekle**

  Dosyanın son satırından sonra (765. satırın altına) görev tanımındaki `/* ========== Canlı TV ========== */` bloğunu ekle. Tüm değişkenler (--bg-2, --line, --text, --dim, --red) zaten `:root`'ta tanımlı.

  **Files:** `src/style.css`
  **Verify:** `npm test` geçmeli. CSS parse hatası olmamalı.

---

- [ ] 4. **GÖREV B — .anthology-scraper/ klasörünü oluştur**

  `c:\Users\bexte\Desktop\lovell anime\.anthology-scraper\` dizinini ve içindeki dosyaları oluştur:

  **`.anthology-scraper/package.json`** — görev tanımındaki JSON ile birebir.

  **`.anthology-scraper/src/server.js`** — Express sunucu, şu endpoint'leri içermeli:
  - `GET /health` → `{status:'ok', service:'anthology-scraper'}`
  - `GET /api/animecix?tmdbId&season&episode` — TMDB'den ad al → AnimeciX ara → TMDB ID eşleştir → best-video URL → TauVideo ID çıkar → TauVideo API → `{sources}`
  - `GET /api/anizium?tmdbId&season&episode` — TMDB → Anizium arama → ID eşleştir → episodes → `{sources}`
  - `GET /api/sonanime?tmdbId&season&episode` — TMDB → SonAnime arama → episodes → videos → `{sources}`
  - `GET /api/hdfilmcehennemi?tmdbId` — TMDB film adı+yılı → HDFilmCehennemi arama → cheerio parse → iframe/player URL → HLS m3u8 → `{sources}`
  - `GET /api/all?tmdbId&type&season&episode` — type=tv ise animecix+anizium+sonanime paralel, type=movie ise hdfilmcehennemi; hataları sustur, birleştir → `{sources, count}`

  Her endpoint: 10 saniye timeout (`AbortSignal.timeout(10000)`), in-memory LRU cache (TTL 1 saat, max 500 entry — `Map` ile basit LRU), `Access-Control-Allow-Origin: *` response header, hata durumunda `{sources: [], error: message}`.

  TMDB API key: `500330721680edb6d5f7f12ba7cd9023` (server.js içinde sabit olarak tutulacak — prod'da env variable tercih edilir ama deploy kolaylığı için sabit).

  **Files:** `.anthology-scraper/package.json`, `.anthology-scraper/src/server.js`
  **Verify:** `cd .anthology-scraper && npm install && node src/server.js` komutu hatasız başlamalı; `curl http://localhost:3000/health` `{"status":"ok"}` döndürmeli. Test sonrası process'i durdur.

---

- [ ] 5. **GÖREV B — .anthology-scraper/README.md oluştur**

  Görev tanımındaki Markdown içeriğiyle birebir.

  **Files:** `.anthology-scraper/README.md`
  **Verify:** Dosya var mı kontrolü.

---

- [ ] 6. **GÖREV C — worker/index.js: Anthology Scraper entegrasyonu**

  `worker/index.js` içindeki `/api/play` handler'ını bul. VidRock bloğunun kapanışından (`} catch { /* resolver timeout — embed ile devam */ }`) hemen sonra, `return json(...)` satırından önce Anthology Scraper bloğunu ekle.

  Mevcut `return json(...)` satırını şununla değiştir:
  ```js
  return json({sources: [...sources, ...vidRockSources, ...anthologySources], embeds, vidrift, folder: `${kind}-${id}`, cloud: true});
  ```

  `env.ANTHOLOGY_SCRAPER_URL` ayarlı değilse `anthologySources` boş dizi olarak kalır, mevcut davranış değişmez.

  **Files:** `worker/index.js`
  **Verify:** `npm test` geçmeli. `worker/index.js` içinde `anthologySources` değişkeninin var olduğunu ve `return json(...)` satırında kullanıldığını doğrula.

---

- [ ] 7. **GÖREV D — Git commit ve push**

  Sırasıyla şu komutları çalıştır:
  ```
  git -C "c:\Users\bexte\Desktop\lovell anime" add index.html src/main.js src/style.css worker/index.js .anthology-scraper/
  git -C "c:\Users\bexte\Desktop\lovell anime" commit -m "feat: Canlı TV sekmesi (138 kanal), Anthology Türkçe scraper servisi"
  git -C "c:\Users\bexte\Desktop\lovell anime" push origin main
  ```

  **Files:** git history
  **Verify:** `git push` çıktısında hata olmamalı; `git log --oneline -1` commit mesajını göstermeli.

---

## Doğrulama özeti

1. `index.html` içinde 3 `.tab-btn` var
2. `src/main.js` içinde `viewLiveTV`, `parseM3U`, `channelCard`, `openLiveChannel` fonksiyonları var
3. Tab click handler başında `livetv` guard'ı var
4. `.anthology-scraper/src/server.js` oluştu ve `npm install` başarılı
5. `worker/index.js` içinde `anthologySources` var ve `return json(...)` içinde kullanılıyor
6. `git push` başarılı
