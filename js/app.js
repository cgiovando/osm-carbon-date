/**
 * Main application for osm-carbon-date
 */

(function() {
    // Register PMTiles protocol with MapLibre
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    // State
    let map;
    let currentProject = null;
    let loadedImageryIds = new Set();
    let imageryFeatures = [];
    let imageryCentroids = []; // For deduplicated imagery labels
    let recentProjects = [];
    let projectCentroids = []; // For deduplicated TM project labels

    // OAM state
    let oamEnabled = false;
    let oamLoaded = false;
    let oamFeatures = [];       // All enriched OAM features (loaded once)
    let oamCentroids = [];      // All OAM centroid points
    let selectedOamFeature = null;

    // DOM elements
    const tmProjectInput = document.getElementById('tm-project-input');
    const loadProjectBtn = document.getElementById('load-project-btn');
    const basemapSelect = document.getElementById('basemap-select');
    const imagerySourceSelect = document.getElementById('imagery-source-select');
    const showTmProjects = document.getElementById('show-tm-projects');
    const zoomWarning = document.getElementById('zoom-warning');
    const infoPanel = document.getElementById('info-panel');
    const infoTitle = document.getElementById('info-title');
    const infoContent = document.getElementById('info-content');
    const closeInfoBtn = document.getElementById('close-info');
    const oamInfoPanel = document.getElementById('oam-info-panel');
    const oamInfoTitle = document.getElementById('oam-info-title');
    const oamInfoContent = document.getElementById('oam-info-content');
    const closeOamInfoBtn = document.getElementById('close-oam-info');
    const oamLoading = document.getElementById('oam-loading');
    const statsPanel = document.getElementById('stats-panel');
    const statsContent = document.getElementById('stats-content');
    const recentProjectsList = document.getElementById('recent-projects-list');
    const imageryLoading = document.getElementById('imagery-loading');

    /**
     * Calculate centroid from a GeoJSON geometry (polygon/multipolygon)
     * Returns [lng, lat] or null if invalid
     */
    function getCentroidFromGeometry(geometry) {
        if (!geometry || !geometry.coordinates) return null;

        let minLon = Infinity, minLat = Infinity;
        let maxLon = -Infinity, maxLat = -Infinity;

        const processCoords = (coords) => {
            if (typeof coords[0] === 'number') {
                minLon = Math.min(minLon, coords[0]);
                maxLon = Math.max(maxLon, coords[0]);
                minLat = Math.min(minLat, coords[1]);
                maxLat = Math.max(maxLat, coords[1]);
            } else {
                coords.forEach(processCoords);
            }
        };

        processCoords(geometry.coordinates);

        if (!isFinite(minLon) || !isFinite(minLat)) return null;

        return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
    }

    /**
     * Initialize the map
     */
    function initMap() {
        // Check for hash coordinates first
        const hashState = parseHashState();
        const initialCenter = hashState.center || CONFIG.map.center;
        const initialZoom = hashState.zoom || CONFIG.map.zoom;

        const basemap = CONFIG.basemaps['esri-imagery'];

        map = new maplibregl.Map({
            container: 'map',
            style: {
                version: 8,
                glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
                sources: {
                    'basemap': {
                        type: 'raster',
                        tiles: basemap.tiles,
                        tileSize: 256,
                        attribution: basemap.attribution,
                        maxzoom: basemap.maxzoom
                    }
                },
                layers: [{
                    id: 'basemap-layer',
                    type: 'raster',
                    source: 'basemap'
                }]
            },
            center: initialCenter,
            zoom: initialZoom,
            attributionControl: false, // We'll add custom attribution
            hash: false // We'll handle hash manually to include project
        });

        // Add compact attribution control
        map.addControl(new maplibregl.AttributionControl({
            compact: true,
            customAttribution: ''
        }), 'bottom-right');
        map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

        // Collapse attribution by default (remove open attribute)
        setTimeout(() => {
            const attrib = document.querySelector('.maplibregl-ctrl-attrib');
            if (attrib) {
                attrib.removeAttribute('open');
                attrib.classList.remove('maplibregl-compact-show');
            }
        }, 100);

        map.on('load', () => {
            addMapSources();
            addMapLayers();
            setupEventListeners();
            checkUrlParams();
            loadRecentProjects();
            loadAllProjectCentroids(); // Load ALL centroids for deduplicated labels
            onMapMove(); // Initial load of imagery metadata
        });

        map.on('moveend', onMapMove);
        map.on('zoomend', updateZoomWarning);
    }

    /**
     * Parse hash state from URL (#zoom/lat/lng)
     */
    function parseHashState() {
        const hash = window.location.hash.replace('#', '');
        if (!hash) return {};

        const parts = hash.split('/');
        if (parts.length >= 3) {
            const zoom = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            const lng = parseFloat(parts[2]);

            if (!isNaN(zoom) && !isNaN(lat) && !isNaN(lng)) {
                return {
                    zoom: zoom,
                    center: [lng, lat]
                };
            }
        }
        return {};
    }

    /**
     * Update URL hash with current map state
     */
    function updateUrlHash() {
        const center = map.getCenter();
        const zoom = map.getZoom().toFixed(2);
        const lat = center.lat.toFixed(5);
        const lng = center.lng.toFixed(5);

        // Preserve query params (like project=X)
        const url = new URL(window.location);
        url.hash = `${zoom}/${lat}/${lng}`;
        window.history.replaceState({}, '', url);
    }

    /**
     * Add GeoJSON sources for imagery, TM projects, and recent projects
     */
    function addMapSources() {
        map.addSource('imagery-metadata', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        // GeoJSON source for imagery label centroids (one per tile, avoids multi-polygon duplication)
        map.addSource('imagery-centroids', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        map.addSource('tm-project', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        // PMTiles source for all TM project geometries (efficient rendering)
        map.addSource('tm-projects-pmtiles', {
            type: 'vector',
            url: `pmtiles://${CONFIG.tmApi.s3Base}/projects.pmtiles`
        });

        // GeoJSON source for project label centroids (one per project, avoids multi-polygon duplication)
        map.addSource('project-centroids', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        // OAM PMTiles source for efficient rendering at low zoom
        map.addSource('oam-pmtiles', {
            type: 'vector',
            url: `pmtiles://${CONFIG.oam.s3Base}/images.pmtiles`
        });

        // OAM enriched footprints (GeoJSON, populated at z10+)
        map.addSource('oam-footprints', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        // OAM centroid points for labels
        map.addSource('oam-centroids', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    /**
     * Add map layers
     */
    function addMapLayers() {
        // PMTiles layers - project polygons (efficient at all zoom levels)
        // Fill layer for project areas
        map.addLayer({
            id: 'pmtiles-projects-fill',
            type: 'fill',
            source: 'tm-projects-pmtiles',
            'source-layer': 'projects',
            paint: {
                'fill-color': '#ffffff',
                'fill-opacity': 0.1
            }
        });

        // Outline layer for project boundaries
        map.addLayer({
            id: 'pmtiles-projects-outline',
            type: 'line',
            source: 'tm-projects-pmtiles',
            'source-layer': 'projects',
            paint: {
                'line-color': '#ffffff',
                'line-width': 1.5,
                'line-opacity': 0.7
            }
        });

        // Project labels from centroids GeoJSON (one label per project, avoids multi-polygon duplication)
        map.addLayer({
            id: 'project-labels',
            type: 'symbol',
            source: 'project-centroids',
            minzoom: 6,
            layout: {
                'text-field': ['concat', '#', ['get', 'projectId']],
                'text-font': ['Open Sans Bold'],
                'text-size': 12,
                'symbol-placement': 'point',
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'text-optional': true
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#000000',
                'text-halo-width': 2
            }
        });

        // Imagery metadata fill (age-based colors)
        map.addLayer({
            id: 'imagery-fill',
            type: 'fill',
            source: 'imagery-metadata',
            paint: {
                'fill-color': ['get', 'ageColor'],
                'fill-opacity': 0.35
            }
        });

        // Imagery metadata outline (age-based colors)
        map.addLayer({
            id: 'imagery-outline',
            type: 'line',
            source: 'imagery-metadata',
            paint: {
                'line-color': ['get', 'ageColor'],
                'line-width': 2.5,
                'line-opacity': 1
            }
        });

        // Imagery date labels using centroids (one label per tile, avoids multipolygon duplication)
        map.addLayer({
            id: 'imagery-labels',
            type: 'symbol',
            source: 'imagery-centroids',
            layout: {
                'text-field': ['get', 'formattedDate'],
                'text-font': ['Open Sans Bold'],
                'text-size': 13,
                'text-anchor': 'center',
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'text-padding': 5
            },
            paint: {
                'text-color': ['get', 'ageColor'],
                'text-halo-color': '#000000',
                'text-halo-width': 2
            }
        });

        // TM project fill
        map.addLayer({
            id: 'tm-project-fill',
            type: 'fill',
            source: 'tm-project',
            paint: {
                'fill-color': '#ffffff',
                'fill-opacity': 0.1
            }
        });

        // TM project outline
        map.addLayer({
            id: 'tm-project-outline',
            type: 'line',
            source: 'tm-project',
            paint: {
                'line-color': '#ffffff',
                'line-width': 3
            }
        });

        // TM project outline dashed (for visibility on any background)
        map.addLayer({
            id: 'tm-project-outline-dash',
            type: 'line',
            source: 'tm-project',
            paint: {
                'line-color': '#333333',
                'line-width': 3,
                'line-dasharray': [2, 2]
            }
        });

        // --- OAM layers (all start hidden) ---

        // OAM PMTiles fill (cyan, for z0-9 overview)
        map.addLayer({
            id: 'oam-pmtiles-fill',
            type: 'fill',
            source: 'oam-pmtiles',
            'source-layer': 'images',
            paint: {
                'fill-color': '#00bcd4',
                'fill-opacity': 0.15
            },
            layout: { 'visibility': 'none' }
        });

        // OAM PMTiles outline
        map.addLayer({
            id: 'oam-pmtiles-outline',
            type: 'line',
            source: 'oam-pmtiles',
            'source-layer': 'images',
            paint: {
                'line-color': '#00bcd4',
                'line-width': 1,
                'line-opacity': 0.6
            },
            layout: { 'visibility': 'none' }
        });

        // OAM footprints fill (age-colored, very light so thumbnails show through)
        map.addLayer({
            id: 'oam-footprints-fill',
            type: 'fill',
            source: 'oam-footprints',
            paint: {
                'fill-color': ['get', 'ageColor'],
                'fill-opacity': 0.08
            },
            layout: { 'visibility': 'none' }
        });

        // OAM footprints outline (age-colored)
        map.addLayer({
            id: 'oam-footprints-outline',
            type: 'line',
            source: 'oam-footprints',
            paint: {
                'line-color': ['get', 'ageColor'],
                'line-width': 2,
                'line-opacity': 0.8
            },
            layout: { 'visibility': 'none' }
        });

        // OAM selected feature outline (orange)
        map.addLayer({
            id: 'oam-selected-outline',
            type: 'line',
            source: 'oam-footprints',
            paint: {
                'line-color': '#ff9800',
                'line-width': 3,
                'line-opacity': 1
            },
            filter: ['==', ['get', '_oamId'], ''],
            layout: { 'visibility': 'none' }
        });

        // OAM date labels from centroids
        map.addLayer({
            id: 'oam-labels',
            type: 'symbol',
            source: 'oam-centroids',
            layout: {
                'text-field': ['get', 'formattedDate'],
                'text-font': ['Open Sans Bold'],
                'text-size': 12,
                'text-anchor': 'center',
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'text-padding': 5,
                'visibility': 'none'
            },
            paint: {
                'text-color': ['get', 'ageColor'],
                'text-halo-color': '#000000',
                'text-halo-width': 2
            }
        });
    }

    /**
     * Setup UI event listeners
     */
    function setupEventListeners() {
        // Load TM project
        loadProjectBtn.addEventListener('click', loadTmProject);
        tmProjectInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadTmProject();
        });

        // Basemap selector
        basemapSelect.addEventListener('change', changeBasemap);

        // Imagery source selector (mutually exclusive ESRI / OAM)
        imagerySourceSelect.addEventListener('change', changeImagerySource);
        showTmProjects.addEventListener('change', toggleTmLayer);

        // Close info panel
        closeInfoBtn.addEventListener('click', () => {
            infoPanel.classList.add('hidden');
        });

        // Close OAM info panel
        closeOamInfoBtn.addEventListener('click', () => {
            oamInfoPanel.classList.add('hidden');
            OamSource.deselectFeature(map);
        });

        // Click on imagery for popup
        map.on('click', 'imagery-fill', onImageryClick);
        map.on('mouseenter', 'imagery-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'imagery-fill', () => {
            map.getCanvas().style.cursor = '';
        });

        // Click on OAM footprints (enriched GeoJSON at z10+)
        map.on('click', 'oam-footprints-fill', onOamFootprintClick);
        map.on('mouseenter', 'oam-footprints-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'oam-footprints-fill', () => {
            map.getCanvas().style.cursor = '';
        });

        // Handle failed image sources (404 thumbnails)
        map.on('error', (e) => {
            if (e.sourceId && e.sourceId.startsWith('oam-thumb-')) {
                console.debug('Removing failed thumbnail:', e.sourceId);
                OamSource._removeThumbnail(map, e.sourceId);
            }
        });

        // Click on TM project
        map.on('click', 'tm-project-fill', onTmProjectClick);
        map.on('mouseenter', 'tm-project-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'tm-project-fill', () => {
            map.getCanvas().style.cursor = '';
        });

        // Click on PMTiles project polygons
        map.on('click', 'pmtiles-projects-fill', onPmtilesProjectClick);
        map.on('mouseenter', 'pmtiles-projects-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'pmtiles-projects-fill', () => {
            map.getCanvas().style.cursor = '';
        });

        // Hash change listener
        window.addEventListener('hashchange', () => {
            const state = parseHashState();
            if (state.center && state.zoom) {
                map.jumpTo({ center: state.center, zoom: state.zoom });
            }
        });
    }

    /**
     * Check URL parameters for deep linking
     */
    function checkUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const projectId = params.get('project') || params.get('tm');

        if (projectId) {
            tmProjectInput.value = projectId;
            loadTmProject();
        }
    }

    /**
     * Load recent TM projects for sidebar list
     */
    async function loadRecentProjects() {
        console.log('Loading recent TM projects...');
        try {
            const limit = CONFIG.map.recentProjectsLimit || 100;
            const data = await TmApi.fetchRecentProjects(limit);
            recentProjects = data.projects || [];
            console.log(`Loaded ${recentProjects.length} projects for sidebar`);
            renderRecentProjectsList();
        } catch (error) {
            console.error('Error loading recent projects:', error);
            recentProjectsList.innerHTML = '<div class="loading-text">Error loading projects</div>';
        }
    }

    /**
     * Load ALL project centroids from the full GeoJSON file
     * This ensures deduplicated labels (one per project) for all projects, not just recent 100
     */
    async function loadAllProjectCentroids() {
        console.log('Loading all project centroids for labels...');
        try {
            const url = `${CONFIG.tmApi.s3Base}/all_projects.geojson`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const geojson = await response.json();

            if (geojson.features && geojson.features.length > 0) {
                projectCentroids = geojson.features
                    .map(f => {
                        const centroid = getCentroidFromGeometry(f.geometry);
                        if (!centroid) return null;
                        return {
                            type: 'Feature',
                            geometry: {
                                type: 'Point',
                                coordinates: centroid
                            },
                            properties: {
                                projectId: f.properties.projectId,
                                name: f.properties.name
                            }
                        };
                    })
                    .filter(f => f !== null);

                // Update the map source with centroids
                map.getSource('project-centroids').setData({
                    type: 'FeatureCollection',
                    features: projectCentroids
                });
                console.log(`Loaded ${projectCentroids.length} project centroids for labels`);
            }
        } catch (error) {
            console.error('Error loading project centroids:', error);
        }
    }

    /**
     * Render recent projects list in sidebar
     */
    function renderRecentProjectsList() {
        if (!recentProjectsList) return;

        if (recentProjects.length === 0) {
            recentProjectsList.innerHTML = '<div class="loading-text">No projects found</div>';
            return;
        }

        recentProjectsList.innerHTML = recentProjects.map(project => `
            <div class="recent-project-item" data-project-id="${project.projectId}">
                <div class="project-id">#${project.projectId}</div>
                <div class="project-name">${project.name || 'Untitled'}</div>
                <div class="project-status status-${(project.status || '').toLowerCase()}">${project.status || 'Unknown'}</div>
            </div>
        `).join('');

        // Add click handlers
        recentProjectsList.querySelectorAll('.recent-project-item').forEach(item => {
            item.addEventListener('click', () => {
                const projectId = parseInt(item.dataset.projectId);

                // Load the project (will fly to bounds)
                tmProjectInput.value = projectId;
                loadTmProject();
            });
        });
    }

    /**
     * Render recent projects on map
     * Note: PMTiles handles the map rendering, this is now just a placeholder
     * that could be used for any additional GeoJSON overlay if needed
     */
    function renderRecentProjectsOnMap() {
        // PMTiles source handles rendering of all project geometries
        // No additional GeoJSON source needed
        console.log('Recent projects will be displayed via PMTiles');
    }

    /**
     * Handle click on PMTiles project polygon
     */
    function onPmtilesProjectClick(e) {
        if (!e.features || e.features.length === 0) return;

        const feature = e.features[0];
        const props = feature.properties;

        // PMTiles features have projectId in properties
        const projectId = props.projectId || props.id;
        if (projectId) {
            tmProjectInput.value = projectId;
            loadTmProject();
        }
    }

    /**
     * Load a TM project
     * @param {Object} options - Optional settings
     * @param {boolean} options.skipFitBounds - Skip flying to bounds (if already zoomed)
     */
    async function loadTmProject(options = {}) {
        const projectId = parseInt(tmProjectInput.value);
        if (!projectId || isNaN(projectId)) {
            alert('Please enter a valid TM project ID');
            return;
        }

        loadProjectBtn.disabled = true;
        loadProjectBtn.innerHTML = '<span class="loading"></span>';

        // Close OAM panel if open
        oamInfoPanel.classList.add('hidden');

        // Show loading state in info panel immediately
        infoTitle.textContent = `TM Project #${projectId}`;
        infoContent.innerHTML = '<div class="loading-text">Loading project...</div>';
        infoPanel.classList.remove('hidden');

        try {
            currentProject = await TmApi.fetchProject(projectId);

            // Update map source with project geometry
            const geojson = TmApi.projectToGeoJSON(currentProject);
            map.getSource('tm-project').setData({
                type: 'FeatureCollection',
                features: [geojson]
            });

            // Fly to project bounds only if not skipped
            if (!options.skipFitBounds) {
                const bounds = TmApi.getProjectBounds(currentProject);
                if (bounds) {
                    map.fitBounds(bounds, { padding: 50 });
                }
            }

            // Update info panel with full details
            infoContent.innerHTML = TmApi.formatProjectInfo(currentProject);

            // Update URL
            const url = new URL(window.location);
            url.searchParams.set('project', projectId);
            window.history.replaceState({}, '', url);

            // Update layer visibility based on zoom
            updateProjectLayerVisibility();

        } catch (error) {
            infoContent.innerHTML = `<div class="error-text">Error: ${error.message}</div>`;
        } finally {
            loadProjectBtn.disabled = false;
            loadProjectBtn.textContent = 'Load';
        }
    }

    /**
     * Update visibility of project layers based on zoom and selection
     * - PMTiles: Show for efficient rendering of all projects
     * - Selected project: Show highlighted boundary when a specific project is loaded
     */
    function updateProjectLayerVisibility() {
        const zoom = map.getZoom();
        const hasSelectedProject = currentProject !== null;

        if (!showTmProjects.checked) {
            // All TM layers hidden
            return;
        }

        // At zoom 10+ with a selected project, hide PMTiles and show only the selected project boundary
        if (zoom >= 10 && hasSelectedProject) {
            map.setLayoutProperty('pmtiles-projects-fill', 'visibility', 'none');
            map.setLayoutProperty('pmtiles-projects-outline', 'visibility', 'none');
            map.setLayoutProperty('project-labels', 'visibility', 'none');
        } else {
            // Show PMTiles polygons and labels (labels have minzoom: 6)
            map.setLayoutProperty('pmtiles-projects-fill', 'visibility', 'visible');
            map.setLayoutProperty('pmtiles-projects-outline', 'visibility', 'visible');
            map.setLayoutProperty('project-labels', 'visibility', 'visible');
        }
    }

    /**
     * Handle map move - load imagery metadata and update URL
     */
    async function onMapMove() {
        updateZoomWarning();
        updateUrlHash();

        const zoom = map.getZoom();
        const minDisplay = CONFIG.map.minZoomForImageryDisplay;
        const minFetch = CONFIG.map.minZoomForImageryFetch;

        // Below ESRI display threshold: clear ESRI imagery
        if (zoom < minDisplay) {
            imageryLoading.classList.add('hidden');
            if (imageryFeatures.length > 0) {
                imageryFeatures = [];
                imageryCentroids = [];
                loadedImageryIds.clear();
                ImagerySource.clearCache();
                map.getSource('imagery-metadata').setData({
                    type: 'FeatureCollection',
                    features: []
                });
                map.getSource('imagery-centroids').setData({
                    type: 'FeatureCollection',
                    features: []
                });
                statsPanel.classList.add('hidden');
            }
        }

        const bounds = map.getBounds();
        const boundsArray = [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth()
        ];

        // ESRI imagery metadata (only when above display threshold)
        if (imagerySourceSelect.value === 'esri' && zoom >= minDisplay) {
            // Between display and fetch (z8-11): only display cached data, don't fetch
            if (zoom < minFetch) {
                imageryLoading.classList.add('hidden');
            } else {
                // At or above fetch threshold (z12+): fetch new imagery
                imageryLoading.classList.remove('hidden');

                try {
                    const data = await ImagerySource.fetchEsriMetadata(boundsArray, zoom);

                    if (data.error) {
                        console.warn('Error loading imagery metadata:', data.message);
                    } else if (data.features) {
                        // Add new features that we haven't loaded yet
                        const newFeatures = data.features.filter(f => {
                            const id = f.properties.OBJECTID;
                            if (loadedImageryIds.has(id)) return false;
                            loadedImageryIds.add(id);
                            return true;
                        });

                        if (newFeatures.length > 0) {
                            imageryFeatures = [...imageryFeatures, ...newFeatures];
                            map.getSource('imagery-metadata').setData({
                                type: 'FeatureCollection',
                                features: imageryFeatures
                            });

                            // Calculate centroids for new features (one label per tile)
                            const newCentroids = newFeatures
                                .map(f => {
                                    const centroid = getCentroidFromGeometry(f.geometry);
                                    if (!centroid) return null;
                                    return {
                                        type: 'Feature',
                                        geometry: {
                                            type: 'Point',
                                            coordinates: centroid
                                        },
                                        properties: { ...f.properties }
                                    };
                                })
                                .filter(f => f !== null);

                            imageryCentroids = [...imageryCentroids, ...newCentroids];
                            map.getSource('imagery-centroids').setData({
                                type: 'FeatureCollection',
                                features: imageryCentroids
                            });

                            updateStats();
                        }
                    }
                } finally {
                    imageryLoading.classList.add('hidden');
                }
            }
        }

        // OAM imagery
        if (oamEnabled) {
            updateOamDisplay(boundsArray, zoom);
        }
    }

    /**
     * Update zoom warning visibility
     * Three states: below display (<8), display-only (8-11), fetch enabled (12+)
     */
    function updateZoomWarning() {
        const zoom = map.getZoom();
        const source = imagerySourceSelect.value;
        let message = '';

        if (source === 'esri') {
            const minDisplay = CONFIG.map.minZoomForImageryDisplay;
            const minFetch = CONFIG.map.minZoomForImageryFetch;

            if (zoom >= minFetch) {
                // At fetch level - no warning needed
            } else if (zoom >= minDisplay && imageryFeatures.length > 0) {
                message = `Viewing cached ESRI data. Zoom to ${minFetch}+ to fetch new.`;
            } else {
                message = `Zoom to ${minFetch}+ to fetch ESRI metadata`;
            }
        } else if (source === 'oam') {
            const oamMinDisplay = CONFIG.oam.minZoomForDisplay;
            if (zoom < oamMinDisplay) {
                message = `Zoom to ${oamMinDisplay}+ to see OAM imagery`;
            }
        }

        if (message) {
            zoomWarning.classList.remove('hidden');
            zoomWarning.textContent = message;
        } else {
            zoomWarning.classList.add('hidden');
        }

        // Also update project layer visibility
        updateProjectLayerVisibility();
    }

    /**
     * Update imagery statistics panel
     * Shows stats for ESRI, OAM, or both depending on active layers
     */
    function updateStats() {
        const source = imagerySourceSelect.value;
        let html = '';

        if (source === 'esri' && imageryFeatures.length > 0) {
            const stats = ImagerySource.calculateStats(imageryFeatures);
            if (stats) {
                const avgClass = ImagerySource.getAgeClass(new Date(Date.now() - stats.avgAgeYears * 365.25 * 24 * 60 * 60 * 1000));
                html = `
                    <div class="stat-row">
                        <span class="stat-label">Tiles loaded</span>
                        <span class="stat-value">${stats.count}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Newest</span>
                        <span class="stat-value">${stats.newestFormatted}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Oldest</span>
                        <span class="stat-value">${stats.oldestFormatted}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Average age</span>
                        <span class="stat-value ${avgClass}">${stats.avgAgeFormatted}</span>
                    </div>
                `;
            }
        } else if (source === 'oam' && oamLoaded) {
            const bounds = map.getBounds();
            const boundsArray = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
            const visibleOam = OamSource.getFeaturesInBounds(boundsArray);

            if (visibleOam.length > 0) {
                const oamStats = OamSource.calculateStats(visibleOam);
                if (oamStats) {
                    const avgClass = ImagerySource.getAgeClass(new Date(Date.now() - oamStats.avgAgeYears * 365.25 * 24 * 60 * 60 * 1000));
                    html = `
                        <div class="stat-row">
                            <span class="stat-label">Images in view</span>
                            <span class="stat-value">${oamStats.count}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Newest</span>
                            <span class="stat-value">${oamStats.newestFormatted}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Oldest</span>
                            <span class="stat-value">${oamStats.oldestFormatted}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Average age</span>
                            <span class="stat-value ${avgClass}">${oamStats.avgAgeFormatted}</span>
                        </div>
                    `;
                }
            }
        }

        if (html) {
            statsContent.innerHTML = html;
            statsPanel.classList.remove('hidden');
        } else {
            statsPanel.classList.add('hidden');
        }
    }

    /**
     * Change basemap
     */
    function changeBasemap() {
        const basemapId = basemapSelect.value;
        const basemap = CONFIG.basemaps[basemapId];

        if (!basemap) return;

        map.getSource('basemap').tiles = basemap.tiles;
        map.style.sourceCaches['basemap'].clearTiles();
        map.style.sourceCaches['basemap'].update(map.transform);
        map.triggerRepaint();

        updateTmProjectColors();
    }

    /**
     * Update TM project layer colors based on basemap brightness
     * Light basemaps (OSM, ESRI Topo) → dark outlines/labels
     * Dark basemaps (ESRI Imagery, Carto Dark) → white outlines/labels
     */
    function updateTmProjectColors() {
        const basemapId = basemapSelect.value;
        const isDark = (basemapId === 'esri-imagery' || basemapId === 'carto-dark');

        const primary = isDark ? '#ffffff' : '#333333';
        const contrast = isDark ? '#333333' : '#ffffff';
        const haloColor = isDark ? '#000000' : '#ffffff';

        // PMTiles layers
        map.setPaintProperty('pmtiles-projects-fill', 'fill-color', primary);
        map.setPaintProperty('pmtiles-projects-outline', 'line-color', primary);

        // Project labels
        map.setPaintProperty('project-labels', 'text-color', primary);
        map.setPaintProperty('project-labels', 'text-halo-color', haloColor);

        // Selected TM project
        map.setPaintProperty('tm-project-fill', 'fill-color', primary);
        map.setPaintProperty('tm-project-outline', 'line-color', primary);
        map.setPaintProperty('tm-project-outline-dash', 'line-color', contrast);
    }

    /**
     * Change imagery metadata source (ESRI / OAM / None)
     * Mutually exclusive — disables one before enabling the other
     */
    async function changeImagerySource() {
        const source = imagerySourceSelect.value;

        // --- Disable ESRI layers ---
        if (source !== 'esri') {
            map.setLayoutProperty('imagery-fill', 'visibility', 'none');
            map.setLayoutProperty('imagery-outline', 'visibility', 'none');
            map.setLayoutProperty('imagery-labels', 'visibility', 'none');
        }

        // --- Disable OAM layers ---
        if (source !== 'oam') {
            oamEnabled = false;
            showOamLayers(false);
            OamSource.cleanup(map);
            oamInfoPanel.classList.add('hidden');
            map.getSource('oam-footprints').setData({ type: 'FeatureCollection', features: [] });
            map.getSource('oam-centroids').setData({ type: 'FeatureCollection', features: [] });
        }

        // --- Enable selected source ---
        if (source === 'esri') {
            map.setLayoutProperty('imagery-fill', 'visibility', 'visible');
            map.setLayoutProperty('imagery-outline', 'visibility', 'visible');
            map.setLayoutProperty('imagery-labels', 'visibility', 'visible');
        } else if (source === 'oam') {
            oamEnabled = true;

            // Lazy-load OAM data on first selection
            if (!oamLoaded) {
                oamLoading.classList.remove('hidden');
                try {
                    const result = await OamSource.loadAllImages();
                    oamFeatures = result.features;
                    oamCentroids = result.centroids;
                    oamLoaded = true;
                    console.log(`OAM loaded: ${oamFeatures.length} features`);
                } catch (e) {
                    console.error('Failed to load OAM data:', e);
                    oamLoading.classList.add('hidden');
                    imagerySourceSelect.value = 'none';
                    oamEnabled = false;
                    return;
                } finally {
                    oamLoading.classList.add('hidden');
                }
            }

            showOamLayers(true);

            // Update display for current viewport
            const bounds = map.getBounds();
            const boundsArray = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
            updateOamDisplay(boundsArray, map.getZoom());
        }

        updateZoomWarning();
        updateStats();
    }

    /**
     * Show/hide all OAM map layers
     */
    function showOamLayers(visible) {
        const v = visible ? 'visible' : 'none';
        map.setLayoutProperty('oam-footprints-fill', 'visibility', v);
        map.setLayoutProperty('oam-footprints-outline', 'visibility', v);
        map.setLayoutProperty('oam-selected-outline', 'visibility', v);
        map.setLayoutProperty('oam-labels', 'visibility', v);
    }

    /**
     * Update OAM display for current viewport
     * Filters all OAM features to viewport, updates sources, manages thumbnails/TMS
     */
    function updateOamDisplay(boundsArray, zoom) {
        const oamMinDisplay = CONFIG.oam.minZoomForDisplay;

        if (zoom < oamMinDisplay) {
            // Below OAM display threshold — hide all enriched layers
            map.setLayoutProperty('oam-footprints-fill', 'visibility', 'none');
            map.setLayoutProperty('oam-footprints-outline', 'visibility', 'none');
            map.setLayoutProperty('oam-selected-outline', 'visibility', 'none');
            map.setLayoutProperty('oam-labels', 'visibility', 'none');

            // Clear enriched data and thumbnails
            map.getSource('oam-footprints').setData({ type: 'FeatureCollection', features: [] });
            map.getSource('oam-centroids').setData({ type: 'FeatureCollection', features: [] });
            OamSource.clearAllThumbnails(map);
            return;
        }

        // At z8+: show enriched footprints
        map.setLayoutProperty('oam-footprints-fill', 'visibility', 'visible');
        map.setLayoutProperty('oam-footprints-outline', 'visibility', 'visible');
        map.setLayoutProperty('oam-selected-outline', 'visibility', 'visible');
        map.setLayoutProperty('oam-labels', 'visibility', 'visible');

        // Filter features to viewport
        const visibleFeatures = OamSource.getFeaturesInBounds(boundsArray);
        const visibleCentroids = OamSource.getCentroidsInBounds(boundsArray);

        // Update GeoJSON sources
        map.getSource('oam-footprints').setData({
            type: 'FeatureCollection',
            features: visibleFeatures
        });
        map.getSource('oam-centroids').setData({
            type: 'FeatureCollection',
            features: visibleCentroids
        });

        // Manage thumbnails
        if (zoom >= CONFIG.oam.minZoomForThumbnails) {
            OamSource.addThumbnailsForFeatures(map, visibleFeatures);
        } else {
            OamSource.clearAllThumbnails(map);
        }

        // Update stats with combined data if both layers are on
        updateStats();
    }

    /**
     * Handle click on OAM enriched footprint (z10+)
     */
    function onOamFootprintClick(e) {
        if (!e.features || e.features.length === 0) return;

        const mapFeature = e.features[0];
        const oamId = mapFeature.properties._oamId;

        // Find the full enriched feature from our data
        const feature = oamFeatures.find(f => f.properties._oamId === oamId);
        if (!feature) return;

        // Select and load TMS
        selectedOamFeature = feature;
        OamSource.selectFeature(map, feature);

        // Close TM info panel if open
        infoPanel.classList.add('hidden');

        // Show OAM info panel
        oamInfoTitle.textContent = 'OAM Image';
        oamInfoContent.innerHTML = formatOamInfo(feature);
        oamInfoPanel.classList.remove('hidden');
    }

    /**
     * Handle click on OAM PMTiles (low zoom overview)
     */
    function onOamPmtilesClick(e) {
        // At low zoom, zoom in to see details
        const zoom = map.getZoom();
        if (zoom < CONFIG.oam.minZoomForDisplay) {
            map.flyTo({
                center: e.lngLat,
                zoom: CONFIG.oam.minZoomForDisplay
            });
        }
    }

    /**
     * Format OAM feature info for the info panel
     */
    function formatOamInfo(feature) {
        const p = feature.properties;
        let html = '';

        // Thumbnail preview
        if (p.thumbnail) {
            html += `<img src="${p.thumbnail}" class="oam-thumbnail-preview" alt="OAM thumbnail" onerror="this.style.display='none'">`;
        }

        html += `
            <div class="info-row">
                <span class="info-label">Date</span>
                <span class="info-value">${p.formattedDate}</span>
            </div>
        `;

        if (p.provider) {
            html += `
                <div class="info-row">
                    <span class="info-label">Provider</span>
                    <span class="info-value">${p.provider}</span>
                </div>
            `;
        }

        if (p.platform) {
            html += `
                <div class="info-row">
                    <span class="info-label">Platform</span>
                    <span class="info-value">${p.platform}</span>
                </div>
            `;
        }

        if (p.sensor) {
            html += `
                <div class="info-row">
                    <span class="info-label">Sensor</span>
                    <span class="info-value">${p.sensor}</span>
                </div>
            `;
        }

        if (p.gsd) {
            html += `
                <div class="info-row">
                    <span class="info-label">GSD</span>
                    <span class="info-value">${Number(p.gsd).toFixed(2)} m</span>
                </div>
            `;
        }

        if (p.title) {
            html += `
                <div class="info-row">
                    <span class="info-label">Title</span>
                    <span class="info-value">${p.title}</span>
                </div>
            `;
        }

        if (p.pageUrl) {
            html += `<a href="${p.pageUrl}" target="_blank" class="btn-link">View on OpenAerialMap</a>`;
        }

        return html;
    }

    /**
     * Toggle TM project layer
     */
    function toggleTmLayer() {
        const visibility = showTmProjects.checked ? 'visible' : 'none';
        map.setLayoutProperty('tm-project-fill', 'visibility', visibility);
        map.setLayoutProperty('tm-project-outline', 'visibility', visibility);
        map.setLayoutProperty('tm-project-outline-dash', 'visibility', visibility);
        map.setLayoutProperty('pmtiles-projects-fill', 'visibility', visibility);
        map.setLayoutProperty('pmtiles-projects-outline', 'visibility', visibility);
        map.setLayoutProperty('project-labels', 'visibility', visibility);
    }

    /**
     * Handle click on imagery tile
     */
    function onImageryClick(e) {
        if (!e.features || e.features.length === 0) return;

        const feature = e.features[0];
        const props = feature.properties;

        const html = `
            <h4>Imagery Tile</h4>
            <div class="popup-row">
                <span class="popup-label">Date</span>
                <span class="popup-value">${props.formattedDate}</span>
            </div>
            <div class="popup-row">
                <span class="popup-label">Source</span>
                <span class="popup-value">${props.NICE_NAME || props.source || 'Unknown'}</span>
            </div>
            ${props.SRC_RES ? `
            <div class="popup-row">
                <span class="popup-label">Resolution</span>
                <span class="popup-value">${props.SRC_RES}m</span>
            </div>
            ` : ''}
            ${props.SRC_ACC ? `
            <div class="popup-row">
                <span class="popup-label">Accuracy</span>
                <span class="popup-value">${props.SRC_ACC}m</span>
            </div>
            ` : ''}
        `;

        new maplibregl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(html)
            .addTo(map);
    }

    /**
     * Handle click on TM project
     */
    function onTmProjectClick(e) {
        if (!currentProject) return;

        // Show info panel
        infoTitle.textContent = `TM Project #${currentProject.id}`;
        infoContent.innerHTML = TmApi.formatProjectInfo(currentProject);
        infoPanel.classList.remove('hidden');
    }

    // Initialize
    initMap();
})();
