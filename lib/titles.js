// Anime ve manga başlıklarını aynı seri saymak için. İstemcideki kopya bununla aynı kalsın.
export function normTitle(value) {
  return String(value || '').toLocaleLowerCase('en')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|season|sezon|part|cour|tv|ova|ona|movie|film)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loose(value) {
  return String(value || '').toLocaleLowerCase('en').replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function titleHit(query, candidate) {
  const a = normTitle(query);
  const b = normTitle(candidate);
  if (a.length >= 4 && b.length >= 4) {
    if (a === b) return true;
    const short = a.length <= b.length ? a : b;
    const long = a.length <= b.length ? b : a;
    if (short.length >= 8 && long.startsWith(`${short} `)) return true;
  }
  const c = loose(query);
  const d = loose(candidate);
  if (c.length < 2 || d.length < 2) return false;
  if (c === d) return true;
  const short = c.length <= d.length ? c : d;
  const long = c.length <= d.length ? d : c;
  return short.length >= 6 && long.startsWith(short);
}
