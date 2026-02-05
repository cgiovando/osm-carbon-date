/**
 * HOT Tasking Manager API integration
 */

const TmApi = {
    /**
     * Fetch recent TM projects
     * @param {number} limit - Number of projects to fetch
     * @returns {Promise<Array>} List of recent projects
     */
    async fetchRecentProjects(limit = 20) {
        const apiUrl = `${CONFIG.tmApi.baseUrl}/projects/?orderBy=last_updated&orderByType=DESC&page=1&perPage=${limit}`;
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
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            return (data.results || []).map(p => ({
                projectId: p.projectId,
                name: p.name,
                status: p.status,
                percentMapped: p.percentMapped,
                percentValidated: p.percentValidated,
                aoiBBOX: p.aoiBBOX,
                lastUpdated: p.lastUpdated
            }));
        } catch (error) {
            console.error('Error fetching recent projects:', error);
            return [];
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
