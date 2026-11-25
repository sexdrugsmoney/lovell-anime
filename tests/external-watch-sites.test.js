import {test} from 'node:test';
import assert from 'node:assert/strict';
import {externalWatchSites} from '../src/data/external-watch-sites.js';
test('external source pages match only the exact film and release year',()=>{
 for(const [title,year] of [['Bizim Hatamız',2025],['Backrooms',2026],['13th',2016]]) {
  assert.equal(externalWatchSites({kind:'movie',title,year}).length,1);
  assert.equal(externalWatchSites({kind:'movie',title,year:year-1}).length,0);
  assert.equal(externalWatchSites({kind:'tv',title,year}).length,0);
 }
 assert.equal(externalWatchSites({kind:'movie',title:'Backrooms 2',year:2026}).length,0);
});
test('external watch pages do not masquerade as playable or Turkish dubbed sources',()=>{
 for(const [title,year] of [['Our Fault',2025],['Backrooms',2026],['13. Madde',2016]]) {
  const s=externalWatchSites({kind:'movie',title,year})[0];
  assert.equal(s.kind,undefined);assert.equal(s.dub,undefined);assert.match(s.language,/ses doğrulanmadı/);assert.ok(s.url.startsWith('https://'));
 }
});

test('SonAnime external series link is restricted to Naruto 2002 and reports sample coverage',()=>{
 for(const kind of ['al','tv']) {
  const rows=externalWatchSites({kind,title:'Naruto',year:2002});
  assert.equal(rows.length,1);assert.equal(rows[0].url,'https://sonanime.com/anime/naruto');
  assert.match(rows[0].language,/Diğer bölümler test edilmedi/);assert.equal(rows[0].kind,undefined);assert.equal(rows[0].dub,undefined);
 }
 for(const item of [{kind:'al',title:'Naruto Shippuden',year:2007},{kind:'movie',title:'Naruto',year:2002},{kind:'al',title:'Naruto',year:2003},{kind:'al',title:'Naruto'}]) assert.equal(externalWatchSites(item).length,0);
});
