/* D1 access, sessions and small HTTP helpers shared by the Pages Functions. */
const COOKIE = 'sv';
const SESSION_DAYS = 30;
const NONE_TTL_DAYS = 180;   // a "no vinyl" verdict is re-checked after this long

let schemaReady = null;
export function ensureSchema(env) {
  if (!env.DB) throw new Error('D1 binding "DB" is missing');
  if (!schemaReady) {
    schemaReady = env.DB.batch([
      env.DB.prepare('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, username TEXT NOT NULL, token TEXT NOT NULL, secret TEXT NOT NULL, created INTEGER NOT NULL)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS oauth_tmp (token TEXT PRIMARY KEY, secret TEXT NOT NULL, created INTEGER NOT NULL)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS verdicts (key TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL, user TEXT NOT NULL, updated INTEGER NOT NULL)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS verdicts_updated ON verdicts (updated)')
    ]).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

export function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export const sessionCookie = (id, maxAge = SESSION_DAYS * 86400) =>
  `${COOKIE}=${id}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export function randomId(bytes = 32) {
  const b = new Uint8Array(bytes); crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function getSession(request, env) {
  const id = parseCookies(request)[COOKIE];
  if (!id || !/^[0-9a-f]{64}$/.test(id)) return null;
  await ensureSchema(env);
  const row = await env.DB.prepare('SELECT id, username, token, secret, created FROM sessions WHERE id = ?').bind(id).first();
  if (!row) return null;
  if (Date.now() - row.created > SESSION_DAYS * 86400 * 1000) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return null;
  }
  return row;
}

/** Reject state-changing requests whose Origin is another site. */
export function sameOrigin(request) {
  const o = request.headers.get('Origin');
  if (!o) return true;                      // same-origin fetches may omit it; cookies are SameSite=Lax anyway
  return o === new URL(request.url).origin;
}

export const noneTtlMs = NONE_TTL_DAYS * 86400 * 1000;
