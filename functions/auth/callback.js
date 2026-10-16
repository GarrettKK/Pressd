import { apiBase, configured, discogsFetch, parseForm } from '../lib/discogs.js';
import { ensureSchema, randomId, sessionCookie } from '../lib/store.js';

const back = (origin, status) => new Response(null, { status: 302, headers: { Location: origin + '/?login=' + status } });

/* Discogs sends the user back here with a verifier. The server tries to finish the handshake itself;
   when Discogs throttles the server's address, the browser finishes it instead (see /api/oauth). */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!configured(env)) return back(url.origin, 'unconfigured');
  const token = url.searchParams.get('oauth_token') || '';
  const verifier = url.searchParams.get('oauth_verifier') || '';
  if (!token || !verifier) return back(url.origin, 'denied');
  await ensureSchema(env);
  const tmp = await env.DB.prepare('SELECT secret FROM oauth_tmp WHERE token = ?').bind(token).first();
  if (!tmp) return back(url.origin, 'expired');

  const toBrowser = () => new Response(null, { status: 302, headers: { Location: url.origin + '/?oauth_token=' + encodeURIComponent(token) + '&oauth_verifier=' + encodeURIComponent(verifier) } });
  let a;
  try {
    const r = await discogsFetch(env, 'POST', apiBase(env) + '/oauth/access_token', { token, tokenSecret: tmp.secret, extra: { oauth_verifier: verifier }, accept: 'text/plain', attempts: 2 });
    if (r.status === 429 || r.status >= 500) return toBrowser();
    if (!r.ok) return back(url.origin, 'error');
    a = parseForm(await r.text());
  } catch (e) { return toBrowser(); }
  if (!a.oauth_token || !a.oauth_token_secret) return back(url.origin, 'error');

  let username = '';
  try {
    const idr = await discogsFetch(env, 'GET', apiBase(env) + '/oauth/identity', { token: a.oauth_token, tokenSecret: a.oauth_token_secret, attempts: 2 });
    if (idr.ok) { const me = await idr.json(); username = String(me.username || '').slice(0, 100); }
    else if (idr.status === 401) return back(url.origin, 'error');
  } catch (e) { /* identity can be fetched by the browser later */ }
  if (!username) {
    // Access token is ours but the name is not: let the browser fetch the identity and finish.
    return new Response(null, { status: 302, headers: { Location: url.origin + '/?oauth_access=' + encodeURIComponent(a.oauth_token) + '&oauth_access_secret=' + encodeURIComponent(a.oauth_token_secret) } });
  }

  const id = randomId();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_tmp WHERE token = ?').bind(token),
    env.DB.prepare('INSERT INTO sessions (id, username, token, secret, created) VALUES (?, ?, ?, ?, ?)').bind(id, username, a.oauth_token, a.oauth_token_secret, Date.now())
  ]);
  return new Response(null, { status: 302, headers: { Location: url.origin + '/?login=ok', 'Set-Cookie': sessionCookie(id) } });
}
