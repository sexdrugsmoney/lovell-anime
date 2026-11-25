// Türkçe Altyazı Veritabanı - Fansub & Çevirmen Kaynakları
// Turkish Subtitles Database - Fansub & Translator Sources
// ⚠️ SADECE TÜRKÇE ALTYAZI İÇERİK

export const TURKISH_SUBTITLE_ANIME = [
  // AnimeCix Fansub - En büyük Türk anime fansub arşivi
  {
    id: 1,
    name: 'AnimeCix',
    type: 'fansub',
    url: 'https://animecix.tv',
    coverage: 'Premium Türk fansub takımları (100+ anime)',
    quality: 'Profesyonel çevirisi',
    language: 'Turkish Subtitles',
  },
  // Türk Fansub Sitesi
  {
    id: 2,
    name: 'AnimeIzle',
    type: 'fansub',
    url: 'https://animeizle.info',
    coverage: 'Türkçe fansub anime (50+ başlık)',
    quality: 'Fansub çevirileri',
    language: 'Turkish Subtitles',
  },
  // Türk Video Arşivi
  {
    id: 3,
    name: 'TurkVideo',
    type: 'fansub',
    url: 'https://turkvideo.tv',
    coverage: 'Türk fansub arşivi (30+ anime)',
    quality: 'Çeşitli fansub takımları',
    language: 'Turkish Subtitles',
  },
];

export const TURKISH_SUBTITLE_FILMS = [
  // OpenSubtitles - Dünyanın en büyük altyazı veritabanı
  {
    id: 1,
    name: 'OpenSubtitles',
    type: 'subtitle_database',
    url: 'https://www.opensubtitles.org',
    coverage: '1000+ Türkçe altyazılı film',
    quality: 'Çevirmen ve fansub çevirileri',
    language: 'Turkish Subtitles',
    formats: ['SRT', 'SUB', 'ASS'],
  },
  // SubScene - PopülerSubtitle sitesi
  {
    id: 2,
    name: 'SubScene',
    type: 'subtitle_database',
    url: 'https://subscene.com',
    coverage: '800+ Türkçe altyazılı film',
    quality: 'Resepsiyon puanlı altyazılar',
    language: 'Turkish Subtitles',
    formats: ['SRT', 'SUB'],
  },
  // Altyazı Türkiye
  {
    id: 3,
    name: 'Altyazı Türkiye',
    type: 'subtitle_database',
    url: 'https://altyaziturkiye.net',
    coverage: '500+ Türkçe altyazılı film',
    quality: 'Türk çevirmen arşivi',
    language: 'Turkish Subtitles',
    formats: ['SRT', 'ASS'],
  },
  // Türk Altyazı
  {
    id: 4,
    name: 'Türk Altyazı',
    type: 'subtitle_database',
    url: 'https://turkaltyazi.org',
    coverage: '400+ Türkçe altyazılı film',
    quality: 'Fansub ve profesyonel çeviriler',
    language: 'Turkish Subtitles',
    formats: ['SRT', 'SUB'],
  },
  // Yüksek Teknoloji İslambol (YTİ)
  {
    id: 5,
    name: 'Yüksek Teknoloji İslambol',
    type: 'subtitle_database',
    url: 'https://ytiblim.com',
    coverage: '300+ Türkçe altyazılı film',
    quality: 'Kaliteli çevirmenler',
    language: 'Turkish Subtitles',
    formats: ['SRT', 'ASS'],
  },
];

export const TURKISH_SUBTITLE_SOURCES = [
  {
    name: 'AnimeCix',
    type: 'Premium Fansub Hub',
    url: 'https://animecix.tv',
    language: 'Turkish',
    specialization: 'Anime & Manga',
    coverage: '100+',
    quality: 'Professional Fansub Teams',
  },
  {
    name: 'OpenSubtitles',
    type: 'Global Subtitle Database',
    url: 'https://www.opensubtitles.org',
    language: 'Turkish + 50+ Languages',
    specialization: 'All Content',
    coverage: '1000+',
    quality: 'Community Reviewed',
  },
  {
    name: 'SubScene',
    type: 'Community Subtitles',
    url: 'https://subscene.com',
    language: 'Turkish + 40+ Languages',
    specialization: 'Films & TV',
    coverage: '800+',
    quality: 'User Rated',
  },
  {
    name: 'Altyazı Türkiye',
    type: 'Turkish Subtitle Archive',
    url: 'https://altyaziturkiye.net',
    language: 'Turkish',
    specialization: 'Films & TV',
    coverage: '500+',
    quality: 'Turkish Translators',
  },
  {
    name: 'Türk Altyazı',
    type: 'Turkish Subtitle Community',
    url: 'https://turkaltyazi.org',
    language: 'Turkish',
    specialization: 'Films & TV',
    coverage: '400+',
    quality: 'Mixed Translators',
  },
  {
    name: 'YTİ (Yüksek Teknoloji)',
    type: 'Turkish Subtitle Hub',
    url: 'https://ytiblim.com',
    language: 'Turkish',
    specialization: 'Films',
    coverage: '300+',
    quality: 'Professional Quality',
  },
  {
    name: 'AnimeIzle',
    type: 'Turkish Anime Fansubs',
    url: 'https://animeizle.info',
    language: 'Turkish',
    specialization: 'Anime',
    coverage: '50+',
    quality: 'Fansub Teams',
  },
  {
    name: 'TurkVideo',
    type: 'Turkish Video Archive',
    url: 'https://turkvideo.tv',
    language: 'Turkish',
    specialization: 'Anime & Series',
    coverage: '30+',
    quality: 'Mixed Quality',
  },
];

export const SUBTITLE_TYPES = {
  PROFESSIONAL: {
    id: 'professional',
    name: 'Profesyonel Çevirmen',
    description: 'Tiyatro ve sinema çevirmenlerinin çevirilerine',
    emoji: '👨‍💼',
    quality_score: 95,
  },
  FANSUB: {
    id: 'fansub',
    name: 'Fansub (Fan Çeviri)',
    description: 'Hayran çevirmenlerinin çevirilerine',
    emoji: '👥',
    quality_score: 85,
  },
  COMMUNITY: {
    id: 'community',
    name: 'Topluluk Çevirisi',
    description: 'Topluluk üyeleri tarafından çevirilen altyazılar',
    emoji: '🌍',
    quality_score: 75,
  },
  AUTO_TRANSLATED: {
    id: 'auto',
    name: 'Otomatik Çevirisi',
    description: 'Makine tarafından çevirilen altyazılar',
    emoji: '🤖',
    quality_score: 50,
  },
};

export const SUBTITLE_FORMATS = {
  SRT: {
    name: 'SubRip (.srt)',
    extension: '.srt',
    description: 'En yaygın altyazı formatı',
    compatibility: 'Tüm oynatıcılar',
  },
  ASS: {
    name: 'Advanced SubStation Alpha (.ass)',
    extension: '.ass',
    description: 'Stil ve efektler destekleyen format',
    compatibility: 'VLC, MPC-HC, ve diğer oynatıcılar',
  },
  SUB: {
    name: 'MicroDVD (.sub)',
    extension: '.sub',
    description: 'Klasik altyazı formatı',
    compatibility: 'Eski oynatıcılar ve DVD',
  },
  VTT: {
    name: 'WebVTT (.vtt)',
    extension: '.vtt',
    description: 'Web video formatı',
    compatibility: 'Web oynatıcılar ve modern cihazlar',
  },
};

export const getTurkishSubtitleSource = (type) => {
  const sources = {
    'professional': [
      {name: 'OpenSubtitles', url: 'https://www.opensubtitles.org', quality: 'High'},
      {name: 'YTİ (Yüksek Teknoloji)', url: 'https://ytiblim.com', quality: 'High'},
    ],
    'fansub': [
      {name: 'AnimeCix', url: 'https://animecix.tv', quality: 'High'},
      {name: 'AnimeIzle', url: 'https://animeizle.info', quality: 'Medium'},
    ],
    'community': [
      {name: 'SubScene', url: 'https://subscene.com', quality: 'Variable'},
      {name: 'Altyazı Türkiye', url: 'https://altyaziturkiye.net', quality: 'Medium'},
    ],
  };
  return sources[type] || sources['community'];
};

export default {
  TURKISH_SUBTITLE_ANIME,
  TURKISH_SUBTITLE_FILMS,
  TURKISH_SUBTITLE_SOURCES,
  SUBTITLE_TYPES,
  SUBTITLE_FORMATS,
  getTurkishSubtitleSource,
};
