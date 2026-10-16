/* Sign a Discogs search for the logged-in user so the browser can call Discogs directly.
   Discogs rate-limits by source IP; the browser's own address gets the user a full 60 requests
   a minute, while Cloudflare's shared egress addresses would not.
   GET /api/sign?artist=…&release_title=…  ->  { url, plainUrl, header, expires } */
import { apiBase, signParams, toHeader, toQueryUrl } from '../lib/discogs.js';
import { getSession, json } from '../lib/store.js';

const ALLOWED = ['artist', 'release_title', 'track', 'q', 'type'];

export async function onRequestGet({ request, env }) {
  const s = await getSession(request, env);
  if (!s) return json({ error: 'Not logged in.' }, 401);
  const inUrl = new URL(request.url);
  const out = new URL(apiBase(env) + '/database/search');
  for (const k of ALLOWED) { const v = inUrl.searchParams.get(k); if (v) out.searchParams.set(k, v.slice(0, 300)); }
  if (![...out.searchParams.keys()].length) return json({ error: 'Nothing to search for.' }, 400);
  out.searchParams.set('format', 'Vinyl');
  out.searchParams.set('per_page', String(Math.min(10, Math.max(1, parseInt(inUrl.searchParams.get('per_page') || '8', 10) || 8))));
  const plainUrl = out.toString();
  const oauth = await signParams(env, 'GET', plainUrl, { token: s.token, tokenSecret: s.secret });
  return json({ url: toQueryUrl(plainUrl, oauth), plainUrl, header: toHeader(oauth), expires: Date.now() + 240000 });
}
