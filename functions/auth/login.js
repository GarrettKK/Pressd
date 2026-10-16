import { apiBase, authorizeUrl, configured, discogsFetch, parseForm } from '../lib/discogs.js';
import { ensureSchema, json } from '../lib/store.js';

export async function onRequestGet({ request, env }) {
  if (!configured(env)) return json({ error: 'Discogs login is not configured on this deployment.' }, 503);
  await ensureSchema(env);
  const origin = new URL(request.url).origin;
  const callback = origin + '/auth/callback';
  const r = await discogsFetch(env, 'GET', apiBase(env) + '/oauth/request_token', { extra: { oauth_callback: callback }, accept: 'text/plain' });
  const body = await r.text();
  if (!r.ok) return json({ error: 'Discogs did not issue a request token.', status: r.status, detail: body.slice(0, 300) }, 502);
  const t = parseForm(body);
  if (!t.oauth_token || !t.oauth_token_secret) return json({ error: 'Unexpected response from Discogs.', detail: body.slice(0, 300) }, 502);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_tmp WHERE created < ?').bind(Date.now() - 3600 * 1000),
    env.DB.prepare('INSERT OR REPLACE INTO oauth_tmp (token, secret, created) VALUES (?, ?, ?)').bind(t.oauth_token, t.oauth_token_secret, Date.now())
  ]);
  return Response.redirect(authorizeUrl(env) + '?oauth_token=' + encodeURIComponent(t.oauth_token), 302);
}
