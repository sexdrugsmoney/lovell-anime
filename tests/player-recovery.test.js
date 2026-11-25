import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const main=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const code=main.slice(main.indexOf('function sourceIdentity('),main.indexOf('function emptyStage('));
const messages=main.slice(main.indexOf('function parsePlayerMessage('),main.indexOf('// Kaldığı yerden başlat:'));
function app(){const calls=[];const s={Set,toast:()=>calls.push('empty'),mountPlayer:(c,i)=>{calls.push(['player',i]);c.mode='player';c.index=i;},mountEmbed:(c,i)=>{calls.push(['embed',i]);c.mode='embed';c.index=i;}};vm.createContext(s);vm.runInContext(code+messages,s);return {...s,calls};}
test('bozuk kaynaklar arasında sonsuz döngü oluşmaz',()=>{
 const a=app(),c={mode:'player',index:0,sources:[{url:'a'}],embeds:[{url:'b'},{url:'c'}]};
 a.nextSource(c);a.nextSource(c);a.nextSource(c);assert.deepEqual(a.calls,[['embed',0],['embed',1],'empty']);
});
test('aynı adres farklı isimle dönerse yeniden denenmez',()=>{
 const a=app(),c={mode:'player',index:0,sources:[{url:'a'},{url:'a'}],embeds:[]};a.nextSource(c);assert.deepEqual(a.calls,['empty']);
});
test('iframe hata mesajı ve player_status başarısızlığı tanınır',()=>{
 const a=app();assert.equal(a.parsePlayerMessage({type:'vidrift:error'}).failed,true);assert.equal(a.parsePlayerMessage({type:'PLAYER_EVENT',data:{player_status:'error'}}).failed,true);assert.equal(a.parsePlayerMessage('bad json'),null);
});
