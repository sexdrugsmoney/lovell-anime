// Node sunucusu yorum deposu: tek JSON dosyası, yazımlar sıraya alınır
// (aynı anda gelen iki yorum birbirinin üstüne yazılmaz).
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './env.js';

export function fileCommentStore(file = process.env.COMMENTS_FILE || path.join(ROOT, 'data', 'comments.json')) {
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
    get(target) { return run(() => read()[target] || null); },
    update(target, fn) {
      return run(async () => {
        const next = await fn(read()[target] || null);
        if (next) { mem[target] = next; write(); }
        return next;
      });
    },
  };
}
