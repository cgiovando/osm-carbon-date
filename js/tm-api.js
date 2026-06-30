/**
 * HOT Tasking Manager API integration via insta-tm
 * https://github.com/cgiovando/insta-tm
 */

const TmApi = {
    // Simple in-memory cache for project data
    _cache: new Map(),
    _cacheTimeout: 5 * 60 * 1000, // 5 minutes
    _summaryPromise: null, // in-flight projects_summary.json request (concurrent-call dedup)

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
     * Fetch the lightweight projects summary from insta-tm.
     * This is a ~5MB file (vs the ~570MB all_projects.geojson) containing one
     * lean record per project: id, name, status, centroid, created, etc.
     * Cached and reused for both the sidebar list and the label/point centroids.
     * @returns {Promise<Array>} Array of summary project records
     */
    async fetchProjectsSummary() {
        const cacheKey = 'summary';
        const cached = this._getCache(cacheKey);
        if (cached) return cached;

        // Dedupe concurrent callers (sidebar + centroids both load at startup):
        // reuse the in-flight request instead of firing a second fetch.
        if (this._summaryPromise) return this._summaryPromise;

        console.log('Fetching projects summary from insta-tm...');

        const url = `${CONFIG.tmApi.s3Base}/projects_summary.json`;

        this._summaryPromise = (async () => {
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' }
                });

                if (!response.ok) {
                    throw new Error(`Failed to fetch projects summary: ${response.status}`);
                }

                const json = await response.json();
                const items = json.projects || [];
                console.log(`Loaded ${items.length} projects from summary`);
                this._setCache(cacheKey, items);
                return items;
            } catch (error) {
                console.error('Failed to fetch projects summary from insta-tm:', error);
                throw error;
            } finally {
                // Clear the in-flight handle; further reads come from the TTL cache.
                this._summaryPromise = null;
            }
        })();

        return this._summaryPromise;
    },

    /**
     * Fetch recent TM projects for the sidebar list.
     * Uses the lightweight summary (see fetchProjectsSummary).
     * @param {number} limit - Number of projects to fetch
     * @returns {Promise<Object>} Object with projects array
     */
    async fetchRecentProjects(limit = 100) {
        const items = await this.fetchProjectsSummary();

        // Sort by lastUpdated (most recently active first) so "recent" means
        // recently worked on, not recently created.
        const projects = items
            .filter(p => p.lastUpdated)
            .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
            .slice(0, limit)
            .map(p => ({
                projectId: p.id,
                name: p.name,
                status: p.status,
                percentMapped: p.pctMapped,
                percentValidated: p.pctValidated,
                lastUpdated: p.lastUpdated
            }));

        return { projects };
    },

    /**
     * Fetch a TM project by ID from insta-tm
     * @param {number} projectId
     * @returns {Promise<Object>} Project data with geometry
     */
    async fetchProject(projectId) {
        const cacheKey = `project-${projectId}`;
        const cached = this._getCache(cacheKey);
        if (cached) return cached;

        console.log(`Fetching project #${projectId} from insta-tm...`);

        const url = `${CONFIG.tmApi.s3Base}/api/v2/projects/${projectId}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) {
                if (response.status === 404 || response.status === 403) {
                    throw new Error(`Project #${projectId} not found`);
                }
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            const result = this.processProject(data);
            this._setCache(cacheKey, result);
            return result;

        } catch (error) {
            console.error(`Failed to fetch project #${projectId}:`, error);
            throw error;
        }
    },

    /**
     * Process project data into a standardized format
     */
    processProject(data) {
        // Prefer pre-computed totalTasks (lean format), fall back to counting task features
        const totalTasks = data.totalTasks ?? data.tasks?.features?.length ?? 0;

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
