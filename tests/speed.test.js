import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashKey, profileRequest, resetProfileLimits} from '../lib/profiles.js';
import {expectedStats, parseResult, resetSpeedLimits, submitSpeed, listSpeedBoard} from '../lib/speed.js';

function memStore() {
  const box = {};
  return {
    get: async h => box[h] || null,
    put: async (h, v) => { box[h] = v; },
    del: async h => { delete box[h]; },
    listRecords: async () => Object.entries(box).filter(([, rec]) => rec?.updatedAt).map(([id, rec]) => ({id, rec})),
  };
}

function sample(over = {}) {
  const duration = over.duration ?? 30;
  const chars = over.chars ?? {correct: 200, incorrect: 8, extra: 2, missed: 4};
  const stats = expectedStats(chars, duration);
  return {duration, lang: over.lang ?? 'tr', wpm: stats.wpm, acc: stats.acc, raw: stats.raw, chars, ...over};
}

test('WPM hesabı Monkeytype birimini kullanır', () => {
  // 200 doğru karakter / 5 = 40 kelime; 30 sn = 0.5 dk → 80 WPM
  const s = expectedStats({correct: 200, incorrect: 8, extra: 2, missed: 4}, 30);
  assert.equal(s.wpm, 80);
  assert.equal(s.raw, 84);
  assert.equal(s.acc, 95);
});

test('uyuşmayan veya aşırı sonuç reddedilir', () => {
  assert.equal(parseResult(sample({wpm: 12})).error, 'Hız hesabı uyuşmuyor');
  assert.equal(parseResult(sample({duration: 12})).error, 'Süre 15, 30 veya 60 saniye olmalı');
  assert.equal(parseResult(sample({lang: 'de'})).error, 'Dil tr veya en olmalı');
  assert.match(parseResult(sample({chars: {correct: 3, incorrect: 0, extra: 0, missed: 0}})).error, /uzun değil/);
  assert.match(parseResult(sample({chars: {correct: 2000, incorrect: 0, extra: 0, missed: 0}})).error, /geçersiz/);
  assert.equal(parseResult(sample()).error, undefined);
  assert.equal(parseResult(sample()).result.wpm, 80);
});

test('anahtar sahiplerinin en iyisi sıralanır ve karşılaştırılır', async () => {
  resetProfileLimits();
  resetSpeedLimits();
  const store = memStore();
  const a = await profileRequest({method: 'POST', admin: true, body: {name: 'Ada'}, store, ip: 's1'});
  const b = await profileRequest({method: 'POST', admin: true, body: {name: 'Ege'}, store, ip: 's2'});
  const hashA = await hashKey(a.data.key);
  const hashB = await hashKey(b.data.key);
  const recA = await store.get(hashA);
  const recB = await store.get(hashB);

  const first = await submitSpeed({store, hash: hashA, rec: recA, body: sample(), ip: 's1'});
  assert.equal(first.status, 200);
  assert.equal(first.data.result.wpm, 80);
  assert.equal(first.data.me.rank, 1);
  assert.equal(first.data.me.name, 'Ada');
  assert.equal(first.data.board[0].you, true);

  const slower = sample({chars: {correct: 125, incorrect: 5, extra: 0, missed: 0}});
  const second = await submitSpeed({store, hash: hashB, rec: recB, body: slower, ip: 's2'});
  assert.equal(second.status, 200);
  assert.equal(second.data.me.rank, 2);
  assert.equal(second.data.board[0].name, 'Ada');
  assert.equal(second.data.board[1].name, 'Ege');
  assert.equal(second.data.board[1].you, true);

  const recA2 = await store.get(hashA);
  const faster = sample({chars: {correct: 250, incorrect: 4, extra: 1, missed: 0}});
  const again = await submitSpeed({store, hash: hashA, rec: recA2, body: faster, ip: 's1'});
  assert.equal(again.data.improved, true);
  assert.equal(again.data.best.wpm, 100);
  assert.equal(again.data.board[0].wpm, 100);
  assert.equal(again.data.me.rank, 1);

  const recA3 = await store.get(hashA);
  const worse = await submitSpeed({store, hash: hashA, rec: recA3, body: sample(), ip: 's1'});
  assert.equal(worse.data.improved, false);
  assert.equal(worse.data.best.wpm, 100);

  const boardEn = await listSpeedBoard({store, hash: hashA, duration: 30, lang: 'en'});
  assert.equal(boardEn.total, 0);

  const recA4 = await store.get(hashA);
  const saved = await profileRequest({
    method: 'PUT', key: a.data.key, store, ip: 's1',
    body: {base: recA4.updatedAt, name: 'Ada'},
  });
  assert.equal(saved.status, 200);
  const recKeep = await store.get(hashA);
  assert.equal(recKeep.speed.best.wpm, 100);
});
