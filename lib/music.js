// Searchify (Cloudflare) üzerinden parça / dağıtımcı sorgusu.
// Canlı servis: https://searchify.bextercontact.workers.dev
export const SEARCHIFY_ORIGIN = 'https://searchify.bextercontact.workers.dev';

export function searchifyOrigin(override) {
  const raw = String(override || '').trim();
  if (!raw) return SEARCHIFY_ORIGIN;
  try {
    const url = new URL(raw);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) {
      return url.origin;
    }
  } catch {}
  return SEARCHIFY_ORIGIN;
}

export function cleanLookupQuery(value) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

export function musicKind(urlOrId) {
  const s = String(urlOrId || '');
  if (/open\.spotify\.com\/playlist\/|spotify:playlist:/i.test(s)) return 'playlist';
  if (/open\.spotify\.com\/album\/|spotify:album:/i.test(s)) return 'album';
  return 'track';
}

function spotifyId(urlOrId, type) {
  const m = String(urlOrId || '').match(new RegExp(`(?:spotify:${type}:|/${type}/)([A-Za-z0-9]{22})`, 'i'));
  return m?.[1] || '';
}

async function listSpotifyCollection(urlOrId, kind) {
  const id = spotifyId(urlOrId, kind);
  if (!id) return [];
  const embed = await fetch(`https://open.spotify.com/embed/${kind}/${id}`, {
    signal: AbortSignal.timeout(12000),
    headers: {accept: 'text/html', 'user-agent': 'Mozilla/5.0'},
  }).then(r => r.ok ? r.text() : '').catch(() => '');
  const names = [];
  const re = /"name"\s*:\s*"([^"\\]{1,120})"[\s\S]{0,240}"type"\s*:\s*"track"/g;
  let m;
  while ((m = re.exec(embed)) && names.length < 16) {
    const name = m[1].replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    if (name && !names.includes(name)) names.push(name);
  }
  if (names.length) return names.map(name => ({name, artists: ''}));
  const loose = [...embed.matchAll(/"subtitle"\s*:\s*"([^"\\]{1,80})"/g)].map(x => x[1]);
  const titles = [...embed.matchAll(/"title"\s*:\s*"([^"\\]{1,120})"/g)].map(x => x[1]);
  return titles.slice(0, 12).map((name, i) => ({name, artists: loose[i] || ''}));
}

export async function lookupTrack(urlOrId, originOverride) {
  const input = cleanLookupQuery(urlOrId);
  if (!input) {
    const err = new Error('Spotify bağlantısı, parça kodu ya da sanatçı + şarkı adı gerekli.');
    err.status = 400;
    throw err;
  }
  const origin = searchifyOrigin(originOverride);
  let res;
  try {
    res = await fetch(`${origin}/api/lookup`, {
      method: 'POST',
      headers: {accept: 'application/json', 'content-type': 'application/json'},
      body: JSON.stringify({urlOrId: input}),
      signal: AbortSignal.timeout(28000),
    });
  } catch (e) {
    const err = new Error('Lovellify şu an Searchify’ye bağlanamadı.');
    err.status = 502;
    err.cause = e;
    throw err;
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(payload.error || 'Parça bilgisi alınamadı.');
    err.status = res.status === 404 ? 404 : res.status >= 400 && res.status < 500 ? 400 : 502;
    throw err;
  }
  if (!payload?.data || typeof payload.data !== 'object') {
    const err = new Error('Bu parça için doğrulanabilir sonuç bulunamadı.');
    err.status = 404;
    throw err;
  }
  return {success: true, cached: !!payload.cached, data: payload.data};
}

export async function lookupMusic(urlOrId, originOverride) {
  const kind = musicKind(urlOrId);
  if (kind === 'track') return lookupTrack(urlOrId, originOverride);
  const listed = await listSpotifyCollection(urlOrId, kind);
  if (!listed.length) return lookupTrack(urlOrId, originOverride);
  const items = await Promise.all(listed.slice(0, 6).map(async row => {
    const q = [row.artists, row.name].filter(Boolean).join(' ').trim();
    try { return (await lookupTrack(q, originOverride)).data; }
    catch { return {trackName: row.name, artists: row.artists || '', distributor: 'Unknown', error: true}; }
  }));
  return {
    success: true,
    collection: true,
    kind,
    data: items[0] || null,
    items,
  };
}
