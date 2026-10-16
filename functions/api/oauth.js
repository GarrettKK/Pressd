/* Browser-driven Discogs OAuth handshake.
   Discogs throttles by source IP and Cloudflare's shared egress addresses are usually over the
   limit, so the server only signs each step and the browser sends it to Discogs itself.
   POST /api/oauth with JSON { step, ... }:
     start                                   -> signed request_token call
     store    { oauth_token, oauth_token_secret } -> keeps the request secret, returns the authorize URL
     exchange { oauth_token, oauth_verifier }     -> signed access_token call (POST)
     identity { token, secret }                   -> signed identity call
     finish   { token, secret, username }         -> creates the session cookie */
import { apiBase, authorizeUrl, configured, oauthHeader, signParams, toHeader, toQueryUrl, UA } from '../lib/discogs.js';
import { ensureSchema, json, randomId, sameOrigin, sessionCookie } from '../lib/store.js';

const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
const signed = (url, oauth) => ({ url: toQueryUrl(url, oauth), plainUrl: url, header: toHeader(oauth) });

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return json({ error: 'Discogs login is not configured on this deployment.' }, 503);
  if (!sameOrigin(request)) return json({ error: 'Cross-site request refused.' }, 403);
  await ensureSchema(env);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'Bad JSON.' }, 400); }
  const origin = new URL(request.url).origin;

  if (b.step === 'start') {
    const url = apiBase(env) + '/oauth/request_token';
    const oauth = await signParams(env, 'GET', url, { extra: { oauth_callback: origin + '/auth/callback' } });
    return json(signed(url, oauth));
  }

  if (b.step === 'store') {
    const t = str(b.oauth_token), s = str(b.oauth_token_secret);
    if (!t || !s) return json({ error: 'Missing request token.' }, 400);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM oauth_tmp WHERE created < ?').bind(Date.now() - 3600 * 1000),
      env.DB.prepare('INSERT OR REPLACE INTO oauth_tmp (token, secret, created) VALUES (?, ?, ?)').bind(t, s, Date.now())
    ]);
    return json({ ok: true, authorize: authorizeUrl(env) + '?oauth_token=' + encodeURIComponent(t) });
  }

  if (b.step === 'exchange') {
    const t = str(b.oauth_token), v = str(b.oauth_verifier);
    if (!t || !v) return json({ error: 'Missing token or verifier.' }, 400);
    const tmp = await env.DB.prepare('SELECT secret FROM oauth_tmp WHERE token = ?').bind(t).first();
    if (!tmp) return json({ error: 'The login link expired, please try again.' }, 410);
    const url = apiBase(env) + '/oauth/access_token';
    const oauth = await signParams(env, 'POST', url, { token: t, tokenSecret: tmp.secret, extra: { oauth_verifier: v } });
    return json(signed(url, oauth));
  }

  if (b.step === 'identity') {
    const t = str(b.token), s = str(b.secret);
    if (!t || !s) return json({ error: 'Missing token.' }, 400);
    const url = apiBase(env) + '/oauth/identity';
    const oauth = await signParams(env, 'GET', url, { token: t, tokenSecret: s });
    return json(signed(url, oauth));
  }

  if (b.step === 'finish') {
    const t = str(b.token), s = str(b.secret);
    let username = str(b.username, 100).replace(/[^\w.\-]/g, '');
    if (!t || !s) return json({ error: 'Missing token.' }, 400);
    // Verify with Discogs when its rate limit lets us (one attempt, so the login stays quick).
    let verified = false;
    try {
      const url = apiBase(env) + '/oauth/identity';
      const r = await fetch(url, { headers: { Authorization: await oauthHeader(env, 'GET', url, { token: t, tokenSecret: s }), 'User-Agent': UA, Accept: 'application/json' } });
      if (r.status === 401) return json({ error: 'Discogs rejected this login. Please try again.' }, 401);
      if (r.ok) { const me = await r.json(); if (me && me.username) { username = String(me.username).slice(0, 100); verified = true; } }
    } catch (e) { /* unreachable from here: fall back to the name the browser saw */ }
    if (!username) return json({ error: 'Could not determine your Discogs username. Please try again.' }, 400);
    const id = randomId();
    await env.DB.prepare('INSERT INTO sessions (id, username, token, secret, created) VALUES (?, ?, ?, ?, ?)')
      .bind(id, verified ? username : username + ' (unverified)', t, s, Date.now()).run();
    return json({ ok: true, username }, 200, { 'Set-Cookie': sessionCookie(id) });
  }

  return json({ error: 'Unknown step.' }, 400);
}
