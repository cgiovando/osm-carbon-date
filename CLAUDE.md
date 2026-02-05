# CLAUDE.md - Project Context for AI Assistants

## Project Overview

**osm-carbon-date** is a web app that helps Tasking Manager project creators visualize ESRI satellite imagery dates. It overlays TM project boundaries with imagery metadata footprints, color-coded by age.

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
- At low zoom (global view): Circle markers + PMTiles polygons visible
- At medium zoom (6+): PMTiles polygons become clearly visible
- At high zoom (10+) with selected project: PMTiles and circles hide, only selected project boundary shown

This enables smooth exploration of all TM projects worldwide without downloading the full GeoJSON.

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
- **Caching**: Loaded imagery persists in memory while zoom stays at 10+; only clears when zooming below 10

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

## UI Layout

**Left side:**
- Header (osm-carbon-date)
- Controls panel (project input, basemap, layers, recent projects list)

**Right side (vertical stack):**
- TM Project info panel (top)
- Imagery Age legend (bottom: 220px)
- Imagery Statistics panel (bottom: 40px)
- Attribution control (collapsed by default)

**Center:**
- Zoom warning (context-aware messages based on zoom level)
- Imagery loading indicator (red pill)

**Note:** Map navigation controls (zoom +/-) are intentionally removed for cleaner UI.

## Configuration Defaults

```javascript
map: {
    center: [0, 20],
    zoom: 2,
    minZoomForImageryFetch: 12,    // ESRI API limit - can't fetch below this
    minZoomForImageryDisplay: 10,  // Show existing data down to this level
    recentProjectsLimit: 100
}
```

### Two-Threshold Zoom System

The app uses separate thresholds for **fetching** vs **displaying** imagery:
- **Fetch threshold (12)**: ESRI API's minimum zoom level for data
- **Display threshold (10)**: Imagery footprints remain visible when zooming out

This lets users see entire project areas with previously loaded footprints, even below ESRI's fetch limit. The `onMapMove()` function in `app.js` handles this with three cases:
1. Below display (< 10): Clear all imagery
2. Between display and fetch (10-11): Keep existing, don't fetch
3. At/above fetch (12+): Fetch new imagery

## Brand Colors

- **HOT red**: `#d73f3f` (used for project markers, buttons, accents)
- Project markers and labels use HOT red
- TM project boundary: red/white dashed line

## Known Issues & Solutions

1. **ESRI query endpoint CORS**: Solved with identify endpoint fallback
2. **Imagery dates showing "Unknown"**: Fixed by using correct field names from identify endpoint
3. **ESRI zoom limit**: Can't fetch below zoom 12 - solved with two-threshold system (display at 10+)
4. **TM API CORS/pagination**: Solved by using insta-tm S3 mirror instead of direct TM API

## Recent Changes (Feb 2026)

### Imagery Metadata Improvements
- **Reduced API requests**: Grid density reduced from 265 to 85 points at z12 to avoid overwhelming ESRI servers
- **Label deduplication**: Imagery labels now use centroid points, preventing duplicate/overlapping labels from multipolygon tiles
- **Smart caching**: Imagery data persists in memory while navigating at z10+; users zoom to z12+ to load an area, then can zoom out to z10 to view it
- **No fetching at z10-11**: Only displays cached data at these zoom levels (prevents excessive API requests)
- **Initial load fix**: Added `onMapMove()` call on map load to fetch imagery when page loads with hash coordinates

### Zoom Display Enhancement
- Added separate `minZoomForImageryFetch` (12) and `minZoomForImageryDisplay` (10) thresholds
- Imagery footprints now persist when zooming out from 12 to 10
- Context-aware zoom warning messages guide users

### Layout Fixes
- Removed map navigation controls (zoom +/-)
- Attribution collapsed by default (was expanded)
- Fixed legend/stats overlap (legend at bottom: 220px, stats at bottom: 40px)

### TM Projects
- **Label deduplication**: TM project labels use centroids from `all_projects.geojson` (933 projects), preventing duplicate labels from multipolygon geometries
- Migrated to insta-tm S3 mirror for TM data (no more CORS proxy needed)
- Single request fetches all projects, sorted by lastUpdated
- Removed Cloudflare Worker dependency
- Added PMTiles support for efficient rendering of project polygons at low zoom
- Circle markers (centroids) + polygon outlines visible at global view
- PMTiles polygons become clearly visible at zoom 6+

### Known Limitations
- **Small imagery slivers**: ESRI's identify endpoint doesn't support area filtering, so small sliver polygons between larger tiles are still fetched and displayed. Server-side filtering would require the query endpoint (CORS blocked) or a custom proxy.

## GitHub Actions

- Auto-deploys to GitHub Pages on push to main
- Workflow: `.github/workflows/deploy.yml`

## Related Resources

- insta-tm repo: https://github.com/cgiovando/insta-tm
- TM API docs: https://tasks.hotosm.org/api-docs
- ESRI identify endpoint returns geometry with `rings` array
- Original inspiration: https://github.com/martinedoesgis/esri-imagery-date-finder
