/* Sign a Discogs API call for the logged-in user so the browser can send it to Discogs directly.
   Discogs rate-limits by source IP; the browser's own address gets the user a full 60 requests
   a minute, while Cloudflare's shared egress addresses would not.
   GET /api/sign?artist=…&release_title=…           search (default op)
   GET /api/sign?op=stats&release_id=N&curr=USD      marketplace lowest price / number for sale
   GET /api/sign?op=want&release_id=N                add to the user's wantlist (PUT)
   GET /api/sign?op=unwant&release_id=N              remove from the wantlist (DELETE)
   GET /api/sign?op=wantlist&page=N                  one page of the user's wantlist
   ->  { url, plainUrl, header, method } */
import { apiBase, signParams, toHeader, toQueryUrl } from '../lib/discogs.js';
import { getSession, json } from '../lib/store.js';

const SEARCH = ['artist', 'release_title', 'track', 'q', 'type'];
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'SEK', 'BRL', 'MXN', 'NZD', 'ZAR'];

/** Build the Discogs request for an operation; returns { method, url } or an error string. */
export function buildRequest(env, s, q) {
  const op = q.get('op') || 'search';
  const base = apiBase(env);
  const user = encodeURIComponent(s.username.replace(/ \(unverified\)$/, ''));
  const releaseId = parseInt(q.get('release_id') || '', 10);
  if (op === 'search') {
    const out = new URL(base + '/database/search');
    for (const k of SEARCH) { const v = q.get(k); if (v) out.searchParams.set(k, v.slice(0, 300)); }
    if (![...out.searchParams.keys()].length) return { error: 'Nothing to search for.' };
    out.searchParams.set('format', 'Vinyl');
    out.searchParams.set('per_page', String(Math.min(10, Math.max(1, parseInt(q.get('per_page') || '8', 10) || 8))));
    return { method: 'GET', url: out.toString() };
  }
  if (op === 'wantlist') {
    const page = Math.min(50, Math.max(1, parseInt(q.get('page') || '1', 10) || 1));
    return { method: 'GET', url: `${base}/users/${user}/wants?per_page=100&page=${page}` };
  }
  if (!Number.isInteger(releaseId) || releaseId <= 0) return { error: 'release_id must be a positive integer.' };
  if (op === 'stats') {
    const curr = CURRENCIES.includes(q.get('curr')) ? q.get('curr') : 'USD';
    return { method: 'GET', url: `${base}/marketplace/stats/${releaseId}?curr_abbr=${curr}` };
  }
  if (op === 'want') return { method: 'PUT', url: `${base}/users/${user}/wants/${releaseId}` };
  if (op === 'unwant') return { method: 'DELETE', url: `${base}/users/${user}/wants/${releaseId}` };
  return { error: 'Unknown operation.' };
}

export async function onRequestGet({ request, env }) {
  const s = await getSession(request, env);
  if (!s) return json({ error: 'Not logged in.' }, 401);
  const r = buildRequest(env, s, new URL(request.url).searchParams);
  if (r.error) return json({ error: r.error }, 400);
  const oauth = await signParams(env, r.method, r.url, { token: s.token, tokenSecret: s.secret });
  return json({ url: toQueryUrl(r.url, oauth), plainUrl: r.url, header: toHeader(oauth), method: r.method, expires: Date.now() + 240000 });
}
