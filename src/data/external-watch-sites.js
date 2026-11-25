// Source pages supplied by the user. Playback progress checked on 2026-11-24.
// These are external watch pages, NOT directly playable Lovell sources.
const entries = [
 {year:2025,names:['Culpa nuestra','Our Fault','Bizim Hatamız'],site:'ufilmizle',url:'https://ufilmizle.com/filmler9/bizim-hatamiz-izle-d/',language:'Türkçe dublaj'},
 {year:2026,names:['Backrooms'],site:'yfilmizle',url:'https://yfilmizle.com/backrooms-izle/',language:'Türkçe altyazı ve dublaj seçeneği'},
 {year:2016,names:['13th','13. Madde'],site:'dizisol',url:'https://dizisol.com/izle/film/13-madde-8qny',language:'Türkçe dublaj'},
 {year:2024,names:['Superman','Süperman'],site:'ufilmizle',url:'https://ufilmizle.com/filmler9/superman-izle/',language:'Türkçe dublaj'},
 {year:2023,names:['The Flash','Hızlı Adam'],site:'yfilmizle',url:'https://yfilmizle.com/the-flash-izle/',language:'Türkçe dublaj'},
 {year:2024,names:['Deadpool & Wolverine'],site:'filmizletv',url:'https://filmizletv.com/deadpool-wolverine-izle/',language:'Türkçe dublaj'},
 {year:2023,names:['Oppenheimer','Oppenheimer'],site:'dizisol',url:'https://dizisol.com/izle/film/oppenheimer',language:'Türkçe altyazı'},
 {year:2024,names:['Dune: Part Two'],site:'hdonline',url:'https://hdonline.com.tr/film/dune-part-two-izle/',language:'Türkçe dublaj'},
];
const normalize = v => String(v || '').normalize('NFKC').toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function externalWatchSites(a) {
 // Türkçe Dublajlı Anime Kaynakları
 const animeNames = [a.title, a.original].filter(Boolean).map(normalize);
 const turkishDubAnime = [
  {names: ['naruto'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/naruto',language:'Türkçe dublaj ve altyazı'}]},
  {names: ['one piece'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/one-piece',language:'Türkçe dublaj'}, {site:'AnimODE',url:'https://animode.cloud/anime/one-piece',language:'Türkçe dublaj'}]},
  {names: ['bleach'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/bleach',language:'Türkçe dublaj'}, {site:'AniMedia',url:'https://animedia.digital/anime/bleach',language:'Türkçe dublaj'}]},
  {names: ['attack on titan','shingeki no kyojin'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/attack-on-titan',language:'Türkçe dublaj'}, {site:'AniStream',url:'https://www.alpemir.com/anime/attack-on-titan',language:'Türkçe dublaj'}]},
  {names: ['jujutsu kaisen'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/jujutsu-kaisen',language:'Türkçe dublaj'}, {site:'AniMedia',url:'https://animedia.digital/anime/jujutsu-kaisen',language:'Türkçe dublaj'}]},
  {names: ['demon slayer','kimetsu no yaiba'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/demon-slayer',language:'Türkçe dublaj'}, {site:'AnimaLive',url:'https://animalive.tv/anime/demon-slayer',language:'Türkçe dublaj'}]},
  {names: ['my hero academia','boku no hero academia'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/my-hero-academia',language:'Türkçe dublaj'}, {site:'AniStream',url:'https://www.alpemir.com/anime/my-hero-academia',language:'Türkçe dublaj'}]},
  {names: ['spy x family'], sites: [{site:'AniMedia',url:'https://animedia.digital/anime/spy-x-family',language:'Türkçe dublaj'}, {site:'SonAnime',url:'https://sonanime.com/anime/spy-x-family',language:'Türkçe dublaj'}]},
  {names: ['chainsaw man'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/chainsaw-man',language:'Türkçe dublaj'}, {site:'AniMedia',url:'https://animedia.digital/anime/chainsaw-man',language:'Türkçe dublaj'}]},
  {names: ['cyberpunk edge runners'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/cyberpunk-edgerunners',language:'Türkçe dublaj'}]},
 ];

 for (const anime of turkishDubAnime) {
  if (anime.names.some(n => animeNames.includes(n))) {
   return anime.sites;
  }
 }

 if(a?.kind !== 'movie') return [];
 const names=[a.title,a.original].filter(Boolean).map(normalize);
 return entries.filter(x=>x.year===Number(a.year)&&x.names.some(n=>names.includes(normalize(n)))).map(({site,url,language})=>({site,url,language}));
}
