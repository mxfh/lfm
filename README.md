# Literaturfest Meißen — Lesefahrplan

Inoffizieller mobiler Lesefahrplan für das **Literaturfest Meißen**: Lesungen
merken und jederzeit sehen, was du von deinem Standort **zu Fuß** noch erreichst.

Statische Astro-App, keine Anmeldung, kein Tracking — Merkliste nur lokal
(`localStorage`). Programmdaten kommen aus der offiziellen WordPress-REST-API und
werden automatisch aktualisiert.

## Develop

```bash
pnpm install
pnpm data        # refresh public/data/* from the festival API (+ geocode, +OSM routing, +authors)
pnpm dev         # http://localhost:4321
pnpm build       # static site -> dist/
```

`pnpm data` is incremental: venue geocodes and author lookups are cached, so
re-runs only fetch what changed. Network sources: WP REST API (program),
Nominatim/OpenStreetMap (venues), Overpass/OpenStreetMap (walking graph),
Wikipedia (author links).

Individual steps: `pnpm data:program`, `pnpm data:authors`, `pnpm data:geo`,
`pnpm data:dist`.

## Deploy targets

Host-agnostic static build. Set the base path for sub-path hosts:

```bash
# custom domain at root (default), e.g. programm.meissnerin.de
pnpm build
# GitHub / Codeberg project sub-path
BASE_PATH=/lfm/ SITE_URL=https://mxfh.github.io pnpm build
```

Published on GitHub Pages at `https://mxfh.github.io/lfm/`. The `gh-pages`
branch contains only the built static assets.

## Repo layout

| path | published? | what |
|------|-----------|------|
| `src/`, `public/`, `astro.config.mjs` … | yes | the app |
| `public/data/*.json` | yes | derived program data |
| `scripts/` | yes | data pipeline used by the scheduled updater |
| `prep/venues.overrides.json` | yes | geocoding corrections used by the updater |
| `prep/source-mirror/`, generated build/test artifacts | no | local source mirror and review artifacts |

## Data & licensing

- Program: facts only (no creative blurbs); source linked per event.
  Venue geocoding and walking network © OpenStreetMap; author links to Wikipedia
  (CC BY-SA).
- UI font **Fraunces** (SIL OFL 1.1) — `src/fonts/OFL.txt`.
- Independent, non-commercial; not affiliated with Literaturfest Meißen.
