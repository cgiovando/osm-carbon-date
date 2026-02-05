/**
 * HOT Tasking Manager API integration
 */

const TmApi = {
    // Simple in-memory cache for project data
    _cache: new Map(),
    _cacheTimeout: 5 * 60 * 1000, // 5 minutes

    /**
     * Get cached data or null if expired/missing
     */
    _getCache(key) {
        const cached = this._cache.get(key);
        if (cached && Date.now() - cached.timestamp < this._cacheTimeout) {
            console.log('Cache hit:', key);
            return cached.data;
        }
        return null;
    },

    /**
     * Set cache data
     */
    _setCache(key, data) {
        this._cache.set(key, { data, timestamp: Date.now() });
    },
    /**
     * Fetch recent TM projects
     * @param {number} limit - Number of projects to fetch
     * @returns {Promise<Object>} Object with results array and mapResults GeoJSON
     */
    async fetchRecentProjects(limit = 20) {
        const cacheKey = `projects-${limit}`;
        const cached = this._getCache(cacheKey);
        if (cached) return cached;

        console.log(`Fetching recent TM projects (target: ${limit})...`);

        // TM API has a max of ~14 results per page, so we need to fetch multiple pages
        const perPage = 14; // API's actual limit
        const pagesToFetch = Math.ceil(limit / perPage);

        let allProjects = [];
        let allMapFeatures = [];

        for (let page = 1; page <= pagesToFetch && allProjects.length < limit; page++) {
            const apiPath = `/projects/?orderBy=last_updated&orderByType=DESC&page=${page}&perPage=${perPage}`;
            const apiUrl = `${CONFIG.tmApi.baseUrl}${apiPath}`;

            // Build list of fetch options: worker proxy first, then CORS proxies
            const fetchOptions = [];

            if (CONFIG.tmApi.workerProxy) {
                fetchOptions.push({
                    url: `${CONFIG.tmApi.workerProxy}/api/v2${apiPath}`,
                    name: 'worker proxy',
                    timeout: 8000
                });
            }

            for (const proxy of CONFIG.tmApi.corsProxies) {
                fetchOptions.push({
                    url: `${proxy}${encodeURIComponent(apiUrl)}`,
                    name: proxy.substring(0, 25),
                    timeout: 12000
                });
            }

            let response;
            let lastError;

            for (const opt of fetchOptions) {
                if (page === 1) console.log('Trying:', opt.name);

                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), opt.timeout);

                    response = await fetch(opt.url, {
                        method: 'GET',
                        headers: { 'Accept': 'application/json' },
                        signal: controller.signal
                    });
                    clearTimeout(timeout);

                    if (response.ok) {
                        if (page === 1) console.log('Success via:', opt.name);
                        break;
                    }
                    lastError = new Error(`Returned ${response.status}`);
                } catch (err) {
                    if (page === 1) console.warn('Failed:', opt.name, err.message);
                    lastError = err;
                    response = null;
                }
            }

            if (!response || !response.ok) {
                if (page === 1) {
                    console.error('All fetch methods failed');
                    throw lastError || new Error('Failed to fetch projects');
                }
                break; // Stop pagination if later pages fail
            }

            try {
                const data = await response.json();

                // Add projects from this page
                const pageProjects = (data.results || []).map(p => ({
                    projectId: p.projectId,
                    name: p.name,
                    status: p.status,
                    percentMapped: p.percentMapped,
                    percentValidated: p.percentValidated,
                    lastUpdated: p.lastUpdated,
                    priority: p.priority
                }));

                allProjects = allProjects.concat(pageProjects);

                // Get map features for this page's projects
                const pageProjectIds = new Set(pageProjects.map(p => p.projectId));
                const pageMapResults = data.mapResults || { type: 'FeatureCollection', features: [] };
                const pageFeatures = (pageMapResults.features || []).filter(f =>
                    pageProjectIds.has(f.properties?.projectId)
                );
                allMapFeatures = allMapFeatures.concat(pageFeatures);

                console.log(`Page ${page}: ${pageProjects.length} projects (total: ${allProjects.length})`);

                // Check if there are more pages
                if (!data.pagination?.hasNext) break;

            } catch (parseError) {
                console.error('Error parsing TM API response:', parseError);
                break;
            }
        }

        // Trim to exact limit
        const projects = allProjects.slice(0, limit);
        const projectIds = new Set(projects.map(p => p.projectId));
        const mapResults = {
            type: 'FeatureCollection',
            features: allMapFeatures.filter(f => projectIds.has(f.properties?.projectId))
        };

        console.log(`Final: ${projects.length} projects, ${mapResults.features.length} map features`);

        const result = { projects, mapResults };
        this._setCache(cacheKey, result);
        return result;
    },

    /**
     * Fetch a TM project by ID
     * @param {number} projectId
     * @returns {Promise<Object>} Project data with geometry
     */
    async fetchProject(projectId) {
        const cacheKey = `project-${projectId}`;
        const cached = this._getCache(cacheKey);
        if (cached) return cached;

        const apiPath = `/projects/${projectId}/`;
        const apiUrl = `${CONFIG.tmApi.baseUrl}${apiPath}`;

        // Build fetch options: worker proxy first, then CORS proxies
        const fetchOptions = [];

        if (CONFIG.tmApi.workerProxy) {
            fetchOptions.push({
                url: `${CONFIG.tmApi.workerProxy}/api/v2${apiPath}`,
                name: 'worker proxy',
                timeout: 6000
            });
        }

        for (const proxy of CONFIG.tmApi.corsProxies) {
            fetchOptions.push({
                url: `${proxy}${encodeURIComponent(apiUrl)}`,
                name: proxy.substring(0, 25),
                timeout: 10000
            });
        }

        let lastError;

        for (const opt of fetchOptions) {
            console.log('Fetching project via:', opt.name);

            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), opt.timeout);

                const response = await fetch(opt.url, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    signal: controller.signal
                });
                clearTimeout(timeout);

                if (response.ok) {
                    const data = await response.json();
                    const result = this.processProject(data);
                    this._setCache(cacheKey, result);
                    return result;
                }

                if (response.status === 404) {
                    throw new Error(`Project #${projectId} not found`);
                }
                lastError = new Error(`API error: ${response.status}`);
            } catch (error) {
                if (error.message.includes('not found')) throw error;
                console.warn('Failed:', opt.name, error.message);
                lastError = error;
            }
        }

        console.error('All fetch methods failed for project:', projectId);
        throw lastError || new Error('Failed to fetch project');
    },

    /**
     * Process project data into a standardized format
     */
    processProject(data) {
        // Total tasks is the number of features in the tasks GeoJSON
        const totalTasks = data.tasks?.features?.length || 0;

        return {
            id: data.projectId,
            name: data.projectInfo?.name || `Project #${data.projectId}`,
            description: data.projectInfo?.shortDescription || '',
            status: data.status,
            priority: data.projectPriority,
            percentMapped: data.percentMapped,
            percentValidated: data.percentValidated,
            totalTasks: totalTasks,
            created: data.created,
            lastUpdated: data.lastUpdated,
            author: data.author,
            organisation: data.organisationName,
            geometry: data.areaOfInterest,
            centroid: data.aoiCentroid,
            url: `${CONFIG.tmApi.projectUrl}/${data.projectId}`
        };
    },

    /**
     * Convert project geometry to GeoJSON Feature
     */
    projectToGeoJSON(project) {
        return {
            type: 'Feature',
            properties: {
                id: project.id,
                name: project.name,
                status: project.status,
                percentMapped: project.percentMapped,
                percentValidated: project.percentValidated,
                url: project.url
            },
            geometry: project.geometry
        };
    },

    /**
     * Get the bounds of a project geometry
     * @returns {Array} [west, south, east, north]
     */
    getProjectBounds(project) {
        if (!project.geometry) return null;

        let minLon = Infinity, minLat = Infinity;
        let maxLon = -Infinity, maxLat = -Infinity;

        const processCoords = (coords) => {
            if (typeof coords[0] === 'number') {
                // It's a coordinate pair [lon, lat]
                minLon = Math.min(minLon, coords[0]);
                maxLon = Math.max(maxLon, coords[0]);
                minLat = Math.min(minLat, coords[1]);
                maxLat = Math.max(maxLat, coords[1]);
            } else {
                // It's an array of coordinates
                coords.forEach(processCoords);
            }
        };

        processCoords(project.geometry.coordinates);

        return [minLon, minLat, maxLon, maxLat];
    },

    /**
     * Format project info for display
     */
    formatProjectInfo(project) {
        const statusColors = {
            'DRAFT': '#9ca3af',
            'PUBLISHED': '#22c55e',
            'ARCHIVED': '#6b7280'
        };

        return `
            <div class="info-row">
                <span class="info-label">Name</span>
                <span class="info-value">${project.name}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Status</span>
                <span class="info-value" style="color: ${statusColors[project.status] || '#333'}">${project.status}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Mapped</span>
                <span class="info-value">${project.percentMapped}%</span>
            </div>
            <div class="info-row">
                <span class="info-label">Validated</span>
                <span class="info-value">${project.percentValidated}%</span>
            </div>
            <div class="info-row">
                <span class="info-label">Total Tasks</span>
                <span class="info-value">${project.totalTasks}</span>
            </div>
            ${project.organisation ? `
            <div class="info-row">
                <span class="info-label">Organisation</span>
                <span class="info-value">${project.organisation}</span>
            </div>
            ` : ''}
            <a href="${project.url}" target="_blank" class="btn-link">Open in Tasking Manager</a>
        `;
    }
};
