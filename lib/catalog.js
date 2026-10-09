// Node sunucusu için veri katmanı: ortak çekirdeği yerel ağ ve dosyalarla yapılandırır.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './env.js';
import {tmdbJson} from './net.js';
import {configure} from './catalog-core.js';

configure({
  tmdbJson,
  offlineEpisodes: JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/offline-episodes.json'), 'utf8')),
  region: process.env.WATCH_REGION || 'TR',
});

export {browse, search, home, detail, episodes, GENRES, genresFor, dataErrors} from './catalog-core.js';
