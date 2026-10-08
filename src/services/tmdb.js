// Lovell Anime - TMDB API Service (via Server Proxy)
// All requests go through /api/tmdb/ to bypass DNS blocks
// Falls back to local catalog when server proxy also fails

import { ALL_ANIME_CATALOG, FEATURED_SPOTLIGHTS, generateEpisodesForAnime } from "../data/anime-catalog.js?v=4";
import { storage } from "./storage.js?v=4";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

class TmdbService {
  constructor() {
    this.cache = new Map();
    this.tmdbAvailable = null; // null = unknown, true/false after first check
  }

  getApiKey() {
    const settings = storage.getSettings();
    return settings.tmdbApiKey?.trim() || "8264db167971762da596258280f479b0";
  }

  // All images go through server-side image proxy to bypass DNS blocks
  getImageUrl(path, size = "w500", title = "Lovell Anime") {
    if (!path) return `/api/image?title=${encodeURIComponent(title)}`;
    
    // Local paths served directly
    if (path.startsWith("/public/")) return path;
    if (path.startsWith("/api/")) return path;
    if (path.startsWith("data:")) return path;

    // External URLs and TMDB paths go through image proxy
    let fullUrl;
    if (path.startsWith("http://") || path.startsWith("https://")) {
      fullUrl = path;
    } else {
      fullUrl = `${TMDB_IMAGE_BASE}/${size}${path.startsWith('/') ? path : '/' + path}`;
    }
    return `/api/image?url=${encodeURIComponent(fullUrl)}&title=${encodeURIComponent(title)}`;
  }

  // Make requests through server proxy
  async request(endpoint, params = {}) {
    const apiKey = this.getApiKey();
    const queryParams = new URLSearchParams({
      api_key: apiKey,
      language: "tr-TR",
      ...params
    });

    // Use local server proxy
    const url = `/api/tmdb/${endpoint}?${queryParams.toString()}`;

    // Check in-memory cache
    if (this.cache.has(url)) {
      return this.cache.get(url);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      
      // Check for TMDB error responses
      if (data.error || data.status_code) {
        throw new Error(data.error || `TMDB status ${data.status_code}`);
      }

      this.cache.set(url, data);
      this.tmdbAvailable = true;
      return data;
    } catch (err) {
      console.warn(`TMDB proxy request failed for ${endpoint}:`, err.message);
      if (this.tmdbAvailable === null) this.tmdbAvailable = false;
      return null;
    }
  }

  // SPOTLIGHT / FEATURED
  async getSpotlights() {
    return FEATURED_SPOTLIGHTS;
  }

  // TRENDING ANIME
  async getTrending() {
    const data = await this.request("trending/tv/week");
    if (data && data.results && data.results.length > 0) {
      const filtered = data.results.filter(item =>
        (item.genre_ids && item.genre_ids.includes(16)) ||
        item.original_language === "ja"
      );
      if (filtered.length > 0) {
        return filtered.map(item => this.formatAnimeItem(item, "tv"));
      }
    }
    // Fallback to local catalog
    return ALL_ANIME_CATALOG.filter(a => a.media_type === "tv").slice(0, 12);
  }

  // POPULAR ANIME TV
  async getPopular(page = 1) {
    const data = await this.request("discover/tv", {
      with_genres: "16",
      with_original_language: "ja",
      sort_by: "popularity.desc",
      page: page
    });

    if (data && data.results && data.results.length > 0) {
      return data.results.map(item => this.formatAnimeItem(item, "tv"));
    }

    return ALL_ANIME_CATALOG.filter(a => a.media_type === "tv");
  }

  // TOP RATED ANIME
  async getTopRated(page = 1) {
    const data = await this.request("discover/tv", {
      with_genres: "16",
      with_original_language: "ja",
      sort_by: "vote_average.desc",
      "vote_count.gte": "200",
      page: page
    });

    if (data && data.results && data.results.length > 0) {
      return data.results.map(item => this.formatAnimeItem(item, "tv"));
    }

    return [...ALL_ANIME_CATALOG]
      .filter(a => a.media_type === "tv")
      .sort((a, b) => b.vote_average - a.vote_average);
  }

  // ANIME MOVIES
  async getAnimeMovies(page = 1) {
    const data = await this.request("discover/movie", {
      with_genres: "16",
      with_original_language: "ja",
      sort_by: "popularity.desc",
      page: page
    });

    if (data && data.results && data.results.length > 0) {
      return data.results.map(item => this.formatAnimeItem(item, "movie"));
    }

    return ALL_ANIME_CATALOG.filter(a => a.media_type === "movie");
  }

  // SEARCH ANIME
  async search(query) {
    if (!query || !query.trim()) return [];
    const q = query.trim().toLowerCase();

    const data = await this.request("search/multi", { query: q });

    if (data && data.results && data.results.length > 0) {
      const filtered = data.results.filter(item =>
        (item.genre_ids && item.genre_ids.includes(16)) ||
        item.original_language === "ja" ||
        item.media_type === "tv" ||
        item.media_type === "movie"
      );
      if (filtered.length > 0) {
        return filtered.map(item => this.formatAnimeItem(item, item.media_type || "tv"));
      }
    }

    // Fallback local search
    return ALL_ANIME_CATALOG.filter(anime => {
      const title = (anime.title || "").toLowerCase();
      const orig = (anime.original_title || "").toLowerCase();
      const overview = (anime.overview || "").toLowerCase();
      return title.includes(q) || orig.includes(q) || overview.includes(q);
    });
  }

  // GET ANIME DETAILS
  async getDetails(id, mediaType = "tv") {
    const local = ALL_ANIME_CATALOG.find(a => a.id === Number(id));

    const data = await this.request(`${mediaType}/${id}`, {
      append_to_response: "videos,credits,similar"
    });

    if (data && !data.error) {
      return {
        ...this.formatAnimeItem(data, mediaType),
        seasons: data.seasons || [],
        number_of_seasons: data.number_of_seasons || local?.seasons_count || 1,
        number_of_episodes: data.number_of_episodes || local?.episodes_count || 12,
        tagline: data.tagline,
        status: data.status,
        genres: (data.genres && data.genres.map(g => g.name)) || local?.genres || [],
        videos: data.videos?.results || [],
        imdb_id: data.external_ids?.imdb_id || local?.imdb_id || ""
      };
    }

    if (local) {
      return {
        ...local,
        number_of_seasons: local.seasons_count || 1,
        number_of_episodes: local.episodes_count || 12,
        seasons: Array.from({ length: local.seasons_count || 1 }, (_, idx) => ({
          season_number: idx + 1,
          name: `Sezon ${idx + 1}`,
          episode_count: Math.ceil((local.episodes_count || 12) / (local.seasons_count || 1))
        }))
      };
    }

    return null;
  }

  // GET SEASON EPISODES
  async getSeasonEpisodes(tvId, seasonNumber = 1) {
    const data = await this.request(`tv/${tvId}/season/${seasonNumber}`);

    if (data && data.episodes && data.episodes.length > 0) {
      return data.episodes.map(ep => ({
        episode_number: ep.episode_number,
        season_number: ep.season_number,
        name: ep.name || `Bölüm ${ep.episode_number}`,
        overview: ep.overview || "Bu bölüm için henüz özet eklenmedi.",
        air_date: ep.air_date,
        runtime: ep.runtime || 24,
        still_path: ep.still_path ? this.getImageUrl(ep.still_path, "w500") : "",
        vote_average: ep.vote_average ? ep.vote_average.toFixed(1) : "8.5"
      }));
    }

    // Fallback
    const local = ALL_ANIME_CATALOG.find(a => a.id === Number(tvId));
    if (local) {
      return generateEpisodesForAnime(local, seasonNumber);
    }

    return Array.from({ length: 12 }, (_, i) => ({
      episode_number: i + 1,
      season_number: seasonNumber,
      name: `Bölüm ${i + 1}`,
      overview: `Lovell Anime yüksek kalitede anime akışı.`,
      air_date: "2024",
      runtime: 24,
      still_path: "",
      vote_average: "8.5"
    }));
  }

  // Test TMDB connection via proxy
  async testConnection() {
    try {
      const res = await fetch(`/api/tmdb/authentication?api_key=${this.getApiKey()}`);
      return res.ok;
    } catch {
      return false;
    }
  }

  formatAnimeItem(item, defaultType = "tv") {
    const mediaType = item.media_type || defaultType;
    const title = item.title || item.name || "Bilinmeyen Anime";
    const originalTitle = item.original_name || item.original_title || title;
    const releaseDate = item.first_air_date || item.release_date || "";

    return {
      id: item.id,
      media_type: mediaType,
      title: title,
      original_title: originalTitle,
      overview: item.overview || "Özet bulunmuyor.",
      poster_path: this.getImageUrl(item.poster_path, "w500", title),
      backdrop_path: this.getImageUrl(item.backdrop_path, "original", title),
      vote_average: item.vote_average ? Number(item.vote_average.toFixed(1)) : 8.5,
      vote_count: item.vote_count || 100,
      release_date: releaseDate,
      first_air_date: releaseDate,
      year: releaseDate ? releaseDate.split("-")[0] : "2024",
      quality: "1080p Ultra HD",
      genres: item.genres?.map(g => g.name) || ["Anime", "Animasyon"],
      imdb_id: item.imdb_id || item.external_ids?.imdb_id || ""
    };
  }
}

export const tmdb = new TmdbService();
