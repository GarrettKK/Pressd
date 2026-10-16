import { clearCookie, getSession, json, sameOrigin } from '../lib/store.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Cross-site request refused.' }, 403);
  const s = await getSession(request, env);
  if (s) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(s.id).run();
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}
