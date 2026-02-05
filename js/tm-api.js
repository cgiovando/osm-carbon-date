/**
 * HOT Tasking Manager API integration
 */

const TmApi = {
    /**
     * Fetch recent TM projects
     * @param {number} limit - Number of projects to fetch
     * @returns {Promise<Object>} Object with results array and mapResults GeoJSON
     */
    async fetchRecentProjects(limit = 20) {
        const apiUrl = `${CONFIG.tmApi.baseUrl}/projects/?orderBy=last_updated&orderByType=DESC&page=1&perPage=${limit}`;

        console.log('Fetching recent TM projects...');

        // Try direct fetch first (TM API might support CORS now)
        let response;
        let usedProxy = false;

        // Use CORS proxy (allorigins) since TM API doesn't have CORS headers
        const proxyUrl = `${CONFIG.tmApi.corsProxy}${encodeURIComponent(apiUrl)}`;
        console.log('Fetching via proxy:', proxyUrl.substring(0, 80) + '...');

        try {
            response = await fetch(proxyUrl, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            console.log('Proxy response status:', response.status);

            if (!response.ok) {
                throw new Error(`Proxy returned ${response.status}`);
            }
        } catch (err) {
            console.error('Fetch failed:', err.message);
            throw err;
        }

        try {
            const data = await response.json();
            console.log('TM API response keys:', Object.keys(data));

            // results is the project list for sidebar
            const projects = (data.results || []).map(p => ({
                projectId: p.projectId,
                name: p.name,
                status: p.status,
                percentMapped: p.percentMapped,
                percentValidated: p.percentValidated,
                lastUpdated: p.lastUpdated,
                priority: p.priority
            }));

            // mapResults is a GeoJSON FeatureCollection with ALL project centroids
            // Filter to only include the projects from our results
            const projectIds = new Set(projects.map(p => p.projectId));
            const allMapResults = data.mapResults || { type: 'FeatureCollection', features: [] };
            const mapResults = {
                type: 'FeatureCollection',
                features: (allMapResults.features || []).filter(f =>
                    projectIds.has(f.properties?.projectId)
                )
            };

            console.log(`Found ${projects.length} projects, ${mapResults.features?.length || 0} map features (filtered from ${allMapResults.features?.length || 0})`);

            return { projects, mapResults };
        } catch (parseError) {
            console.error('Error parsing TM API response:', parseError);
            return { projects: [], mapResults: { type: 'FeatureCollection', features: [] } };
        }
    },

    /**
     * Fetch a TM project by ID
     * @param {number} projectId
     * @returns {Promise<Object>} Project data with geometry
     */
    async fetchProject(projectId) {
        // Use CORS proxy since TM API doesn't have CORS headers
        const apiUrl = `${CONFIG.tmApi.baseUrl}/projects/${projectId}/`;
        const url = CONFIG.tmApi.corsProxy
            ? `${CONFIG.tmApi.corsProxy}${encodeURIComponent(apiUrl)}`
            : apiUrl;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(`Project #${projectId} not found`);
                }
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            return this.processProject(data);
        } catch (error) {
            console.error('Error fetching TM project:', error);
            throw error;
        }
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
