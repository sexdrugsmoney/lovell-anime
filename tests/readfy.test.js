import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mangaDetail,mangaChapters,chapterPages} from '../lib/readfy.js';
const id='11111111-1111-1111-1111-111111111111';
async function mock(fn,run){const old=globalThis.fetch;globalThis.fetch=fn;try{await run();}finally{globalThis.fetch=old;}}
const json=d=>new Response(JSON.stringify(d),{headers:{'content-type':'application/json'}});
test('manga Türkçe bölümleri sayfalar, sonraki offset korunur',async()=>mock(async url=>{
 const u=new URL(url);assert.equal(u.searchParams.get('translatedLanguage[]'),'tr');assert.equal(u.searchParams.get('offset'),'100');
 return json({total:205,data:Array.from({length:100},(_,n)=>({id:id+n,attributes:{chapter:String(n+101),pages:3,translatedLanguage:'tr'}}))});
},async()=>{const d=await mangaChapters(id,100);assert.equal(d.nextOffset,200);assert.equal(d.hasMore,true);assert.equal(d.chapters.length,100);}));
test('İngilizce ayrı istenir; son sayfa bitişi doğru',async()=>mock(async url=>{assert.equal(new URL(url).searchParams.get('translatedLanguage[]'),'en');return json({total:1,data:[{id,attributes:{chapter:'0',pages:0,externalUrl:'https://mangaplus.shueisha.co.jp/viewer/1'}}]});},async()=>{const d=await mangaChapters(id,0,'en');assert.equal(d.hasMore,false);assert.equal(d.chapters[0].chapter,'0');assert.ok(d.chapters[0].externalUrl);}));
test('boş dataSaver varsa özgün görüntüler açılır',async()=>mock(async()=>json({baseUrl:'https://uploads.mangadex.org',chapter:{hash:'abc123',dataSaver:[],data:['1.jpg','2.png']}}),async()=>{const d=await chapterPages(id);assert.deepEqual(d.pages,['https://uploads.mangadex.org/data/abc123/1.jpg','https://uploads.mangadex.org/data/abc123/2.png']);}));
test('özel veya yabancı sayfa sunucusu kabul edilmez',async()=>mock(async()=>json({baseUrl:'http://127.0.0.1',chapter:{hash:'abc',data:['1.jpg']}}),async()=>assert.rejects(()=>chapterPages(id),/alınamadı/)));
test('MangaDex hız sınırı 429 olarak korunur',async()=>mock(async()=>new Response('{}',{status:429}),async()=>assert.rejects(()=>mangaChapters(id),e=>e.status===429)));
test('geçersiz manga kimliği dış istek üretmez',async()=>mock(async()=>{throw Error('unexpected fetch')},async()=>assert.rejects(()=>mangaDetail('invalid'),/Geçersiz/)));
