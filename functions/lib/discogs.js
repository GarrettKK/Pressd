/* Discogs OAuth 1.0a (HMAC-SHA1) helpers for the Pages Functions. */
export const UA = 'SpotiVinyl/1.0 +https://github.com/GarrettKK/SpotiVinyl';

export const apiBase = (env) => (env.DISCOGS_API || 'https://api.discogs.com').replace(/\/$/, '');
export const authorizeUrl = (env) => (env.DISCOGS_AUTHORIZE || 'https://discogs.com/oauth/authorize');
export const configured = (env) => Boolean(env.DISCOGS_CONSUMER_KEY && env.DISCOGS_CONSUMER_SECRET);

const enc = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function nonce() {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function hmacSha1(key, text) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** Sign a request. Returns the oauth_* parameters including the signature; the same set is valid
    either in an Authorization header or appended to the query string (RFC 5849 §3.5). */
export async function signParams(env, method, url, { token = '', tokenSecret = '', extra = {} } = {}) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: env.DISCOGS_CONSUMER_KEY,
    oauth_nonce: nonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
    ...(token ? { oauth_token: token } : {}),
    ...extra
  };
  const all = { ...oauth };
  u.searchParams.forEach((v, k) => { all[k] = v; });
  const norm = Object.keys(all).map((k) => [enc(k), enc(all[k])])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map((p) => p.join('=')).join('&');
  const base = [method.toUpperCase(), enc(u.origin + u.pathname), enc(norm)].join('&');
  oauth.oauth_signature = await hmacSha1(enc(env.DISCOGS_CONSUMER_SECRET) + '&' + enc(tokenSecret), base);
  return oauth;
}

export const toHeader = (oauth) => 'OAuth ' + Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(', ');
export function toQueryUrl(url, oauth) {
  const u = new URL(url);
  for (const k of Object.keys(oauth)) u.searchParams.set(k, oauth[k]);
  return u.toString();
}

/** Build the OAuth Authorization header for a request. `extra` holds oauth_callback / oauth_verifier. */
export async function oauthHeader(env, method, url, opts = {}) {
  return toHeader(await signParams(env, method, url, opts));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Signed fetch against the Discogs API. Discogs throttles by source IP, and requests from Cloudflare
    leave from shared addresses, so a 429 is retried a few times with a pause. */
export async function discogsFetch(env, method, url, opts = {}) {
  let r;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(Math.min(6000, 1500 * attempt));
    const auth = await oauthHeader(env, method, url, opts);
    r = await fetch(url, { method, headers: { Authorization: auth, 'User-Agent': UA, Accept: opts.accept || 'application/json' } });
    if (r.status !== 429) return r;
  }
  return r;
}

export function parseForm(text) {
  const out = {};
  for (const part of text.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = decodeURIComponent(i < 0 ? part : part.slice(0, i));
    out[k] = i < 0 ? '' : decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
  }
  return out;
}
