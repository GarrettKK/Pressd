/* Shared verdict cache.
   POST /api/cache  { keys: [...] }            -> { key: verdict, ... }   (anyone)
   PUT  /api/cache  { items: [{ key, v }] }    -> { stored: n }           (logged-in users)
   A verdict is { s: 'vinyl'|'none', n, id, t, y, c, f, th, u, via, conf }. */
import { ensureSchema, getSession, json, noneTtlMs, sameOrigin } from '../lib/store.js';

const MAX_BATCH = 100;
const keyOk = (k) => typeof k === 'string' && k.length >= 3 && k.length <= 300 && k.includes('|');

function cleanVerdict(v) {
  if (!v || typeof v !== 'object') return null;
  if (v.s !== 'vinyl' && v.s !== 'none') return null;
  if (v.manual) return null;
  const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : typeof x === 'number' ? String(x) : '');
  if (v.s === 'none') return { s: 'none', n: 0, via: str(v.via, 10) };
  const id = Number.isInteger(v.id) ? v.id : parseInt(v.id, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  const u = str(v.u, 300);
  const th = str(v.th, 300);
  return {
    s: 'vinyl', n: Math.max(0, Math.min(99999, parseInt(v.n, 10) || 0)), id,
    t: str(v.t, 300), y: str(v.y, 4).replace(/\D/g, ''), c: str(v.c, 40), f: str(v.f, 120),
    th: /^https:\/\/i\.discogs\.com\//.test(th) ? th : '',
    u: /^https:\/\/www\.discogs\.com\//.test(u) ? u : 'https://www.discogs.com/release/' + id,
    via: str(v.via, 10), conf: v.conf === 'high' ? 'high' : 'medium'
  };
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'Shared cache is not configured.' }, 503);
  await ensureSchema(env);
  let body; try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON.' }, 400); }
  const keys = Array.isArray(body && body.keys) ? body.keys.filter(keyOk).slice(0, MAX_BATCH) : [];
  if (!keys.length) return json({});
  const placeholders = keys.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT key, status, data, updated FROM verdicts WHERE key IN (${placeholders})`).bind(...keys).all();
  const out = {}; const now = Date.now();
  for (const r of results) {
    if (r.status === 'none' && now - r.updated > noneTtlMs) continue;
    try { out[r.key] = { ...JSON.parse(r.data), shared: true, ts: r.updated }; } catch (e) { /* skip a corrupt row */ }
  }
  return json(out);
}

export async function onRequestPut({ request, env }) {
  if (!env.DB) return json({ error: 'Shared cache is not configured.' }, 503);
  if (!sameOrigin(request)) return json({ error: 'Cross-site request refused.' }, 403);
  const s = await getSession(request, env);
  if (!s) return json({ error: 'Log in with Discogs to contribute results.' }, 401);
  let body; try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON.' }, 400); }
  const items = Array.isArray(body && body.items) ? body.items.slice(0, MAX_BATCH) : [];
  const stmts = []; const now = Date.now();
  for (const it of items) {
    if (!it || !keyOk(it.key)) continue;
    const v = cleanVerdict(it.v); if (!v) continue;
    // A "vinyl" verdict is never overwritten by a "none" one.
    stmts.push(env.DB.prepare(
      'INSERT INTO verdicts (key, status, data, user, updated) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET status = excluded.status, data = excluded.data, user = excluded.user, updated = excluded.updated ' +
      "WHERE NOT (verdicts.status = 'vinyl' AND excluded.status = 'none')"
    ).bind(it.key, v.s, JSON.stringify(v), s.username, now));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ stored: stmts.length });
}
