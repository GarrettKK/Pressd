import { apiBase, configured, discogsFetch, parseForm } from '../lib/discogs.js';
import { ensureSchema, randomId, sessionCookie } from '../lib/store.js';

const back = (origin, status) => new Response(null, { status: 302, headers: { Location: origin + '/?login=' + status } });

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!configured(env)) return back(url.origin, 'unconfigured');
  const token = url.searchParams.get('oauth_token') || '';
  const verifier = url.searchParams.get('oauth_verifier') || '';
  if (!token || !verifier) return back(url.origin, 'denied');
  await ensureSchema(env);
  const tmp = await env.DB.prepare('SELECT secret FROM oauth_tmp WHERE token = ?').bind(token).first();
  if (!tmp) return back(url.origin, 'expired');

  const r = await discogsFetch(env, 'POST', apiBase(env) + '/oauth/access_token', { token, tokenSecret: tmp.secret, extra: { oauth_verifier: verifier }, accept: 'text/plain' });
  const body = await r.text();
  if (!r.ok) return back(url.origin, 'error');
  const a = parseForm(body);
  if (!a.oauth_token || !a.oauth_token_secret) return back(url.origin, 'error');

  const idr = await discogsFetch(env, 'GET', apiBase(env) + '/oauth/identity', { token: a.oauth_token, tokenSecret: a.oauth_token_secret });
  if (!idr.ok) return back(url.origin, 'error');
  const me = await idr.json();
  const username = String(me.username || '').slice(0, 100);
  if (!username) return back(url.origin, 'error');

  const id = randomId();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_tmp WHERE token = ?').bind(token),
    env.DB.prepare('INSERT INTO sessions (id, username, token, secret, created) VALUES (?, ?, ?, ?, ?)').bind(id, username, a.oauth_token, a.oauth_token_secret, Date.now())
  ]);
  return new Response(null, { status: 302, headers: { Location: url.origin + '/?login=ok', 'Set-Cookie': sessionCookie(id) } });
}
