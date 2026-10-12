// Türkçe fansub arşivi dizini: GenesisAnime (MIT) veri setinden AniList id → kayıt adı eşlemesini üretir.
// Bölüm ve bağlantı verisinin kendisi depoya alınmaz; oynatma anında jsDelivr CDN'den kayıt başına (~8 KB) çekilir.
//
// Kullanım: node scripts/build-tr-archive.mjs [GenesisAnime-site klasörü]
//   Klasör verilmezse depo sığ olarak (yalnızca public/data/anime) geçici bir klasöre indirilir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const REPO = 'https://github.com/GenesisAnime/GenesisAnime-site.git';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/tr-archive-index.js');

let dir = process.argv[2];
let tmp = null;
if (!dir) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-'));
  const git = (...a) => execFileSync('git', a, {cwd: tmp, stdio: ['ignore', 'ignore', 'inherit']});
  git('init', '-q');
  git('remote', 'add', 'origin', REPO);
  git('config', 'core.sparseCheckout', 'true');
  fs.writeFileSync(path.join(tmp, '.git/info/sparse-checkout'), 'public/data/anime/\n');
  git('fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', 'main');
  git('checkout', '-q', 'FETCH_HEAD');
  dir = tmp;
}
const commit = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: dir}).toString().trim(); } catch { return null; } })();
const animeDir = path.join(dir, 'public/data/anime');

// Aynı AniList kaydına birden fazla dosya düşerse en çok bölümü olanı al.
const best = new Map();
let files = 0;
for (const f of fs.readdirSync(animeDir)) {
  if (!f.endsWith('.json')) continue;
  files++;
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(animeDir, f), 'utf8')); } catch { continue; }
  const al = Number(d.anilist);
  if (!al || !d.slug || !/^[a-z0-9-]+$/.test(d.slug)) continue;
  const eps = (d.bolumler || []).filter(b => (b.src || []).length).length;
  if (!eps) continue;
  const prev = best.get(al);
  if (!prev || eps > prev.eps) best.set(al, {slug: d.slug, eps});
}
const map = Object.fromEntries([...best.entries()].sort((a, b) => a[0] - b[0]).map(([al, v]) => [al, v.slug]));
const out = {source: 'GenesisAnime/GenesisAnime-site (MIT)', commit, built: new Date().toISOString().slice(0, 10), count: best.size, map};
fs.mkdirSync(path.dirname(OUT), {recursive: true});
fs.writeFileSync(OUT, `// Otomatik üretilir: node scripts/build-tr-archive.mjs — elle düzenleme.\nexport default ${JSON.stringify(out)};\n`);
console.log(`${files} dosya tarandı, ${best.size} anime dizine alındı → ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
if (tmp) fs.rmSync(tmp, {recursive: true, force: true});
