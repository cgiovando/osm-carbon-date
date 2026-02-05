# osm-carbon-date

**Carbon-dating your OSM imagery** — See how old the satellite imagery is behind your mapping projects.

## Live Demo

**[View the app →](https://cgiovando.github.io/osm-carbon-date/)**

## The Problem

When creating map data in OpenStreetMap through Tasking Manager projects, we often don't know how current the source imagery is. This leads to:

- Map data that may be months or years out of date
- Missing metadata about imagery age in OSM changesets
- Project managers unable to assess if imagery is suitable for their needs
- No easy way to compare imagery freshness across providers

## The Solution

**osm-carbon-date** overlays Tasking Manager project boundaries with imagery metadata, showing you exactly when each imagery tile was captured.

## Features

- **ESRI World Imagery metadata**: See capture dates for imagery tiles
- **TM project overlay**: Load any Tasking Manager project boundary
- **Color-coded age**: Instantly see imagery freshness (green = recent, red = old)
- **Click for details**: Get imagery dates, resolution, and source info
- **Recent projects list**: Browse and load recent TM projects
- **Basemap switcher**: Compare different imagery providers
- **Age statistics**: View newest/oldest imagery dates for visible area
- **URL deep-linking**: Share links to specific TM projects (e.g., `?project=17232`)

## Imagery Age Legend

| Color | Age |
|-------|-----|
| 🟢 Green | < 1 year |
| 🟡 Yellow | 1-2 years |
| 🟠 Orange | 2-3 years |
| 🔴 Red | > 3 years |

## Usage

1. Visit the app at **https://cgiovando.github.io/osm-carbon-date/**
2. Enter a Tasking Manager project ID or click a project from the list
3. Zoom in to load imagery metadata (loads at zoom 12+)
4. Click on imagery tiles to see capture dates and details

## Tech Stack

- [MapLibre GL JS](https://maplibre.org/) — Map rendering
- [Tasking Manager API](https://tasks.hotosm.org/api-docs) — Project geometries
- [ESRI ArcGIS REST API](https://developers.arcgis.com/rest/) — Imagery metadata
- [Cloudflare Workers](https://workers.cloudflare.com/) — CORS proxy
- Vanilla JavaScript — No build step required

## Deployment

### GitHub Pages

1. Fork/clone this repo
2. Enable GitHub Pages in repo settings (deploy from main branch)
3. Optionally deploy your own Cloudflare Worker for the CORS proxy (see below)

### CORS Proxy

The Tasking Manager API doesn't include CORS headers, so a proxy is required for browser requests. This app uses a Cloudflare Worker as the primary proxy with public fallbacks.

To deploy your own Cloudflare Worker:

1. Create a free account at [workers.cloudflare.com](https://workers.cloudflare.com/)
2. Create a new Worker and paste the code from `cloudflare-worker/tm-proxy.js`
3. Deploy and update `CONFIG.tmApi.workerProxy` in `js/config.js` with your worker URL

### Local Development

```bash
# Using Python
python -m http.server 8000

# Using Node
npx serve .
```

Then open `http://localhost:8000`

## AI-Generated Code Disclaimer

**A significant portion of this application's code was generated with assistance from AI tools.**

### Tools Used
- **Claude** (Anthropic) - Code generation, debugging, and documentation

### What This Means
- The codebase was developed with AI assistance based on requirements and iterative prompts
- All functionality has been tested and verified to work as intended
- The code has undergone human review for usability and correctness

## License

MIT

## Credits

- Original ESRI imagery date finder concept by [martinedoesgis](https://github.com/martinedoesgis/esri-imagery-date-finder)
