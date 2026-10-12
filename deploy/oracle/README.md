# Yardımcı servisleri Oracle Cloud'a (ücretsiz) kurma

Render'ın ücretsiz planı 15 dakika boşta kalınca uyuyor; ilk istek 30-60 saniye bekliyor. Oracle Cloud'un
**Always Free** sunucusu ise hiç uyumuyor ve süresiz ücretsiz. Bu klasördeki betik üç servisi oraya tek
komutla kurar ve GitHub'a her push'ta kendini günceller:

| Servis | Ne işe yarar | Adres |
|---|---|---|
| Anthology | Türkçe kaynaklar (SonAnime, DiziYou, AnimeciX…), Stremio eklentileri, Referer isteyen akışlar için geçit | `https://anthology.<ip>.sslip.io` |
| VidRock çözücü | VidRock akışlarını çözer | `https://vidrock.<ip>.sslip.io` |
| DDizi/DiziWatch kazıyıcısı | Python, yalnızca Anthology kullanır | dışarı açık değil |

Alan adı gerekmez: `sslip.io` sunucunun IP'sini adrese çevirir, Caddy de ücretsiz HTTPS sertifikasını kendisi alır.

---

## 1. Hesap aç (bir kez, ~10 dk)

1. https://www.oracle.com/cloud/free/ → **Start for free**.
2. **Home Region** olarak **Germany Central (Frankfurt)** seç. Türkiye'ye en yakın bölge bu ve sonradan değiştirilemez.
3. Kart bilgisi kimlik doğrulaması için istenir. Always Free kaynaklar için ücret alınmaz; hesabı "Pay As You Go"ya
   yükseltmediğin sürece ücretli bir şey açılamaz.

## 2. Sunucuyu oluştur (~5 dk)

1. Konsolda **Compute → Instances → Create instance**.
2. **Image**: *Canonical Ubuntu 24.04* (ya da 22.04).
3. **Shape** → *Change shape* → **Ampere** → `VM.Standard.A1.Flex`, **2 OCPU / 12 GB** yeterli (ücretsiz sınır 4 OCPU / 24 GB).
   - "Out of capacity" hatası alırsan birkaç saat sonra tekrar dene ya da **Specialty and previous generation** →
     `VM.Standard.E2.1.Micro` (1 GB, o da ücretsiz) seç; servisler onda da çalışır.
4. **Add SSH keys** → *Generate a key pair for me* → **Save private key** (dosyayı sakla).
5. **Create**. Birkaç dakika sonra sayfada **Public IP address** görünür.

## 3. 80 ve 443 portlarını aç (~2 dk)

Sunucu sayfasında **Primary VNIC → Subnet** bağlantısına tıkla → **Security Lists** → *Default Security List* →
**Add Ingress Rules**, iki kural ekle:

| Source CIDR | IP Protocol | Destination Port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(Sunucunun kendi iç güvenlik duvarını betik açıyor.)

## 4. Betiği çalıştır (~5 dk)

Windows'ta PowerShell aç (indirdiğin anahtarın adını ve IP'yi kendi değerlerinle değiştir):

```powershell
ssh -i "$HOME\Downloads\ssh-key-2026-10-12.key" ubuntu@129.1.2.3
```

> "Permissions too open" hatası alırsan bir kez şunu çalıştır:
> `icacls "$HOME\Downloads\ssh-key-2026-10-12.key" /inheritance:r /grant:r "$($env:USERNAME):R"`

Sunucuya bağlanınca:

```bash
curl -fsSL https://raw.githubusercontent.com/sexdrugsmoney/lovell-anime/main/deploy/oracle/setup.sh | sudo bash
```

Betik sonunda iki adres yazar, örneğin:

```
ANTHOLOGY_SCRAPER_URL = https://anthology.129-1-2-3.sslip.io
VIDROCK_RESOLVER_URL  = https://vidrock.129-1-2-3.sslip.io
```

## 5. Siteye bağla (~2 dk)

1. GitHub'da depo → **Settings → Secrets and variables → Actions** → bu iki secret'ı ekle / güncelle.
2. Değişikliklerin canlıya geçmesi için `main`'e bir push yap (ya da Actions sekmesinden *Deploy* iş akışını yeniden çalıştır).
3. Yerelde de kullanmak istersen aynı iki satırı proje klasöründeki `.env` dosyasına yaz.

Render'daki eski servisi bundan sonra silebilirsin.

---

## Bakım

| İş | Komut (sunucuda) |
|---|---|
| Durum | `systemctl status lovell-anthology lovell-vidrock lovell-scraper caddy` |
| Canlı günlük | `journalctl -u lovell-anthology -f` |
| Hemen güncelle | `sudo /usr/local/bin/lovell-update` |
| Ayarlar (TMDB anahtarı, Stremio eklentileri) | `sudo nano /etc/lovell.env` sonra `sudo systemctl restart lovell-anthology` |
| Hangi kaynak çalışıyor? | `curl -s "https://anthology.<ip>.sslip.io/api/all?tmdbId=1429&type=tv&title=Attack%20on%20Titan&imdb=tt2560140" \| python3 -m json.tool` → `providers` listesi |

- **Güncellemeler otomatik**: sunucu 10 dakikada bir GitHub'daki `main` dalına bakar; değişen servisleri yeniden başlatır.
- **Çökme**: systemd servisi 3 saniye içinde yeniden başlatır; 1,5 GB bellek sınırını aşan süreç de yeniden başlar.
- **Kendi alan adın** varsa (ör. `api.ornek.com`), DNS'te `anthology.api.ornek.com` ve `vidrock.api.ornek.com`'u sunucu
  IP'sine yönlendir ve betiği `curl … | sudo DOMAIN=api.ornek.com bash` şeklinde yeniden çalıştır.
- **Oracle hesabı boşta kalırsa**: Oracle, uzun süre neredeyse hiç işlemci kullanmayan Always Free sunucuları
  "boşta" sayıp durdurabiliyor. Site trafiği varken bu olmaz; olursa konsoldan **Start** demen yeterli.
