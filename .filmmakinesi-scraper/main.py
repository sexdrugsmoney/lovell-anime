from fastapi import FastAPI, Query
from typing import Optional
import re
import base64
from cachetools import TTLCache
from curl_cffi import requests as cffi_requests

app = FastAPI()

cache: TTLCache = TTLCache(maxsize=500, ttl=3600)

TMDB_KEY = "500330721680edb6d5f7f12ba7cd9023"


def to_slug(text: str) -> str:
    text = text.lower()
    text = text.replace("ğ", "g").replace("ü", "u").replace("ş", "s")
    text = text.replace("ı", "i").replace("ö", "o").replace("ç", "c")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return text


def unpack_js(packed: str) -> str:
    """p,a,c,k,e,d JS unpacker."""
    try:
        match = re.search(
            r"eval\(function\(p,a,c,k,e,(?:d|r)\)\{.*?\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)",
            packed, re.DOTALL
        )
        if not match:
            return packed
        p_str = match.group(1)
        a_val = int(match.group(2))
        k_list = match.group(4).split("|")

        def e_func(c: int) -> str:
            return ("" if c < a_val else e_func(c // a_val)) + (
                chr(c % a_val + 29) if c % a_val > 35 else str(c % a_val) if c % a_val < 10 else chr(c % a_val + 87)
            )

        for i in range(len(k_list) - 1, -1, -1):
            if k_list[i]:
                p_str = re.sub(r"\b" + re.escape(e_func(i)) + r"\b", k_list[i], p_str)
        return p_str
    except Exception:
        return packed


def closeload_decode(b64: str) -> Optional[str]:
    """Base64 double decode: decode -> reverse bytes -> decode -> split('|')[1]."""
    try:
        first = base64.b64decode(b64)
        reversed_bytes = bytes(reversed(first))
        second = base64.b64decode(reversed_bytes)
        parts = second.decode("utf-8").split("|")
        return parts[1] if len(parts) > 1 else None
    except Exception:
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

    session = cffi_requests.Session(impersonate="chrome124")

    try:
        # 1. TMDB'den başlık al
        tmdb_url = f"https://api.themoviedb.org/3/{type}/{tmdbId}?api_key={TMDB_KEY}&language=tr-TR"
        tmdb_resp = session.get(tmdb_url, timeout=10)
        if not tmdb_resp.ok:
            return {"sources": [], "error": f"TMDB HTTP {tmdb_resp.status_code}"}
        tmdb_data = tmdb_resp.json()
        tr_title = tmdb_data.get("title") or tmdb_data.get("name") or ""
        orig_title = tmdb_data.get("original_title") or tmdb_data.get("original_name") or ""
        year = ""
        if tmdb_data.get("release_date"):
            year = tmdb_data["release_date"][:4]
        elif tmdb_data.get("first_air_date"):
            year = tmdb_data["first_air_date"][:4]

        # 2. filmmakinesi.to API veya slug ile video ID bul
        video_id = None

        # 2a. lema/v1 API dene
        if type == "movie":
            api_url = f"https://filmmakinesi.to/lema/v1/search?tmdb={tmdbId}&type=movie"
        else:
            api_url = f"https://filmmakinesi.to/lema/v1/search?tmdb={tmdbId}&type=tv&season={season}&episode={episode}"

        try:
            api_resp = session.get(
                api_url,
                headers={"Referer": "https://filmmakinesi.to/", "Accept": "application/json"},
                timeout=10,
            )
            if api_resp.ok:
                api_data = api_resp.json()
                video_id = (
                    api_data.get("closeload_id")
                    or api_data.get("video_id")
                    or api_data.get("embed_id")
                    or (api_data.get("data", [{}])[0].get("closeload_id") if isinstance(api_data.get("data"), list) and api_data.get("data") else None)
                    or (api_data.get("results", [{}])[0].get("closeload_id") if isinstance(api_data.get("results"), list) and api_data.get("results") else None)
                )
        except Exception:
            pass

        # 2b. Slug ile film sayfasından ID çıkar
        if not video_id:
            for title in ([tr_title, orig_title] if tr_title else [orig_title]):
                if not title:
                    continue
                slug = to_slug(title)
                if type == "movie":
                    page_url = f"https://filmmakinesi.to/film/{slug}-izle-{year}/" if year else f"https://filmmakinesi.to/film/{slug}-izle/"
                else:
                    page_url = f"https://filmmakinesi.to/dizi/{slug}/sezon-{season}/bolum-{episode}"

                try:
                    page_resp = session.get(
                        page_url,
                        headers={"Referer": "https://filmmakinesi.to/"},
                        timeout=15,
                    )
                    if not page_resp.ok:
                        continue
                    html = page_resp.text

                    patterns = [
                        r"closeload\.filmmakinesi\.to/video/embed/([A-Za-z0-9]+)",
                        r'data-video=[\'"]([A-Za-z0-9]+)[\'"]',
                        r"videoId.*?([A-Za-z0-9]{8,})",
                    ]
                    for pat in patterns:
                        m = re.search(pat, html)
                        if m:
                            video_id = m.group(1)
                            break
                    if video_id:
                        break
                except Exception:
                    continue

        if not video_id:
            result = {"sources": [], "error": "filmmakinesi video ID bulunamadi"}
            cache[cache_key] = result
            return result

        # 3. CloseLoad embed sayfasını GET ile çek
        embed_url = f"https://closeload.filmmakinesi.to/video/embed/{video_id}/ah/"
        embed_resp = session.get(
            embed_url,
            headers={
                "Referer": "https://filmmakinesi.to/",
                "sec-fetch-dest": "iframe",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "same-site",
            },
            timeout=15,
        )
        if not embed_resp.ok:
            result = {"sources": [], "error": f"CloseLoad GET HTTP {embed_resp.status_code}"}
            cache[cache_key] = result
            return result

        embed_html = embed_resp.text

        # 4. Hash çıkar
        hash_match = (
            re.search(r'var\s+\w+\s*=\s*[\'"]([a-f0-9]{32})[\'"]', embed_html, re.IGNORECASE)
            or re.search(r'hash[\'\":\s]+[\'"]([a-f0-9]{32})[\'"]', embed_html, re.IGNORECASE)
            or re.search(r'[\'"]([a-f0-9]{32})[\'"]', embed_html)
        )
        if not hash_match:
            result = {"sources": [], "error": "CloseLoad hash bulunamadi"}
            cache[cache_key] = result
            return result
        hash_val = hash_match.group(1)

        # 5. POST at
        post_resp = session.post(
            embed_url,
            data=f"hash={hash_val}",
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Origin": "https://closeload.filmmakinesi.to",
                "Referer": embed_url,
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "same-origin",
                "sec-fetch-site": "same-origin",
            },
            timeout=15,
        )
        if not post_resp.ok:
            result = {"sources": [], "error": f"CloseLoad POST HTTP {post_resp.status_code}"}
            cache[cache_key] = result
            return result

        post_html = post_resp.text

        # 6. Packed JS bul ve unpack et
        script_match = re.search(r"eval\(function\(p,a,c,k,e,(?:d|r)\)[\s\S]+?\)\)", post_html)
        if not script_match:
            result = {"sources": [], "error": "Packed JS bulunamadi"}
            cache[cache_key] = result
            return result

        unpacked = unpack_js(script_match.group(0))

        # 7. Base64 data çıkar ve decode et
        data_match = (
            re.search(r"return result\}[^(]*\([\"']([A-Za-z0-9+/=]+)[\"']\)", unpacked)
            or re.search(r"[\"']((?:[A-Za-z0-9+/]{4}){8,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)[\"']", unpacked)
        )
        if not data_match:
            result = {"sources": [], "error": "Base64 data bulunamadi"}
            cache[cache_key] = result
            return result

        m3u8_url = closeload_decode(data_match.group(1))
        if not m3u8_url or not m3u8_url.startswith("http"):
            result = {"sources": [], "error": "m3u8 URL cikarilmadi"}
            cache[cache_key] = result
            return result

        result = {
            "sources": [
                {
                    "url": m3u8_url,
                    "quality": "1080p",
                    "name": "FilmMakinesi (TR Dublaj)",
                    "type": "hls",
                    "lang": "tr-dub",
                }
            ]
        }
        cache[cache_key] = result
        return result

    except Exception as ex:
        return {"sources": [], "error": str(ex)}
