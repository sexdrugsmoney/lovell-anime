from fastapi import FastAPI, Query
from typing import Optional
import re
import base64
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
    return cffi_requests.Session(impersonate="chrome124")


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
    return {"status": "ok", "service": "filmmakinesi-scraper"}


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

        # 2a. filmmakinesi.to ana sayfasında arama yap
        # URL pattern: /film/{slug}-izle-{yil}-fm{id}/
        # Arama: https://filmmakinesi.to/?s={query}
        for title in filter(None, [tr_title, orig_title]):
            try:
                search_url = f"{FM_BASE}/?s={cffi_requests.utils.quote(title)}"
                search_resp = session.get(
                    search_url,
                    headers={"Referer": FM_BASE + "/"},
                    timeout=15,
                )
                if search_resp.ok:
                    html = search_resp.text
                    # Film linklerini bul: /film/xxx-fm123/
                    film_links = re.findall(
                        r'href=[\'"](' + re.escape(FM_BASE) + r'/film/[^\'"]+)[\'"]',
                        html
                    )
                    if not film_links:
                        film_links = re.findall(r'href=[\'"](/film/[^\'"]+)[\'"]', html)
                        film_links = [FM_BASE + l for l in film_links]

                    if film_links:
                        # İlk eşleşen linke git
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
        resp = session.get(url, headers={"Referer": FM_BASE + "/"}, timeout=15)
        html = resp.text[:2000]
        video_id = find_video_id_in_html(resp.text)
        return {
            "status": resp.status_code,
            "video_id": video_id,
            "html_preview": html,
            "length": len(resp.text),
        }
    except Exception as ex:
        return {"error": str(ex)}
