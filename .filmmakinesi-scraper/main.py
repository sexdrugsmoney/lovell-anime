from fastapi import FastAPI, Query
from typing import Optional
import re
import base64
import urllib.parse
from bs4 import BeautifulSoup
from cachetools import TTLCache
from curl_cffi import requests as cffi_requests

app = FastAPI()

cache: TTLCache = TTLCache(maxsize=500, ttl=3600)

TMDB_KEY = "500330721680edb6d5f7f12ba7cd9023"
FM_BASE = "https://filmmakinesi.to"
CL_BASE = "https://closeload.filmmakinesi.to"


def to_slug(text: str) -> str:
    text = text.lower()
    tr_map = {"ğ": "g", "ü": "u", "ş": "s", "ı": "i", "ö": "o", "ç": "c",
              "Ğ": "g", "Ü": "u", "Ş": "s", "İ": "i", "Ö": "o", "Ç": "c"}
    for k, v in tr_map.items():
        text = text.replace(k, v)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def unpack_js(packed: str) -> str:
    try:
        match = re.search(
            r"eval\(function\(p,a,c,k,e,(?:d|r)\)\{.*?\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)",
            packed, re.DOTALL
        )
        if not match:
            return packed
        p_str, a_val = match.group(1), int(match.group(2))
        k_list = match.group(4).split("|")

        def e_func(c: int) -> str:
            r = "" if c < a_val else e_func(c // a_val)
            mod = c % a_val
            return r + (chr(mod + 29) if mod > 35 else str(mod) if mod < 10 else chr(mod + 87))

        for i in range(len(k_list) - 1, -1, -1):
            if k_list[i]:
                p_str = re.sub(r"\b" + re.escape(e_func(i)) + r"\b", k_list[i], p_str)
        return p_str
    except Exception:
        return packed


def closeload_decode(b64: str) -> Optional[str]:
    try:
        first = base64.b64decode(b64)
        reversed_bytes = bytes(reversed(first))
        second = base64.b64decode(reversed_bytes)
        parts = second.decode("utf-8").split("|")
        return parts[1] if len(parts) > 1 else None
    except Exception:
        return None


def make_session() -> cffi_requests.Session:
    s = cffi_requests.Session(impersonate="chrome131")
    return s


def bypass_cloudflare(session: cffi_requests.Session, url: str) -> Optional[cffi_requests.Response]:
    """İlk önce ana sayfayı ziyaret ederek Cloudflare cookie'lerini al, sonra hedef URL'ye git."""
    try:
        # Önce ana sayfayı ziyaret et — CF cookie al
        session.get(
            FM_BASE + "/",
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
                "Accept-Encoding": "gzip, deflate, br",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
            },
            timeout=20,
            allow_redirects=True,
        )
        import time
        time.sleep(1)
        # Şimdi hedef URL'ye git
        resp = session.get(
            url,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
                "Referer": FM_BASE + "/",
                "Upgrade-Insecure-Requests": "1",
            },
            timeout=20,
            allow_redirects=True,
        )
        return resp
    except Exception as e:
        return None


def find_video_id_in_html(html: str) -> Optional[str]:
    """HTML'den CloseLoad video ID çıkar."""
    patterns = [
        r"closeload\.filmmakinesi\.to/video/embed/([A-Za-z0-9]+)",
        r'data-video=[\'"]([A-Za-z0-9]{6,})[\'"]',
        r'"video_id"\s*:\s*"([A-Za-z0-9]{6,})"',
        r"embed/([A-Za-z0-9]{6,})/ah",
        r"videoId\s*=\s*['\"]([A-Za-z0-9]{6,})['\"]",
    ]
    for pat in patterns:
        m = re.search(pat, html)
        if m:
            return m.group(1)
    return None


@app.get("/health")
def health():
    return {"status": "ok", "service": "filmmakinesi-scraper", "scrapers": ["ddizi", "diziwatch"]}


@app.get("/api/stream")
def stream(
    tmdbId: str = Query(...),
    type: str = Query("movie"),
    season: str = Query("1"),
    episode: str = Query("1"),
):
    cache_key = f"{tmdbId}:{type}:{season}:{episode}"
    if cache_key in cache:
        return cache[cache_key]

    session = make_session()

    try:
        # 1. TMDB'den başlık + yıl al
        tmdb_url = f"https://api.themoviedb.org/3/{type}/{tmdbId}?api_key={TMDB_KEY}&language=tr-TR"
        tmdb_resp = session.get(tmdb_url, timeout=10)
        if not tmdb_resp.ok:
            return {"sources": [], "error": f"TMDB HTTP {tmdb_resp.status_code}"}
        tmdb_data = tmdb_resp.json()
        tr_title = tmdb_data.get("title") or tmdb_data.get("name") or ""
        orig_title = tmdb_data.get("original_title") or tmdb_data.get("original_name") or ""
        year = (tmdb_data.get("release_date") or tmdb_data.get("first_air_date") or "")[:4]

        video_id = None

        # 2a. Önce CF bypass — ana sayfayı ziyaret et
        bypass_cloudflare(session, FM_BASE + "/")

        # 2b. filmmakinesi.to'da arama yap
        for title in filter(None, [tr_title, orig_title]):
            try:
                import urllib.parse
                search_url = f"{FM_BASE}/?s={urllib.parse.quote(title)}"
                search_resp = session.get(
                    search_url,
                    headers={"Referer": FM_BASE + "/",
                             "Accept": "text/html,application/xhtml+xml",
                             "Accept-Language": "tr-TR,tr;q=0.9"},
                    timeout=15,
                )
                if search_resp.ok:
                    html = search_resp.text
                    film_links = re.findall(
                        r'href=[\'"](' + re.escape(FM_BASE) + r'/film/[^\'"]+)[\'"]', html
                    )
                    if not film_links:
                        rel_links = re.findall(r'href=[\'"](/film/[^\'"]+)[\'"]', html)
                        film_links = [FM_BASE + l for l in rel_links]
                    if film_links:
                        film_resp = session.get(
                            film_links[0],
                            headers={"Referer": search_url},
                            timeout=15,
                        )
                        if film_resp.ok:
                            video_id = find_video_id_in_html(film_resp.text)
                if video_id:
                    break
            except Exception:
                continue

        # 2b. Direkt slug tahmini ile dene
        if not video_id:
            for title in filter(None, [tr_title, orig_title]):
                slug = to_slug(title)
                if type == "movie":
                    # Format: /film/{slug}-izle-{yil}/  (fm ID olmadan da çalışabilir)
                    candidates = [
                        f"{FM_BASE}/film/{slug}-izle-{year}/",
                        f"{FM_BASE}/film/{slug}-izle/",
                        f"{FM_BASE}/film/{slug}/",
                    ]
                else:
                    candidates = [
                        f"{FM_BASE}/dizi/{slug}/sezon-{season}/bolum-{episode}",
                        f"{FM_BASE}/dizi/{slug}-izle/sezon-{season}/bolum-{episode}",
                    ]

                for url in candidates:
                    try:
                        resp = session.get(
                            url,
                            headers={"Referer": FM_BASE + "/"},
                            timeout=15,
                        )
                        if resp.ok and len(resp.text) > 500:
                            video_id = find_video_id_in_html(resp.text)
                            if video_id:
                                break
                    except Exception:
                        continue
                if video_id:
                    break

        if not video_id:
            result = {"sources": [], "error": "filmmakinesi video ID bulunamadi - slug eslesmesi yapılamadı"}
            return result

        # 3. CloseLoad embed sayfasını GET ile çek
        embed_url = f"{CL_BASE}/video/embed/{video_id}/ah/"
        embed_resp = session.get(
            embed_url,
            headers={
                "Referer": FM_BASE + "/",
                "sec-fetch-dest": "iframe",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "same-site",
            },
            timeout=15,
        )
        if not embed_resp.ok:
            result = {"sources": [], "error": f"CloseLoad GET HTTP {embed_resp.status_code}"}
            return result

        embed_html = embed_resp.text

        # 4. Hash çıkar
        hash_match = (
            re.search(r'var\s+\w+\s*=\s*[\'"]([a-f0-9]{32})[\'"]', embed_html, re.IGNORECASE)
            or re.search(r'[\'"]([a-f0-9]{32})[\'"]', embed_html)
        )
        if not hash_match:
            result = {"sources": [], "error": "CloseLoad hash bulunamadi"}
            return result
        hash_val = hash_match.group(1)

        # 5. POST at
        post_resp = session.post(
            embed_url,
            data=f"hash={hash_val}",
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Origin": CL_BASE,
                "Referer": embed_url,
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "same-origin",
                "sec-fetch-site": "same-origin",
            },
            timeout=15,
        )
        if not post_resp.ok:
            result = {"sources": [], "error": f"CloseLoad POST HTTP {post_resp.status_code}"}
            return result

        post_html = post_resp.text

        # 6. Packed JS unpack
        script_match = re.search(r"eval\(function\(p,a,c,k,e,(?:d|r)\)[\s\S]+?\)\)", post_html)
        if not script_match:
            # Direkt m3u8 arama
            m3u8_direct = re.search(r'[\'"]?(https?://[^\s\'"<>]+\.m3u8[^\s\'"<>]*)[\'"]?', post_html)
            if m3u8_direct:
                result = {"sources": [{"url": m3u8_direct.group(1), "quality": "1080p",
                          "name": "FilmMakinesi (TR Dublaj)", "type": "hls", "lang": "tr-dub"}]}
                cache[cache_key] = result
                return result
            result = {"sources": [], "error": "Packed JS bulunamadi"}
            return result

        unpacked = unpack_js(script_match.group(0))

        # 7. Base64 data → m3u8
        data_match = (
            re.search(r"return result\}[^(]*\([\"']([A-Za-z0-9+/=]{20,})[\"']\)", unpacked)
            or re.search(r"\([\"']([A-Za-z0-9+/=]{20,})[\"']\)", unpacked)
        )
        if not data_match:
            result = {"sources": [], "error": "Base64 data bulunamadi"}
            return result

        m3u8_url = closeload_decode(data_match.group(1))
        if not m3u8_url or not m3u8_url.startswith("http"):
            result = {"sources": [], "error": "m3u8 URL cikarilmadi"}
            return result

        result = {
            "sources": [{
                "url": m3u8_url,
                "quality": "1080p",
                "name": "FilmMakinesi (TR Dublaj)",
                "type": "hls",
                "lang": "tr-dub",
            }]
        }
        cache[cache_key] = result
        return result

    except Exception as ex:
        return {"sources": [], "error": str(ex)}


@app.get("/api/test-url")
def test_url(url: str = Query(...)):
    """Herhangi bir URL'yi curl-cffi ile çek ve ilk 2000 karakteri döndür (debug)."""
    try:
        session = make_session()
        resp = bypass_cloudflare(session, url)
        if not resp:
            return {"error": "bypass başarısız"}
        html = resp.text[:3000]
        video_id = find_video_id_in_html(resp.text)
        return {
            "status": resp.status_code,
            "video_id": video_id,
            "html_preview": html,
            "length": len(resp.text),
            "cf_cookies": [c.name for c in session.cookies],
        }
    except Exception as ex:
        return {"error": str(ex)}


DDIZI_BASE = "https://www.ddizi.tel"  # alan adı değişirse yalnızca burayı güncelle (eski: ddizi.im)
DDIZI_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"


def _ddizi_key(href: str):
    """Bölüm linkinden sıralama anahtarı: (sezon, bölüm) ya da yerli dizide (0, mutlak bölüm)."""
    m = re.search(r"-(\d+)-sezon-(\d+)-bolum", href)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    m = re.search(r"-(\d+)-bolum", href)
    return (0, int(m.group(1))) if m else None


@app.get("/api/ddizi")
def ddizi(
    tmdbId: str = Query(...),
    season: str = Query("1"),
    episode: str = Query("1"),
    title: str = Query(""),
    original: str = Query(""),
):
    cache_key = f"ddizi:{tmdbId}:{season}:{episode}"
    if cache_key in cache:
        return cache[cache_key]

    try:
        s, e = int(season), int(episode)
        # 1. TMDB'den TR + orijinal başlık ve sezon bölüm sayıları (yerli dizilerde mutlak bölüm no için)
        tmdb_data = {}
        try:
            r = cffi_requests.get(f"https://api.themoviedb.org/3/tv/{tmdbId}?api_key={TMDB_KEY}&language=tr-TR", timeout=8)
            if r.ok:
                tmdb_data = r.json()
        except Exception:
            pass
        names = [n for n in dict.fromkeys([tmdb_data.get("name"), tmdb_data.get("original_name"), title, original]) if n]
        if not names:
            return {"sources": [], "error": "TMDB başlık bulunamadı"}

        session = cffi_requests.Session(impersonate="chrome131")
        headers = {"User-Agent": DDIZI_UA, "Referer": DDIZI_BASE + "/", "Accept-Language": "tr-TR,tr;q=0.9"}

        # 2. Arama: POST /arama/ (arama=...). Türkçe karakterler eşleşmiyor → ASCII'ye çevrilerek aranır.
        # Dizi linkleri "/diziler/{id}/{ad}-hd15" / "{ad}-67" / "{ad}-son-bolum-izle" biçiminde; ad tam eşleşmeli.
        def show_key(slug: str) -> str:
            slug = re.sub(r"-son-bolum-izle$", "", slug)
            slug = re.sub(r"-hd\d*$", "", slug)
            slug = re.sub(r"-\d+$", "", slug)
            return slug
        want = {to_slug(n) for n in names}
        show_url = None
        for q in names[:3]:
            resp = session.post(f"{DDIZI_BASE}/arama/", data={"arama": to_slug(q).replace("-", " ")}, headers=headers, timeout=12)
            if not resp.ok:
                continue
            for href, slug in re.findall(r'href="(https?://[^"]+/diziler/\d+/([a-z0-9-]+))"', resp.text):
                if show_key(slug) in want:
                    show_url = href
                    break
            if show_url:
                break
        if not show_url:
            return {"sources": [], "error": "DDizi dizi sayfası bulunamadı"}

        # 3. Bölüm listesi sayfalı (sayfa-0 en yeni, en büyük sayfa en eski) → ikili arama.
        # Kenar çubuğundaki diğer dizilerin "son bölüm" linkleri ad önekiyle ayıklanır.
        slug_word = show_key(show_url.rstrip("/").split("/")[-1])

        def page_eps(p: int):
            pr = session.get(f"{show_url}/sayfa-{p}", headers=headers, timeout=12)
            html = pr.text if pr.ok else ""
            eps = []
            for h in dict.fromkeys(re.findall(r'href="(https?://[^"]+/izle/\d+/[^"]+\.htm)"', html)):
                k = _ddizi_key(h)
                if k and f"/{slug_word}-" in h:
                    eps.append((k, h))
            return html, eps

        first_html, first_eps = page_eps(0)
        last_page = max([int(x) for x in re.findall(r"/sayfa-(\d+)", first_html)] or [0])
        yerli = bool(first_eps) and all(k[0] == 0 for k, _ in first_eps)
        if yerli:
            target = e
            if s > 1:
                seasons = [x for x in tmdb_data.get("seasons", []) if 0 < x.get("season_number", 0) < s]
                if not seasons:
                    return {"sources": [], "error": "DDizi mutlak bölüm no hesaplanamadı"}
                target = sum(x.get("episode_count", 0) for x in seasons) + e
            target = (0, target)
        else:
            target = (s, e)

        ep_url = None
        lo, hi, cache_pages = 0, last_page, {0: first_eps}
        for _ in range(8):
            if lo > hi:
                break
            mid = (lo + hi) // 2
            eps = cache_pages.get(mid)
            if eps is None:
                eps = page_eps(mid)[1]
                cache_pages[mid] = eps
            if not eps:
                break
            hit = next((h for k, h in eps if k == target), None)
            if hit:
                ep_url = hit
                break
            keys = [k for k, _ in eps]
            if target > max(keys):
                hi = mid - 1
            elif target < min(keys):
                lo = mid + 1
            else:
                break
        if not ep_url:
            return {"sources": [], "error": "DDizi bölüm bulunamadı"}

        # 4. Bölüm sayfası → /player/oynat/{hash} → jwplayer sources (çoğunlukla Yandex Disk MP4)
        ep_resp = session.get(ep_url, headers={**headers, "Referer": show_url}, timeout=12)
        if not ep_resp.ok:
            return {"sources": [], "error": f"DDizi bölüm sayfası HTTP {ep_resp.status_code}"}
        ep_html = ep_resp.text
        if re.search(r"kaldirilmistir|telif", ep_html, re.IGNORECASE) and "player/oynat" not in ep_html:
            return {"sources": [], "error": "DDizi bölüm telif nedeniyle kaldırılmış"}
        m = re.search(r'<iframe[^>]+src=[\'"]([^\'"]*player/[^\'"]+)[\'"]', ep_html, re.IGNORECASE) \
            or re.search(r'og:video"\s+content="([^"]+)"', ep_html)
        if not m:
            return {"sources": [], "error": "DDizi oynatıcı bulunamadı"}
        iframe_src = urllib.parse.urljoin(DDIZI_BASE + "/", m.group(1))
        desc = (re.search(r'name="DESCRIPTION"\s+CONTENT="([^"]*)"', ep_html, re.IGNORECASE) or [None, ""])[1]
        # Yerli dizi zaten Türkçe sesli; yabancılarda açıklamada "Dublaj" geçiyorsa Türkçe dublaj
        lang = "tr-dub" if yerli or re.search(r"dublaj", desc, re.IGNORECASE) else "tr"

        pl = session.get(iframe_src, headers={"User-Agent": DDIZI_UA, "Referer": ep_url}, timeout=12)
        if not pl.ok:
            return {"sources": [], "error": f"DDizi oynatıcı HTTP {pl.status_code}"}
        files = re.findall(r'file\s*:\s*[\'"](https?://[^\'"]+)[\'"]\s*,\s*label\s*:\s*[\'"]([^\'"]*)[\'"]', pl.text) \
            or [(u, "Auto") for u in re.findall(r'[\'"](https?://[^\'"]+\.m3u8[^\'"]*)[\'"]', pl.text)]
        sources = []
        for url, label in files:
            if re.search(r"\.(vtt|srt|jpg|png)(\?|$)", url, re.IGNORECASE):
                continue
            hls = ".m3u8" in url.lower()
            name = "DDizi (TR Dublaj)" if lang == "tr-dub" and not yerli else "DDizi (Türkçe)" if yerli else "DDizi (TR Altyazı)"
            sources.append({"url": url, "quality": label if re.search(r"\d{3,4}p", label) else "1080p", "name": name, "type": "hls" if hls else "mp4", "lang": lang})
        if not sources:
            return {"sources": [], "error": "DDizi video bulunamadı"}
        result = {"sources": sources[:3]}
        # Yandex bağlantıları süreli → kısa önbellek
        cache[cache_key] = result
        return result

    except Exception as ex:
        return {"sources": [], "error": str(ex)}


DIZIWATCH_BASE = "https://diziwatch.ac"


@app.get("/api/diziwatch")
def diziwatch(
    tmdbId: str = Query(...),
    season: str = Query("1"),
    episode: str = Query("1"),
):
    cache_key = f"diziwatch:{tmdbId}:{season}:{episode}"
    if cache_key in cache:
        return cache[cache_key]

    try:
        # 1. TMDB'den başlık + external IDs al
        tmdb_resp = cffi_requests.Session(impersonate="chrome131").get(
            f"https://api.themoviedb.org/3/tv/{tmdbId}?api_key={TMDB_KEY}&language=tr-TR&append_to_response=external_ids",
            timeout=10,
        )
        if not tmdb_resp.ok:
            return {"sources": [], "error": f"TMDB HTTP {tmdb_resp.status_code}"}
        tmdb_data = tmdb_resp.json()
        tr_title = tmdb_data.get("name") or ""
        orig_title = tmdb_data.get("original_name") or ""
        imdb_id = (tmdb_data.get("external_ids") or {}).get("imdb_id") or ""

        search_title = tr_title or orig_title
        if not search_title:
            return {"sources": [], "error": "TMDB başlık bulunamadı"}

        session = cffi_requests.Session(impersonate="chrome131")
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
            "Referer": DIZIWATCH_BASE + "/",
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded",
        }

        # 2. DiziWatch arama
        search_resp = session.post(
            f"{DIZIWATCH_BASE}/bg/searchcontent",
            data=f"searchterm={urllib.parse.quote(search_title)}",
            headers=headers,
            timeout=15,
        )
        if not search_resp.ok:
            return {"sources": [], "error": f"DiziWatch arama HTTP {search_resp.status_code}"}

        search_data = search_resp.json()
        results = search_data.get("data", {}).get("result", [])
        if not results:
            return {"sources": [], "error": "DiziWatch sonuç bulunamadı"}

        # 3. IMDB ID veya başlık ile eşleştir
        match = None
        if imdb_id:
            match = next((r for r in results if r.get("object_related_imdb_id") == imdb_id), None)
        if not match:
            q_low = search_title.lower().strip()
            match = next(
                (r for r in results if q_low in (r.get("object_name") or "").lower()),
                results[0] if results else None,
            )
        if not match:
            return {"sources": [], "error": "DiziWatch eşleşme bulunamadı"}

        slug = match.get("used_slug")
        if not slug:
            return {"sources": [], "error": "DiziWatch slug bulunamadı"}

        # 4. Bölüm URL
        s = int(season)
        e = int(episode)
        ep_url = f"{DIZIWATCH_BASE}/dizi/{slug}/sezon-{s}/bolum-{e}"

        ep_resp = session.get(
            ep_url,
            headers={"User-Agent": headers["User-Agent"], "Referer": DIZIWATCH_BASE + "/"},
            timeout=15,
        )
        if not ep_resp.ok:
            return {"sources": [], "error": f"DiziWatch bölüm sayfası HTTP {ep_resp.status_code}"}
        ep_html = ep_resp.text

        # 5. iframe src çıkar (#cstk içindeki veya .embed-responsive iframe)
        ep_soup = BeautifulSoup(ep_html, "html.parser")
        iframe = (
            ep_soup.select_one("#cstk iframe")
            or ep_soup.select_one(".embed-responsive iframe")
            or ep_soup.find("iframe", src=True)
            or ep_soup.find("iframe", attrs={"data-src": True})
        )
        iframe_src = None
        if iframe:
            iframe_src = iframe.get("src") or iframe.get("data-src")
        if not iframe_src:
            m = re.search(r'<iframe[^>]+(?:src|data-src)=[\'"]([^\'"]+)[\'"]', ep_html, re.IGNORECASE)
            if m:
                iframe_src = m.group(1)
        if not iframe_src:
            return {"sources": [], "error": "DiziWatch iframe bulunamadı"}

        if iframe_src.startswith("//"):
            iframe_src = "https:" + iframe_src

        # 6. iframe'i çek (Pichive player) → m3u8
        player_resp = session.get(
            iframe_src,
            headers={"User-Agent": headers["User-Agent"], "Referer": ep_url},
            timeout=15,
        )
        if not player_resp.ok:
            return {"sources": [], "error": f"DiziWatch player HTTP {player_resp.status_code}"}
        player_html = player_resp.text

        m3u8_match = (
            re.search(r'file\s*:\s*[\'\"](https?://[^\'"]+\.m3u8[^\'"]*)[\'"]', player_html, re.IGNORECASE)
            or re.search(r'[\'"](https?://[^\'"]+\.m3u8[^\'"]*)[\'"]', player_html, re.IGNORECASE)
        )
        if m3u8_match:
            url = m3u8_match.group(1).strip()
            result = {"sources": [{"url": url, "quality": "1080p", "name": "DiziWatch", "type": "hls"}]}
            cache[cache_key] = result
            return result

        # m3u8 bulunamazsa iframe URL'yi döndür
        result = {"sources": [{"url": iframe_src, "quality": "1080p", "name": "DiziWatch", "type": "hls"}]}
        cache[cache_key] = result
        return result

    except Exception as ex:
        return {"sources": [], "error": str(ex)}
