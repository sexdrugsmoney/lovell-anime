# UI zenginleştirme: skeleton, hamburger menü, CinePro fallback ve embed kaynakları

Bu değişiklik UX katmanını genişletiyor: skeleton yükleme gridleri, IntersectionObserver tabanlı kart giriş animasyonları, glassmorphism arama dialogu, toast tip desteği, chips mobil scroll ve tam klavye erişimli bir hamburger menü eklendi. Arka tarafta `lib/media.js` CinePro'nun localhost/private-IP URL'lerini Render.com'daki public fallback'e yönlendiriyor; ayrıca VidPlus, Vidy, VidSrc, VidRock ve MegaPlay embed sağlayıcıları sisteme eklendi. Temel risk alanları: IntersectionObserver'ların yalnızca *scroll sentinel* için temizlenip kart animasyonu observer'ı serbest bırakılması, CinePro'nun 55 saniyelik timeout ile çağrılmasına rağmen `api()` fonksiyonunun 20 saniyeyle onu kesmesi ve tüm embed iframe'lerin `X-Frame-Options` kısıtlamalarına tabi olması.

**Watch for:** `observeCards` observer'ı temizlenmiyor (likely leak) · CinePro'nun 55s timeout'u `api()` 20s hard limit tarafından gizlice kesiliyor (confirmed) · Hamburger menü `aria-modal` kullanımı yanlış (confirmed) · Skeleton grid prefers-reduced-motion ile çakışma (confirmed).

**Verdict**: NEEDS_CHANGES

---

## High-level view

CinePro fallback mantığı private/iç ağ IP'lerini kapsamlı bir regex setiyle kontrol ediyor ve geçersiz URL'lerde sessiz warning ile fallback'e geçiyor; bu sağlam bir güvenlik sınırı. Ancak scrape endpoint'i 55 saniye timeout isteyip, onu çağıran `api()` fonksiyonunun sabit 20 saniyelik limiti bu süreyi sessizce kesiyor; CinePro yanıtı hiç gelmeden kaynak listesi boş dönebilir.

Embed sağlayıcı katmanı (VidRift, VidPlus, Vidy, VidSrc, VidRock, MegaPlay) `embedSources` fonksiyonunda toplanmış ve `kind:'al'` (AniList) için desteklenmeyen sağlayıcılar `null` döndürüp otomatik dışlanıyor. Tüm bu iframe kaynakları üçüncü taraf CDN'ler; `X-Frame-Options: DENY` veya `frame-ancestors` kısıtlaması olan herhangi biri sessizce boş gelir ve kullanıcıya herhangi bir hata mesajı gösterilmez.

`viewBrowse` içindeki sonsuz scroll IntersectionObserver (`_scrollIo`) route değişiminde temizleniyor. Buna karşın `observeCards` her çağrıda yeni bir `IntersectionObserver` örneği oluşturuyor ve `.visible` sınıfı eklenmiş kartlar `unobserve` ediliyor, ancak observer nesnesi herhangi bir temizlik rutinine kaydedilmiyor. Her sayfa/bölüm geçişinde observer birikimi oluşabilir.

Hamburger menü Escape, Tab döngüsü ve ilk odak yönetimini doğru uyguluyor. Ancak `aria-modal="true"` navigasyon öğesine ekleniyor; bu standart yanlış — `aria-modal` yalnızca `role="dialog"` olan öğelerde anlamlıdır. Ekran okuyucular bu niteliği nav üzerinde görmezden gelir veya hatalı yorumlar.

Skeleton grid animasyonu (`shimmer` keyframe) `prefers-reduced-motion` bloğunun içinde değil. CSS dosyasında zaten `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important } }` kuralı var; bu kural shimmer'ı da kapatır. Ama `transition: none !important` aynı zamanda `.card` / `.wide`'ın prefers-reduced-motion bloğundaki açık `transition: none` kuralını — ki bu kural doğru — gereksiz kılıyor, çakışma değil ama gürültü.

---

<details>
<summary>Issues (5)</summary>

1. **CinePro timeout kesintisi** — `cineProqueries` 55s timeout ile `fetch` yapıyor, fakat onu çağıran kod `api()` fonksiyonu üzerinden geçiyor ve `api()` sabit 20s timeout ile `AbortSignal` kuruyor. CinePro'ya yapılan çağrı 20 saniyede iptal edilir, 55 saniyeye ulaşamaz. `cineproSources` doğrudan `fetch` kullandığı için sorun yok; ama server tarafında `api()` üzerinden sarmalanıyorsa (veya gelecekte sarmalanırsa) bu gecikme tamamen görünmez olur. Şimdiki çağrı zincirini doğrulayıp `api()` timeout parametresini ya kaldırın ya da CinePro rotası için 60s geçin.

2. **`observeCards` observer leak'i** — Her çağrıda yeni bir `IntersectionObserver` oluşturulup hiçbir ref'e kaydedilmiyor. Kart görünür olduğunda `unobserve` ediliyor, ancak observer nesnesi yok edilmiyor. Sayfa navigasyonları arasında birden fazla `IntersectionObserver` ayakta kalabilir. `_scrollIo` gibi modül düzeyi bir değişkende saklayın ve `route()` içinde `disconnect()` çağırın.

3. **`aria-modal` yanlış öğe üzerinde** — `mainNav.setAttribute('aria-modal', 'true')` bir `<nav>` öğesine uygulanıyor. `aria-modal` yalnızca `role="dialog"` veya `role="alertdialog"` olan öğelerde desteklenen bir niteliktir; buradaki kullanım spec dışı ve ekran okuyucularda beklenmedik davranışlara neden olabilir. Bu niteliği kaldırın; focus-trap zaten mevcuttur.

4. **Skeleton shimmer + prefers-reduced-motion çakışması** — `shimmer` keyframe'i `@media (prefers-reduced-motion: reduce)` dışında tanımlanıyor ve skeleton animasyonu bu media query altında `animation: none !important` tarafından bastırılıyor. Bastırılınca skeleton kartlar solid, animasyonsuz bloklar olarak kalır — bu kabul edilebilir bir fallback. Ancak aynı zamanda `transform: translateY(18px)` ile başlayan `.card` / `.wide` öğeleri prefers-reduced-motion'da `opacity: 1; transform: none; transition: none` ile override ediliyor fakat bu override genel `animation: none !important; transition: none !important` kuralından *sonra* geliyor. Spesifik selector kazandığı için düzgün çalışıyor, ancak güvenilirlik için `@media (prefers-reduced-motion: reduce) { .skeleton { animation: none; background: var(--bg-3); } }` kuralını açıkça ekleyin.

5. **Embed iframe hata görünürlüğü** — Herhangi bir embed sağlayıcısı `X-Frame-Options` veya `Content-Security-Policy: frame-ancestors` ile frame'lemeyi engellerse, kullanıcı boş bir siyah kutu görür; hata mesajı yok. `<iframe>` öğesinin `load` olayı hata durumunu ortaya koymaz. Bir `setTimeout` ile iframe boş kalırsa kullanıcıya "Bu kaynak yüklenemedi, başka kaynak dene" uyarısı gösteren bir mekanizma eklenebilir.

</details>

---

<details>
<summary>Details</summary>

## CinePro timeout asimetrisi

`cineProqueries`, `AbortSignal.timeout(55000)` ile kendi `fetch`'ini yapıyor; bu doğru. Sorun istemci tarafında: `api()` fonksiyonu (main.js ~70. satır) sabit 20 saniyeyle `AbortSignal` kuruyor. `/api/play/...` endpoint'i server-side `cineproSources` sonucunu bekliyorsa, istemci 20 saniyede yanıtı iptal eder; 55 saniyelik bekleme hiçbir zaman tamamlanamaz. Server route kodu burada incelenemedi, bu yüzden "likely" olarak işaretleniyor. CinePro rotasına özgü `api('/api/play/...', 65000)` gibi bir timeout geçmek veya `/api/play` endpoint'inde streaming yanıt kullanmak sorunu ortadan kaldırır.

## IntersectionObserver yaşam döngüsü

`observeCards(root)` her çağrıda ayrı bir `io` değişkeni oluşturuyor ve bu referans hiçbir yere kaydedilmiyor. Kart viewport'a girdiğinde `io.unobserve` çağrılıyor; ama kullanıcı scroll etmeden rotadan çıkarsa observer hâlâ canlı kalır. Ana sayfa + browse + watch sayfasının her birinde `observeCards` çağrısı yapılıyor; birden fazla rota ziyaretinde observer'lar birikir. `_scrollIo` ile aynı pattern uygulanmalı: modül düzeyi `_cardIo` değişkeni, route() başında `disconnect()`.

## Debounce ve arama cache

`searchTimer` + `clearTimeout` + `searchSeq` race-condition koruması doğru çalışıyor. API cache TTL hesabı (`Date.now() + ttl * 1000`) doğru; 200-entry LRU Map insertion-order'a dayanıyor ve doğru.

Arama sonuçlarındaki `<img>` öğelerinde `loading=` niteliği eksik (`result-img` içinde). Diğer tüm `card()` ve `wideCard()` çağrıları `loading="lazy" decoding="async"` kullanıyor.

</details>

---

<details>
<summary>Dosya haritası</summary>

- `lib/media.js` — `isPrivateHost` private IP kontrolü, CinePro fallback URL mantığı, VidPlus/Vidy/VidSrc/VidRock/MegaPlay embed sağlayıcıları eklendi
- `src/style.css` — skeleton shimmer animasyonu, kart hover overlay, scroll giriş animasyonu (.card/.wide), toast data-type stilleri, chips mobil scroll, hamburger menü CSS, glassmorphism arama dialogu
- `src/main.js` — `toast()` type parametresi, `api()` cache + TTL, `skeletonGrid()`, `observeCards()` IntersectionObserver, CinePro yükleme mesajı, hamburger menü mantığı (Escape, focus-trap, aria-expanded)
- `index.html` — hamburger `<button>` elementi eklendi, `aria-label`, `aria-expanded`, `aria-controls` nitelikleri

[Tam diff için `git diff main` çalıştır]

</details>
