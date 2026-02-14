# CLAUDE.md - Project Context for AI Assistants

## Project Overview

**osm-carbon-date** is a web app that helps Tasking Manager project creators visualize satellite imagery dates from ESRI World Imagery and OpenAerialMap. It overlays TM project boundaries with imagery metadata footprints, color-coded by age.

**Live app**: https://cgiovando.github.io/osm-carbon-date/

## Tech Stack

- **MapLibre GL JS** - Map rendering (v4.1.0)
- **Vanilla JavaScript** - No build step, static site
- **GitHub Pages** - Hosting
- **insta-tm** - S3-hosted TM API mirror (https://github.com/cgiovando/insta-tm)

## Key Files

| File | Purpose |
|------|---------|
| `js/config.js` | Configuration (API URLs, colors, thresholds) |
| `js/app.js` | Main application logic, map initialization, event handlers |
| `js/tm-api.js` | Tasking Manager API integration via insta-tm |
| `js/imagery-sources.js` | ESRI imagery metadata fetching via identify endpoint |
| `js/oam-source.js` | OpenAerialMap data loading, thumbnails, feature selection |
| `css/style.css` | All styling |
| `index.html` | Single page app structure |

## Critical Technical Details

### Insta-TM Integration

TM project data is fetched from **insta-tm**, a cloud-native S3-hosted mirror of the HOT Tasking Manager API:
- **S3 Base URL**: `https://insta-tm.s3.us-east-1.amazonaws.com`
- **Individual project**: `{s3Base}/api/v2/projects/{id}`
- **All projects GeoJSON**: `{s3Base}/all_projects.geojson`
- **PMTiles**: `{s3Base}/projects.pmtiles` (vector tiles for efficient rendering)

Benefits over direct TM API:
- No CORS proxy needed (S3 has proper headers)
- Single request for all projects (no pagination)
- Fast CDN-cached responses
- Data synced every 10 minutes

### PMTiles Integration

The app uses **PMTiles** (cloud-native vector tiles) for efficient rendering of all TM project geometries at low zoom levels:
- **Library**: `pmtiles.js` v3.0.6 via CDN
- **Protocol**: Registered as `pmtiles://` with MapLibre GL JS
- **Source layer**: `projects` (contains ~900+ project polygons)
- **Zoom range**: 0-12 (tiles generated with tippecanoe)

**Layer visibility logic:**
- At low zoom (global view): PMTiles polygons visible
- At medium zoom (6+): PMTiles polygons + labels become clearly visible
- At high zoom (10+) with selected project: PMTiles hide, only selected project boundary shown

### ESRI Imagery Metadata

- Uses the **identify endpoint** (not query endpoint - blocked by CORS)
- Endpoint: `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/identify`
- Field names from identify endpoint differ from query:
  - `DATE (YYYYMMDD)` (not `SRC_DATE`)
  - `RESOLUTION (M)` (not `SRC_RES`)
  - `ACCURACY (M)` (not `SRC_ACC`)
  - `DESCRIPTION` (not `NICE_NAME`)
- Date format: YYYYMMDD (e.g., 20220205 = Feb 5, 2022)
- **Dual offset grid sampling** for coverage without overwhelming ESRI servers:
  - Primary grid: Points centered in each cell
  - Secondary grid: Offset by half-cell to catch tiles between primary points
  - Grid density by zoom: z15+ (25 pts), z14 (41 pts), z13 (61 pts), z12 (85 pts)
- **Label deduplication**: Imagery labels use centroid points (one per tile) to avoid duplicate labels from multipolygons
- **Caching**: Loaded imagery persists in memory while zoom stays at 8+; only clears when zooming below 8

### OpenAerialMap (OAM) Integration

OAM imagery is an **alternative source** to ESRI, selected via a dropdown (mutually exclusive). Data comes from a static S3 mirror of the OAM catalog:
- **S3 Base URL**: `https://cgiovando-oam-api.s3.us-east-1.amazonaws.com`
- **All images GeoJSON**: `{s3Base}/all_images.geojson` (~20k footprints)
- **PMTiles**: `{s3Base}/images.pmtiles` (exists but not displayed — contains unfiltered oversized images)

**Zoom behavior:**

| Zoom | Footprints (GeoJSON) | Thumbnails |
|------|---------------------|------------|
| 0-7 | Hidden | None |
| 8+ | Age-colored outlines + labels | Yes (max 50) |

**Key implementation details:**
- **Mutually exclusive**: ESRI and OAM are selected via a `<select>` dropdown — only one active at a time
- **Lazy loading**: OAM data loads only when first selected (one-time fetch of `all_images.geojson`)
- **Oversized image filter**: Images with bbox area > 1 deg² (~111x111km) are filtered out during loading (removes ~42 mosaics/composites)
- **Viewport filtering**: All ~20k features are filtered client-side to the current viewport bbox
- **Thumbnails**: Added as MapLibre `image` sources, bbox-aligned. Max 50 concurrent. Failed thumbnails (404s) are silently removed via `map.on('error')` handler.
- **Light footprint fill**: Fill opacity 0.08 so thumbnails show through clearly
- **TMS disabled**: OAM TMS tiles (`tiles.openaerialmap.org`) block cross-origin requests. TMS code paths exist but are disabled. Future: self-hosted titiler on Lambda.
- **URL sanitization**: All OAM URLs converted from `http://` to `https://`
- **Date format**: ISO 8601 from `acquisition_start` field (e.g., `2023-05-15T00:00:00.000Z`)

### Imagery Age Colors

```javascript
ageThresholds: { fresh: 1, medium: 2, old: 3 } // years
ageColors: {
    fresh: '#22c55e',    // green - < 1 year
    medium: '#eab308',   // yellow - 1-2 years
    old: '#f97316',      // orange - 2-3 years
    veryOld: '#ef4444',  // red - > 3 years
    unknown: '#9ca3af'   // gray
}
```

### TM API Caching

- In-memory cache in `TmApi._cache`
- 5-minute TTL (`_cacheTimeout: 5 * 60 * 1000`)
- Cache keys: `projects-{limit}`, `project-{id}`

### Dynamic TM Project Colors

TM project boundaries and labels adapt to the basemap:
- **Dark basemaps** (ESRI Imagery, Carto Dark): white outlines/labels with black halo
- **Light basemaps** (OSM, ESRI Topo): dark grey (#333) outlines/labels with white halo
- Updated via `updateTmProjectColors()`, called from `changeBasemap()`
- Selected project uses solid + dashed contrast line for visibility on any background

## UI Layout

**Left side:**
- Header (osm-carbon-date)
- Controls panel (project input, basemap selector, imagery metadata source dropdown, TM projects toggle, recent projects list)

**Right side (vertical stack):**
- TM Project info panel (top) — or OAM info panel (mutually exclusive)
- Imagery Age legend (bottom: 220px)
- Imagery Statistics panel (bottom: 40px) — shows stats for active source only
- Attribution control (collapsed by default)

**Center:**
- Zoom warning (source-aware: "Zoom to 12+ for ESRI" or "Zoom to 8+ for OAM")
- ESRI loading indicator (red pill)
- OAM loading indicator (teal pill, shown during initial data load)

**Note:** Map navigation controls (zoom +/-) are intentionally removed for cleaner UI.

## Configuration Defaults

```javascript
map: {
    center: [0, 20],
    zoom: 2,
    minZoomForImageryFetch: 12,    // ESRI API limit - can't fetch below this
    minZoomForImageryDisplay: 8,   // Show cached data down to this level
    recentProjectsLimit: 100
}
oam: {
    minZoomForDisplay: 8,          // Show OAM footprints from z8
    minZoomForThumbnails: 8,       // Show thumbnail overlays from z8
    maxImageAreaDeg2: 1.0,         // Filter images > 1 deg²
    maxThumbnails: 50              // Max concurrent thumbnail sources
}
```

### Two-Threshold Zoom System (ESRI only)

The app uses separate thresholds for **fetching** vs **displaying** ESRI imagery:
- **Fetch threshold (12)**: ESRI API's minimum zoom level for data
- **Display threshold (8)**: Cached imagery footprints remain visible when zooming out

This lets users see entire project areas with previously loaded footprints, even below ESRI's fetch limit.

## Brand Colors

- **HOT red**: `#d73f3f` (used for UI elements: header, buttons, sidebar)
- **TM project outlines**: White on dark basemaps, dark grey on light basemaps (dynamic)
- **OAM selection orange**: `#ff9800` (selected footprint highlight)

## Known Issues & Solutions

1. **ESRI query endpoint CORS**: Solved with identify endpoint fallback
2. **Imagery dates showing "Unknown"**: Fixed by using correct field names from identify endpoint
3. **ESRI zoom limit**: Can't fetch below zoom 12 - solved with two-threshold system (display cached at z8+)
4. **TM API CORS/pagination**: Solved by using insta-tm S3 mirror instead of direct TM API
5. **OAM TMS CORS**: `tiles.openaerialmap.org` blocks cross-origin. TMS disabled. Thumbnails (S3) work. Future: titiler on Lambda.
6. **OAM oversized images**: Country-spanning mosaics filtered by bbox area > 1 deg²
7. **OAM PMTiles unfiltered**: PMTiles overview contains oversized images. Solved by not displaying it — only filtered GeoJSON at z8+.

## GitHub Actions

- Auto-deploys to GitHub Pages on push to main
- Workflow: `.github/workflows/deploy.yml`

## Related Resources

- insta-tm repo: https://github.com/cgiovando/insta-tm
- OAM S3 mirror: `cgiovando-oam-api` S3 bucket
- OpenAerialMap: https://openaerialmap.org
- TM API docs: https://tasks.hotosm.org/api-docs
- ESRI identify endpoint returns geometry with `rings` array
- Original inspiration: https://github.com/martinedoesgis/esri-imagery-date-finder
