/* SpotiVinyl app: library state, Discogs check loop, list rendering, export and statistics. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LS = { token: 'spotivinyl.token', results: 'spotivinyl.results.v1', library: 'spotivinyl.library.v1' };
  const OLD = { token: 'vinylcheck.token', results: 'vinylcheck.results.v1', library: 'vinylcheck.library' };
  const DELAY_MS = 1100;          // Discogs allows 60 authenticated requests a minute
  const PAGE = 60;

  // ---------- storage ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  // ---------- normalisation ----------
  const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  function cleanAlbum(s) {
    return strip(s)
      .replace(/\s*[\(\[][^\)\]]*(feat\.|ft\.|remix|edit|version|mix|deluxe|remaster|bonus|edition|instrumental|acoustic|live)[^\)\]]*[\)\]]/gi, '')
      .replace(/\s+-\s+(single|ep|deluxe.*|remaster.*|.*edition)$/i, '')
      .replace(/\s+/g, ' ').trim();
  }
  function cleanTrack(s) {
    return strip(s).replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/\s+-\s+.*$/, '').replace(/\s+/g, ' ').trim();
  }
  function cleanArtist(s) {
    const a = strip(s).replace(/\s*[\(\[].*?[\)\]]/g, '').replace(/\s*(,|&| x | feat\.?| ft\.?)\s.*$/i, '').trim();
    return a || String(s || '');
  }
  const key = (artist, album) => (cleanArtist(artist) + '|' + cleanAlbum(album)).toLowerCase();
  // Loose form used to compare our names with Discogs names: letters and digits only.
  const loose = (s) => strip(s).toLowerCase().replace(/\(\d+\)/g, '').replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, '');

  // ---------- state ----------
  let tracks = [];      // {title, artist, album, isrc, id, i}
  let albums = [];      // {key, artist, album, tracks, idx, artistCount}
  let albumByKey = new Map();
  let libMeta = { source: '', count: 0 };
  let results = store.get(LS.results) || store.get(OLD.results) || {};
  let perArtist = new Map();

  function buildLibrary(rows, meta) {
    tracks = rows.map((r, i) => ({ title: r[0], artist: r[1], album: r[2], isrc: r[3] || '', id: r[4] || '', i }));
    albumByKey = new Map(); albums = []; perArtist = new Map();
    for (const t of tracks) {
      const k = key(t.artist, t.album);
      let a = albumByKey.get(k);
      if (!a) { a = { key: k, artist: t.artist, album: t.album, tracks: [], idx: albums.length }; albumByKey.set(k, a); albums.push(a); }
      a.tracks.push(t);
      perArtist.set(t.artist, (perArtist.get(t.artist) || 0) + 1);
    }
    for (const a of albums) a.artistCount = perArtist.get(a.artist) || 0;
    libMeta = meta || libMeta;
    $('import').hidden = tracks.length > 0;
    $('app').hidden = tracks.length === 0;
    $('libline').hidden = tracks.length === 0;
    $('lib-count').textContent = tracks.length;
    $('lib-source').textContent = libMeta.source || 'your export';
    if (tracks.length) renderStats();
    render();
    if (tracks.length && auth.sharedCache) pullShared();
  }

  const toRows = (list) => list.map((t) => [t.title, t.artist, t.album, t.isrc, t.id]);

  function loadFile(file, mode) {
    const fr = new FileReader();
    fr.onload = () => {
      const res = window.Importers.importLibrary(String(fr.result), file.name);
      const errEl = $('import-err');
      if (res.error) { errEl.textContent = res.error; errEl.hidden = false; if (!$('import').hidden) return; toast(res.error); return; }
      errEl.hidden = true;
      let rows = toRows(res.tracks);
      let source = `${file.name} (${res.format})`;
      if (mode === 'add' && tracks.length) {
        const seen = new Set(tracks.map((t) => (t.id ? 'id:' + t.id : t.isrc ? 'isrc:' + t.isrc : 'n:' + (t.artist + '|' + t.album + '|' + t.title).toLowerCase())));
        const fresh = rows.filter((r) => !seen.has(r[4] ? 'id:' + r[4] : r[3] ? 'isrc:' + r[3] : 'n:' + (r[1] + '|' + r[2] + '|' + r[0]).toLowerCase()));
        rows = toRows(tracks).concat(fresh);
        source = libMeta.source.includes(' + ') ? libMeta.source : libMeta.source + ' + ' + file.name;
        toast(`${fresh.length} new tracks added`);
      } else {
        toast(`${rows.length} tracks imported` + (res.warnings.length ? '. ' + res.warnings[0] : ''));
      }
      const meta = { source, count: rows.length };
      if (!store.set(LS.library, { rows, meta })) toast('Browser storage is full: the library will not survive a reload.');
      buildLibrary(rows, meta);
    };
    fr.readAsText(file, 'utf-8');
  }
  for (const [id, mode] of [['csv-main', 'replace'], ['csv-replace', 'replace'], ['csv-add', 'add']]) {
    $(id).addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadFile(f, mode); e.target.value = ''; });
  }
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadFile(f, 'replace'); });

  // ---------- hosted mode: login and shared cache (Pages Functions under /api and /auth) ----------
  const auth = { hosted: false, username: null, loginAvailable: false, sharedCache: false };
  const api = (path, opts) => fetch(path, { credentials: 'same-origin', ...opts });

  async function initAuth() {
    if (!/^https?:$/.test(location.protocol)) return;
    try {
      const r = await api('/api/me');
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return;
      const me = await r.json();
      auth.hosted = true; auth.username = me.username || null; auth.loginAvailable = !!me.loginAvailable; auth.sharedCache = !!me.sharedCache;
    } catch (e) { /* static hosting without functions */ }
    const m = /[?&]login=([a-z]+)/.exec(location.search);
    if (m) {
      const msg = { ok: 'Logged in to Discogs', denied: 'Discogs login was cancelled', expired: 'The login link expired, please try again', error: 'Discogs login failed, please try again', unconfigured: 'Login is not set up on this deployment' }[m[1]];
      if (msg) toast(msg);
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    }
    renderAuth();
  }
  function renderAuth() {
    const canLogin = auth.hosted && auth.loginAvailable;
    $('auth-out').hidden = !(canLogin && !auth.username);
    $('auth-in').hidden = !(auth.hosted && auth.username);
    $('token-summary').hidden = !canLogin;
    $('token-details').open = !canLogin;
    if (auth.username) $('auth-user').textContent = auth.username;
    $('shared-note').textContent = auth.sharedCache ? 'Albums you resolve are added to the shared cache.' : '';
  }
  $('login').addEventListener('click', () => { location.href = '/auth/login'; });
  $('logout').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch (e) {}
    auth.username = null; renderAuth(); toast('Logged out');
  });

  // Pull verdicts other users already found for albums we have not checked yet.
  async function pullShared() {
    if (!auth.sharedCache) return 0;
    const keys = albums.filter((a) => !results[a.key]).map((a) => a.key);
    let got = 0;
    for (let i = 0; i < keys.length; i += 100) {
      try {
        const r = await api('/api/cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: keys.slice(i, i + 100) }) });
        if (!r.ok) break;
        const data = await r.json();
        for (const k of Object.keys(data)) { if (!results[k]) { results[k] = data[k]; got++; } }
      } catch (e) { break; }
    }
    if (got) { saveResults(); render(); }
    return got;
  }
  // Push our own verdicts to the shared cache, in small batches.
  let pending = [];
  function queueShared(key, v) { if (auth.username && !v.manual && !v.shared) { pending.push({ key, v }); if (pending.length >= 10) flushShared(); } }
  async function flushShared() {
    if (!pending.length || !auth.username) { pending = []; return; }
    const items = pending.splice(0, 100);
    try { await api('/api/cache', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }); } catch (e) { /* lost batch is only a missed contribution */ }
  }

  // ---------- Discogs ----------
  let running = false, stopFlag = false, lastErr = '';
  const tokenInput = $('token');
  tokenInput.value = store.get(LS.token) || store.get(OLD.token) || '';
  $('save-token').addEventListener('click', () => { store.set(LS.token, tokenInput.value.trim()); toast('Token saved'); });

  async function discogs(params) {
    let r;
    if (auth.username) {
      const u = new URL('/api/search', location.href);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      r = await api(u.toString());
      if (r.status === 401) { auth.username = null; renderAuth(); throw new Error('Your Discogs login expired. Log in again to continue.'); }
    } else {
      const token = tokenInput.value.trim();
      if (!token) throw new Error(auth.loginAvailable ? 'Log in with Discogs, or paste a personal token below.' : 'A Discogs token is needed: paste it in the field above.');
      const u = new URL('https://api.discogs.com/database/search');
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      u.searchParams.set('format', 'Vinyl');
      u.searchParams.set('per_page', '8');
      u.searchParams.set('token', token);
      r = await fetch(u.toString(), { headers: { Accept: 'application/json' } });
      if (r.status === 401 || r.status === 403) throw new Error(`Discogs rejected the token (HTTP ${r.status}). Check it on the developer settings page.`);
    }
    if (r.status === 429) { const e = new Error('rate'); e.rate = true; throw e; }
    if (!r.ok) throw new Error(`Discogs answered HTTP ${r.status}`);
    return r.json();
  }

  // Discogs titles read "Artist - Title". Accept a result only when its artist part matches ours.
  function artistMatches(title, artist) {
    const parts = String(title || '').split(' - ');
    if (parts.length < 2) return false;
    const da = loose(parts[0]), ours = loose(cleanArtist(artist));
    if (!da || !ours) return false;
    if (da === ours || da.includes(ours) || ours.includes(da)) return true;
    // several artists on the Discogs side: "A, B", "A & B", "A Feat. B"
    return parts[0].split(/,|&|\bfeat\.?\b|\bft\.?\b|\bvs\.?\b|\bx\b/i).some((p) => loose(p) === ours);
  }
  function pick(res, artist, albumTitle) {
    const want = loose(cleanAlbum(albumTitle));
    const list = (res.results || []).filter((x) => (x.type === 'release' || x.type === 'master') && artistMatches(x.title, artist));
    if (!list.length) return null;
    const scored = list.map((x) => {
      const t = loose((x.title || '').split(' - ').slice(1).join(' - '));
      let s = 0;
      if (t === want) s += 4; else if (want && t.includes(want)) s += 2;
      if (x.year) s += 1;
      if ((x.format || []).some((f) => /lp|album/i.test(f))) s += 1;
      return { x, s };
    }).sort((a, b) => b.s - a.s);
    return { hit: scored[0].x, strong: scored[0].s >= 2 };
  }

  async function checkAlbum(a) {
    const artist = cleanArtist(a.artist);
    let res = await discogs({ artist, release_title: cleanAlbum(a.album) });
    let via = 'album';
    let p = pick(res, a.artist, a.album), total = (res.pagination && res.pagination.items) || 0;
    if (!p) {
      const tr = cleanTrack((a.tracks.find((t) => t.title) || {}).title || '');
      if (tr && tr.toLowerCase() !== cleanAlbum(a.album).toLowerCase()) {
        await sleep(DELAY_MS);
        res = await discogs({ artist, track: tr });
        via = 'track'; p = pick(res, a.artist, a.album); total = (res.pagination && res.pagination.items) || 0;
      }
    }
    if (p) {
      const h = p.hit;
      return { s: 'vinyl', n: total, id: h.id, t: h.title, y: h.year || '', c: h.country || '', f: (h.format || []).slice(0, 4).join(', '),
        th: h.thumb || '', u: h.uri ? 'https://www.discogs.com' + h.uri : '', via, conf: via === 'album' && p.strong ? 'high' : 'medium', ts: Date.now() };
    }
    return { s: 'none', n: 0, via, ts: Date.now() };
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function queue() {
    const order = $('order').value;
    let list = albums.filter((a) => !results[a.key]);
    if (order === 'artist') list.sort((a, b) => b.artistCount - a.artistCount || a.idx - b.idx);
    else if (order === 'filtered') { const vis = new Set(filtered().map((a) => a.key)); list = list.filter((a) => vis.has(a.key)); }
    return list;
  }
  function saveResults() { if (!store.set(LS.results, results)) lastErr = 'Browser storage is full: results will not survive closing the tab.'; }

  async function run() {
    if (running) { stopFlag = true; return; }
    running = true; stopFlag = false; lastErr = '';
    $('run').textContent = 'Pause';
    if (auth.sharedCache) {
      setStatus('Looking up the shared cache…');
      const got = await pullShared();
      if (got) toast(`${got} albums resolved from the shared cache`);
    }
    let backoff = 0;
    const q = queue();
    let done = 0; const t0 = Date.now();
    for (let i = 0; i < q.length; i++) {
      const a = q[i];
      if (stopFlag) break;
      a.busy = true; setStatus(`Checking: ${a.artist} — ${a.album}`); renderRow(a);
      try {
        results[a.key] = await checkAlbum(a);
        saveResults(); queueShared(a.key, results[a.key]);
        backoff = 0;
      } catch (e) {
        a.busy = false;
        if (e.rate) { backoff = Math.min(60000, backoff ? backoff * 2 : 15000); setStatus(`Discogs asked us to slow down, waiting ${backoff / 1000}s`); await sleep(backoff); q.push(a); continue; }
        lastErr = e instanceof TypeError ? 'No network, or the browser blocked the request to Discogs. Checking stopped.' : e.message;
        renderRow(a); break;
      }
      a.busy = false; done++;
      updateCounts(done, t0);
      renderRow(a);
      await sleep(DELAY_MS);
    }
    running = false; stopFlag = false;
    flushShared();
    setStatus(lastErr ? 'Stopped.' : (queue().length ? 'Paused.' : 'All albums checked.'));
    updateCounts();
  }
  // Check one album right away (the Recheck button).
  async function checkOne(a) {
    a.busy = true; renderRow(a);
    try { results[a.key] = await checkAlbum(a); saveResults(); queueShared(a.key, results[a.key]); flushShared(); }
    catch (e) { toast(e.rate ? 'Discogs asked us to slow down, try again in a minute' : e.message); }
    a.busy = false; renderRow(a); updateCounts();
  }
  $('run').addEventListener('click', run);
  function setStatus(t) { $('st-text').textContent = t; $('st-err').textContent = lastErr; }

  // ---------- counts ----------
  function tally() {
    let vinyl = 0, none = 0, wait = 0, vt = 0, nt = 0;
    for (const a of albums) {
      const r = results[a.key];
      if (!r) wait++; else if (r.s === 'vinyl') { vinyl++; vt += a.tracks.length; } else { none++; nt += a.tracks.length; }
    }
    return { vinyl, none, wait, vt, nt };
  }
  let speed = null;
  function updateCounts(done, t0) {
    const c = tally();
    $('t-tracks').textContent = tracks.length;
    $('t-artists').textContent = perArtist.size + ' artists';
    $('t-albums').textContent = albums.length;
    $('t-vinyl').textContent = c.vinyl; $('t-vinyl-tracks').textContent = c.vt + ' tracks';
    $('t-none').textContent = c.none; $('t-none-tracks').textContent = c.nt + ' tracks';
    $('t-wait').textContent = c.wait;
    if (done && t0) speed = (Date.now() - t0) / done;
    $('t-eta').textContent = c.wait ? (speed ? 'about ' + Math.max(1, Math.round(c.wait * speed / 60000)) + ' min left' : 'roughly ' + Math.max(1, Math.round(c.wait * 1.6 / 60)) + ' min') : '';
    $('p-good').style.width = (100 * c.vinyl / (albums.length || 1)) + '%';
    $('p-bad').style.width = (100 * c.none / (albums.length || 1)) + '%';
    $('n-all').textContent = albums.length; $('n-vinyl').textContent = c.vinyl; $('n-none').textContent = c.none; $('n-wait').textContent = c.wait;
    $('run').textContent = running ? 'Pause' : (c.wait ? (c.wait === albums.length ? 'Start checking' : 'Continue checking') : 'All checked');
    $('run').disabled = !running && !c.wait;
  }

  // ---------- list ----------
  let filter = 'all', query = '', shown = PAGE;
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.f; document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', x === b)); shown = PAGE; render();
  }));
  $('q').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); shown = PAGE; render(); });
  $('sort').addEventListener('change', () => { shown = PAGE; render(); });
  $('more-btn').addEventListener('click', () => { shown += PAGE; render(); });

  const statusOf = (a) => { const r = results[a.key]; return r ? r.s : 'wait'; };
  function filtered() {
    let list = albums;
    if (filter !== 'all') list = list.filter((a) => statusOf(a) === filter);
    if (query) list = list.filter((a) => (a.artist + ' ' + a.album + ' ' + a.tracks.map((t) => t.title).join(' ')).toLowerCase().includes(query));
    const s = $('sort').value;
    list = list.slice();
    if (s === 'count') list.sort((a, b) => b.artistCount - a.artistCount || a.artist.localeCompare(b.artist) || a.idx - b.idx);
    else if (s === 'artist') list.sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album));
    else if (s === 'year') list.sort((a, b) => ((results[b.key] || {}).y || 0) - ((results[a.key] || {}).y || 0) || a.idx - b.idx);
    return list;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DISC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 6a6 6 0 0 1 6 6"/></svg>';
  const isSingle = (a) => a.tracks.length === 1 && cleanTrack(a.tracks[0].title).toLowerCase() === cleanAlbum(a.album).toLowerCase();

  function rowHTML(a) {
    const r = results[a.key];
    const st = a.busy ? 'busy' : (r ? r.s : 'wait');
    const pill = st === 'vinyl' ? '<span class="pill vinyl">On vinyl</span>' : st === 'none' ? '<span class="pill none">Not found</span>'
      : st === 'busy' ? '<span class="pill wait busy">Checking</span>' : '<span class="pill wait">Unchecked</span>';
    const cover = r && r.th ? `<img src="${esc(r.th)}" alt="" loading="lazy" onerror="this.remove()">` : DISC;
    let match = '';
    if (r && r.s === 'vinyl') {
      const meta = [r.y, r.c, r.f].filter(Boolean).join(' · ');
      match = `<div class="match"><span>Discogs: <a href="${esc(r.u)}" target="_blank" rel="noopener">${esc(r.t)}</a></span><span class="mono">${esc(meta)}</span>`
        + (r.n > 1 ? `<span class="mono">+${r.n - 1} more pressings</span>` : '')
        + (r.conf === 'medium' ? '<span class="mono">please verify</span>' : '')
        + (r.shared ? '<span class="mono">shared result</span>' : '')
        + `<button class="btn link small" data-act="dismiss" data-k="${esc(a.key)}" type="button">Not a match</button>`
        + `<button class="btn link small" data-act="recheck" data-k="${esc(a.key)}" type="button">Recheck</button></div>`;
    } else if (r && r.s === 'none') {
      const q = encodeURIComponent(cleanArtist(a.artist) + ' ' + cleanAlbum(a.album));
      match = `<div class="match"><span class="mono">${r.manual ? 'Dismissed by you.' : r.shared ? 'No vinyl pressing found (shared result).' : 'No vinyl pressing found.'}</span><a href="https://www.discogs.com/search/?q=${q}&format_exact=Vinyl" target="_blank" rel="noopener">Search Discogs by hand</a>`
        + `<button class="btn link small" data-act="recheck" data-k="${esc(a.key)}" type="button">Recheck</button></div>`;
    }
    const named = a.tracks.filter((t) => t.title);
    const tl = named.slice(0, 6).map((t) => t.id ? `<li><a href="https://open.spotify.com/track/${esc(t.id)}" target="_blank" rel="noopener">${esc(t.title)}</a></li>` : `<li>${esc(t.title)}</li>`).join('')
      + (named.length > 6 ? `<li>${named.length - 6} more</li>` : '');
    const single = isSingle(a);
    const tag = single ? '<span class="tag">single</span>' : (!named.length ? '<span class="tag">saved album</span>' : '');
    return `<div class="cover">${cover}</div><div class="main"><div class="title">${esc(a.album)}${tag}</div><div class="artist">${esc(a.artist)}</div>`
      + (single || !named.length ? '' : `<ul class="tracks">${tl}</ul>`) + `</div><div class="side">${pill}</div>${match}`;
  }
  function renderRow(a) {
    const el = document.querySelector(`.album[data-k="${CSS.escape(a.key)}"]`);
    if (el) el.innerHTML = rowHTML(a);
  }
  function render() {
    const list = filtered();
    const frag = document.createDocumentFragment();
    for (const a of list.slice(0, shown)) {
      const el = document.createElement('article'); el.className = 'album'; el.dataset.k = a.key; el.innerHTML = rowHTML(a); frag.appendChild(el);
    }
    $('list').replaceChildren(frag);
    $('more').hidden = list.length <= shown;
    $('empty').hidden = list.length > 0;
    updateCounts();
  }
  $('list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const a = albumByKey.get(b.dataset.k); if (!a) return;
    if (b.dataset.act === 'dismiss') { results[a.key] = { s: 'none', n: 0, manual: true, ts: Date.now() }; saveResults(); renderRow(a); updateCounts(); return; }
    delete results[a.key]; saveResults();
    if (running) { renderRow(a); updateCounts(); return; }
    checkOne(a);
  });

  // ---------- export ----------
  function exportRows() {
    return albums.filter((a) => results[a.key] && results[a.key].s === 'vinyl').map((a) => { const r = results[a.key]; return [a.artist, a.album, r.t, r.y, r.c, r.f, r.u, a.tracks.map((t) => t.title).filter(Boolean).join('; ')]; });
  }
  $('export').addEventListener('click', () => {
    const rows = exportRows();
    $('export-title').textContent = `Albums available on vinyl: ${rows.length}`;
    $('export-text').value = rows.map((r) => `${r[0]} — ${r[1]}  |  ${r[2]} (${[r[3], r[4], r[5]].filter(Boolean).join(', ')})  ${r[6]}`).join('\n') || 'Nothing found yet. Start checking first.';
    $('export-box').hidden = false; $('export-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('export-close').addEventListener('click', () => { $('export-box').hidden = true; });
  $('copy').addEventListener('click', () => {
    const ta = $('export-text'); const done = () => toast('Copied');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); done(); });
    else { ta.select(); done(); }
  });
  $('download').addEventListener('click', () => {
    const csv = [['Artist', 'Album', 'Discogs title', 'Year', 'Country', 'Format', 'Discogs URL', 'Tracks']].concat(exportRows())
      .map((r) => r.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'spotivinyl.csv'; document.body.appendChild(a); a.click(); a.remove();
  });

  // ---------- reset / clear ----------
  function armed(btn, label, confirmLabel, action) {
    let on = false, t;
    btn.addEventListener('click', () => {
      if (!on) { on = true; btn.textContent = confirmLabel; t = setTimeout(() => { on = false; btn.textContent = label; }, 4000); return; }
      clearTimeout(t); on = false; btn.textContent = label; action();
    });
  }
  armed($('reset'), 'Reset results', 'Really reset?', () => { results = {}; store.del(LS.results); store.del(OLD.results); speed = null; render(); toast('Results cleared'); });
  armed($('clear-all'), 'Clear library and results', 'Really clear everything?', () => {
    results = {}; for (const k of [LS.results, LS.library, OLD.results, OLD.library]) store.del(k);
    buildLibrary([], { source: '', count: 0 }); toast('Library and results cleared');
  });

  let toastT;
  function toast(msg) {
    let t = document.querySelector('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 2600);
  }

  // ---------- statistics ----------
  function bars(el, pairs, total) {
    const max = Math.max(...pairs.map((p) => p[1]), 1);
    el.innerHTML = pairs.map((p) => `<div class="b"><span title="${esc(p[0])}">${esc(p[0])}</span><i style="width:${(100 * p[1] / max).toFixed(1)}%"></i><b>${total ? Math.round(100 * p[1] / total) + '%' : p[1]}</b></div>`).join('');
  }
  const REGISTRANT = { QZ: 'QZ (distributors)', TC: 'TC (TuneCore)', QM: 'QM (distributors)', QT: 'QT (distributors)', GX: 'GX (distributors)', GB: 'United Kingdom', UK: 'United Kingdom (UK)', US: 'United States', CA: 'Canada', JP: 'Japan', SE: 'Sweden', FR: 'France', NL: 'Netherlands', DE: 'Germany', RU: 'Russia', AU: 'Australia', FI: 'Finland', NO: 'Norway', DK: 'Denmark', IT: 'Italy', ES: 'Spain', PL: 'Poland', BR: 'Brazil', KR: 'South Korea', BE: 'Belgium', IE: 'Ireland', CH: 'Switzerland', AT: 'Austria', MX: 'Mexico', AR: 'Argentina', IN: 'India', UA: 'Ukraine' };
  function renderStats() {
    bars($('top-artists'), [...perArtist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15));
    const years = new Map(); let early = 0, withIsrc = 0;
    for (const t of tracks) {
      const m = /^[A-Za-z]{2}[A-Za-z0-9]{3}(\d{2})/.exec(t.isrc); if (!m) continue;
      withIsrc++;
      let y = +m[1]; y = y < 40 ? 2000 + y : 1900 + y; if (y > new Date().getFullYear()) continue;
      if (y < 2005) early++; else years.set(y, (years.get(y) || 0) + 1);
    }
    $('years-panel').hidden = !withIsrc; $('countries-panel').hidden = !withIsrc;
    if (withIsrc) {
      const ys = [...years.keys()].sort(); const vals = ys.map((y) => years.get(y)); const max = Math.max(...vals, early, 1);
      const peak = ys[vals.indexOf(Math.max(...vals))];
      $('years').innerHTML = `<i style="height:${(100 * early / max).toFixed(1)}%" title="before 2005: ${early}"></i>` + ys.map((y) => `<i style="height:${(100 * years.get(y) / max).toFixed(1)}%" title="${y}: ${years.get(y)}"${y === peak ? ` data-label="${years.get(y)}"` : ''}></i>`).join('');
      $('yearaxis').innerHTML = `<span>before 2005</span><span>${ys[Math.floor(ys.length / 2)] || ''}</span><span>${ys[ys.length - 1] || ''}</span>`;
      const cc = new Map();
      for (const t of tracks) { const p = t.isrc.slice(0, 2).toUpperCase(); if (p) cc.set(p, (cc.get(p) || 0) + 1); }
      bars($('countries'), [...cc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map((p) => [REGISTRANT[p[0]] || p[0], p[1]]), withIsrc);
    }
    const singles = albums.filter(isSingle).length;
    const remixes = tracks.filter((t) => /remix|mix\)|edit|flip|bootleg|vip/i.test(t.title)).length;
    const counts = [...perArtist.values()];
    bars($('misc'), [['Singles (track = album)', singles], ['Albums and EPs', albums.length - singles], ['Remixes, edits, flips', remixes], ['Artists with 1 liked track', counts.filter((v) => v === 1).length], ['Artists with 10+ liked tracks', counts.filter((v) => v >= 10).length]]);
  }

  // ---------- boot ----------
  (async function boot() {
    const saved = store.get(LS.library);
    const old = store.get(OLD.library);
    if (saved && saved.rows && saved.rows.length) buildLibrary(saved.rows, saved.meta);
    else if (old && old.length) buildLibrary(old, { source: 'your earlier import', count: old.length });
    else if (window.SPOTIFY_LIBRARY && window.SPOTIFY_LIBRARY.length) buildLibrary(window.SPOTIFY_LIBRARY, { source: 'library.js', count: window.SPOTIFY_LIBRARY.length });
    else buildLibrary([], { source: '', count: 0 });
    await initAuth();
    if (tracks.length) pullShared();
  })();
  window.addEventListener('beforeunload', (e) => { if (running) { e.preventDefault(); e.returnValue = ''; } });
})();
