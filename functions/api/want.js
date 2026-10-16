/* Server-side fallback for wantlist writes, used when the browser cannot send a cross-origin
   PUT/DELETE to Discogs. Rare and small, so the shared-address rate limit is tolerable here.
   POST /api/want { op: 'want'|'unwant', release_id } -> { ok, status } */
import { discogsFetch } from '../lib/discogs.js';
import { getSession, json, sameOrigin } from '../lib/store.js';
import { buildRequest } from './sign.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Cross-site request refused.' }, 403);
  const s = await getSession(request, env);
  if (!s) return json({ error: 'Not logged in.' }, 401);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'Bad JSON.' }, 400); }
  if (b.op !== 'want' && b.op !== 'unwant') return json({ error: 'Unknown operation.' }, 400);
  const q = new URLSearchParams({ op: b.op, release_id: String(b.release_id || '') });
  const r = buildRequest(env, s, q);
  if (r.error) return json({ error: r.error }, 400);
  const resp = await discogsFetch(env, r.method, r.url, { token: s.token, tokenSecret: s.secret, attempts: 3 });
  if (resp.status === 429) return json({ error: 'Discogs is rate-limiting right now. Try again in a minute.' }, 429);
  if (resp.status === 401) return json({ error: 'Discogs no longer accepts this login. Please log in again.' }, 401);
  return json({ ok: resp.ok, status: resp.status }, resp.ok ? 200 : 502);
}
