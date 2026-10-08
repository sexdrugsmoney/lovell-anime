# LOVELL

Anime keşif sitesi ve kişisel video oynatıcı. Anime bilgileri TMDB'den gelir; TMDB'ye ulaşılamazsa AniList'e, o da olmazsa yerel seçkiye geçilir.

## Çalıştırma

Node.js 20 veya üzeri yeterli, ek paket kurmak gerekmez.

```powershell
npm start
```

Ardından tarayıcıda http://localhost:3000 adresini aç. Port doluysa: `$env:PORT='3002'; npm start`

## TMDB sorunu ve çözümü

Türkiye'de bazı internet sağlayıcıları `api.themoviedb.org` adresini DNS düzeyinde engelliyor. Bu yüzden alan adı 127.0.0.1'e ya da bir uyarı sayfasına yönleniyor. Sunucu artık şu yolları sırayla dener ve çalışanı hatırlar:

1. `TMDB_PROXY_URL` (isteğe bağlı, kendi vekil adresin)
2. Sistem DNS'i (yerel ya da özel IP dönerse atlanır)
3. Şifreli DNS (DoH): Cloudflare 1.1.1.1 ve 1.0.0.1, Google 8.8.8.8. Bunlara doğrudan IP ile bağlanılır, DNS gerekmez.

Listeler TMDB'nin "anime" anahtar kelimesiyle (210024) süzülür; Japon yapımı ama anime olmayan animasyonlar listelere girmez.

Her yol hem `api.themoviedb.org` hem de TMDB'nin diğer resmî adresi `api.tmdb.org` için denenir. Görseller için de `image.tmdb.org` ve `media.themoviedb.org` denenir. TLS doğrulaması her zaman açıktır.

**Bağlantıyı test et:**

```powershell
npm run doctor
```

Bu komut her yolu tek tek dener ve hangisinin çalıştığını yazar. Sitenin alt kısmında da o anki veri kaynağı görünür.

### Hâlâ bağlanmıyorsa: ücretsiz Cloudflare Worker vekili

1. https://dash.cloudflare.com adresinde ücretsiz hesap aç. **Workers & Pages → Create → Worker** adımlarını izle.
2. Editöre `scripts/cloudflare-worker.js` dosyasının içeriğini yapıştır ve **Deploy** de.
3. Proje klasöründe `.env.example` dosyasını `.env` adıyla kopyala ve şunları yaz:
   ```
   TMDB_PROXY_URL=https://senin-worker-adin.workers.dev
   TMDB_IMAGE_PROXY_URL=https://senin-worker-adin.workers.dev
   ```
4. Sunucuyu yeniden başlat.

Worker ayarlarında `TMDB_API_KEY` adında bir secret tanımlarsan anahtar Worker'da saklanır. Worker hem `/3/discover/tv?...` hem de `/?endpoint=/discover/tv&...` biçimini kabul eder. `?endpoint=` biçiminde çalışan başka bir vekil kullanıyorsan `.env` içine `TMDB_PROXY_STYLE=query` yaz.

### Kendi TMDB anahtarın

Projedeki varsayılan anahtar çalışıyor ama paylaşımlı. Kendi anahtarını https://www.themoviedb.org/settings/api adresinden ücretsiz alıp `.env` dosyasına `TMDB_API_KEY=` olarak yazabilirsin. v4 jetonu kullanmak istersen `TMDB_READ_TOKEN=` satırını doldur.

## İnternette yayınlama (Cloudflare Workers)

Siteyi kendi bilgisayarın kapalıyken de her cihazdan açılabilen bir adreste yayınlayabilirsin. TMDB'ye ve görsellere Cloudflare bağlandığı için ziyaretçinin internetindeki DNS engeli sorun olmaz. TMDB anahtarın Worker'da gizli değişken olarak durur, tarayıcıya gönderilmez.

```powershell
npm run yayinla
```

İlk çalıştırmada tarayıcıda Cloudflare giriş sayfası açılır; "Allow" deyip terminale dön. Komut siteyi `dist` klasörüne hazırlar, Worker'ı yayınlar ve `.env` içindeki `TMDB_READ_TOKEN` / `TMDB_API_KEY` değerlerini Worker'a yükler. Sonunda `https://lovell.<hesap-adın>.workers.dev` adresini yazar. Güncelleme yaptıkça aynı komutu tekrar çalıştırman yeterli.

İnternetteki sürüm bilgisayarındaki `media` klasörünü göremez; "Bilgisayarımda" sayfası orada gizlenir. Kendi videoların için yerel sürümü (`npm start`) kullan.

## İzleme

LOVELL lisanssız yayın sitelerini gömmez. Bir animeyi üç yoldan izleyebilirsin:

**1. Kendi video dosyaların.** Proje içindeki `media` klasörüne her anime için bir klasör aç. Klasör adı animenin sayfasında yazar, ör. `tv-127532`, `movie-372058` ya da AniList'ten gelenler için `al-21`. Klasör adından sonra istediğin adı ekleyebilirsin: `tv-127532 Solo Leveling`.

```
media/
  tv-127532 Solo Leveling/
    S01E01.mp4
    S01E01.tr.srt      ← altyazı (Türkçe karakterler otomatik düzeltilir)
    Season 2/
      Solo Leveling - 03.mp4
  movie-372058/
    Your Name.mp4
```

Bölüm numarası `S01E01`, `1x01`, `E01`, `Bölüm 3`, `- 03` gibi adlardan okunur. MP4 (H.264 + AAC) ve WebM her tarayıcıda açılır. MKV tarayıcıya göre açılmayabilir. Videoları başka bir klasörde tutuyorsan `.env` içinde `MEDIA_DIR=D:\Anime` yaz.

Oynatıcı kaldığın saniyeyi hatırlar, altyazıyı otomatik açar, bölüm bitince sonrakine geçer. "Bilgisayarımda" sayfası dosyası olan animeleri listeler.

**2. Bağlantı listesi (`streams.json`).** Hakkına sahip olduğun ya da kendi sunucunda barındırdığın videolar için. MP4, WebM ve HLS (`.m3u8`) desteklenir. Anahtar biçimi `tür:kimlik:sezon:bölüm`:

```json
{
  "tv:127532:1:1": [
    {"name": "Kendi sunucum", "url": "https://ornek.com/solo/01.m3u8",
     "subtitles": [{"label": "Türkçe", "language": "tr", "url": "https://ornek.com/solo/01.tr.vtt"}]}
  ]
}
```

**3. Yasal platformlar.** Her animenin sayfasında Türkiye'de hangi platformda (Netflix, Crunchyroll, Disney+ vb.) yayınlandığı ve resmî yayın bağlantıları gösterilir. Bölge `WATCH_REGION` ile değiştirilebilir. Fragmanlar YouTube'dan açılır.

## Yapı

- `server.js`: HTTP sunucusu, API uçları, video ve altyazı sunumu (aralık istekleri destekli)
- `lib/net.js`: TMDB'ye engellere dayanıklı bağlantı
- `lib/catalog-core.js`: TMDB → AniList → yerel seçki veri katmanı (Node ve Worker ortak)
- `lib/catalog.js`: çekirdeği Node sunucusu için yapılandırır
- `worker/index.js`, `wrangler.toml`, `scripts/deploy.mjs`: Cloudflare Workers sürümü

### CinePro Core kaynağı

Cloudflare Worker, CinePro Core'un OMSS uçlarını kullanabilir. `.env` dosyasına CinePro örneğinin HTTPS kök adresini `CINEPRO_API_URL` olarak ekle; gerekiyorsa `CINEPRO_API_TOKEN` da tanımla. TV bölümleri `/v1/tv/{tmdbId}/seasons/{season}/episodes/{episode}`, filmler `/v1/movies/{tmdbId}` uçlarından çözülür. `npm run deploy` bu ayarları Worker'a gizli değer olarak yükler. CinePro sunucu adresi belgelerdeki örnek `api.example.com` değildir; gerçek örnek adresini CinePro yöneticisinden almak gerekir.
- `lib/media.js`: `media` klasörü tarama ve `streams.json`
- `src/main.js`, `src/style.css`, `index.html`: arayüz
- `public/logo.svg`, `public/logo-dark.svg`, `public/mark.svg`: logo dosyaları

## Testler

```powershell
npm test
```

Önceki sürümün dosyaları `.backup/` klasöründe duruyor.
