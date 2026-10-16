var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/pages-WQoJ9A/functionsWorker-0.7629309417961112.mjs
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var COOKIE = "sv";
var SESSION_DAYS = 30;
var NONE_TTL_DAYS = 180;
var schemaReady = null;
function ensureSchema(env) {
  if (!env.DB) throw new Error('D1 binding "DB" is missing');
  if (!schemaReady) {
    schemaReady = env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, username TEXT NOT NULL, token TEXT NOT NULL, secret TEXT NOT NULL, created INTEGER NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS oauth_tmp (token TEXT PRIMARY KEY, secret TEXT NOT NULL, created INTEGER NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS verdicts (key TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL, user TEXT NOT NULL, updated INTEGER NOT NULL)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS verdicts_updated ON verdicts (updated)")
    ]).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}
__name(ensureSchema, "ensureSchema");
__name2(ensureSchema, "ensureSchema");
var json = /* @__PURE__ */ __name2((data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } }), "json");
function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
__name(parseCookies, "parseCookies");
__name2(parseCookies, "parseCookies");
var sessionCookie = /* @__PURE__ */ __name2((id, maxAge = SESSION_DAYS * 86400) => `${COOKIE}=${id}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`, "sessionCookie");
var clearCookie = /* @__PURE__ */ __name2(() => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, "clearCookie");
function randomId(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
__name(randomId, "randomId");
__name2(randomId, "randomId");
async function getSession(request, env) {
  const id = parseCookies(request)[COOKIE];
  if (!id || !/^[0-9a-f]{64}$/.test(id)) return null;
  await ensureSchema(env);
  const row = await env.DB.prepare("SELECT id, username, token, secret, created FROM sessions WHERE id = ?").bind(id).first();
  if (!row) return null;
  if (Date.now() - row.created > SESSION_DAYS * 86400 * 1e3) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return null;
  }
  return row;
}
__name(getSession, "getSession");
__name2(getSession, "getSession");
function sameOrigin(request) {
  const o = request.headers.get("Origin");
  if (!o) return true;
  return o === new URL(request.url).origin;
}
__name(sameOrigin, "sameOrigin");
__name2(sameOrigin, "sameOrigin");
var noneTtlMs = NONE_TTL_DAYS * 86400 * 1e3;
var MAX_BATCH = 100;
var keyOk = /* @__PURE__ */ __name2((k) => typeof k === "string" && k.length >= 3 && k.length <= 300 && k.includes("|"), "keyOk");
function cleanVerdict(v) {
  if (!v || typeof v !== "object") return null;
  if (v.s !== "vinyl" && v.s !== "none") return null;
  if (v.manual) return null;
  const str = /* @__PURE__ */ __name2((x, n) => typeof x === "string" ? x.slice(0, n) : typeof x === "number" ? String(x) : "", "str");
  if (v.s === "none") return { s: "none", n: 0, via: str(v.via, 10) };
  const id = Number.isInteger(v.id) ? v.id : parseInt(v.id, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  const u = str(v.u, 300);
  const th = str(v.th, 300);
  return {
    s: "vinyl",
    n: Math.max(0, Math.min(99999, parseInt(v.n, 10) || 0)),
    id,
    t: str(v.t, 300),
    y: str(v.y, 4).replace(/\D/g, ""),
    c: str(v.c, 40),
    f: str(v.f, 120),
    th: /^https:\/\/i\.discogs\.com\//.test(th) ? th : "",
    u: /^https:\/\/www\.discogs\.com\//.test(u) ? u : "https://www.discogs.com/release/" + id,
    via: str(v.via, 10),
    conf: v.conf === "high" ? "high" : "medium"
  };
}
__name(cleanVerdict, "cleanVerdict");
__name2(cleanVerdict, "cleanVerdict");
async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "Shared cache is not configured." }, 503);
  await ensureSchema(env);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Bad JSON." }, 400);
  }
  const keys = Array.isArray(body && body.keys) ? body.keys.filter(keyOk).slice(0, MAX_BATCH) : [];
  if (!keys.length) return json({});
  const placeholders = keys.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT key, status, data, updated FROM verdicts WHERE key IN (${placeholders})`).bind(...keys).all();
  const out = {};
  const now = Date.now();
  for (const r of results) {
    if (r.status === "none" && now - r.updated > noneTtlMs) continue;
    try {
      out[r.key] = { ...JSON.parse(r.data), shared: true, ts: r.updated };
    } catch (e) {
    }
  }
  return json(out);
}
__name(onRequestPost, "onRequestPost");
__name2(onRequestPost, "onRequestPost");
async function onRequestPut({ request, env }) {
  if (!env.DB) return json({ error: "Shared cache is not configured." }, 503);
  if (!sameOrigin(request)) return json({ error: "Cross-site request refused." }, 403);
  const s = await getSession(request, env);
  if (!s) return json({ error: "Log in with Discogs to contribute results." }, 401);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Bad JSON." }, 400);
  }
  const items = Array.isArray(body && body.items) ? body.items.slice(0, MAX_BATCH) : [];
  const stmts = [];
  const now = Date.now();
  for (const it of items) {
    if (!it || !keyOk(it.key)) continue;
    const v = cleanVerdict(it.v);
    if (!v) continue;
    stmts.push(env.DB.prepare(
      "INSERT INTO verdicts (key, status, data, user, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET status = excluded.status, data = excluded.data, user = excluded.user, updated = excluded.updated WHERE NOT (verdicts.status = 'vinyl' AND excluded.status = 'none')"
    ).bind(it.key, v.s, JSON.stringify(v), s.username, now));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ stored: stmts.length });
}
__name(onRequestPut, "onRequestPut");
__name2(onRequestPut, "onRequestPut");
var UA = "SpotiVinyl/1.0 +https://github.com/GarrettKK/SpotiVinyl";
var apiBase = /* @__PURE__ */ __name2((env) => (env.DISCOGS_API || "https://api.discogs.com").replace(/\/$/, ""), "apiBase");
var authorizeUrl = /* @__PURE__ */ __name2((env) => env.DISCOGS_AUTHORIZE || "https://discogs.com/oauth/authorize", "authorizeUrl");
var configured = /* @__PURE__ */ __name2((env) => Boolean(env.DISCOGS_CONSUMER_KEY && env.DISCOGS_CONSUMER_SECRET), "configured");
var enc = /* @__PURE__ */ __name2((s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()), "enc");
function nonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
__name(nonce, "nonce");
__name2(nonce, "nonce");
async function hmacSha1(key, text) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
__name(hmacSha1, "hmacSha1");
__name2(hmacSha1, "hmacSha1");
async function signParams(env, method, url, { token = "", tokenSecret = "", extra = {} } = {}) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: env.DISCOGS_CONSUMER_KEY,
    oauth_nonce: nonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1e3).toString(),
    oauth_version: "1.0",
    ...token ? { oauth_token: token } : {},
    ...extra
  };
  const all = { ...oauth };
  u.searchParams.forEach((v, k) => {
    all[k] = v;
  });
  const norm = Object.keys(all).map((k) => [enc(k), enc(all[k])]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1).map((p) => p.join("=")).join("&");
  const base = [method.toUpperCase(), enc(u.origin + u.pathname), enc(norm)].join("&");
  oauth.oauth_signature = await hmacSha1(enc(env.DISCOGS_CONSUMER_SECRET) + "&" + enc(tokenSecret), base);
  return oauth;
}
__name(signParams, "signParams");
__name2(signParams, "signParams");
var toHeader = /* @__PURE__ */ __name2((oauth) => "OAuth " + Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(", "), "toHeader");
function toQueryUrl(url, oauth) {
  const u = new URL(url);
  for (const k of Object.keys(oauth)) u.searchParams.set(k, oauth[k]);
  return u.toString();
}
__name(toQueryUrl, "toQueryUrl");
__name2(toQueryUrl, "toQueryUrl");
async function oauthHeader(env, method, url, opts = {}) {
  return toHeader(await signParams(env, method, url, opts));
}
__name(oauthHeader, "oauthHeader");
__name2(oauthHeader, "oauthHeader");
var sleep = /* @__PURE__ */ __name2((ms) => new Promise((r) => setTimeout(r, ms)), "sleep");
async function discogsFetch(env, method, url, opts = {}) {
  let r;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(Math.min(6e3, 1500 * attempt));
    const auth = await oauthHeader(env, method, url, opts);
    r = await fetch(url, { method, headers: { Authorization: auth, "User-Agent": UA, Accept: opts.accept || "application/json" } });
    if (r.status !== 429) return r;
  }
  return r;
}
__name(discogsFetch, "discogsFetch");
__name2(discogsFetch, "discogsFetch");
function parseForm(text) {
  const out = {};
  for (const part of text.split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = decodeURIComponent(i < 0 ? part : part.slice(0, i));
    out[k] = i < 0 ? "" : decodeURIComponent(part.slice(i + 1).replace(/\+/g, " "));
  }
  return out;
}
__name(parseForm, "parseForm");
__name2(parseForm, "parseForm");
async function onRequestGet({ request, env }) {
  const hasDb = Boolean(env.DB);
  let s = null;
  try {
    s = hasDb ? await getSession(request, env) : null;
  } catch (e) {
    return json({ username: null, loginAvailable: false, sharedCache: false, error: "Database not ready: " + e.message });
  }
  return json({ username: s ? s.username : null, loginAvailable: hasDb && configured(env), sharedCache: hasDb });
}
__name(onRequestGet, "onRequestGet");
__name2(onRequestGet, "onRequestGet");
var ALLOWED = ["artist", "release_title", "track", "q", "type"];
async function onRequestGet2({ request, env }) {
  const s = await getSession(request, env);
  if (!s) return json({ error: "Not logged in." }, 401);
  const inUrl = new URL(request.url);
  const out = new URL(apiBase(env) + "/database/search");
  for (const k of ALLOWED) {
    const v = inUrl.searchParams.get(k);
    if (v) out.searchParams.set(k, v.slice(0, 300));
  }
  if (![...out.searchParams.keys()].length) return json({ error: "Nothing to search for." }, 400);
  out.searchParams.set("format", "Vinyl");
  out.searchParams.set("per_page", String(Math.min(10, Math.max(1, parseInt(inUrl.searchParams.get("per_page") || "8", 10) || 8))));
  const r = await discogsFetch(env, "GET", out.toString(), { token: s.token, tokenSecret: s.secret });
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  for (const h of ["X-Discogs-Ratelimit", "X-Discogs-Ratelimit-Used", "X-Discogs-Ratelimit-Remaining", "Retry-After"]) {
    const v = r.headers.get(h);
    if (v) headers[h] = v;
  }
  if (r.status === 401) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(s.id).run();
    return json({ error: "Discogs no longer accepts this login. Please log in again." }, 401);
  }
  if (!r.ok) return new Response(await r.text(), { status: r.status, headers });
  const data = await r.json();
  const results = (data.results || []).map((x) => ({ id: x.id, type: x.type, title: x.title, year: x.year, country: x.country, format: x.format, thumb: x.thumb, uri: x.uri, master_id: x.master_id }));
  return new Response(JSON.stringify({ pagination: { items: data.pagination && data.pagination.items || results.length }, results }), { status: 200, headers });
}
__name(onRequestGet2, "onRequestGet2");
__name2(onRequestGet2, "onRequestGet");
var ALLOWED2 = ["artist", "release_title", "track", "q", "type"];
async function onRequestGet3({ request, env }) {
  const s = await getSession(request, env);
  if (!s) return json({ error: "Not logged in." }, 401);
  const inUrl = new URL(request.url);
  const out = new URL(apiBase(env) + "/database/search");
  for (const k of ALLOWED2) {
    const v = inUrl.searchParams.get(k);
    if (v) out.searchParams.set(k, v.slice(0, 300));
  }
  if (![...out.searchParams.keys()].length) return json({ error: "Nothing to search for." }, 400);
  out.searchParams.set("format", "Vinyl");
  out.searchParams.set("per_page", String(Math.min(10, Math.max(1, parseInt(inUrl.searchParams.get("per_page") || "8", 10) || 8))));
  const plainUrl = out.toString();
  const oauth = await signParams(env, "GET", plainUrl, { token: s.token, tokenSecret: s.secret });
  return json({ url: toQueryUrl(plainUrl, oauth), plainUrl, header: toHeader(oauth), expires: Date.now() + 24e4 });
}
__name(onRequestGet3, "onRequestGet3");
__name2(onRequestGet3, "onRequestGet");
var back = /* @__PURE__ */ __name2((origin, status) => new Response(null, { status: 302, headers: { Location: origin + "/?login=" + status } }), "back");
async function onRequestGet4({ request, env }) {
  const url = new URL(request.url);
  if (!configured(env)) return back(url.origin, "unconfigured");
  const token = url.searchParams.get("oauth_token") || "";
  const verifier = url.searchParams.get("oauth_verifier") || "";
  if (!token || !verifier) return back(url.origin, "denied");
  await ensureSchema(env);
  const tmp = await env.DB.prepare("SELECT secret FROM oauth_tmp WHERE token = ?").bind(token).first();
  if (!tmp) return back(url.origin, "expired");
  const r = await discogsFetch(env, "POST", apiBase(env) + "/oauth/access_token", { token, tokenSecret: tmp.secret, extra: { oauth_verifier: verifier }, accept: "text/plain" });
  const body = await r.text();
  if (!r.ok) return back(url.origin, "error");
  const a = parseForm(body);
  if (!a.oauth_token || !a.oauth_token_secret) return back(url.origin, "error");
  const idr = await discogsFetch(env, "GET", apiBase(env) + "/oauth/identity", { token: a.oauth_token, tokenSecret: a.oauth_token_secret });
  if (!idr.ok) return back(url.origin, "error");
  const me = await idr.json();
  const username = String(me.username || "").slice(0, 100);
  if (!username) return back(url.origin, "error");
  const id = randomId();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_tmp WHERE token = ?").bind(token),
    env.DB.prepare("INSERT INTO sessions (id, username, token, secret, created) VALUES (?, ?, ?, ?, ?)").bind(id, username, a.oauth_token, a.oauth_token_secret, Date.now())
  ]);
  return new Response(null, { status: 302, headers: { Location: url.origin + "/?login=ok", "Set-Cookie": sessionCookie(id) } });
}
__name(onRequestGet4, "onRequestGet4");
__name2(onRequestGet4, "onRequestGet");
async function onRequestGet5({ request, env }) {
  if (!configured(env)) return json({ error: "Discogs login is not configured on this deployment." }, 503);
  await ensureSchema(env);
  const origin = new URL(request.url).origin;
  const callback = origin + "/auth/callback";
  const r = await discogsFetch(env, "GET", apiBase(env) + "/oauth/request_token", { extra: { oauth_callback: callback }, accept: "text/plain" });
  const body = await r.text();
  if (!r.ok) return json({ error: "Discogs did not issue a request token.", status: r.status, detail: body.slice(0, 300) }, 502);
  const t = parseForm(body);
  if (!t.oauth_token || !t.oauth_token_secret) return json({ error: "Unexpected response from Discogs.", detail: body.slice(0, 300) }, 502);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_tmp WHERE created < ?").bind(Date.now() - 3600 * 1e3),
    env.DB.prepare("INSERT OR REPLACE INTO oauth_tmp (token, secret, created) VALUES (?, ?, ?)").bind(t.oauth_token, t.oauth_token_secret, Date.now())
  ]);
  return Response.redirect(authorizeUrl(env) + "?oauth_token=" + encodeURIComponent(t.oauth_token), 302);
}
__name(onRequestGet5, "onRequestGet5");
__name2(onRequestGet5, "onRequestGet");
async function onRequestPost2({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Cross-site request refused." }, 403);
  const s = await getSession(request, env);
  if (s) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(s.id).run();
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
}
__name(onRequestPost2, "onRequestPost2");
__name2(onRequestPost2, "onRequestPost");
var routes = [
  {
    routePath: "/api/cache",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/cache",
    mountPath: "/api",
    method: "PUT",
    middlewares: [],
    modules: [onRequestPut]
  },
  {
    routePath: "/api/me",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/search",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/sign",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet3]
  },
  {
    routePath: "/auth/callback",
    mountPath: "/auth",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet4]
  },
  {
    routePath: "/auth/login",
    mountPath: "/auth",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet5]
  },
  {
    routePath: "/auth/logout",
    mountPath: "/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  }
];
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
__name2(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name2(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name2(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name2(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name2(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name2(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
__name2(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
__name2(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name2(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
__name2(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
__name2(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
__name2(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
__name2(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
__name2(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
__name2(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
__name2(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");
__name2(pathToRegexp, "pathToRegexp");
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
__name2(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name2(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name2(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name2((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
var drainBody = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
__name2(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
__name2(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
__name2(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");
__name2(__facade_invoke__, "__facade_invoke__");
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  static {
    __name(this, "___Facade_ScheduledController__");
  }
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name2(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name2(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name2(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
__name2(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name2((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name2((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
__name2(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;

// ../../../tmp/claude-0/-home-user/47cc4bcd-2aa5-5a29-82c4-f2825d62bfad/scratchpad/wr/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default2 = drainBody2;

// ../../../tmp/claude-0/-home-user/47cc4bcd-2aa5-5a29-82c4-f2825d62bfad/scratchpad/wr/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError2(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError2(e.cause)
  };
}
__name(reduceError2, "reduceError");
var jsonError2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError2(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default2 = jsonError2;

// .wrangler/tmp/bundle-IIcsnY/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__2 = [
  middleware_ensure_req_body_drained_default2,
  middleware_miniflare3_json_error_default2
];
var middleware_insertion_facade_default2 = middleware_loader_entry_default;

// ../../../tmp/claude-0/-home-user/47cc4bcd-2aa5-5a29-82c4-f2825d62bfad/scratchpad/wr/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__2 = [];
function __facade_register__2(...args) {
  __facade_middleware__2.push(...args.flat());
}
__name(__facade_register__2, "__facade_register__");
function __facade_invokeChain__2(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__2(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__2, "__facade_invokeChain__");
function __facade_invoke__2(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__2(request, env, ctx, dispatch, [
    ...__facade_middleware__2,
    finalMiddleware
  ]);
}
__name(__facade_invoke__2, "__facade_invoke__");

// .wrangler/tmp/bundle-IIcsnY/middleware-loader.entry.ts
var __Facade_ScheduledController__2 = class ___Facade_ScheduledController__2 {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__2)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler2(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__2(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__2(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler2, "wrapExportedHandler");
function wrapWorkerEntrypoint2(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__2(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__2(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint2, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY2;
if (typeof middleware_insertion_facade_default2 === "object") {
  WRAPPED_ENTRY2 = wrapExportedHandler2(middleware_insertion_facade_default2);
} else if (typeof middleware_insertion_facade_default2 === "function") {
  WRAPPED_ENTRY2 = wrapWorkerEntrypoint2(middleware_insertion_facade_default2);
}
var middleware_loader_entry_default2 = WRAPPED_ENTRY2;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__2 as __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default2 as default
};
//# sourceMappingURL=functionsWorker-0.7629309417961112.js.map
