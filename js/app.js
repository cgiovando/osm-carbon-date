/**
 * Main application for osm-carbon-date
 */

(function() {
    // State
    let map;
    let currentProject = null;
    let loadedImageryIds = new Set();
    let imageryFeatures = [];
    let recentProjects = [];
    let recentProjectsGeoJSON = null;

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

        map.addSource('tm-project', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        map.addSource('recent-projects', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    /**
     * Add map layers
     */
    function addMapLayers() {
        // Recent projects as circles (centroids) - HOT red
        map.addLayer({
            id: 'recent-projects-circles',
            type: 'circle',
            source: 'recent-projects',
            paint: {
                'circle-radius': 8,
                'circle-color': '#d73f3f',
                'circle-opacity': 0.9,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            }
        });

        // Recent projects labels - HOT red
        map.addLayer({
            id: 'recent-projects-labels',
            type: 'symbol',
            source: 'recent-projects',
            layout: {
                'text-field': ['concat', '#', ['get', 'projectId']],
                'text-font': ['Open Sans Bold'],
                'text-size': 12,
                'text-offset': [0, 1.8],
                'text-anchor': 'top'
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

        // Imagery date labels (age-based colors with dark outline)
        map.addLayer({
            id: 'imagery-labels',
            type: 'symbol',
            source: 'imagery-metadata',
            layout: {
                'text-field': ['get', 'formattedDate'],
                'text-font': ['Open Sans Bold'],
                'text-size': 13,
                'text-anchor': 'center',
                'text-allow-overlap': true
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

        // Click on recent projects
        map.on('click', 'recent-projects-circles', onRecentProjectClick);
        map.on('mouseenter', 'recent-projects-circles', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'recent-projects-circles', () => {
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
     * Load recent TM projects
     */
    async function loadRecentProjects() {
        console.log('Loading recent TM projects...');
        try {
            const limit = CONFIG.map.recentProjectsLimit || 100;
            const data = await TmApi.fetchRecentProjects(limit);
            console.log('Received data:', data);
            recentProjects = data.projects || [];
            recentProjectsGeoJSON = data.mapResults || { type: 'FeatureCollection', features: [] };
            console.log('Projects:', recentProjects.length, 'Map features:', recentProjectsGeoJSON.features?.length);
            renderRecentProjectsList();
            renderRecentProjectsOnMap();
        } catch (error) {
            console.error('Error loading recent projects:', error);
            recentProjectsList.innerHTML = '<div class="loading-text">Error loading projects</div>';
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

                // Find the centroid from mapResults and fly there immediately
                let didFly = false;
                if (recentProjectsGeoJSON && recentProjectsGeoJSON.features) {
                    const feature = recentProjectsGeoJSON.features.find(
                        f => f.properties.projectId === projectId
                    );
                    if (feature && feature.geometry && feature.geometry.coordinates) {
                        map.flyTo({
                            center: feature.geometry.coordinates,
                            zoom: 13,
                            duration: 1000
                        });
                        didFly = true;
                    }
                }

                // Then load the full project details (skip fitBounds if we already flew)
                tmProjectInput.value = projectId;
                loadTmProject({ skipFitBounds: didFly });
            });
        });
    }

    /**
     * Render recent projects on map using centroid points from mapResults
     */
    function renderRecentProjectsOnMap() {
        console.log('renderRecentProjectsOnMap called');
        console.log('recentProjectsGeoJSON:', recentProjectsGeoJSON);

        if (!recentProjectsGeoJSON || !recentProjectsGeoJSON.features || recentProjectsGeoJSON.features.length === 0) {
            console.log('No recent projects GeoJSON to render');
            return;
        }

        // The mapResults contains Point features with projectId in properties
        // Enhance them with project names from the results array
        const projectMap = new Map(recentProjects.map(p => [p.projectId, p]));

        const features = recentProjectsGeoJSON.features.map(f => {
            const project = projectMap.get(f.properties.projectId);
            return {
                ...f,
                properties: {
                    ...f.properties,
                    name: project?.name || `Project #${f.properties.projectId}`,
                    status: project?.status || 'Unknown'
                }
            };
        });

        console.log('Setting map source with features:', features.length);
        console.log('First feature:', features[0]);

        map.getSource('recent-projects').setData({
            type: 'FeatureCollection',
            features: features
        });

        console.log(`Rendered ${features.length} recent project markers on map`);
    }

    /**
     * Handle click on recent project on map
     */
    function onRecentProjectClick(e) {
        if (!e.features || e.features.length === 0) return;

        const feature = e.features[0];
        const props = feature.properties;

        // Immediately fly to the clicked point
        if (feature.geometry && feature.geometry.coordinates) {
            map.flyTo({
                center: feature.geometry.coordinates,
                zoom: 13,
                duration: 1000
            });
        }

        // Then load the full project details (skip fitBounds since we already flew)
        tmProjectInput.value = props.projectId;
        loadTmProject({ skipFitBounds: true });
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
     * Update visibility of project circles vs project boundary based on zoom
     */
    function updateProjectLayerVisibility() {
        const zoom = map.getZoom();
        const hasSelectedProject = currentProject !== null;

        // At zoom 10+, hide circles and show project boundary if a project is selected
        if (zoom >= 10 && hasSelectedProject) {
            map.setLayoutProperty('recent-projects-circles', 'visibility', 'none');
            map.setLayoutProperty('recent-projects-labels', 'visibility', 'none');
        } else if (showTmProjects.checked) {
            map.setLayoutProperty('recent-projects-circles', 'visibility', 'visible');
            map.setLayoutProperty('recent-projects-labels', 'visibility', 'visible');
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
                loadedImageryIds.clear();
                ImagerySource.clearCache();
                map.getSource('imagery-metadata').setData({
                    type: 'FeatureCollection',
                    features: []
                });
                statsPanel.classList.add('hidden');
            }
            return;
        }

        // Between display and fetch threshold: keep existing imagery, don't fetch
        if (zoom < minFetch) {
            imageryLoading.classList.add('hidden');
            // Keep existing imagery visible, just don't fetch new data
            return;
        }

        // At or above fetch threshold: fetch new imagery
        const bounds = map.getBounds();
        const boundsArray = [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth()
        ];

        const imagerySource = imagerySourceSelect.value;

        if (imagerySource === 'esri') {
            // Show loading indicator
            imageryLoading.classList.remove('hidden');

            try {
                const data = await ImagerySource.fetchEsriMetadata(boundsArray, zoom);

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
     */
    function updateZoomWarning() {
        const zoom = map.getZoom();
        const minDisplay = CONFIG.map.minZoomForImageryDisplay;
        const minFetch = CONFIG.map.minZoomForImageryFetch;

        if (zoom >= minFetch) {
            // At fetch level - no warning needed
            zoomWarning.classList.add('hidden');
        } else if (zoom >= minDisplay) {
            // Between display and fetch - show "zoom to load more"
            zoomWarning.classList.remove('hidden');
            if (imageryFeatures.length > 0) {
                zoomWarning.textContent = `Zoom to ${minFetch}+ to load more imagery metadata (current: ${Math.floor(zoom)})`;
            } else {
                zoomWarning.textContent = `Zoom to ${minFetch}+ to load imagery metadata (current: ${Math.floor(zoom)})`;
            }
        } else {
            // Below display level
            zoomWarning.classList.remove('hidden');
            zoomWarning.textContent = `Zoom to ${minDisplay}+ to view imagery metadata (current: ${Math.floor(zoom)})`;
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
        map.setLayoutProperty('recent-projects-circles', 'visibility', visibility);
        map.setLayoutProperty('recent-projects-labels', 'visibility', visibility);
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
