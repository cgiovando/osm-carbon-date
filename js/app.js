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

    // DOM elements
    const tmProjectInput = document.getElementById('tm-project-input');
    const loadProjectBtn = document.getElementById('load-project-btn');
    const basemapSelect = document.getElementById('basemap-select');
    const imagerySourceSelect = document.getElementById('imagery-source-select');
    const showImageryMeta = document.getElementById('show-imagery-meta');
    const showTmProjects = document.getElementById('show-tm-projects');
    const zoomWarning = document.getElementById('zoom-warning');
    const infoPanel = document.getElementById('info-panel');
    const infoTitle = document.getElementById('info-title');
    const infoContent = document.getElementById('info-content');
    const closeInfoBtn = document.getElementById('close-info');
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
                'fill-color': '#d73f3f',
                'fill-opacity': 0.15
            }
        });

        // Outline layer for project boundaries
        map.addLayer({
            id: 'pmtiles-projects-outline',
            type: 'line',
            source: 'tm-projects-pmtiles',
            'source-layer': 'projects',
            paint: {
                'line-color': '#d73f3f',
                'line-width': 1.5,
                'line-opacity': 0.8
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
                'text-color': '#d73f3f',
                'text-halo-color': '#ffffff',
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
                'fill-color': '#d73f3f',
                'fill-opacity': 0.15
            }
        });

        // TM project outline
        map.addLayer({
            id: 'tm-project-outline',
            type: 'line',
            source: 'tm-project',
            paint: {
                'line-color': '#d73f3f',
                'line-width': 3
            }
        });

        // TM project outline dashed (for visibility on any background)
        map.addLayer({
            id: 'tm-project-outline-dash',
            type: 'line',
            source: 'tm-project',
            paint: {
                'line-color': '#ffffff',
                'line-width': 3,
                'line-dasharray': [2, 2]
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

        // Layer toggles
        showImageryMeta.addEventListener('change', toggleImageryLayer);
        showTmProjects.addEventListener('change', toggleTmLayer);

        // Close info panel
        closeInfoBtn.addEventListener('click', () => {
            infoPanel.classList.add('hidden');
        });

        // Click on imagery for popup
        map.on('click', 'imagery-fill', onImageryClick);
        map.on('mouseenter', 'imagery-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'imagery-fill', () => {
            map.getCanvas().style.cursor = '';
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

        // Below display threshold: clear imagery
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
            return;
        }

        const bounds = map.getBounds();
        const boundsArray = [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth()
        ];

        const imagerySource = imagerySourceSelect.value;

        if (imagerySource === 'esri') {
            // Between display and fetch (z10-11): only display cached data, don't fetch
            // This avoids overwhelming ESRI with hundreds of requests at low zoom
            if (zoom < minFetch) {
                imageryLoading.classList.add('hidden');
                return;
            }

            // Show loading indicator
            imageryLoading.classList.remove('hidden');

            try {
                let data;

                // At or above fetch threshold (z12+): fetch new imagery
                data = await ImagerySource.fetchEsriMetadata(boundsArray, zoom);

                if (data.error) {
                    console.warn('Error loading imagery metadata:', data.message);
                    return;
                }

                if (data.features) {
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
                // Hide loading indicator
                imageryLoading.classList.add('hidden');
            }
        }
    }

    /**
     * Update zoom warning visibility
     * Three states: below display (<8), display-only (8-11), fetch enabled (12+)
     */
    function updateZoomWarning() {
        const zoom = map.getZoom();
        const minDisplay = CONFIG.map.minZoomForImageryDisplay;
        const minFetch = CONFIG.map.minZoomForImageryFetch;

        if (zoom >= minFetch) {
            // At fetch level (12+) - can load new imagery, no warning needed
            zoomWarning.classList.add('hidden');
        } else if (zoom >= minDisplay) {
            // Between display and fetch (8-11) - show cached data only
            zoomWarning.classList.remove('hidden');
            if (imageryFeatures.length > 0) {
                zoomWarning.textContent = `Viewing cached imagery. Zoom to ${minFetch}+ to fetch new metadata.`;
            } else {
                zoomWarning.textContent = `Zoom to ${minFetch}+ to fetch imagery metadata`;
            }
        } else {
            // Below display level (<8) - imagery hidden
            zoomWarning.classList.remove('hidden');
            zoomWarning.textContent = `Zoom to ${minFetch}+ to fetch imagery metadata`;
        }

        // Also update project layer visibility
        updateProjectLayerVisibility();
    }

    /**
     * Update imagery statistics panel
     */
    function updateStats() {
        if (imageryFeatures.length === 0) {
            statsPanel.classList.add('hidden');
            return;
        }

        const stats = ImagerySource.calculateStats(imageryFeatures);
        if (!stats) {
            statsPanel.classList.add('hidden');
            return;
        }

        const avgClass = ImagerySource.getAgeClass(new Date(Date.now() - stats.avgAgeYears * 365.25 * 24 * 60 * 60 * 1000));

        statsContent.innerHTML = `
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

        statsPanel.classList.remove('hidden');
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
    }

    /**
     * Toggle imagery metadata layer
     */
    function toggleImageryLayer() {
        const visibility = showImageryMeta.checked ? 'visible' : 'none';
        map.setLayoutProperty('imagery-fill', 'visibility', visibility);
        map.setLayoutProperty('imagery-outline', 'visibility', visibility);
        map.setLayoutProperty('imagery-labels', 'visibility', visibility);
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
