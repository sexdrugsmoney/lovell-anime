import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const main=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const code=main.slice(main.indexOf('function isTurkishAudio('),main.indexOf('// ---- Arama: boşken'));
function app(player=null) {
 const calls=[]; const sandbox={secOf: a => a?.section || 'media',player,store:{set(){}},paintWatchOpts(){},toast:m=>calls.push(['toast',m]),mountPlayer:(c,i)=>calls.push(['source',i]),mountEmbed:(c,i)=>calls.push(['embed',i])};
 vm.createContext(sandbox);vm.runInContext(code,sandbox);return {...sandbox,calls};
}
test('Türkçe ses izine aynı oynatıcıda geçer',()=>{
 const p={hls:{audioTracks:[{lang:'en'},{lang:'tr-TR'}],audioTrack:0}};
 const a=app(p);a.applyAudio({mode:'player'},'dub');assert.equal(p.hls.audioTrack,1);assert.equal(a.calls[0][0],'toast');
 a.applyAudio({mode:'player'},'sub');assert.equal(p.hls.audioTrack,0);
});
test('Türkçe doğrudan kaynak gömüden önce seçilir',()=>{
 const a=app();a.applyAudio({mode:'embed',sources:[{lang:'en'},{lang:'tr',dub:true}],embeds:[{lang:'dub'}]},'dub');assert.deepEqual(a.calls,[['source',1]]);
});
test('yalnızca dub etiketi Türkçe dublaj kabul edilmez',()=>{
 const a=app();a.applyAudio({mode:'embed',sources:[],embeds:[{lang:'dub',anime:true}]},'dub');assert.equal(a.calls[0][0],'toast');assert.match(a.calls[0][1],/doğrulanmış/);
});
test('yerleşik audioTracks seçimi eski sesi kapatır',()=>{
 const tracks=[{language:'en',enabled:true},{language:'tur',enabled:false}];const a=app();assert.equal(a.selectPlayerAudio({video:{audioTracks:tracks}},true),true);assert.deepEqual(tracks.map(x=>x.enabled),[false,true]);
});
