/**
 * Configuration for osm-carbon-date
 */

const CONFIG = {
    // Default map settings
    map: {
        center: [0, 20], // lon, lat - centered to show global coverage
        zoom: 2,
        minZoomForImageryFetch: 12, // Minimum zoom to fetch new imagery metadata (ESRI limit)
        minZoomForImageryDisplay: 10, // Minimum zoom to display imagery metadata
        recentProjectsLimit: 100 // Number of recent TM projects to load
    },

    // Basemap definitions
    basemaps: {
        'esri-imagery': {
            name: 'ESRI World Imagery',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
            maxzoom: 19
        },
        'osm': {
            name: 'OpenStreetMap',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxzoom: 19
        },
        'esri-topo': {
            name: 'ESRI Topographic',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],
            attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community',
            maxzoom: 19
        },
        'carto-dark': {
            name: 'Carto Dark',
            tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxzoom: 19
        }
    },

    // Imagery age thresholds (in years)
    ageThresholds: {
        fresh: 1,      // < 1 year = green
        medium: 2,     // 1-2 years = yellow
        old: 3         // 2-3 years = orange, > 3 = red
    },

    // Colors for imagery age
    ageColors: {
        fresh: '#22c55e',
        medium: '#eab308',
        old: '#f97316',
        veryOld: '#ef4444',
        unknown: '#9ca3af'
    },

    // Insta-TM: Cloud-native mirror of HOT Tasking Manager API
    // https://github.com/cgiovando/insta-tm
    tmApi: {
        // S3-hosted API endpoints (no CORS proxy needed)
        projectUrl: 'https://tasks.hotosm.org/projects',
        s3Base: 'https://insta-tm.s3.us-east-1.amazonaws.com',
        // Individual project: {s3Base}/api/v2/projects/{id}
        // All projects GeoJSON: {s3Base}/all_projects.geojson
        // PMTiles: {s3Base}/projects.pmtiles
    },

    // ESRI API - using identify endpoint which returns geometry and works without CORS issues
    esri: {
        identifyUrl: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/identify'
    }
};
