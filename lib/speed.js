// Anahtar sahiplerinin klavye hızı sıralaması.
// WPM: (doğru karakter / 5) / dakika — Monkeytype / Speedfy ile aynı birim.

export const SPEED_DURATIONS = [15, 30, 60];
export const SPEED_LANGS = ['tr', 'en'];
export const SPEED_MAX_WPM = 250;
export const SPEED_MAX_RAW = 400;
export const SPEED_MIN_ACC = 40;
export const SPEED_BOARD_LIMIT = 50;

const limits = new Map();

export function resetSpeedLimits() { limits.clear(); }

function limited(ip) {
  const now = Date.now();
  const id = `speed:${ip || 'yerel'}`;
  let row = limits.get(id);
  if (!row || row.reset < now) {
    if (limits.size > 4000) limits.clear();
    row = {n: 0, reset: now + 60 * 1000};
    limits.set(id, row);
  }
  row.n += 1;
  return row.n > 24;
}

function int(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : NaN;
}

export function expectedStats(chars, duration) {
  const correct = Math.max(0, int(chars?.correct) || 0);
  const incorrect = Math.max(0, int(chars?.incorrect) || 0);
  const extra = Math.max(0, int(chars?.extra) || 0);
  const missed = Math.max(0, int(chars?.missed) || 0);
  const minutes = duration / 60;
  const wpm = minutes > 0 ? Math.round((correct / 5) / minutes) : 0;
  const raw = minutes > 0 ? Math.round(((correct + incorrect + extra) / 5) / minutes) : 0;
  const total = correct + incorrect + extra;
  const acc = total > 0 ? Math.round((correct / total) * 100) : 0;
  return {correct, incorrect, extra, missed, wpm, raw, acc};
}

export function parseResult(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {error: 'Geçersiz istek'};
  const duration = int(body.duration);
  if (!SPEED_DURATIONS.includes(duration)) return {error: 'Süre 15, 30 veya 60 saniye olmalı'};
  const lang = body.lang === 'en' ? 'en' : body.lang === 'tr' ? 'tr' : '';
  if (!lang) return {error: 'Dil tr veya en olmalı'};
  const chars = body.chars && typeof body.chars === 'object' ? body.chars : {};
  const stats = expectedStats(chars, duration);
  if (stats.correct < 8) return {error: 'Bu deneme sıralamaya girecek kadar uzun değil'};
  if (stats.wpm < 1 || stats.wpm > SPEED_MAX_WPM) return {error: 'Hız değeri geçersiz'};
  if (stats.raw < 1 || stats.raw > SPEED_MAX_RAW) return {error: 'Ham hız değeri geçersiz'};
  if (stats.acc < SPEED_MIN_ACC || stats.acc > 100) return {error: 'Doğruluk sıralama için yetersiz'};
  if (stats.correct / duration > 21) return {error: 'Hız değeri geçersiz'};
  const wpm = int(body.wpm);
  const acc = int(body.acc);
  const raw = int(body.raw);
  if (Math.abs(wpm - stats.wpm) > 2) return {error: 'Hız hesabı uyuşmuyor'};
  if (Math.abs(acc - stats.acc) > 2) return {error: 'Doğruluk hesabı uyuşmuyor'};
  if (Math.abs(raw - stats.raw) > 2) return {error: 'Ham hız hesabı uyuşmuyor'};
  return {
    result: {
      wpm: stats.wpm,
      acc: stats.acc,
      raw: stats.raw,
      duration,
      lang,
      chars: {correct: stats.correct, incorrect: stats.incorrect, extra: stats.extra, missed: stats.missed},
      at: Date.now(),
    },
  };
}

function better(prev, next) {
  if (!prev) return true;
  if (next.wpm !== prev.wpm) return next.wpm > prev.wpm;
  if (next.acc !== prev.acc) return next.acc > prev.acc;
  return next.raw > prev.raw;
}

function publicRow(rec, hash, modeKey) {
  const speed = rec?.speed;
  if (!speed || typeof speed !== 'object') return null;
  const row = modeKey ? speed.byMode?.[modeKey] : speed.best;
  if (!row || !Number.isFinite(row.wpm)) return null;
  return {
    name: rec.name || 'İzleyici',
    color: Number.isInteger(rec.color) ? rec.color : 0,
    wpm: row.wpm,
    acc: row.acc,
    raw: row.raw,
    duration: row.duration,
    lang: row.lang,
    at: row.at,
    tests: Number(speed.tests) || 1,
    _id: hash,
  };
}

export function rankBoard(rows, hash) {
  const sorted = [...rows].sort((a, b) => b.wpm - a.wpm || b.acc - a.acc || a.at - b.at);
  const board = sorted.slice(0, SPEED_BOARD_LIMIT).map((r, i) => {
    const {_id, ...rest} = r;
    return {rank: i + 1, ...rest, you: _id === hash};
  });
  const idx = sorted.findIndex(r => r._id === hash);
  let me = null;
  if (idx >= 0) {
    const {_id, ...rest} = sorted[idx];
    me = {rank: idx + 1, ...rest, you: true};
  }
  return {board, me, total: sorted.length};
}

export async function listSpeedBoard({store, hash, duration, lang}) {
  const dur = SPEED_DURATIONS.includes(int(duration)) ? int(duration) : 0;
  const lg = lang === 'en' || lang === 'tr' ? lang : '';
  const modeKey = dur && lg ? `${dur}:${lg}` : '';
  const records = typeof store.listRecords === 'function' ? await store.listRecords() : [];
  const rows = [];
  for (const item of records) {
    const row = publicRow(item.rec, item.id, modeKey);
    if (row) rows.push(row);
  }
  return rankBoard(rows, hash);
}

export async function submitSpeed({store, hash, rec, body, ip}) {
  if (!hash || !rec?.updatedAt) return {status: 401, data: {error: 'Anahtar gerekli'}};
  if (limited(ip)) return {status: 429, data: {error: 'Çok fazla deneme. Biraz sonra tekrar dene.'}};
  const parsed = parseResult(body);
  if (parsed.error) return {status: 400, data: {error: parsed.error}};
  const result = parsed.result;
  const modeKey = `${result.duration}:${result.lang}`;
  const prev = rec.speed && typeof rec.speed === 'object' ? rec.speed : {best: null, byMode: {}, tests: 0};
  const byMode = prev.byMode && typeof prev.byMode === 'object' && !Array.isArray(prev.byMode) ? {...prev.byMode} : {};
  const modePrev = byMode[modeKey];
  const modeBest = better(modePrev, result);
  if (modeBest) byMode[modeKey] = result;
  const overallBest = better(prev.best, result);
  const history = Array.isArray(prev.history) ? prev.history.slice(0, 23) : [];
  history.unshift({wpm: result.wpm, acc: result.acc, raw: result.raw, duration: result.duration, lang: result.lang, at: result.at});
  const next = {
    ...rec,
    updatedAt: Date.now(),
    speed: {
      best: overallBest ? result : prev.best,
      byMode,
      tests: (Number(prev.tests) || 0) + 1,
      history,
    },
  };
  await store.put(hash, next);
  const board = await listSpeedBoard({store, hash, duration: result.duration, lang: result.lang});
  return {
    status: 200,
    data: {
      ok: true,
      result,
      improved: modeBest,
      best: next.speed.byMode[modeKey],
      history: next.speed.history,
      ...board,
    },
  };
}
