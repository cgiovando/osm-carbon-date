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
- **Recent projects list**: Browse and load recent TM projects (100 most recent)
- **Basemap switcher**: Compare different imagery providers
- **Age statistics**: View newest/oldest imagery dates for visible area
- **URL deep-linking**: Share links to specific TM projects (e.g., `?project=17232`)
- **Smart caching**: Imagery metadata persists when zooming out (down to z8)

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
3. Zoom to level 12+ to load imagery metadata
4. Click on imagery tiles to see capture dates and details

**Note**: Imagery is fetched at zoom 12+ but cached data stays visible down to zoom 8.

## Tech Stack

- [MapLibre GL JS](https://maplibre.org/) — Map rendering
- [insta-tm](https://github.com/hotosm/insta-tm) — S3-hosted TM API mirror (synced every 10 min)
- [PMTiles](https://protomaps.com/docs/pmtiles) — Efficient vector tiles for TM project polygons
- [ESRI ArcGIS REST API](https://developers.arcgis.com/rest/) — Imagery metadata via identify endpoint
- Vanilla JavaScript — No build step required

## Architecture

### TM Project Data

The app uses **insta-tm**, an S3-hosted mirror of Tasking Manager data that syncs every 10 minutes via GitHub Actions. This avoids CORS issues and provides fast, reliable access to:

- All TM projects as a single GeoJSON file (sorted client-side by lastUpdated)
- Individual project details at `/api/v2/projects/{id}`
- PMTiles vector tiles for efficient polygon rendering at low zoom levels

### ESRI Imagery Metadata

Imagery metadata is fetched from ESRI's World Imagery MapServer using the **identify endpoint** with multi-point grid sampling:

- Dual offset grids ensure complete coverage (primary grid + half-cell offset)
- Grid density adapts to zoom level (25-85 sample points)
- Results are cached in-memory while zoom remains ≥ 8
- Label deduplication using centroids prevents overlapping text

## Deployment

### GitHub Pages

1. Fork/clone this repo
2. Enable GitHub Pages in repo settings (deploy from main branch)
3. The app works out-of-the-box using the public insta-tm S3 bucket

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
- TM data powered by [insta-tm](https://github.com/hotosm/insta-tm) by HOT
