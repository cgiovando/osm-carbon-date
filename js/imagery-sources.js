/**
 * Imagery metadata sources for osm-carbon-date
 */

const ImagerySource = {
    /**
     * Parse ESRI date format (YYYYMMDD as number) to Date object
     */
    parseEsriDate(dateNum) {
        if (!dateNum || dateNum === 'Null' || dateNum === 'null') return null;
        const dateStr = dateNum.toString();
        if (dateStr.length !== 8) return null;

        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6)) - 1; // 0-indexed
        const day = parseInt(dateStr.substring(6, 8));

        return new Date(year, month, day);
    },

    /**
     * Format date for display
     */
    formatDate(date) {
        if (!date) return 'Unknown';
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    },

    /**
     * Calculate age in years from a date
     */
    getAgeInYears(date) {
        if (!date) return null;
        const now = new Date();
        const diffMs = now - date;
        return diffMs / (1000 * 60 * 60 * 24 * 365.25);
    },

    /**
     * Get color based on imagery age
     */
    getAgeColor(date) {
        const age = this.getAgeInYears(date);
        if (age === null) return CONFIG.ageColors.unknown;

        if (age < CONFIG.ageThresholds.fresh) return CONFIG.ageColors.fresh;
        if (age < CONFIG.ageThresholds.medium) return CONFIG.ageColors.medium;
        if (age < CONFIG.ageThresholds.old) return CONFIG.ageColors.old;
        return CONFIG.ageColors.veryOld;
    },

    /**
     * Get age category class name
     */
    getAgeClass(date) {
        const age = this.getAgeInYears(date);
        if (age === null) return '';

        if (age < CONFIG.ageThresholds.fresh) return 'fresh';
        if (age < CONFIG.ageThresholds.medium) return 'medium';
        if (age < CONFIG.ageThresholds.old) return 'old';
        return 'very-old';
    },

    /**
     * Fetch ESRI imagery metadata using the identify endpoint
     * Uses multiple sample points to get coverage across the viewport
     * @param {Array} bounds - [west, south, east, north] in EPSG:4326
     * @param {number} zoom - current zoom level
     * @returns {Promise<Object>} GeoJSON FeatureCollection with date info
     */
    async fetchEsriMetadata(bounds, zoom) {
        const [west, south, east, north] = bounds;

        // Create a grid of sample points across the viewport
        // More points at higher zoom, fewer at lower zoom
        const gridSize = zoom >= 14 ? 3 : 2;
        const points = [];

        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const lon = west + (east - west) * (i + 0.5) / gridSize;
                const lat = south + (north - south) * (j + 0.5) / gridSize;
                points.push([lon, lat]);
            }
        }

        // Fetch metadata for each sample point in parallel
        const allFeatures = [];
        const seenIds = new Set();

        try {
            const results = await Promise.all(
                points.map(([lon, lat]) => this.fetchIdentifyPoint(lon, lat, bounds))
            );

            // Combine results, deduplicating by OBJECTID
            for (const result of results) {
                if (result.features) {
                    for (const feature of result.features) {
                        const id = feature.properties.OBJECTID;
                        if (!seenIds.has(id)) {
                            seenIds.add(id);
                            allFeatures.push(feature);
                        }
                    }
                }
            }

            return {
                type: 'FeatureCollection',
                features: allFeatures
            };
        } catch (error) {
            console.error('Error fetching ESRI metadata:', error);
            return { error: 'fetch', message: error.message };
        }
    },

    /**
     * Fetch identify results for a single point
     */
    async fetchIdentifyPoint(lon, lat, bounds) {
        const [west, south, east, north] = bounds;

        const params = new URLSearchParams({
            f: 'json',
            geometryType: 'esriGeometryPoint',
            geometry: `${lon},${lat}`,
            sr: '4326',
            mapExtent: `${west},${south},${east},${north}`,
            imageDisplay: '512,512,96',
            tolerance: '10',
            layers: 'visible:0',
            returnGeometry: 'true'
        });

        const url = `${CONFIG.esri.identifyUrl}?${params}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            // Convert results to GeoJSON features
            const features = (data.results || [])
                .filter(r => r.geometry && r.geometry.rings)
                .map(r => {
                    const srcDate = r.attributes?.SRC_DATE;
                    const parsedDate = this.parseEsriDate(srcDate);

                    return {
                        type: 'Feature',
                        properties: {
                            OBJECTID: r.attributes?.OBJECTID,
                            SRC_DATE: srcDate,
                            SRC_RES: r.attributes?.SRC_RES,
                            SRC_ACC: r.attributes?.SRC_ACC,
                            NICE_NAME: r.attributes?.NICE_NAME,
                            NICE_DESC: r.attributes?.NICE_DESC,
                            layerName: r.layerName,
                            parsedDate: parsedDate,
                            formattedDate: this.formatDate(parsedDate),
                            ageYears: this.getAgeInYears(parsedDate),
                            ageColor: this.getAgeColor(parsedDate),
                            ageClass: this.getAgeClass(parsedDate),
                            source: 'ESRI World Imagery'
                        },
                        geometry: {
                            type: 'Polygon',
                            coordinates: r.geometry.rings
                        }
                    };
                });

            return { features };
        } catch (error) {
            console.error('Error fetching identify point:', error);
            return { features: [] };
        }
    },

    /**
     * Calculate statistics for a set of imagery features
     */
    calculateStats(features) {
        if (!features || features.length === 0) {
            return null;
        }

        const dates = features
            .map(f => f.properties.parsedDate)
            .filter(d => d !== null)
            .sort((a, b) => a - b);

        if (dates.length === 0) {
            return null;
        }

        const ages = dates.map(d => this.getAgeInYears(d));
        const avgAge = ages.reduce((a, b) => a + b, 0) / ages.length;

        return {
            count: features.length,
            oldest: dates[0],
            newest: dates[dates.length - 1],
            oldestFormatted: this.formatDate(dates[0]),
            newestFormatted: this.formatDate(dates[dates.length - 1]),
            avgAgeYears: avgAge,
            avgAgeFormatted: avgAge < 1
                ? `${Math.round(avgAge * 12)} months`
                : `${avgAge.toFixed(1)} years`
        };
    }
};
