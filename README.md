# SpotiVinyl

Find out which of your liked tracks exist on vinyl. Import a library export from Spotify, Tidal, Apple Music, Deezer, YouTube Music or any CSV, then check it against [Discogs](https://www.discogs.com), album by album.

The page itself is static and runs entirely in the browser. An optional set of Cloudflare Pages Functions adds **Log in with Discogs** and a **shared cache** of results, so an album anyone has already resolved is not looked up again.

## Using it

1. Open the site (or `index.html` locally; no server needed).
2. Drop in a library export. Supported inputs:
   - **TuneMyMusic** and **Soundiiz** CSV exports (covers Spotify, Tidal, Apple Music, Deezer, Amazon Music, YouTube Music and more)
   - **Exportify** CSV (Spotify, includes ISRC codes)
   - **Spotify privacy export** `YourLibrary.json`
   - **Google Takeout** `music-library-songs.csv` (YouTube Music)
   - **Apple Music / iTunes** `Library.xml`
   - any CSV/TSV with Title, Artist and Album columns (names are detected automatically), a JSON array of tracks, or a text file with one `Artist - Title` per line
3. Either **Log in with Discogs** (on a deployment with Functions) or paste a free personal access token from <https://www.discogs.com/settings/developers>, then press **Start checking**.

Discogs allows 60 searches a minute per account, so a library of ~3000 albums takes about an hour the first time. Results are saved after every album; the tab can be closed and the check resumed later. Each match links to its Discogs release and can be dismissed with **Not a match** or searched again with **Recheck**.

## How matching works

- Tracks are grouped into albums by artist and album name (after stripping things like `(feat. …)`, `- Single`, `- Remastered`).
- One Discogs search per album with `format=Vinyl`. If nothing comes back, a second search uses the first track title.
- A result counts only when the artist part of the Discogs title matches the artist in the library. Among matching results the one whose title equals the album name wins; a match found through a track search, or without an exact title match, is labelled *please verify*.
- Discogs throttles by source IP (60 requests a minute). Requests from Cloudflare leave from shared addresses, so when logged in the Functions only *sign* each search and the browser sends it to Discogs from the user's own address. OAuth parameters go in the query string first, then in an Authorization header, and the server-side proxy is the last resort.
- With the shared cache, unchecked albums are first looked up in the cache. Verdicts a logged-in user finds are written back. A *vinyl* verdict is never overwritten by a *none* one, and a *none* verdict expires after 180 days so new pressings get picked up. Manual dismissals stay local.
- ISRC codes, when present, drive the statistics panel (release years and registrant prefixes).

## Files

| Path | Purpose |
|---|---|
| `index.html` | markup and styles |
| `app.js` | state, Discogs check loop, list, export, statistics, hosted-mode client |
| `importers.js` | library parsers (also usable in Node for tests) |
| `functions/api/oauth.js` | signs each step of the Discogs OAuth handshake; the browser sends them from its own address |
| `functions/auth/*` | server-side login fallback, OAuth callback, logout |
| `functions/api/me.js` | who is logged in, which features the deployment has |
| `functions/api/sign.js` | signs a Discogs search with the user's OAuth token; the browser then calls Discogs itself |
| `functions/api/search.js` | server-side search proxy, used only when the browser cannot call Discogs directly |
| `functions/api/cache.js` | shared verdict cache (read: anyone, write: logged-in users) |
| `functions/lib/*` | OAuth signing, D1 access, sessions |
| `_headers` | response headers for Cloudflare Pages |

## Deploying

### Static only

The page works from any static host or from a local folder. Users paste their own Discogs token. Nothing else to configure.

### Cloudflare Pages with login and shared cache

1. **Pages project.** Create a Pages project from this repository: build command empty, output directory `/`. The `functions/` directory is picked up automatically.
2. **Discogs application.** At <https://www.discogs.com/settings/developers> click *Create an Application*. Set the callback URL to `https://<your-domain>/auth/callback` (for example `https://spotivinyl.pages.dev/auth/callback`). Copy the consumer key and secret.
3. **D1 database.** In the Cloudflare dashboard go to *Storage & Databases → D1*, create a database (any name, for example `spotivinyl`). Tables are created automatically on first use.
4. **Bindings.** In the Pages project open *Settings → Bindings* (or *Functions* on older dashboards) and add:
   - D1 database binding, variable name `DB`, pointing to the database from step 3;
   - environment variables `DISCOGS_CONSUMER_KEY` and `DISCOGS_CONSUMER_SECRET` (mark them as secrets).
   Add them for Production and, if you use it, Preview.
5. Redeploy (push a commit or use *Retry deployment*). `GET /api/me` should now answer `{"username":null,"loginAvailable":true,"sharedCache":true}`.

Without the D1 binding the API reports `sharedCache: false` and the page falls back to token mode. Without the Discogs keys login is hidden and the shared cache still works read-only.

### Local development

```bash
npm i -D wrangler
npx wrangler pages dev . --d1 DB --binding DISCOGS_CONSUMER_KEY=... DISCOGS_CONSUMER_SECRET=...
```

`DISCOGS_API` and `DISCOGS_AUTHORIZE` can be overridden to point the functions at a stand-in server for tests.

## Roadmap

- Add found albums to the user's Discogs wantlist; show marketplace price ranges.
- Per-user history across devices (the login already identifies the user).

Data provided by Discogs. The Discogs API is free for non-commercial use.
