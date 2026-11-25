import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleHlsProxy, proxyPath} from '../lib/hls-proxy.js';

test('oynatma listesi kaynak başına bir kez imzalanır, sahte parça türü düzelir', async () => {
  const secret = 'test-secret';
  const real = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('master.m3u8')) return new Response('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="https://cdn.example/a.m3u8"\nhttps://cdn.example/v.m3u8\nhttps://other.example/v.m3u8\n', {headers: {'content-type': 'text/plain'}});
    if (u.includes('/seg.ts')) return new Response(Uint8Array.from([0x47, 0x40, 0x11, 0x10]), {headers: {'content-type': 'text/html'}});
    return new Response('no', {status: 404});
  };
  try {
    const path = await proxyPath(secret, 'https://player.example/master.m3u8', 'https://player.example/');
    const res = await handleHlsProxy(secret, path, null);
    const text = await res.text();
    assert.equal(res.headers.get('content-type'), 'application/vnd.apple.mpegurl');
    const tokens = new Set([...text.matchAll(/\/api\/hls\/[^?"\s]+/g)].map(m => m[0]));
    assert.equal(tokens.size, 2);
    const token = [...text.matchAll(/\/api\/hls\/([^?"\s]+)/g)].find(m => decodeURIComponent(text).includes('cdn.example'))?.[1];
    assert.ok(token);
    assert.equal((await handleHlsProxy(secret, '/api/hls/' + token, null, '?u=' + encodeURIComponent('https://evil.example/x'))).status, 403);
    const seg = await handleHlsProxy(secret, '/api/hls/' + token, null, '?u=' + encodeURIComponent('https://cdn.example/seg.ts'));
    assert.equal(seg.headers.get('content-type'), 'video/mp2t');
    assert.equal(new Uint8Array(await seg.arrayBuffer())[0], 0x47);
  } finally {
    globalThis.fetch = real;
  }
});
