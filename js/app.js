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
                glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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
            attributionControl: true,
            hash: false // We'll handle hash manually to include project
        });

        map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
        map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

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
        // Recent projects fill (subtle)
        map.addLayer({
            id: 'recent-projects-fill',
            type: 'fill',
            source: 'recent-projects',
            paint: {
                'fill-color': '#2563eb',
                'fill-opacity': 0.1
            }
        });

        // Recent projects outline
        map.addLayer({
            id: 'recent-projects-outline',
            type: 'line',
            source: 'recent-projects',
            paint: {
                'line-color': '#2563eb',
                'line-width': 1,
                'line-opacity': 0.5
            }
        });

        // Imagery metadata fill (color-coded by age)
        map.addLayer({
            id: 'imagery-fill',
            type: 'fill',
            source: 'imagery-metadata',
            paint: {
                'fill-color': ['get', 'ageColor'],
                'fill-opacity': 0.3
            }
        });

        // Imagery metadata outline
        map.addLayer({
            id: 'imagery-outline',
            type: 'line',
            source: 'imagery-metadata',
            paint: {
                'line-color': ['get', 'ageColor'],
                'line-width': 2
            }
        });

        // Imagery date labels
        map.addLayer({
            id: 'imagery-labels',
            type: 'symbol',
            source: 'imagery-metadata',
            layout: {
                'text-field': ['get', 'formattedDate'],
                'text-font': ['Open Sans Regular'],
                'text-size': 11,
                'text-anchor': 'center',
                'text-allow-overlap': false
            },
            paint: {
                'text-color': '#000',
                'text-halo-color': '#fff',
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
        map.on('click', 'recent-projects-fill', onRecentProjectClick);
        map.on('mouseenter', 'recent-projects-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'recent-projects-fill', () => {
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
        try {
            recentProjects = await TmApi.fetchRecentProjects(20);
            renderRecentProjectsList();
            renderRecentProjectsOnMap();
        } catch (error) {
            console.error('Error loading recent projects:', error);
        }
    }

    /**
     * Render recent projects list in sidebar
     */
    function renderRecentProjectsList() {
        if (!recentProjectsList) return;

        recentProjectsList.innerHTML = recentProjects.map(project => `
            <div class="recent-project-item" data-project-id="${project.projectId}">
                <div class="project-id">#${project.projectId}</div>
                <div class="project-name">${project.name || 'Untitled'}</div>
                <div class="project-status status-${(project.status || '').toLowerCase()}">${project.status}</div>
            </div>
        `).join('');

        // Add click handlers
        recentProjectsList.querySelectorAll('.recent-project-item').forEach(item => {
            item.addEventListener('click', () => {
                const projectId = item.dataset.projectId;
                tmProjectInput.value = projectId;
                loadTmProject();
            });
        });
    }

    /**
     * Render recent projects on map
     */
    function renderRecentProjectsOnMap() {
        const features = recentProjects
            .filter(p => p.aoiBBOX)
            .map(project => {
                // aoiBBOX is [minX, minY, maxX, maxY]
                const bbox = project.aoiBBOX;
                return {
                    type: 'Feature',
                    properties: {
                        projectId: project.projectId,
                        name: project.name,
                        status: project.status
                    },
                    geometry: {
                        type: 'Polygon',
                        coordinates: [[
                            [bbox[0], bbox[1]],
                            [bbox[2], bbox[1]],
                            [bbox[2], bbox[3]],
                            [bbox[0], bbox[3]],
                            [bbox[0], bbox[1]]
                        ]]
                    }
                };
            });

        map.getSource('recent-projects').setData({
            type: 'FeatureCollection',
            features: features
        });
    }

    /**
     * Handle click on recent project on map
     */
    function onRecentProjectClick(e) {
        if (!e.features || e.features.length === 0) return;

        const props = e.features[0].properties;
        tmProjectInput.value = props.projectId;
        loadTmProject();
    }

    /**
     * Load a TM project
     */
    async function loadTmProject() {
        const projectId = parseInt(tmProjectInput.value);
        if (!projectId || isNaN(projectId)) {
            alert('Please enter a valid TM project ID');
            return;
        }

        loadProjectBtn.disabled = true;
        loadProjectBtn.innerHTML = '<span class="loading"></span>';

        try {
            currentProject = await TmApi.fetchProject(projectId);

            // Update map source
            const geojson = TmApi.projectToGeoJSON(currentProject);
            map.getSource('tm-project').setData({
                type: 'FeatureCollection',
                features: [geojson]
            });

            // Fly to project bounds
            const bounds = TmApi.getProjectBounds(currentProject);
            if (bounds) {
                map.fitBounds(bounds, { padding: 50 });
            }

            // Show info panel
            infoTitle.textContent = `TM Project #${currentProject.id}`;
            infoContent.innerHTML = TmApi.formatProjectInfo(currentProject);
            infoPanel.classList.remove('hidden');

            // Update URL
            const url = new URL(window.location);
            url.searchParams.set('project', projectId);
            window.history.replaceState({}, '', url);

        } catch (error) {
            alert(error.message);
        } finally {
            loadProjectBtn.disabled = false;
            loadProjectBtn.textContent = 'Load';
        }
    }

    /**
     * Handle map move - load imagery metadata and update URL
     */
    async function onMapMove() {
        updateZoomWarning();
        updateUrlHash();

        const zoom = map.getZoom();
        if (zoom < CONFIG.map.minZoomForImagery) {
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
        }
    }

    /**
     * Update zoom warning visibility
     */
    function updateZoomWarning() {
        const zoom = map.getZoom();
        if (zoom >= CONFIG.map.minZoomForImagery) {
            zoomWarning.classList.add('hidden');
        } else {
            zoomWarning.classList.remove('hidden');
            zoomWarning.textContent = `Zoom in to level ${CONFIG.map.minZoomForImagery}+ to load imagery metadata (current: ${Math.floor(zoom)})`;
        }
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
        map.setLayoutProperty('recent-projects-fill', 'visibility', visibility);
        map.setLayoutProperty('recent-projects-outline', 'visibility', visibility);
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
