# Download website (Vercel)

The public landing page is in `public/`. Vercel Functions in `api/` query the latest stable GitHub release and redirect downloads to its installer, portable ZIP, or source ZIP. The large binaries remain on GitHub. New releases appear without rebuilding the website.

## Deploy

Import `w7llywonka/larp-browser` into Vercel and set **Root Directory** to `site`. Choose **Other** as the framework, **public** as the output directory, and no build/install commands. These settings are also in `vercel.json`. Node.js 24 runs the API functions. No environment variables are required. For higher GitHub API limits, an optional server-only `GITHUB_RELEASE_TOKEN` can be configured in Vercel; never put it in public files.

Alternatively run `npx vercel link` and `npx vercel --prod` from this directory. Keep `.vercel/` and `.env*` out of Git. Do not deploy the Electron project root as a website.

## Local preview

From the repository root run `npm run site:dev` and open `http://127.0.0.1:4173`. The preview runs the same release/download handlers with no frontend build dependencies.

`GET /api/release` returns version, date, installer, portable, source, and release URL. `GET /api/download?kind=installer` redirects to the newest uploaded setup executable; `portable` and `source` select the ZIPs. Invalid download types are rejected. Unavailable GitHub metadata falls back to the project releases page. Only uploaded assets from the configured repository are accepted.

## Desktop updates

The installed Windows executable reads its update feed directly from GitHub via `electron-updater`, independently of the website. Publish the setup EXE, its blockmap, and the matching `latest.yml` together. The installed app checks on startup and every six hours, verifies downloads, and installs on a normal exit. `update install` restarts immediately. `settings updates off` disables automatic checking, downloading, and installation. The existing portable editions need a one-time installation of the new setup EXE.
