/**
 * Imagery metadata sources for osm-carbon-date
 * Based on https://github.com/martinedoesgis/esri-imagery-date-finder
 */

const ImagerySource = {
    // Cache of loaded imagery IDs to avoid duplicates
    loadedIds: new Set(),

    /**
     * Parse ESRI date format (YYYYMMDD as number) to Date object
     */
    parseEsriDate(dateNum) {
        if (!dateNum || dateNum === 'Null' || dateNum === 'null') return null;
        const dateStr = dateNum.toString();
        if (dateStr.length !== 8) return null;

        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6)) - 1;
        const day = parseInt(dateStr.substring(6, 8));

        return new Date(year, month, day);
    },

    /**
     * Format date as YYYY-MM-DD for display (like reference app)
     */
    formatDate(date) {
        if (!date) return 'Unknown';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
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
     * Convert lat/lon to Web Mercator (EPSG:3857/102100)
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
     * Clear the loaded IDs cache (call when zooming out)
     */
    clearCache() {
        this.loadedIds.clear();
    },

    /**
     * Fetch ESRI imagery metadata using the query endpoint
     * Following the approach from esri-imagery-date-finder
     * @param {Array} bounds - [west, south, east, north] in EPSG:4326
     * @param {number} zoom - current zoom level
     * @returns {Promise<Object>} GeoJSON FeatureCollection with date info
     */
    async fetchEsriMetadata(bounds, zoom) {
        // Convert bounds to Web Mercator
        const [minX, minY] = this.toWebMercator(bounds[0], bounds[1]);
        const [maxX, maxY] = this.toWebMercator(bounds[2], bounds[3]);

        // Build geometry JSON like the reference app
        const geometry = {
            xmin: minX,
            ymin: minY,
            xmax: maxX,
            ymax: maxY,
            spatialReference: { wkid: 102100 }
        };

        try {
            // Step 1: Get count first to check if we have too many features
            const countUrl = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/0/query?` +
                `f=json&returnCountOnly=true&` +
                `geometry=${encodeURIComponent(JSON.stringify(geometry))}&` +
                `geometryType=esriGeometryEnvelope&` +
                `spatialRel=esriSpatialRelIntersects&` +
                `inSR=102100`;

            const countResponse = await fetch(countUrl);
            if (!countResponse.ok) {
                console.warn('Count query failed:', countResponse.status);
                // Try identify as fallback
                return this.fetchEsriMetadataViaIdentify(bounds, zoom);
            }

            const countData = await countResponse.json();
            console.log('Feature count:', countData.count);

            if (countData.count > 100) {
                return {
                    type: 'FeatureCollection',
                    features: [],
                    warning: `Too many features (${countData.count}). Zoom in more.`
                };
            }

            // Step 2: Get object IDs
            const idsUrl = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/0/query?` +
                `f=json&returnIdsOnly=true&` +
                `geometry=${encodeURIComponent(JSON.stringify(geometry))}&` +
                `geometryType=esriGeometryEnvelope&` +
                `spatialRel=esriSpatialRelIntersects&` +
                `inSR=102100`;

            const idsResponse = await fetch(idsUrl);
            if (!idsResponse.ok) {
                return this.fetchEsriMetadataViaIdentify(bounds, zoom);
            }

            const idsData = await idsResponse.json();
            const objectIds = idsData.objectIds || [];
            console.log('Object IDs:', objectIds.length);

            // Filter out already loaded IDs
            const newIds = objectIds.filter(id => !this.loadedIds.has(id));
            if (newIds.length === 0) {
                return { type: 'FeatureCollection', features: [] };
            }

            // Step 3: Fetch features with geometry
            const features = [];
            for (const objectId of newIds) {
                try {
                    const feature = await this.fetchSingleFeature(objectId);
                    if (feature) {
                        this.loadedIds.add(objectId);
                        features.push(feature);
                    }
                } catch (e) {
                    console.warn('Error fetching feature', objectId, e);
                }
            }

            return {
                type: 'FeatureCollection',
                features: features
            };
        } catch (error) {
            console.error('Error fetching ESRI metadata:', error);
            // Fallback to identify endpoint
            return this.fetchEsriMetadataViaIdentify(bounds, zoom);
        }
    },

    /**
     * Fetch a single feature by object ID
     */
    async fetchSingleFeature(objectId) {
        const url = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/0/query?` +
            `f=json&objectIds=${objectId}&` +
            `outFields=OBJECTID,SRC_DATE,SRC_RES,SRC_ACC,NICE_NAME,NICE_DESC&` +
            `returnGeometry=true&outSR=4326`;

        const response = await fetch(url);
        if (!response.ok) return null;

        const data = await response.json();
        if (!data.features || data.features.length === 0) return null;

        const f = data.features[0];
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

        if (!geometry) return null;

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
    },

    /**
     * Fallback: Fetch metadata via identify endpoint with multi-point sampling
     */
    async fetchEsriMetadataViaIdentify(bounds, zoom) {
        const [west, south, east, north] = bounds;

        // Create a grid of sample points
        const gridSize = zoom >= 14 ? 3 : 2;
        const points = [];

        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const lon = west + (east - west) * (i + 0.5) / gridSize;
                const lat = south + (north - south) * (j + 0.5) / gridSize;
                points.push([lon, lat]);
            }
        }

        const allFeatures = [];
        const seenIds = new Set();

        try {
            const results = await Promise.all(
                points.map(([lon, lat]) => this.fetchIdentifyPoint(lon, lat, bounds))
            );

            for (const result of results) {
                if (result.features) {
                    for (const feature of result.features) {
                        const id = feature.properties.OBJECTID;
                        if (!seenIds.has(id) && !this.loadedIds.has(id)) {
                            seenIds.add(id);
                            this.loadedIds.add(id);
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
            console.error('Error fetching via identify:', error);
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

        const url = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/identify?${params}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            const features = (data.results || [])
                .filter(r => r.geometry && r.geometry.rings)
                .map(r => {
                    // Identify endpoint uses different field names than query endpoint
                    const srcDate = r.attributes?.['DATE (YYYYMMDD)'] || r.attributes?.SRC_DATE;
                    const parsedDate = this.parseEsriDate(srcDate);

                    return {
                        type: 'Feature',
                        properties: {
                            OBJECTID: r.attributes?.OBJECTID,
                            SRC_DATE: srcDate,
                            SRC_RES: r.attributes?.['RESOLUTION (M)'] || r.attributes?.SRC_RES,
                            SRC_ACC: r.attributes?.['ACCURACY (M)'] || r.attributes?.SRC_ACC,
                            NICE_NAME: r.attributes?.DESCRIPTION || r.attributes?.NICE_NAME,
                            NICE_DESC: r.attributes?.SOURCE_INFO || r.attributes?.NICE_DESC,
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
