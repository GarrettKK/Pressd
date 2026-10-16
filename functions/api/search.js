import { apiBase, discogsFetch } from '../lib/discogs.js';
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

  const r = await discogsFetch(env, 'GET', out.toString(), { token: s.token, tokenSecret: s.secret });
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  for (const h of ['X-Discogs-Ratelimit', 'X-Discogs-Ratelimit-Used', 'X-Discogs-Ratelimit-Remaining', 'Retry-After']) { const v = r.headers.get(h); if (v) headers[h] = v; }
  if (r.status === 401) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(s.id).run();
    return json({ error: 'Discogs no longer accepts this login. Please log in again.' }, 401);
  }
  if (!r.ok) return new Response(await r.text(), { status: r.status, headers });
  // Pass through only what the page uses, to keep responses small.
  const data = await r.json();
  const results = (data.results || []).map((x) => ({ id: x.id, type: x.type, title: x.title, year: x.year, country: x.country, format: x.format, thumb: x.thumb, uri: x.uri, master_id: x.master_id }));
  return new Response(JSON.stringify({ pagination: { items: (data.pagination && data.pagination.items) || results.length }, results }), { status: 200, headers });
}
