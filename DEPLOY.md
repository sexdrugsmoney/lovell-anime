# LOVELL Canlı Deploy Rehberi

Bu rehber LOVELL'i Cloudflare Workers üzerinde, CinePro Core'u Render.com üzerinde sürekli çalışır hâle getirir.

---

## 1. CinePro Core → Render.com (ücretsiz)

CinePro Core scraping backend'ini Render'da çalıştır.

### Adımlar

1. **Fork et**  
   GitHub'da `https://github.com/cinepro-org/core` adresine git → sağ üstte **Fork** düğmesine bas → kendi hesabına fork et.

2. **Render.com'da deploy et**  
   - [render.com](https://render.com) → New → **Web Service**  
   - Repoyu bağla (forkladığın repo: `github.com/<senin-kullanıcı-adın>/core`)  
   - Render `render.yaml` dosyasını otomatik tanır, ayarları doldurur  
   - **Environment Variables** kısmına ekle:
     ```
     TMDB_API_KEY = 17f0fe645009122aedc492b86c1be458
     NODE_ENV     = production
     CACHE_TYPE   = memory
     CORS_ORIGIN  = *
     HOST         = 0.0.0.0
     PORT         = 3000
     ```
   - **Deploy** düğmesine bas  
   - Deploy tamamlanınca URL'yi kopyala: `https://cinepro-xxxx.onrender.com`

3. **Test et**  
   ```
   https://cinepro-xxxx.onrender.com/scrape?tmdbId=1429&type=tv&season=1&episode=1
   ```
   Kaynak listesi JSON olarak geliyorsa çalışıyor demektir.

> **Not:** Render free tier 15 dakika hareketsiz kalınca uyku moduna girer.  
> Bunun için GitHub Actions `cinepro-health.yml` workflow'u her 14 dakikada bir ping atar.

---

## 2. LOVELL → Cloudflare Workers (GitHub Actions ile otomatik)

### Adımlar

1. **GitHub repo oluştur**  
   - GitHub'da yeni bir private/public repo aç  
   - Bu klasörün içindekini push et:
     ```powershell
     cd "c:\Users\bexte\Desktop\lovell anime"
     git init
     git add .
     git commit -m "ilk commit"
     git remote add origin https://github.com/<kullanıcı-adın>/<repo-adın>.git
     git push -u origin main
     ```

2. **Cloudflare API Token al**  
   - [dash.cloudflare.com](https://dash.cloudflare.com) → My Profile → API Tokens  
   - **Create Token** → **Edit Cloudflare Workers** şablonu  
   - Token'ı kopyala

3. **GitHub Secrets ekle**  
   GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**:

   | Secret Adı | Değer |
   |------------|-------|
   | `CF_API_TOKEN` | Cloudflare API token |
   | `CF_ACCOUNT_ID` | Cloudflare dashboard sağ altındaki Account ID |
   | `TMDB_READ_TOKEN` | `.env` dosyasındaki `TMDB_READ_TOKEN` değeri |
   | `CINEPRO_URL` | Render'dan aldığın URL (örn. `https://cinepro-xxxx.onrender.com`) |

4. **İlk deploy**  
   main branch'e herhangi bir push → Actions sekmesinde deploy otomatik başlar.  
   Ya da Actions → **Deploy LOVELL → Cloudflare Workers** → **Run workflow**.

---

## 3. Cloudflare Worker Secrets (manuel deploy için)

`npm run yayinla` komutu çalıştırıldığında `CINEPRO_URL` de otomatik yüklenir.  
`.env` dosyasına şu satırı ekle:

```
CINEPRO_URL=https://cinepro-xxxx.onrender.com
```

---

## Nasıl çalışır

```
Kullanıcı
   ↓
Cloudflare Workers (LOVELL)
   ├── Statik dosyalar → Workers Static Assets (dist/)
   ├── /api/title, /api/browse vb. → TMDB API
   └── /api/play → 
         ├── CinePro Core (Render) → HLS/MP4 kaynaklar
         └── Embed sağlayıcılar → iframe (kurulum gerektirmez)
               VidRift, VidPlus, Vidy, VidSrc, VidRock, MegaPlay
```

### Kaynak önceliği

1. **Yerel dosya** (Cloudflare KV'de tanımlıysa) — en hızlı
2. **CinePro Core** (Render'da çalışıyorsa) — HLS/MP4 direkt
3. **Embed sağlayıcılar** — her zaman mevcut, 6 adet

---

## Sık sorulan sorular

**CinePro URL'i eklemeden embed'ler çalışır mı?**  
Evet. `CINEPRO_URL` olmadan sadece embed iframe'leri (VidRift, VidPlus vb.) devreye girer.

**CinePro nasıl güncel kalır?**  
Fork ettiğin repo otomatik güncellenmez. Zaman zaman upstream'i merge et:
```
git fetch upstream
git merge upstream/main
git push
```
Render `autoDeploy: false` ayarlı, elle deploy et veya `true` yap.

**GitHub Actions ne zaman çalışır?**  
`main` branch'e her push'ta. Ayrıca Actions sekmesinden elle tetiklenebilir.
