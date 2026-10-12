# Anthology Scraper

Türkçe anime / dizi / film kaynakları için scraper servisi (Render.com'a deploy edilir). LOVELL
(`lib/providers.js`) bu servisin `/api/all` ucunu çağırır; Worker'da `ANTHOLOGY_SCRAPER_URL`
secret'ı, yerelde `.env` içindeki `ANTHOLOGY_SCRAPER_URL` kullanılır.

## Deploy
Önerilen: **Oracle Cloud Always Free** — uyumaz, ücretsiz, tek komutla kurulur ve GitHub'dan kendini günceller.
Adım adım kılavuz: [`deploy/oracle/README.md`](../deploy/oracle/README.md).

Render da hâlâ çalışır (Root directory: `.anthology-scraper`, Build: `npm install`, Start: `npm start`), ama ücretsiz
planda 15 dakika boşta kalınca uyur ve ilk istek 30-60 saniye bekler.

İsteğe bağlı ortam değişkenleri: `TMDB_API_KEY`, `FILMMAKINESI_SCRAPER_URL`, `STREMIO_ADDONS`, `ANTHOLOGY_LEGACY=1`,
`HOST` (ör. `127.0.0.1`; önünde ters vekil varken yalnızca yerel arayüzü dinler).

## API
```
GET /health
GET /api/all?tmdbId=127532&type=tv&season=1&episode=1[&title=&original=&year=&imdb=&budget=12000]
GET /api/<kaynak>?tmdbId=...            animecix, sonanime, diziyou, dizimom, webteizle, lovefilmizle,
                                         filmizlebabam, filmmakinesi, hdfilmcehennemi, closeload, ddizi, diziwatch
GET /api/stremio?imdb=tt...&type=tv|movie&season=&episode=   Stremio eklentileri (varsayılan CNCVerse)
GET /proxy/<jeton>                      yalnızca bu servisin verdiği Referer'li akışlar için
```

### `/api/all`
- **Süre bütçesi:** `budget` (3000–25000 ms, varsayılan 12000). Süre dolunca o ana kadar bulunanlar
  döner; yavaş bir site hiçbir şeyin dönmesini engellemez.
- **Durum raporu:** yanıttaki `providers` dizisi her kaynak için `{id, ok, ms, count, error?}` verir.
  Bir kaynak neden sonuç vermedi sorusunun cevabı burada.
- **Başlık ipuçları:** `title`, `original`, `year`, `imdb` gönderilirse TMDB'ye hiç gidilmez (TMDB'nin
  engellendiği ağlarda da çalışır). Gönderilmezse `api.themoviedb.org` ve `api.tmdb.org` sırayla denenir,
  sonuç 24 saat önbelleğe alınır.
- **Önbellek:** başarılı sonuç 30 dk, eksik sonuç 1 dk, başarısız tekil sorgu 3 dk.
- **Yanlış eşleşme koruması:** sitelerin arama sonucunda ilk kayıt körü körüne alınmaz; TMDB id'si,
  başlık ve yıl uyumu aranır.
- **Referer isteyen akışlar** (ör. VidMoly) `/proxy/<jeton>` adresine çevrilir. Jeton 4 saat geçerlidir
  ve yalnızca bu servisin kendi bulduğu adresleri açar; herhangi bir adresi açan açık bir vekil değildir.
  HLS listeleri yeniden yazılır, `Range` istekleri desteklenir.
- AnimeciX'te ölü MP4 bağlantıları 1 baytlık aralık isteğiyle ayıklanır, kalanlar yüksek kaliteden sıralanır.

### Türkçe kaynaklar (2026-10 itibarıyla çalışan)
| Kaynak | Ne verir | Not |
|---|---|---|
| SonAnime | Türkçe altyazılı doğrudan MP4 (1080/720/480) | Herkese açık API; arama sonucunda TMDB id'si var. CORS açık, Referer gerekmez |
| DiziYou | Türkçe altyazılı ve **Türkçe dublaj** HLS + Türkçe VTT | Dizi ve anime; CORS açık, Referer gerekmez |
| AnimeciX | Türkçe altyazılı doğrudan MP4 (TauVideo) | Ölü kalite bağlantıları ayıklanır |
| CNCVerse (Stremio) | Çok dilli HLS/MP4 | IMDb id'si gerekir; Referer isteyenler `/proxy` üzerinden; MKV/HEVC/DTS gibi tarayıcıda oynamayanlar elenir. `STREMIO_ADDONS` ile başka eklenti adresleri (virgülle) verilebilir |

`/api/all` aynı anda iki kez çağrılırsa (kısa + tam bütçe) alt sorgular paylaşılır; sitelere çift istek gitmez.

### Devre dışı kaynaklar
`anizium` (API'si taklit edilmesi gereken bir koruma belirteci istiyor) ve `sinewix` (API 401 dönüyor)
varsayılan olarak taranmaz. `ANTHOLOGY_LEGACY=1` ile geri açılır; tekil uçları yine çağrılabilir.

### Bilinen sınırlar
`hdfilmcehennemi` ve `closeload` bazı sunucu IP'lerine 403 (Cloudflare) dönebilir; bu durum `providers`
raporunda görünür. Sonuç, Render sunucusunun IP'sine göre değişir.
