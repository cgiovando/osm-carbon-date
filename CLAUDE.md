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

## UI Layout

**Left side:**
- Header (osm-carbon-date)
- Controls panel (project input, basemap, layers, recent projects list)

**Right side (vertical stack):**
- TM Project info panel (top)
- Map navigation controls
- Imagery Age legend
- Imagery Statistics panel (bottom)

**Center:**
- Zoom warning (when < zoom 12)
- Imagery loading indicator (red pill)

## Configuration Defaults

```javascript
map: {
    center: [0, 20],
    zoom: 2,
    minZoomForImagery: 12,
    recentProjectsLimit: 100
}
```

## Brand Colors

- **HOT red**: `#d73f3f` (used for project markers, buttons, accents)
- Project markers and labels use HOT red
- TM project boundary: red/white dashed line

## Known Issues & Solutions

1. **TM API CORS**: Solved with Cloudflare Worker proxy
2. **ESRI query endpoint CORS**: Solved with identify endpoint fallback
3. **Slow public proxies**: Worker proxy is much faster
4. **Imagery dates showing "Unknown"**: Fixed by using correct field names from identify endpoint

## GitHub Actions

- Auto-deploys to GitHub Pages on push to main
- Workflow: `.github/workflows/deploy.yml`

## Related Resources

- TM API docs: https://tasks.hotosm.org/api-docs
- ESRI identify endpoint returns geometry with `rings` array
- Original inspiration: https://github.com/martinedoesgis/esri-imagery-date-finder

## HOT TM API Note

There's an open request to add `cgiovando.github.io` to the TM API CORS allowlist. If approved, the Cloudflare Worker would no longer be needed. See TM repo issues #6845 and #6969 for context on their CORS policy.
