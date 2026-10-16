/* Pressd importers: turn a library export from any music service into one list of tracks.
   Output track: { title, artist, album, isrc, id, service } — id is a Spotify track id when known.
   Works in the browser and in Node (for tests). */
(function (root) {
  'use strict';

  // ---------- small helpers ----------
  function parseDelimited(text, delim) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim()));
  }

  function detectDelimiter(headerLine) {
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (const ch of headerLine) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }

  const norm = (h) => String(h || '').replace(/^﻿/, '').trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');

  // Find the column for a role. `cands` are tested in order; a header matches when it equals
  // or contains the candidate, and does not contain any of the excluded words.
  function findCol(headers, cands, exclude) {
    exclude = exclude || [];
    for (const c of cands) {
      let i = headers.findIndex((h) => h === c);
      if (i >= 0) return i;
      i = headers.findIndex((h) => h.includes(c) && !exclude.some((x) => h.includes(x)));
      if (i >= 0) return i;
    }
    return -1;
  }

  const ROLE = {
    title: { cands: ['track name', 'track title', 'song title', 'song name', 'title', 'track', 'song', 'name'], exclude: ['album', 'artist', 'playlist', 'label', 'file'] },
    artist: { cands: ['artist name(s)', 'artist names', 'artist name', 'artists', 'artist', 'performer', 'band'], exclude: ['album artist', 'playlist'] },
    album: { cands: ['album name', 'album title', 'album', 'release name', 'release'], exclude: ['artist', 'date', 'year', 'id', 'uri', 'url', 'type'] },
    isrc: { cands: ['isrc'], exclude: [] },
    id: { cands: ['spotify id', 'spotify track id', 'track uri', 'spotify uri', 'spotify url', 'track url', 'spotify', 'uri', 'url'], exclude: ['album', 'artist', 'playlist', 'image', 'preview', 'cover'] }
  };

  function mapColumns(headers) {
    const h = headers.map(norm);
    const m = {};
    for (const role of Object.keys(ROLE)) m[role] = findCol(h, ROLE[role].cands, ROLE[role].exclude);
    return m;
  }

  function spotifyId(v) {
    if (!v) return '';
    v = String(v).trim();
    let m = /spotify:track:([A-Za-z0-9]{22})/.exec(v); if (m) return m[1];
    m = /open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]{22})/.exec(v); if (m) return m[1];
    if (/^[A-Za-z0-9]{22}$/.test(v)) return v;
    return '';
  }

  function guessService(headers, fileName) {
    const h = headers.map(norm).join('|');
    const f = (fileName || '').toLowerCase();
    if (h.includes('spotify - id') || (h.includes('playlist name') && h.includes('type') && h.includes('isrc'))) return 'TuneMyMusic export';
    if (h.includes('track uri') && h.includes('artist name(s)')) return 'Exportify (Spotify)';
    if (h.includes('song title') && h.includes('artist names')) return 'YouTube Music (Google Takeout)';
    if (h.includes('apple') || f.includes('apple music')) return 'Apple Music';
    if (f.includes('soundiiz')) return 'Soundiiz export';
    if (f.includes('tidal')) return 'Tidal';
    if (f.includes('deezer')) return 'Deezer';
    if (f.includes('spotify')) return 'Spotify';
    return 'CSV';
  }

  // ---------- format readers ----------
  function fromDelimited(text, fileName) {
    const firstLine = text.replace(/^﻿/, '').split(/\r?\n/)[0] || '';
    const delim = detectDelimiter(firstLine);
    const rows = parseDelimited(text.replace(/^﻿/, ''), delim);
    if (rows.length < 2) return { error: 'The file has no data rows.' };
    const headers = rows[0];
    const m = mapColumns(headers);
    const warnings = [];
    if (m.title < 0 && m.artist < 0) return { error: 'Could not find Title and Artist columns. Headers seen: ' + headers.slice(0, 8).join(', '), headers, rows };
    if (m.artist < 0) warnings.push('No artist column found; matching will be weak.');
    if (m.album < 0) warnings.push('No album column found; the track title is used as the album name.');
    const tracks = []; let blank = 0;
    for (const r of rows.slice(1)) {
      const title = m.title >= 0 ? (r[m.title] || '').trim() : '';
      const artist = m.artist >= 0 ? (r[m.artist] || '').trim() : '';
      if (!title && !artist) { blank++; continue; }
      tracks.push({ title, artist, album: (m.album >= 0 && (r[m.album] || '').trim()) || title, isrc: m.isrc >= 0 ? (r[m.isrc] || '').trim().toUpperCase() : '', id: m.id >= 0 ? spotifyId(r[m.id]) : '' });
    }
    if (blank) warnings.push(blank + ' rows without a title or artist skipped (usually tracks no longer available).');
    return { format: guessService(headers, fileName), tracks, warnings, columns: m, headers };
  }

  function fromJSON(text, fileName) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { error: 'The file is not valid JSON.' }; }
    const tracks = []; const warnings = [];
    // Spotify privacy export: YourLibrary.json
    if (data && Array.isArray(data.tracks) && data.tracks.length && 'track' in data.tracks[0]) {
      for (const t of data.tracks) tracks.push({ title: t.track || '', artist: t.artist || '', album: t.album || t.track || '', isrc: '', id: spotifyId(t.uri) });
      if (Array.isArray(data.albums)) for (const a of data.albums) tracks.push({ title: '', artist: a.artist || '', album: a.album || '', isrc: '', id: '' });
      return { format: 'Spotify privacy export (YourLibrary.json)', tracks, warnings };
    }
    // Spotify Web API dump: { items: [ { track: { name, artists:[{name}], album:{name}, id, external_ids:{isrc} } } ] }
    const items = Array.isArray(data) ? data : (data && (data.items || data.tracks || data.songs || data.library));
    if (Array.isArray(items)) {
      for (const it of items) {
        const t = it && it.track && typeof it.track === 'object' ? it.track : it;
        if (!t || typeof t !== 'object') continue;
        const artist = Array.isArray(t.artists) ? t.artists.map((a) => (a && a.name) || a).filter(Boolean).join(', ') : (t.artist || t.artistName || t.artist_name || '');
        const album = t.album && typeof t.album === 'object' ? (t.album.name || t.album.title || '') : (t.album || t.albumName || t.album_name || t.collectionName || '');
        const title = t.name || t.title || t.track || t.trackName || t.track_name || '';
        if (!title && !artist) continue;
        tracks.push({ title, artist, album: album || title, isrc: ((t.external_ids && t.external_ids.isrc) || t.isrc || '').toUpperCase(), id: spotifyId(t.uri || t.id || t.url || t.href) });
      }
      if (tracks.length) return { format: 'JSON library', tracks, warnings };
    }
    return { error: 'Unrecognised JSON layout. Expected a list of tracks with title, artist and album.' };
  }

  // Apple Music / iTunes Library.xml (plist)
  function fromPlist(text) {
    if (typeof DOMParser === 'undefined') return { error: 'XML import needs a browser.' };
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const tracks = [];
    const dicts = doc.querySelectorAll('dict > dict > dict');
    dicts.forEach((d) => {
      const kv = {}; const kids = Array.from(d.children);
      for (let i = 0; i < kids.length - 1; i += 2) if (kids[i].tagName === 'key') kv[kids[i].textContent] = kids[i + 1].textContent;
      if (kv.Name || kv.Artist) tracks.push({ title: kv.Name || '', artist: kv.Artist || kv['Album Artist'] || '', album: kv.Album || kv.Name || '', isrc: '', id: '' });
    });
    if (!tracks.length) return { error: 'No tracks found in this XML library.' };
    return { format: 'Apple Music / iTunes Library.xml', tracks, warnings: [] };
  }

  // Plain text: one "Artist - Title" or "Artist – Title" per line
  function fromText(text) {
    const tracks = [];
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(.+?)\s+[-–—]\s+(.+?)\s*$/.exec(line);
      if (m) tracks.push({ title: m[2], artist: m[1], album: m[2], isrc: '', id: '' });
    }
    if (!tracks.length) return { error: 'No "Artist - Title" lines found.' };
    return { format: 'Plain text list', tracks, warnings: [] };
  }

  // ---------- entry point ----------
  function dedupe(tracks) {
    const seen = new Set(); const out = [];
    for (const t of tracks) {
      const k = t.id ? 'id:' + t.id : (t.isrc ? 'isrc:' + t.isrc : 'n:' + (t.artist + '|' + t.album + '|' + t.title).toLowerCase());
      if (seen.has(k)) continue; seen.add(k); out.push(t);
    }
    return out;
  }

  function importLibrary(text, fileName) {
    fileName = fileName || '';
    const trimmed = text.replace(/^﻿/, '').trimStart();
    let res;
    if (/\.json$/i.test(fileName) || trimmed[0] === '{' || trimmed[0] === '[') res = fromJSON(text, fileName);
    else if (/\.xml$/i.test(fileName) || trimmed.startsWith('<?xml') || trimmed.startsWith('<plist')) res = fromPlist(text);
    else if (/\.txt$/i.test(fileName)) res = fromText(text);
    else {
      res = fromDelimited(text, fileName);
      if (res.error && !/\.(csv|tsv)$/i.test(fileName)) { const t = fromText(text); if (!t.error) res = t; }
    }
    if (res.error) return res;
    const before = res.tracks.length;
    res.tracks = dedupe(res.tracks.map((t) => ({ title: t.title || '', artist: t.artist || '', album: t.album || t.title || '', isrc: t.isrc || '', id: t.id || '' })));
    if (before !== res.tracks.length) res.warnings.push((before - res.tracks.length) + ' duplicate rows skipped.');
    return res;
  }

  root.Importers = { importLibrary, parseDelimited, mapColumns, spotifyId, fromDelimited, fromJSON, fromText };
})(typeof window !== 'undefined' ? window : globalThis);
