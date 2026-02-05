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
     * This works without CORS issues unlike the query endpoint
     * @param {Array} bounds - [west, south, east, north] in EPSG:4326
     * @param {number} zoom - current zoom level
     * @returns {Promise<Object>} GeoJSON FeatureCollection with date info
     */
    async fetchEsriMetadata(bounds, zoom) {
        // Convert to Web Mercator (EPSG:3857) for ESRI API
        const toWebMercator = (lon, lat) => {
            const x = lon * 20037508.34 / 180;
            let y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
            y = y * 20037508.34 / 180;
            return [x, y];
        };

        const [minX, minY] = toWebMercator(bounds[0], bounds[1]);
        const [maxX, maxY] = toWebMercator(bounds[2], bounds[3]);

        // Calculate center point for identify
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        // Build identify request - this endpoint works without CORS issues
        const params = new URLSearchParams({
            f: 'json',
            geometryType: 'esriGeometryPoint',
            geometry: JSON.stringify({
                x: centerX,
                y: centerY,
                spatialReference: { wkid: 102100 }
            }),
            mapExtent: `${minX},${minY},${maxX},${maxY}`,
            imageDisplay: '256,256,96',
            tolerance: 0,
            layers: 'visible:0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18',
            returnGeometry: 'true'
        });

        const url = `${CONFIG.esri.identifyUrl}?${params}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            // Process results - filter to get the most relevant layer based on zoom
            // Layer 0 is the main imagery metadata layer
            const features = [];
            const seenIds = new Set();

            for (const result of (data.results || [])) {
                // Skip if no geometry or already seen this object
                if (!result.geometry || seenIds.has(result.attributes?.OBJECTID)) continue;
                seenIds.add(result.attributes?.OBJECTID);

                // Get the date from SRC_DATE or DATE field
                const srcDate = result.attributes?.SRC_DATE ||
                               result.attributes?.['DATE (YYYYMMDD)'] ||
                               result.attributes?.DATE;

                const parsedDate = this.parseEsriDate(srcDate);

                // Convert ESRI geometry to GeoJSON
                let geometry = null;
                if (result.geometry.rings) {
                    geometry = {
                        type: 'Polygon',
                        coordinates: result.geometry.rings
                    };
                }

                if (geometry) {
                    features.push({
                        type: 'Feature',
                        properties: {
                            OBJECTID: result.attributes?.OBJECTID,
                            SRC_DATE: srcDate,
                            SRC_RES: result.attributes?.SRC_RES || result.attributes?.['RESOLUTION (M)'],
                            SRC_ACC: result.attributes?.SRC_ACC || result.attributes?.['ACCURACY (M)'],
                            NICE_NAME: result.attributes?.NICE_NAME || result.attributes?.SOURCE_INFO,
                            NICE_DESC: result.attributes?.NICE_DESC || result.attributes?.SOURCE,
                            layerName: result.layerName,
                            parsedDate: parsedDate,
                            formattedDate: this.formatDate(parsedDate),
                            ageYears: this.getAgeInYears(parsedDate),
                            ageColor: this.getAgeColor(parsedDate),
                            ageClass: this.getAgeClass(parsedDate),
                            source: 'ESRI World Imagery'
                        },
                        geometry: geometry
                    });
                }
            }

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
