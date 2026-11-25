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
  {names: ['hunter x hunter'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/hunter-x-hunter',language:'Türkçe dublaj'}, {site:'AnimODE',url:'https://animode.cloud/anime/hunter-x-hunter',language:'Türkçe dublaj'}]},
  {names: ['fullmetal alchemist'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/fullmetal-alchemist',language:'Türkçe dublaj'}, {site:'AniMedia',url:'https://animedia.digital/anime/fullmetal-alchemist',language:'Türkçe dublaj'}]},
  {names: ['death note'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/death-note',language:'Türkçe dublaj'}, {site:'SonAnime',url:'https://sonanime.com/anime/death-note',language:'Türkçe dublaj'}]},
  {names: ['vinland saga'], sites: [{site:'AniMedia',url:'https://animedia.digital/anime/vinland-saga',language:'Türkçe dublaj'}, {site:'SonAnime',url:'https://sonanime.com/anime/vinland-saga',language:'Türkçe dublaj'}]},
  {names: ['made in abyss'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/made-in-abyss',language:'Türkçe dublaj'}]},
  {names: ['mob psycho'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/mob-psycho-100',language:'Türkçe dublaj'}, {site:'AniMedia',url:'https://animedia.digital/anime/mob-psycho-100',language:'Türkçe dublaj'}]},
  {names: ['link click','avi'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/link-click',language:'Türkçe dublaj'}]},
  {names: ['wind breaker'], sites: [{site:'AniMedia',url:'https://animedia.digital/anime/wind-breaker',language:'Türkçe dublaj'}]},
  {names: ['fairy tail'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/fairy-tail',language:'Türkçe dublaj'}, {site:'AnimODE',url:'https://animode.cloud/anime/fairy-tail',language:'Türkçe dublaj'}]},
  {names: ['high school dxd'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/high-school-dxd',language:'Türkçe dublaj'}]},
  {names: ['angel beats'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/angel-beats',language:'Türkçe dublaj'}]},
  {names: ['toradora'], sites: [{site:'AniMedia',url:'https://animedia.digital/anime/toradora',language:'Türkçe dublaj'}]},
  {names: ['ergo proxy'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/ergo-proxy',language:'Türkçe dublaj'}]},
  {names: ['psycho pass'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/psycho-pass',language:'Türkçe dublaj'}, {site:'AniMedia',url:'https://animedia.digital/anime/psycho-pass',language:'Türkçe dublaj'}]},
  {names: ['seraph of the end','owari no seraph'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/seraph-of-the-end',language:'Türkçe dublaj'}]},
  {names: ['parasyte','kiseijuu'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/parasyte',language:'Türkçe dublaj'}, {site:'AniMedia',url:'https://animedia.digital/anime/parasyte',language:'Türkçe dublaj'}]},
  {names: ['gintama'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/gintama',language:'Türkçe dublaj'}]},
  {names: ['kengan ashura'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/kengan-ashura',language:'Türkçe dublaj'}]},
  {names: ['goblin slayer'], sites: [{site:'AniMedia',url:'https://animedia.digital/anime/goblin-slayer',language:'Türkçe dublaj'}]},
  {names: ['re:zero'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/rezero',language:'Türkçe dublaj'}, {site:'AnimODE',url:'https://animode.cloud/anime/rezero',language:'Türkçe dublaj'}]},
  {names: ['sword art online','sao'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/sword-art-online',language:'Türkçe dublaj'}, {site:'AniMedia',url:'https://animedia.digital/anime/sword-art-online',language:'Türkçe dublaj'}]},
  {names: ['log horizon'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/log-horizon',language:'Türkçe dublaj'}]},
  {names: ['no game no life'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/no-game-no-life',language:'Türkçe dublaj'}, {site:'AniMedia',url:'https://animedia.digital/anime/no-game-no-life',language:'Türkçe dublaj'}]},
  {names: ['trinity seven'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/trinity-seven',language:'Türkçe dublaj'}]},
  {names: ['a certain magical index','toaru majutsu'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/toaru-majutsu',language:'Türkçe dublaj'}, {site:'AniMedia',url:'https://animedia.digital/anime/toaru-majutsu',language:'Türkçe dublaj'}]},
  {names: ['a certain scientific railgun','toaru kagaku'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/toaru-kagaku',language:'Türkçe dublaj'}]},
  {names: ['steins;gate'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/steins-gate',language:'Türkçe dublaj'}, {site:'SonAnime',url:'https://sonanime.com/anime/steins-gate',language:'Türkçe dublaj'}]},
  {names: ['code geass'], sites: [{site:'AniMedia',url:'https://animedia.digital/anime/code-geass',language:'Türkçe dublaj'}, {site:'AnimODE',url:'https://animode.cloud/anime/code-geass',language:'Türkçe dublaj'}]},
  {names: ['fate stay night'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/fate-stay-night',language:'Türkçe dublaj'}]},
  {names: ['fate zero'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/fate-zero',language:'Türkçe dublaj'}]},
  {names: ['hellsing','hellsing ultimate'], sites: [{site:'AniMedia',url:'https://animedia.digital/anime/hellsing-ultimate',language:'Türkçe dublaj'}]},
  {names: ['monogatari'], sites: [{site:'SonAnime',url:'https://sonanime.com/anime/monogatari',language:'Türkçe dublaj'}]},
  {names: ['torrent no shoujo','wind breaker'], sites: [{site:'AnimODE',url:'https://animode.cloud/anime/wind-breaker',language:'Türkçe dublaj'}]},
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
