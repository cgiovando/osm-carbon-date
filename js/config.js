/**
 * Configuration for osm-carbon-date
 */

const CONFIG = {
    // Default map settings
    map: {
        center: [0, 20], // lon, lat - centered to show global coverage
        zoom: 2,
        minZoomForImageryFetch: 12, // Minimum zoom to fetch new imagery metadata (ESRI limit)
        minZoomForImageryDisplay: 8, // Minimum zoom to display cached imagery metadata
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
    },

    // OpenAerialMap - static S3 mirror of OAM catalog
    oam: {
        s3Base: 'https://cgiovando-oam-api.s3.us-east-1.amazonaws.com',
        // all_images.geojson: Full catalog (~20k footprints)
        // images.pmtiles: Vector tiles for efficient rendering
        minZoomForDisplay: 8,       // Show enriched footprints + labels from z8
        minZoomForThumbnails: 8,    // Show thumbnail overlays from z8
        maxImageAreaDeg2: 1.0,      // Filter out images with bbox > 1 deg² (~111x111km)
        minZoomForAutoTms: 16,      // Auto-load TMS raster at z16+
        maxThumbnails: 50,          // Max concurrent thumbnail image sources
        maxAutoTms: 10,             // Max concurrent auto-loaded TMS sources
        colors: {
            fill: 'rgba(0, 188, 212, 0.15)',   // Cyan fill for PMTiles overview
            stroke: '#00bcd4',                   // Cyan stroke
            selectedStroke: '#ff9800',           // Orange for selected footprint
            selectedFill: 'rgba(255, 152, 0, 0.2)'
        }
    }
};
