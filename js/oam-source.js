/**
 * OpenAerialMap (OAM) data source for osm-carbon-date
 * Loads imagery footprints from a static S3 mirror of the OAM catalog
 */

const OamSource = {
    // All enriched features (loaded once)
    _allFeatures: [],
    // All centroid points for labels
    _allCentroids: [],
    // Whether data has been loaded
    _loaded: false,
    // Currently active thumbnail image source IDs
    _activeThumbnails: new Set(),
    // Currently active TMS source IDs
    _activeTms: new Set(),
    // Currently selected feature ID
    _selectedFeatureId: null,

    /**
     * Parse OAM ISO 8601 date string (e.g. "2023-05-15T00:00:00.000Z")
     * @param {string} isoString - ISO date from acquisition_start/end
     * @returns {Date|null}
     */
    parseOamDate(isoString) {
        if (!isoString) return null;
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return null;
        return d;
    },

    /**
     * Load all OAM images from S3 GeoJSON
     * Enriches each feature with age color, formatted date, bbox
     * @returns {Promise<{features: Array, centroids: Array}>}
     */
    async loadAllImages() {
        if (this._loaded) {
            return { features: this._allFeatures, centroids: this._allCentroids };
        }

        const url = `${CONFIG.oam.s3Base}/all_images.geojson`;
        console.log('Loading OAM images from', url);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load OAM data: HTTP ${response.status}`);
        }

        const geojson = await response.json();
        const rawFeatures = geojson.features || [];
        console.log(`Loaded ${rawFeatures.length} raw OAM features`);

        this._allFeatures = [];
        this._allCentroids = [];

        const maxArea = CONFIG.oam.maxImageAreaDeg2 || 1.0;
        let filtered = 0;

        for (const f of rawFeatures) {
            const props = f.properties || {};

            // Filter out abnormally large images (mosaics, Sentinel/Landsat composites)
            const bbox = this._getBbox(f.geometry);
            if (bbox) {
                const area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
                if (area > maxArea) {
                    filtered++;
                    continue;
                }
            }

            // Parse acquisition date
            const acqDate = this.parseOamDate(props.acquisition_start);
            const ageColor = ImagerySource.getAgeColor(acqDate);
            const ageClass = ImagerySource.getAgeClass(acqDate);
            const formattedDate = ImagerySource.formatDate(acqDate);

            // Force HTTPS on all URLs
            const uuid = props.uuid || props._id || '';
            const thumbnail = this._httpsify(props.thumbnail || props.properties?.thumbnail || '');
            const tms = this._httpsify(props.tms || '');
            const pageUrl = props.pageUrl || (uuid ? `https://map.openaerialmap.org/#/${uuid}` : '');

            const enriched = {
                type: 'Feature',
                geometry: f.geometry,
                properties: {
                    ...props,
                    _oamId: uuid || `oam-${this._allFeatures.length}`,
                    parsedDate: acqDate,
                    formattedDate: formattedDate,
                    ageColor: ageColor,
                    ageClass: ageClass,
                    ageYears: ImagerySource.getAgeInYears(acqDate),
                    thumbnail: thumbnail,
                    tms: tms,
                    pageUrl: pageUrl,
                    bbox: bbox,
                    source: 'OpenAerialMap'
                }
            };

            this._allFeatures.push(enriched);

            // Create centroid point for labels
            if (bbox) {
                const cx = (bbox[0] + bbox[2]) / 2;
                const cy = (bbox[1] + bbox[3]) / 2;
                this._allCentroids.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [cx, cy] },
                    properties: {
                        _oamId: enriched.properties._oamId,
                        formattedDate: formattedDate,
                        ageColor: ageColor
                    }
                });
            }
        }

        this._loaded = true;
        console.log(`Enriched ${this._allFeatures.length} OAM features, ${this._allCentroids.length} centroids (filtered ${filtered} oversized)`);
        return { features: this._allFeatures, centroids: this._allCentroids };
    },

    /**
     * Get features within a bounding box
     * @param {Array} bounds - [west, south, east, north]
     * @returns {Array} Filtered features
     */
    getFeaturesInBounds(bounds) {
        const [west, south, east, north] = bounds;
        return this._allFeatures.filter(f => {
            const bbox = f.properties.bbox;
            if (!bbox) return false;
            // Simple bbox intersection test
            return bbox[0] < east && bbox[2] > west && bbox[1] < north && bbox[3] > south;
        });
    },

    /**
     * Get centroids within a bounding box
     * @param {Array} bounds - [west, south, east, north]
     * @returns {Array} Filtered centroids
     */
    getCentroidsInBounds(bounds) {
        const [west, south, east, north] = bounds;
        return this._allCentroids.filter(f => {
            const [cx, cy] = f.geometry.coordinates;
            return cx >= west && cx <= east && cy >= south && cy <= north;
        });
    },

    /**
     * Add thumbnail image overlays for visible features
     * @param {maplibregl.Map} map
     * @param {Array} features - Features to show thumbnails for
     */
    addThumbnailsForFeatures(map, features) {
        const maxThumbnails = CONFIG.oam.maxThumbnails || 50;

        // Sort by area (larger first) and limit
        const sorted = features
            .filter(f => f.properties.thumbnail && f.properties.bbox)
            .sort((a, b) => {
                const areaA = this._bboxArea(a.properties.bbox);
                const areaB = this._bboxArea(b.properties.bbox);
                return areaB - areaA;
            })
            .slice(0, maxThumbnails);

        const newIds = new Set(sorted.map(f => `oam-thumb-${f.properties._oamId}`));

        // Remove thumbnails no longer in view
        for (const sourceId of this._activeThumbnails) {
            if (!newIds.has(sourceId)) {
                this._removeThumbnail(map, sourceId);
            }
        }

        // Add new thumbnails
        for (const f of sorted) {
            const sourceId = `oam-thumb-${f.properties._oamId}`;
            if (this._activeThumbnails.has(sourceId)) continue;
            this._addThumbnail(map, sourceId, f);
        }
    },

    /**
     * Add a single thumbnail overlay
     */
    _addThumbnail(map, sourceId, feature) {
        const bbox = feature.properties.bbox;
        if (!bbox) return;

        const layerId = sourceId + '-layer';

        try {
            // Coordinates: [[topLeft], [topRight], [bottomRight], [bottomLeft]]
            const coordinates = [
                [bbox[0], bbox[3]], // top-left
                [bbox[2], bbox[3]], // top-right
                [bbox[2], bbox[1]], // bottom-right
                [bbox[0], bbox[1]]  // bottom-left
            ];

            map.addSource(sourceId, {
                type: 'image',
                url: feature.properties.thumbnail,
                coordinates: coordinates
            });

            // Insert below oam-footprints-fill so footprint outlines show on top
            map.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                paint: { 'raster-opacity': 0.85 }
            }, 'oam-footprints-fill');

            this._activeThumbnails.add(sourceId);
        } catch (e) {
            // Silently fail - thumbnail may be unavailable
            console.debug('Failed to add thumbnail:', sourceId, e.message);
        }
    },

    /**
     * Remove a single thumbnail overlay
     */
    _removeThumbnail(map, sourceId) {
        const layerId = sourceId + '-layer';
        try {
            if (map.getLayer(layerId)) map.removeLayer(layerId);
            if (map.getSource(sourceId)) map.removeSource(sourceId);
        } catch (e) {
            // Ignore
        }
        this._activeThumbnails.delete(sourceId);
    },

    /**
     * Remove all thumbnails
     */
    clearAllThumbnails(map) {
        for (const sourceId of this._activeThumbnails) {
            this._removeThumbnail(map, sourceId);
        }
        this._activeThumbnails.clear();
    },

    /**
     * Load TMS raster for a single feature
     * @param {maplibregl.Map} map
     * @param {Object} feature
     * @returns {string|null} Source ID if loaded
     */
    loadTmsForFeature(map, feature) {
        const tmsUrl = feature.properties.tms;
        if (!tmsUrl) return null;

        const sourceId = `oam-tms-${feature.properties._oamId}`;
        if (this._activeTms.has(sourceId)) return sourceId;

        const layerId = sourceId + '-layer';

        try {
            map.addSource(sourceId, {
                type: 'raster',
                tiles: [tmsUrl],
                tileSize: 256,
                bounds: feature.properties.bbox
            });

            // Insert below oam-footprints-fill
            map.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                paint: { 'raster-opacity': 1.0 }
            }, 'oam-footprints-fill');

            this._activeTms.add(sourceId);
            return sourceId;
        } catch (e) {
            console.debug('Failed to load TMS:', sourceId, e.message);
            return null;
        }
    },

    /**
     * Clear TMS for a specific feature
     */
    clearTmsForFeature(map, featureId) {
        const sourceId = `oam-tms-${featureId}`;
        const layerId = sourceId + '-layer';
        try {
            if (map.getLayer(layerId)) map.removeLayer(layerId);
            if (map.getSource(sourceId)) map.removeSource(sourceId);
        } catch (e) {
            // Ignore
        }
        this._activeTms.delete(sourceId);
    },

    /**
     * Load TMS for visible features at high zoom (auto-load)
     */
    loadTmsForVisibleFeatures(map, features) {
        const maxTms = CONFIG.oam.maxAutoTms || 10;

        // Sort by area (smaller first for high zoom) and limit
        const sorted = features
            .filter(f => f.properties.tms)
            .sort((a, b) => this._bboxArea(a.properties.bbox) - this._bboxArea(b.properties.bbox))
            .slice(0, maxTms);

        for (const f of sorted) {
            this.loadTmsForFeature(map, f);
        }
    },

    /**
     * Clear all TMS sources
     */
    clearAllTms(map) {
        for (const sourceId of this._activeTms) {
            const layerId = sourceId + '-layer';
            try {
                if (map.getLayer(layerId)) map.removeLayer(layerId);
                if (map.getSource(sourceId)) map.removeSource(sourceId);
            } catch (e) {
                // Ignore
            }
        }
        this._activeTms.clear();
    },

    /**
     * Clear TMS for selected feature specifically
     */
    clearSelectedTms(map) {
        if (this._selectedFeatureId) {
            this.clearTmsForFeature(map, this._selectedFeatureId);
        }
    },

    /**
     * Select a feature (highlight + load TMS)
     * @param {maplibregl.Map} map
     * @param {Object} feature
     */
    selectFeature(map, feature) {
        this.deselectFeature(map);

        const oamId = feature.properties._oamId;
        this._selectedFeatureId = oamId;

        // Update selected outline filter
        if (map.getLayer('oam-selected-outline')) {
            map.setFilter('oam-selected-outline', ['==', ['get', '_oamId'], oamId]);
        }
    },

    /**
     * Deselect current feature
     */
    deselectFeature(map) {
        if (this._selectedFeatureId) {
            if (map.getLayer('oam-selected-outline')) {
                map.setFilter('oam-selected-outline', ['==', ['get', '_oamId'], '']);
            }

            this._selectedFeatureId = null;
        }
    },

    /**
     * Calculate statistics for OAM features (same interface as ESRI)
     */
    calculateStats(features) {
        if (!features || features.length === 0) return null;

        const dates = features
            .map(f => f.properties.parsedDate)
            .filter(d => d !== null)
            .sort((a, b) => a - b);

        if (dates.length === 0) return null;

        const ages = dates.map(d => ImagerySource.getAgeInYears(d));
        const avgAge = ages.reduce((a, b) => a + b, 0) / ages.length;

        return {
            count: features.length,
            oldest: dates[0],
            newest: dates[dates.length - 1],
            oldestFormatted: ImagerySource.formatDate(dates[0]),
            newestFormatted: ImagerySource.formatDate(dates[dates.length - 1]),
            avgAgeYears: avgAge,
            avgAgeFormatted: avgAge < 1
                ? `${Math.round(avgAge * 12)} months`
                : `${avgAge.toFixed(1)} years`
        };
    },

    /**
     * Clean up everything (called when toggling OAM off)
     */
    cleanup(map) {
        this.clearAllThumbnails(map);
        this.clearAllTms(map);
        this.deselectFeature(map);
    },

    // ---- Internal helpers ----

    /**
     * Calculate bounding box from a GeoJSON geometry
     * @returns {Array|null} [west, south, east, north]
     */
    _getBbox(geometry) {
        if (!geometry || !geometry.coordinates) return null;

        let minLon = Infinity, minLat = Infinity;
        let maxLon = -Infinity, maxLat = -Infinity;

        const process = (coords) => {
            if (typeof coords[0] === 'number') {
                minLon = Math.min(minLon, coords[0]);
                maxLon = Math.max(maxLon, coords[0]);
                minLat = Math.min(minLat, coords[1]);
                maxLat = Math.max(maxLat, coords[1]);
            } else {
                coords.forEach(process);
            }
        };

        process(geometry.coordinates);

        if (!isFinite(minLon)) return null;
        return [minLon, minLat, maxLon, maxLat];
    },

    /**
     * Calculate approximate area of a bbox (for sorting)
     */
    _bboxArea(bbox) {
        if (!bbox) return 0;
        return (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
    },

    /**
     * Convert http:// URLs to https://
     */
    _httpsify(url) {
        if (!url) return '';
        return url.replace(/^http:\/\//i, 'https://');
    }
};
