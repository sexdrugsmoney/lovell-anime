/**
 * GitHub Actions Secrets'a değer yükler.
 * Kullanım: node scripts/set-secrets.mjs
 * libsodium-wrappers paketini gerektirir — kurulum için:
 *   npm install libsodium-wrappers
 */
import sodium from 'libsodium-wrappers';
import https from 'node:https';

const GH_TOKEN = process.env.GH_TOKEN;
const REPO = 'sexdrugsmoney/lovell-anime';

const SECRETS = {
  CF_API_TOKEN:    process.env.CF_API_TOKEN    || '',
  CF_ACCOUNT_ID:   process.env.CF_ACCOUNT_ID   || '16ddb4aae41efc447347dbac3c25d007',
  TMDB_READ_TOKEN: process.env.TMDB_READ_TOKEN || '',
  CINEPRO_URL:     process.env.CINEPRO_URL     || '',
  VIDRIFT_BRAND:   'LOVELL',
  VIDRIFT_COLOR:   'e4202b',
};

async function ghReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        Authorization: `token ${GH_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'lovell-deploy',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function encrypt(publicKey, value) {
  await sodium.ready;
  const key = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const msg = sodium.from_string(value);
  const encrypted = sodium.crypto_box_seal(msg, key);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}

async function setSecret(name, value, keyId, publicKey) {
  if (!value) { console.log(`  ATLA: ${name} (değer yok)`); return; }
  const encryptedValue = await encrypt(publicKey, value);
  const r = await ghReq('PUT', `/repos/${REPO}/actions/secrets/${name}`, {
    encrypted_value: encryptedValue,
    key_id: keyId,
  });
  console.log(`  ${r.status === 201 || r.status === 204 ? '✓' : '✗'} ${name} (${r.status})`);
}

async function main() {
  console.log('GitHub Secrets yükleniyor...');
  const pk = await ghReq('GET', `/repos/${REPO}/actions/secrets/public-key`);
  const { key_id, key } = pk.body;
  for (const [name, value] of Object.entries(SECRETS)) {
    await setSecret(name, value, key_id, key);
  }
  console.log('\nTamamlandı.');
}

main().catch(console.error);
