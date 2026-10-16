# SpotiVinyl

Find out which of your liked tracks exist on vinyl. Import a library export from Spotify, Tidal, Apple Music, Deezer, YouTube Music or any CSV, then check it against [Discogs](https://www.discogs.com), album by album, right in the browser.

Everything runs client-side: the library file is parsed in the browser, results are cached in `localStorage`, and the only network calls go to the Discogs API with the user's own token. There is no backend.

## Using it

1. Open the site (or `index.html` locally; no server needed).
2. Drop in a library export. Supported inputs:
   - **TuneMyMusic** and **Soundiiz** CSV exports (covers Spotify, Tidal, Apple Music, Deezer, Amazon Music, YouTube Music and more)
   - **Exportify** CSV (Spotify, includes ISRC codes)
   - **Spotify privacy export** `YourLibrary.json`
   - **Google Takeout** `music-library-songs.csv` (YouTube Music)
   - **Apple Music / iTunes** `Library.xml`
   - any CSV/TSV with Title, Artist and Album columns (names are detected automatically), a JSON array of tracks, or a text file with one `Artist - Title` per line
3. Paste a free Discogs personal access token from <https://www.discogs.com/settings/developers> and press **Start checking**.

Discogs allows 60 searches a minute per token, so a library of ~3000 albums takes about an hour. Results are saved after every album; the tab can be closed and the check resumed later. Each match links to its Discogs release and can be dismissed with **Not a match** or searched again with **Recheck**.

## How matching works

- Tracks are grouped into albums by artist and album name (after stripping things like `(feat. …)`, `- Single`, `- Remastered`).
- One Discogs search per album with `format=Vinyl`. If nothing comes back, a second search uses the first track title.
- A result counts only when the artist part of the Discogs title matches the artist in the library. Among matching results the one whose title equals the album name wins; a match found through a track search, or without an exact title match, is labelled *please verify*.
- ISRC codes, when present, drive the statistics panel (release years and registrant prefixes).

## Files

- `index.html` – markup and styles
- `app.js` – state, Discogs check loop, list, export, statistics
- `importers.js` – library parsers (also usable in Node for tests)
- `_headers` – response headers for Cloudflare Pages

## Deploying

The site is static. On Cloudflare Pages: create a project from this repository, leave the build command empty and set the output directory to `/`. Netlify and GitHub Pages work the same way. No environment variables are needed.

## Roadmap

- "Log in with Discogs" (OAuth) instead of pasting a token: needs a small worker to hold the consumer secret.
- Shared cache of album → vinyl results so popular albums are not looked up again by every user.
- Add found albums to the user's Discogs wantlist; show marketplace price ranges.

Data provided by Discogs. The Discogs API is free for non-commercial use.
