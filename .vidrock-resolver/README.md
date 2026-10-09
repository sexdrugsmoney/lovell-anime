# VidRock Resolver

VidRock stream resolver servisi. Render.com'a deploy edilir.

## Deploy (Render.com)
1. Render.com → New Web Service
2. Public Git repo: https://github.com/sexdrugsmoney/lovell-anime
3. Root directory: `.vidrock-resolver`
4. Build command: `npm install`
5. Start command: `npm start`
6. Environment: `VIDROCK_KEY=<key>` (opsiyonel)

## API
GET /health
GET /api/resolve?type=movie&id=27205
GET /api/resolve?type=tv&id=1396&season=1&episode=1
