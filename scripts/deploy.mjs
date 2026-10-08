// LOVELL'i Cloudflare Workers'a yayınlar: npm run yayinla
// 1) Sitenin herkese açık dosyalarını dist/ klasörüne kopyalar (sunucu kodu, .env, media/ kopyalanmaz).
// 2) Gerekirse Cloudflare girişini açar (tarayıcıda "Allow" demen yeterli).
// 3) Worker'ı yayınlar ve .env içindeki TMDB anahtarını Worker'a gizli değişken (secret) olarak yükler.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT} from '../lib/env.js';

const WRANGLER = ['--yes', 'wrangler@4'];
const run = (args, capture = false) => {
  const r = spawnSync('npx', [...WRANGLER, ...args], {cwd: ROOT, shell: process.platform === 'win32', stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8'});
  return {code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`};
};
const step = t => console.log(`\n\x1b[1m→ ${t}\x1b[0m`);

// 1) dist/
step('Site dosyaları hazırlanıyor');
const dist = path.join(ROOT, 'dist');
fs.rmSync(dist, {recursive: true, force: true});
const copy = rel => {
  const from = path.join(ROOT, rel), to = path.join(dist, rel);
  fs.mkdirSync(path.dirname(to), {recursive: true});
  fs.cpSync(from, to, {recursive: true});
};
['index.html', 'src/main.js', 'src/style.css', 'public'].forEach(copy);
console.log('  dist/ hazır');

// 2) Giriş
step('Cloudflare hesabı kontrol ediliyor');
const who = run(['whoami'], true);
if (who.code !== 0 || /not authenticated|not logged in|wrangler login/i.test(who.out)) {
  console.log('  Tarayıcıda Cloudflare giriş sayfası açılacak. "Allow" düğmesine bas, sonra buraya dön.');
  if (run(['login']).code !== 0) { console.error('\nGiriş tamamlanamadı. Komutu tekrar çalıştır.'); process.exit(1); }
} else {
  console.log('  ' + (who.out.match(/associated with the email ([^\s.]+@[^\s]+?)\.?\s/i)?.[1] || 'Giriş yapılmış'));
}

// 3) Yayın
step('Worker yayınlanıyor');
if (run(['deploy']).code !== 0) { console.error('\nYayın başarısız oldu. Yukarıdaki hata mesajına bak.'); process.exit(1); }

step('TMDB anahtarı Worker\'a gizli olarak yükleniyor');
const secrets = Object.fromEntries(
  ['TMDB_READ_TOKEN', 'TMDB_API_KEY', 'TMDB_FALLBACK_URL', 'CINEPRO_URL', 'VIDRIFT_BRAND', 'VIDRIFT_COLOR', 'VIDRIFT_LOGO']
    .map(k => [k, process.env[k]?.trim()])
    .filter(([, v]) => v)
);
if (!Object.keys(secrets).length) {
  console.log('  .env dosyasında TMDB anahtarı bulunamadı. Site AniList ile çalışır; anahtar ekleyip komutu tekrar çalıştırabilirsin.');
} else {
  const tmp = path.join(os.tmpdir(), `lovell-secrets-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify(secrets), {mode: 0o600});
  try { run(['secret', 'bulk', tmp]); } finally { fs.rmSync(tmp, {force: true}); }
}

console.log('\n\x1b[1mBitti.\x1b[0m Site adresi yukarıda "https://lovell.<hesap-adın>.workers.dev" olarak yazıyor.\n');
