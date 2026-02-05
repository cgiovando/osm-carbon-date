/**
 * Cloudflare Worker - Fast CORS proxy for HOT Tasking Manager API
 *
 * Deploy this to Cloudflare Workers (free tier: 100k requests/day)
 *
 * Setup:
 * 1. Go to https://workers.cloudflare.com/
 * 2. Create a new worker
 * 3. Paste this code
 * 4. Deploy and get your worker URL (e.g., https://tm-proxy.your-subdomain.workers.dev)
 * 5. Update CONFIG.tmApi.workerProxy in config.js with your worker URL
 */

const TM_API_BASE = 'https://tasking-manager-tm4-production-api.hotosm.org';

// Allowed origins (add your GitHub Pages URL)
const ALLOWED_ORIGINS = [
  'https://cgiovando.github.io',
  'http://localhost:3000',
  'http://localhost:8000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:8000',
];

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS(request);
    }

    const url = new URL(request.url);
    const path = url.pathname + url.search;

    // Only allow /api/v2/ paths
    if (!path.startsWith('/api/v2/')) {
      return new Response('Not found', { status: 404 });
    }

    // Proxy to TM API
    const tmUrl = TM_API_BASE + path;

    try {
      const response = await fetch(tmUrl, {
        method: request.method,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'osm-carbon-date/1.0'
        }
      });

      // Clone response and add CORS headers
      const newResponse = new Response(response.body, response);

      const origin = request.headers.get('Origin');
      if (ALLOWED_ORIGINS.includes(origin)) {
        newResponse.headers.set('Access-Control-Allow-Origin', origin);
      } else {
        // Allow any origin for public access (or restrict as needed)
        newResponse.headers.set('Access-Control-Allow-Origin', '*');
      }

      newResponse.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
      newResponse.headers.set('Access-Control-Max-Age', '86400');

      // Cache successful responses for 5 minutes
      if (response.ok) {
        newResponse.headers.set('Cache-Control', 'public, max-age=300');
      }

      return newResponse;
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};

function handleCORS(request) {
  const origin = request.headers.get('Origin');

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Max-Age': '86400'
    }
  });
}
