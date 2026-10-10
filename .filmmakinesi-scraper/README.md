# FilmMakinesi Scraper

curl-cffi tabanlı Cloudflare bypass scraper. Render.com'a Docker ile deploy edilir.

## Deploy (Render.com)
1. Render.com → New Web Service
2. **"Build and deploy from a Git repo"** seç
3. Repo: https://github.com/sexdrugsmoney/lovell-anime
4. Root directory: `.filmmakinesi-scraper`
5. Runtime: **Docker** (otomatik algılar Dockerfile'ı)
6. Plan: Free (512MB yeterli, headless browser yok)

## API
GET /health
GET /api/stream?tmdbId=27205&type=movie
GET /api/stream?tmdbId=1396&type=tv&season=1&episode=1
