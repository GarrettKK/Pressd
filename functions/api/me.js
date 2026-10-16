import { configured } from '../lib/discogs.js';
import { getSession, json } from '../lib/store.js';

export async function onRequestGet({ request, env }) {
  const hasDb = Boolean(env.DB);
  let s = null;
  try { s = hasDb ? await getSession(request, env) : null; } catch (e) { return json({ username: null, loginAvailable: false, sharedCache: false, error: 'Database not ready: ' + e.message }); }
  return json({ username: s ? s.username : null, loginAvailable: hasDb && configured(env), sharedCache: hasDb });
}
