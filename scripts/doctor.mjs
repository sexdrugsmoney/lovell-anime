// Bağlantı teşhisi: npm run doctor
import '../lib/env.js';
import {probeAll, tmdbAuth} from '../lib/net.js';

console.log('\nLOVELL bağlantı testi\n');
const auth = tmdbAuth();
console.log('Kimlik doğrulama:', process.env.TMDB_READ_TOKEN ? 'TMDB_READ_TOKEN (v4)' : process.env.TMDB_API_KEY ? 'TMDB_API_KEY (.env)' : 'projedeki varsayılan anahtar', auth.key ? '' : '');
if (process.env.TMDB_PROXY_URL) console.log('Vekil:', process.env.TMDB_PROXY_URL);
console.log('');

const results = await probeAll();
for (const r of results) {
  const mark = r.ok ? (r.status === 200 ? 'TAMAM ' : `HTTP ${r.status}`) : 'HATA  ';
  console.log(`${mark}  ${r.group === 'api' ? 'Veri  ' : 'Görsel'}  ${r.route.padEnd(48)} ${String(r.ms).padStart(5)} ms${r.error ? '  ' + r.error : ''}`);
}
const api = results.filter(r => r.group === 'api');
const ok = api.find(r => r.ok && r.status === 200);
const unauthorized = api.find(r => r.status === 401);
console.log('');
if (ok) console.log(`Sonuç: TMDB çalışıyor. Site otomatik olarak "${ok.route}" yolunu kullanacak.`);
else if (unauthorized) console.log('Sonuç: TMDB\'ye ulaşılıyor ama API anahtarı reddedildi. .env dosyasına kendi TMDB_API_KEY veya TMDB_READ_TOKEN değerini yaz.');
else console.log('Sonuç: TMDB\'ye hiçbir yoldan ulaşılamadı. Site AniList ile çalışmaya devam eder. Kalıcı çözüm için README\'deki "Cloudflare Worker vekili" adımlarına bak.');

try {
  const r = await fetch('https://graphql.anilist.co', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({query: '{Media(id:1){id}}'}), signal: AbortSignal.timeout(6000)});
  console.log(`AniList (yedek kaynak): ${r.ok ? 'çalışıyor' : 'HTTP ' + r.status}`);
} catch (e) { console.log('AniList (yedek kaynak): ulaşılamadı -', e.message); }
console.log('');
