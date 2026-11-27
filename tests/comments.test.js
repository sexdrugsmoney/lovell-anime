import {test, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {listComments, postComment, deleteComment, memoryCommentStore, resetCommentLimits, cleanText, commentTarget, COMMENT_MAX} from '../lib/comments.js';

const alice = {hash: 'a'.repeat(64), rec: {name: 'Ayşe', color: 3, updatedAt: 1}};
const bob = {hash: 'b'.repeat(64), rec: {name: 'Bora', color: 1, updatedAt: 1}};
let store;
beforeEach(() => { store = memoryCommentStore(); resetCommentLimits(); });

test('yorum yazılır, listede en üstte görünür ve yazarın anahtar özeti dışarı çıkmaz', async () => {
  const out = await postComment({store, ...alice, body: {kind: 'tv', id: '1396', text: '  Harika dizi  '}});
  assert.equal(out.status, 201);
  assert.equal(out.data.item.text, 'Harika dizi');
  assert.equal(out.data.item.name, 'Ayşe');
  assert.equal(out.data.item.you, true);
  const list = await listComments({store, hash: bob.hash, kind: 'tv', id: '1396'});
  assert.equal(list.status, 200);
  assert.equal(list.data.total, 1);
  assert.equal(list.data.items[0].you, false);
  assert.equal(JSON.stringify(list.data).includes(alice.hash), false);
});

test('boş, çok uzun ve geçersiz başlıklı yorum reddedilir', async () => {
  assert.equal((await postComment({store, ...alice, body: {kind: 'tv', id: '1', text: '   '}})).status, 400);
  assert.equal((await postComment({store, ...alice, body: {kind: 'tv', id: '1', text: 'x'.repeat(COMMENT_MAX + 1)}})).status, 400);
  assert.equal((await postComment({store, ...alice, body: {kind: 'TV;', id: '1', text: 'merhaba'}})).status, 400);
  assert.equal((await postComment({store, hash: '', rec: null, body: {kind: 'tv', id: '1', text: 'merhaba'}})).status, 401);
  assert.equal((await listComments({store, hash: alice.hash, kind: 'tv', id: '../x'})).status, 400);
});

test('aynı kişi art arda yazamaz, başka biri yazabilir', async () => {
  assert.equal((await postComment({store, ...alice, body: {kind: 'movie', id: '27205', text: 'İlk'}})).status, 201);
  assert.equal((await postComment({store, ...alice, body: {kind: 'movie', id: '27205', text: 'İkinci'}})).status, 429);
  assert.equal((await postComment({store, ...bob, body: {kind: 'movie', id: '27205', text: 'Ben de'}})).status, 201);
  const list = await listComments({store, hash: alice.hash, kind: 'movie', id: '27205'});
  assert.deepEqual(list.data.items.map(c => c.text), ['Ben de', 'İlk']);
});

test('aynı anda gelen iki yorumdan hiçbiri kaybolmaz', async () => {
  const [x, y] = await Promise.all([
    postComment({store, ...alice, body: {kind: 'tv', id: '7', text: 'A'}}),
    postComment({store, ...bob, body: {kind: 'tv', id: '7', text: 'B'}}),
  ]);
  assert.equal(x.status, 201);
  assert.equal(y.status, 201);
  assert.equal((await listComments({store, hash: '', kind: 'tv', id: '7'})).data.total, 2);
});

test('yalnızca yazarı kendi yorumunu silebilir', async () => {
  const made = await postComment({store, ...alice, body: {kind: 'tv', id: '9', text: 'Silinecek', spoiler: true}});
  const cid = made.data.item.id;
  assert.equal(made.data.item.spoiler, true);
  assert.equal((await deleteComment({store, hash: bob.hash, kind: 'tv', id: '9', cid})).status, 403);
  assert.equal((await deleteComment({store, hash: alice.hash, kind: 'tv', id: '9', cid: 'ffffffffffffffff'})).status, 404);
  const gone = await deleteComment({store, hash: alice.hash, kind: 'tv', id: '9', cid});
  assert.equal(gone.status, 200);
  assert.equal(gone.data.total, 0);
});

test('metin temizliği kontrol karakterlerini atar, satır sonlarını sınırlar', () => {
  assert.equal(cleanText('a‮b\u0000c\r\n\r\n\r\n\r\nd'), 'abc\n\nd');
  assert.equal(commentTarget('al', '21-x'), 'al:21-x');
  assert.equal(commentTarget('tv', ''), '');
});
