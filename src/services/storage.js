// Lovell Anime - Local Storage Manager (Watchlist, History, Settings)

const STORAGE_KEYS = {
  WATCHLIST: "lovell_anime_watchlist",
  HISTORY: "lovell_anime_history",
  SETTINGS: "lovell_anime_settings"
};

export const storage = {
  getWatchlist() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.WATCHLIST);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  isInWatchlist(animeId) {
    const list = this.getWatchlist();
    return list.some(item => item.id === animeId);
  },

  toggleWatchlist(anime) {
    const list = this.getWatchlist();
    const index = list.findIndex(item => item.id === anime.id);
    let added = false;
    if (index >= 0) {
      list.splice(index, 1);
    } else {
      list.unshift({
        id: anime.id,
        title: anime.title || anime.name,
        poster_path: anime.poster_path,
        backdrop_path: anime.backdrop_path,
        media_type: anime.media_type || "tv",
        vote_average: anime.vote_average,
        genres: anime.genres || [],
        addedAt: Date.now()
      });
      added = true;
    }
    localStorage.setItem(STORAGE_KEYS.WATCHLIST, JSON.stringify(list));
    return { added, list };
  },

  getHistory() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.HISTORY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  saveHistory(anime, season = 1, episode = 1) {
    try {
      let history = this.getHistory();
      history = history.filter(item => item.id !== anime.id);
      history.unshift({
        id: anime.id,
        title: anime.title || anime.name,
        poster_path: anime.poster_path,
        backdrop_path: anime.backdrop_path,
        media_type: anime.media_type || "tv",
        season,
        episode,
        updatedAt: Date.now()
      });
      // Keep last 30
      if (history.length > 30) history = history.slice(0, 30);
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
    } catch (e) {
      console.warn("Could not save history:", e);
    }
  },

  getSettings() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      return data ? JSON.parse(data) : {
        tmdbApiKey: "8264db167971762da596258280f479b0",
        proxyUrl: "",
        autoNext: true,
        cinemaMode: false
      };
    } catch {
      return {
        tmdbApiKey: "8264db167971762da596258280f479b0",
        proxyUrl: "",
        autoNext: true,
        cinemaMode: false
      };
    }
  },

  saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }
};
