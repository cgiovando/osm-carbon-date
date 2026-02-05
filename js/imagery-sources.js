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
     * Convert lat/lon to Web Mercator (EPSG:3857)
     */
    toWebMercator(lon, lat) {
        const x = lon * 20037508.34 / 180;
        let y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
        y = y * 20037508.34 / 180;
        return [x, y];
    },

    /**
     * Convert Web Mercator to lat/lon
     */
    fromWebMercator(x, y) {
        const lon = x * 180 / 20037508.34;
        const lat = (Math.atan(Math.exp(y * Math.PI / 20037508.34)) * 360 / Math.PI) - 90;
        return [lon, lat];
    },

    /**
     * Fetch ESRI imagery metadata using the query endpoint
     * Uses CORS proxy since query endpoint doesn't have CORS headers
     * @param {Array} bounds - [west, south, east, north] in EPSG:4326
     * @param {number} zoom - current zoom level
     * @returns {Promise<Object>} GeoJSON FeatureCollection with date info
     */
    async fetchEsriMetadata(bounds, zoom) {
        // Convert to Web Mercator (EPSG:3857) for ESRI API
        const [minX, minY] = this.toWebMercator(bounds[0], bounds[1]);
        const [maxX, maxY] = this.toWebMercator(bounds[2], bounds[3]);

        // Build query - first get count to avoid loading too many features
        const baseParams = {
            f: 'json',
            geometryType: 'esriGeometryEnvelope',
            geometry: JSON.stringify({
                xmin: minX, ymin: minY, xmax: maxX, ymax: maxY,
                spatialReference: { wkid: 102100 }
            }),
            spatialRel: 'esriSpatialRelIntersects',
            inSR: 102100,
            outSR: 4326 // Return geometry in lat/lon for MapLibre
        };

        try {
            // First, get count to ensure we don't overload
            const countParams = new URLSearchParams({
                ...baseParams,
                returnCountOnly: 'true'
            });

            const countUrl = `${CONFIG.esri.corsProxy}${encodeURIComponent(CONFIG.esri.queryUrl + '?' + countParams)}`;
            const countResponse = await fetch(countUrl);
            const countData = await countResponse.json();

            if (countData.count > 200) {
                console.log(`Too many features (${countData.count}), zoom in more`);
                return {
                    type: 'FeatureCollection',
                    features: [],
                    warning: `Too many imagery tiles (${countData.count}). Zoom in for details.`
                };
            }

            // Get all features with geometry
            const queryParams = new URLSearchParams({
                ...baseParams,
                outFields: 'OBJECTID,SRC_DATE,SRC_RES,SRC_ACC,NICE_NAME,NICE_DESC',
                returnGeometry: 'true'
            });

            const queryUrl = `${CONFIG.esri.corsProxy}${encodeURIComponent(CONFIG.esri.queryUrl + '?' + queryParams)}`;
            const response = await fetch(queryUrl);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message || 'ESRI API error');
            }

            // Convert ESRI features to GeoJSON
            const features = (data.features || []).map(f => {
                const srcDate = f.attributes?.SRC_DATE;
                const parsedDate = this.parseEsriDate(srcDate);

                // Convert ESRI geometry to GeoJSON
                let geometry = null;
                if (f.geometry?.rings) {
                    geometry = {
                        type: 'Polygon',
                        coordinates: f.geometry.rings
                    };
                }

                return {
                    type: 'Feature',
                    properties: {
                        OBJECTID: f.attributes?.OBJECTID,
                        SRC_DATE: srcDate,
                        SRC_RES: f.attributes?.SRC_RES,
                        SRC_ACC: f.attributes?.SRC_ACC,
                        NICE_NAME: f.attributes?.NICE_NAME,
                        NICE_DESC: f.attributes?.NICE_DESC,
                        parsedDate: parsedDate,
                        formattedDate: this.formatDate(parsedDate),
                        ageYears: this.getAgeInYears(parsedDate),
                        ageColor: this.getAgeColor(parsedDate),
                        ageClass: this.getAgeClass(parsedDate),
                        source: 'ESRI World Imagery'
                    },
                    geometry: geometry
                };
            }).filter(f => f.geometry !== null);

            return {
                type: 'FeatureCollection',
                features: features
            };
        } catch (error) {
            console.error('Error fetching ESRI metadata:', error);
            return { error: 'fetch', message: error.message };
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
