// Node sunucusu profil deposu. Ham anahtar yazılmaz, yalnızca özeti.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './env.js';
import {profileSummary} from './profiles.js';

export function fileProfileStore(file = process.env.PROFILES_FILE || path.join(ROOT, 'data', 'profiles.json')) {
  let mem = null;
  let chain = Promise.resolve();
  const read = () => {
    if (mem) return mem;
    try { mem = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { mem = {}; }
    if (!mem || typeof mem !== 'object' || Array.isArray(mem)) mem = {};
    return mem;
  };
  const write = () => {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(mem));
    fs.renameSync(tmp, file);
  };
  const run = fn => {
    const job = chain.then(fn, fn);
    chain = job.then(() => {}, () => {});
    return job;
  };
  return {
    get(hash) { return run(() => read()[hash] || null); },
    put(hash, value) { return run(() => { read()[hash] = value; write(); }); },
    del(hash) { return run(() => { if (!read()[hash]) return; delete mem[hash]; write(); }); },
    list() {
      return run(() => Object.entries(read())
        .filter(([, rec]) => rec?.updatedAt)
        .map(([id, rec]) => profileSummary(id, rec))
        .sort((a, b) => b.createdAt - a.createdAt));
    },
    listRecords() {
      return run(() => Object.entries(read())
        .filter(([, rec]) => rec?.updatedAt)
        .map(([id, rec]) => ({id, rec})));
    },
  };
}
