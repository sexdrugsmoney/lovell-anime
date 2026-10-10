# Anthology Scraper

Türkçe anime/film kaynakları için scraper servisi. Render.com'a deploy edilir.

## Deploy
1. Render.com → New Web Service
2. Public repo: https://github.com/sexdrugsmoney/lovell-anime  
3. Root directory: `.anthology-scraper`
4. Build: `npm install`
5. Start: `npm start`
6. Ortam değişkeni gerekmez.

## API
GET /health
GET /api/animecix?tmdbId=21&season=1&episode=1
GET /api/anizium?tmdbId=21&season=1&episode=1
GET /api/sonanime?tmdbId=21&season=1&episode=1
GET /api/all?tmdbId=21&type=tv&season=1&episode=1
