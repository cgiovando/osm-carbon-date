# CLAUDE.md - Project Context for AI Assistants

## Project Overview

**osm-carbon-date** is a web app that helps Tasking Manager project creators visualize ESRI satellite imagery dates. It overlays TM project boundaries with imagery metadata footprints, color-coded by age.

**Live app**: https://cgiovando.github.io/osm-carbon-date/

## Tech Stack

- **MapLibre GL JS** - Map rendering (v4.1.0)
- **Vanilla JavaScript** - No build step, static site
- **GitHub Pages** - Hosting
- **Cloudflare Worker** - CORS proxy for TM API

## Key Files

| File | Purpose |
|------|---------|
| `js/config.js` | Configuration (API URLs, colors, thresholds, proxy settings) |
| `js/app.js` | Main application logic, map initialization, event handlers |
| `js/tm-api.js` | Tasking Manager API integration with caching |
| `js/imagery-sources.js` | ESRI imagery metadata fetching via identify endpoint |
| `css/style.css` | All styling |
| `index.html` | Single page app structure |
| `cloudflare-worker/tm-proxy.js` | Cloudflare Worker code for CORS proxy |

## Critical Technical Details

### CORS Proxy Setup

The TM API doesn't have CORS headers. We use a Cloudflare Worker as primary proxy:
- **Worker URL**: `https://tm-api.giovand.workers.dev`
- **Config location**: `CONFIG.tmApi.workerProxy` in `js/config.js`
- Fallback proxies: codetabs.com, allorigins.win, corsproxy.io

### ESRI Imagery Metadata

- Uses the **identify endpoint** (not query endpoint - blocked by CORS)
- Endpoint: `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/identify`
- Field names from identify endpoint differ from query:
  - `DATE (YYYYMMDD)` (not `SRC_DATE`)
  - `RESOLUTION (M)` (not `SRC_RES`)
  - `ACCURACY (M)` (not `SRC_ACC`)
  - `DESCRIPTION` (not `NICE_NAME`)
- Date format: YYYYMMDD (e.g., 20220205 = Feb 5, 2022)
- Multi-point grid sampling for coverage (2x2 or 3x3 based on zoom)

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

### TM API Pagination

The TM API has a hard limit of **14 projects per page** regardless of the `perPage` parameter. To fetch 100 projects, `fetchRecentProjects()` iterates through multiple pages:
```javascript
const perPage = 14; // API's actual limit
const pagesToFetch = Math.ceil(limit / perPage); // 8 pages for 100 projects
```

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

1. **TM API CORS**: Solved with Cloudflare Worker proxy
2. **ESRI query endpoint CORS**: Solved with identify endpoint fallback
3. **Slow public proxies**: Worker proxy is much faster
4. **Imagery dates showing "Unknown"**: Fixed by using correct field names from identify endpoint
5. **TM API pagination**: API ignores `perPage` param, limited to 14/page - solved with multi-page fetch
6. **ESRI zoom limit**: Can't fetch below zoom 12 - solved with two-threshold system (display at 10+)

## Recent Changes (Feb 2026)

### Zoom Display Enhancement
- Added separate `minZoomForImageryFetch` (12) and `minZoomForImageryDisplay` (10) thresholds
- Imagery footprints now persist when zooming out from 12 to 10
- Context-aware zoom warning messages guide users

### Layout Fixes
- Removed map navigation controls (zoom +/-)
- Attribution collapsed by default (was expanded)
- Fixed legend/stats overlap (legend at bottom: 220px, stats at bottom: 40px)

### TM Projects
- Fixed pagination to actually fetch 100 projects (TM API limits to 14/page)
- Fetches 8 pages to get full 100 recent projects

## GitHub Actions

- Auto-deploys to GitHub Pages on push to main
- Workflow: `.github/workflows/deploy.yml`

## Related Resources

- TM API docs: https://tasks.hotosm.org/api-docs
- ESRI identify endpoint returns geometry with `rings` array
- Original inspiration: https://github.com/martinedoesgis/esri-imagery-date-finder

## HOT TM API Note

There's an open request to add `cgiovando.github.io` to the TM API CORS allowlist. If approved, the Cloudflare Worker would no longer be needed. See TM repo issues #6845 and #6969 for context on their CORS policy.
