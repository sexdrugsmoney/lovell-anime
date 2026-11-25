import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanLookupQuery, lookupTrack, musicKind, searchifyOrigin, SEARCHIFY_ORIGIN} from '../lib/music.js';
import {chapterPages} from '../lib/readfy.js';

test('Searchify adresi güvenli kökle sınırlanır', () => {
  assert.equal(searchifyOrigin(), SEARCHIFY_ORIGIN);
  assert.equal(searchifyOrigin('https://searchify.bextercontact.workers.dev/api/lookup'), 'https://searchify.bextercontact.workers.dev');
  assert.equal(searchifyOrigin('http://127.0.0.1:9'), 'http://127.0.0.1:9');
  assert.equal(searchifyOrigin('javascript:alert(1)'), SEARCHIFY_ORIGIN);
});

test('Spotify albüm ve çalma listesi adresi ayırt edilir', () => {
  assert.equal(musicKind('https://open.spotify.com/album/1abcDEFGhijKLMNOpqrstu'), 'album');
  assert.equal(musicKind('spotify:playlist:1abcDEFGhijKLMNOpqrstu'), 'playlist');
  assert.equal(musicKind('Tarkan Şımarık'), 'track');
});

test('sorgu metni kırpılır ve boşsa reddedilir', async () => {
  assert.equal(cleanLookupQuery('  a\n b  '), 'a b');
  await assert.rejects(() => lookupTrack('   '), /gerekli/);
});

test('lookup Searchify gövdesini iletir', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:9/api/lookup');
    assert.equal(init.method, 'POST');
    assert.equal(JSON.parse(init.body).urlOrId, 'Sanatçı Şarkı');
    return new Response(JSON.stringify({success: true, data: {trackName: 'Şarkı', isrc: 'TRABC'}}), {headers: {'content-type': 'application/json'}});
  };
  try {
    const out = await lookupTrack('Sanatçı Şarkı', 'http://127.0.0.1:9');
    assert.equal(out.data.trackName, 'Şarkı');
    assert.equal(out.success, true);
  } finally {
    globalThis.fetch = real;
  }
});

test('Readfy geçersiz bölüm kimliğini reddeder', async () => {
  await assert.rejects(() => chapterPages('nope'), /Geçersiz/);
});
