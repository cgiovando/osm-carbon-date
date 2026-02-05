# osm-carbon-date

**Carbon-dating your OSM data** — See how old the imagery is behind your mapping projects.

## The Problem

When creating map data in OpenStreetMap through HOT Tasking Manager projects, we often don't know how current the source imagery is. This leads to:

- Map data that may be months or years out of date
- Missing metadata about imagery age in OSM changesets
- Project managers unable to assess if imagery is suitable for their needs
- No easy way to compare imagery freshness across providers

## The Solution

**osm-carbon-date** overlays HOT Tasking Manager project boundaries with imagery metadata from multiple providers, showing you exactly when each imagery tile was captured.

## Features

- **Multiple imagery sources**: ESRI World Imagery, OpenAerialMap (more coming)
- **TM project overlay**: See any Tasking Manager project boundary
- **Color-coded age**: Instantly see imagery freshness (green = recent, red = old)
- **Click for details**: Get imagery dates, TM project info, and direct links
- **Basemap switcher**: Compare different imagery providers
- **Age statistics**: Min/max/average imagery age for project areas
- **URL deep-linking**: Share links to specific TM projects (e.g., `?project=17232`)

## Usage

1. Visit the app at `https://hotosm.github.io/osm-carbon-date/` (or your deployment)
2. Enter a HOT Tasking Manager project ID or browse the map
3. Zoom in to load imagery metadata (loads at zoom 12+)
4. Click on TM project areas to see imagery age statistics
5. Click on imagery tiles to see capture dates

## Imagery Age Legend

| Color | Age |
|-------|-----|
| Green | < 1 year |
| Yellow | 1-2 years |
| Orange | 2-3 years |
| Red | > 3 years |

## Supported Imagery Sources

| Provider | Status | Notes |
|----------|--------|-------|
| ESRI World Imagery | Supported | Metadata via ArcGIS REST API |
| OpenAerialMap | Planned | Community-contributed imagery |
| Bing Maps | Planned | Metadata API TBD |
| Maxar | Planned | Requires API key |

## Deployment

### GitHub Pages (Recommended)

1. Fork/clone this repo
2. Deploy a CORS proxy (see below)
3. Update `js/config.js` with your proxy URL
4. Enable GitHub Pages in repo settings

### CORS Proxy Setup

Both the HOT Tasking Manager API and ESRI's imagery metadata API lack CORS headers, requiring a proxy for browser requests.

#### Option 1: Cloudflare Workers (Free)

Create a new Worker with this code:

```javascript
// worker.js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
      return new Response('Missing url parameter', { status: 400 });
    }

    // Only allow specific domains
    const allowed = ['tasking-manager-tm4-production-api.hotosm.org', 'services.arcgisonline.com'];
    const targetHost = new URL(targetUrl).hostname;
    if (!allowed.some(h => targetHost.includes(h))) {
      return new Response('Domain not allowed', { status: 403 });
    }

    const response = await fetch(targetUrl, {
      headers: { 'User-Agent': 'osm-carbon-date/1.0' }
    });

    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    return newResponse;
  }
};
```

Then update `js/config.js`:
```javascript
tmApi: {
    corsProxy: 'https://your-worker.workers.dev/?url='
},
esri: {
    corsProxy: 'https://your-worker.workers.dev/?url='
}
```

#### Option 2: Local Development with CORS Extension

For local development, install a browser extension like:
- [CORS Unblock](https://chrome.google.com/webstore/detail/cors-unblock/) (Chrome)
- [CORS Everywhere](https://addons.mozilla.org/en-US/firefox/addon/cors-everywhere/) (Firefox)

### Local Development

```bash
# Using Python
python -m http.server 8000

# Using Node
npx serve .
```

Then open `http://localhost:8000`

## Tech Stack

- [MapLibre GL JS](https://maplibre.org/) — Map rendering
- [HOT Tasking Manager API](https://tasks.hotosm.org/api-docs) — Project geometries
- [ESRI ArcGIS REST API](https://developers.arcgis.com/rest/) — Imagery metadata
- Vanilla JavaScript — No build step required

## Contributing

Contributions welcome! Ideas for new imagery sources, features, or improvements — open an issue or PR.

## License

MIT

## Credits

- Built for [HOT - Humanitarian OpenStreetMap Team](https://www.hotosm.org/)
- Original ESRI imagery date finder by [martinedoesgis](https://github.com/martinedoesgis)
