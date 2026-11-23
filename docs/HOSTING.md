# Hosting the demo (GitHub Pages)

The hosted demo is a static site: no server, no login, no install. It is the public URL for the project.

## What it is (and is not)

- The arena, Workflow Lab, campaign hub and the Play demo scripts run **in your browser** on the in-page engine (`window.__haunt`, mode `browser`).
- The tournament, Casebook, lessons, Patterns and the improve loop need the real engine. On the hosted page they replay **recorded runs** of the real live server (`site/recorded/*.json`, made by `npm run record:hosted`). The page says so: the banner reads "Hosted demo: runs in your browser. Tournament, Casebook and improve loop are a Recorded run. The real engine runs locally: npm run demo".
- Campaign nights play the scripted night fixtures from the recorded campaign data.
- Real bots, real chaos and the real provider run only locally: `npm run demo`.

## Build and check locally (works today, no Actions needed)

```
npm ci
npm run build:hosted        # arena UI build, then assembles dist/hosted (about 4 MB, 3.4 MB of it recorded JSON)
npm run serve:hosted        # http://127.0.0.1:8080/   (add: -- --base=/Kiroween-Chaos/ to test a sub path)
npm run check:hosted        # headless Chrome: populated arena in under 10 s, recorded tournament plays; screenshots to docs/proof/hosted
```

`npx serve dist/hosted` also works. Open it over http, not file:// (browsers block module scripts and fetch on file://).
All asset paths are relative, so the site works under `/Kiroween-Chaos/` or at a root. `dist/hosted/404.html` is the fallback and `.nojekyll` is included.

To refresh the recordings (needs `npm run build:bots`; takes about 6 minutes): `npm run record:hosted`, then commit `site/recorded/`.

## What the owner must do

GitHub Actions currently cannot start jobs because of the account billing limit, and the repo is private. Pages on a private repo needs a paid plan. Do these in order:

1. **Fix billing** (Settings > Billing and plans: raise the spending limit or add a payment method) so Actions can start jobs.
2. **Make the repo public** (Settings > General > Danger zone > Change visibility). Judges need to open the URL, and free Pages needs a public repo. Check first that no secret is in the history.
3. **Enable Pages**: Settings > Pages > Build and deployment > Source = **GitHub Actions**.
4. **Run the workflow**: Actions > `pages` > Run workflow (it also runs on every push to `main`). The `deploy` job prints the URL.
5. Open the URL and check the banner, the arena and Start tournament. Share this URL as the live demo.

Final URL form: `https://<github-user-or-org>.github.io/Kiroween-Chaos/` (for the repo `kakoritz/Kiroween-Chaos`: `https://kakoritz.github.io/Kiroween-Chaos/`).

If Actions stay blocked: publish by hand. Build locally, then push the contents of `dist/hosted` to a `gh-pages` branch (for example `npx gh-pages -d dist/hosted`), and set Pages source to "Deploy from a branch", `gh-pages`, `/ (root)`.

The older `pages-build.yml` only builds and uploads an artifact; it never deploys.
