import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {cleanList, cleanPrefs, normalizeKey, profileRequest, resetProfileLimits} from '../lib/profiles.js';
import {fileProfileStore} from '../lib/profile-store.js';

test('görünüm tercihleri temizlenir', () => {
  const p = cleanPrefs({theme: 'kitty', accent: '#ff5aa5', wall: 'https://cdn.example/a.jpg', extra: 1});
  assert.equal(p.theme, 'kitty');
  assert.equal(p.accent, '#ff5aa5');
  assert.equal(p.wall, 'https://cdn.example/a.jpg');
  assert.equal(cleanPrefs({theme: 'hack', accent: 'red', wall: 'javascript:alert(1)'}).theme, '');
});

test('anahtar biçimi ve liste temizliği', () => {
  assert.equal(normalizeKey(' abcd-efgh-jklm-npqr-stuv '), 'ABCD-EFGH-JKLM-NPQR-STUV');
  assert.equal(normalizeKey('aaaa-aaaa-aaaa-aaaa-aaaa'), 'AAAA-AAAA-AAAA-AAAA-AAAA');
  assert.equal(normalizeKey('IIII-IIII-IIII-IIII-IIII'), null);
  assert.equal(normalizeKey('AAAA-AAAA-AAAA-AAAA-AAA0'), null);
  const list = cleanList([
    {kind: 'tv', id: '12', title: '  Bir Anime  ', poster: 'javascript:alert(1)', section: 'nope', score: 99},
    {kind: 'tv', id: '12', title: 'kopya'},
    {kind: 'hack', id: '1', title: 'yok'},
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Bir Anime');
  assert.equal(list[0].poster, '');
  assert.equal(list[0].section, 'anime');
  assert.equal(list[0].score, 10);
});

test('dosyadaki profil çakışınca birleşmek için 409 döner', async () => {
  resetProfileLimits();
  const file = path.join(os.tmpdir(), `lovell-profiles-${Date.now()}.json`);
  const store = fileProfileStore(file);
  assert.equal((await profileRequest({method: 'POST', body: {name: 'Kimse'}, store, ip: 'unit-a'})).status, 404);
  const created = await profileRequest({method: 'POST', admin: true, body: {name: '   ', list: []}, store, ip: 'unit-a'});
  assert.equal(created.status, 201);
  assert.equal(created.data.profile.name, 'İzleyici');
  const key = created.data.key;
  const first = await profileRequest({method: 'GET', key, store, ip: 'unit-a'});
  const clash = await profileRequest({method: 'PUT', key, body: {base: 0, list: []}, store, ip: 'unit-a'});
  assert.equal(clash.status, 409);
  assert.equal(clash.data.profile.updatedAt, first.data.updatedAt);
  const saved = await profileRequest({
    method: 'PUT', key, store, ip: 'unit-a',
    body: {base: first.data.updatedAt, name: 'Ada', list: [{kind: 'movie', id: '3', title: 'Film'}], progress: {'tv:1:1:1': {t: 5, d: 10, at: 1}}, recent: {}},
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.name, 'Ada');
  assert.equal(saved.data.avatar, '');
  assert.equal(saved.data.list[0].kind, 'movie');
  assert.equal(saved.data.progress['tv:1:1:1'].t, 5);
  const tiny = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const rejected = await profileRequest({
    method: 'PUT', key, store, ip: 'unit-a',
    body: {base: saved.data.updatedAt, avatar: 'javascript:alert(1)', color: 99},
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.avatar, '');
  assert.equal(rejected.data.color, saved.data.color);
  const photo = await profileRequest({
    method: 'PUT', key, store, ip: 'unit-a',
    body: {base: rejected.data.updatedAt, avatar: tiny, color: 3},
  });
  assert.equal(photo.data.avatar, tiny);
  assert.equal(photo.data.color, 3);
  const again = await profileRequest({
    method: 'PUT', key, store, ip: 'unit-a',
    body: {base: photo.data.updatedAt, avatar: 'data:image/svg+xml;base64,PHN2Zy8+', color: 3.5},
  });
  assert.equal(again.data.avatar, tiny);
  assert.equal(again.data.color, 3);
  const huge = 'data:image/png;base64,' + 'A'.repeat(100001);
  const dropped = await profileRequest({
    method: 'PUT', key, store, ip: 'unit-a',
    body: {base: again.data.updatedAt, avatar: huge},
  });
  assert.equal(dropped.data.avatar, tiny);
  const cleared = await profileRequest({
    method: 'PUT', key, store, ip: 'unit-a',
    body: {base: dropped.data.updatedAt, avatar: '', color: 0},
  });
  assert.equal(cleared.data.avatar, '');
  assert.equal(cleared.data.color, 0);
  const disk = fs.readFileSync(file, 'utf8');
  assert.equal(disk.includes(tiny), false);
  assert.equal(fs.readFileSync(file, 'utf8').includes(key), false);
  assert.equal((await profileRequest({method: 'DELETE', key, store, ip: 'unit-a'})).status, 404);
  const gone = await profileRequest({method: 'DELETE', admin: true, key, store, ip: 'unit-a'});
  assert.equal(gone.status, 200);
  assert.equal((await profileRequest({method: 'GET', key, store, ip: 'unit-a'})).status, 401);
  fs.rmSync(file, {force: true});
});
