/**
 * Session Cache - In-memory ephemeral storage
 * Destroyed on page refresh/navigation/tab close
 * Used for LLM-generated values that haven't been saved
 */

class SessionCache {
    constructor() {
        this.cache = new Map();
        this.metadata = new Map();
        this.setupCleanup();
    }

    /**
     * Set up automatic cleanup on page unload
     */
    setupCleanup() {
        // Clear cache when page unloads
        window.addEventListener('beforeunload', () => {
            this.clear();
        });

        // Clear on visibility change (tab switch can indicate leaving)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // Optionally clear on tab hide - uncomment if needed
                // this.clear();
            }
        });
    }

    /**
     * Store a field value in cache
     * @param {string} fieldId - Unique field identifier
     * @param {Object} data - Field data to cache
     * @param {string} data.value - The field value
     * @param {number} data.confidence - Confidence score 0-1
     * @param {string} data.source - Source type (deterministic, llm, user)
     * @param {string} [data.reason] - Reasoning for the match
     * @param {string} [data.profilePath] - Path in profile this maps to
     */
    set(fieldId, data) {
        if (!fieldId) return;

        const cacheEntry = {
            value: data.value || '',
            confidence: data.confidence || 0,
            source: data.source || FIELD_SOURCE.DETERMINISTIC,
            reason: data.reason || '',
            profilePath: data.profilePath || null,
            editable: true,
            timestamp: Date.now()
        };

        this.cache.set(fieldId, cacheEntry);

        // Store metadata separately for quick lookups
        this.metadata.set(fieldId, {
            source: cacheEntry.source,
            confidence: cacheEntry.confidence,
            saved: false
        });

        console.log(`[SessionCache] Cached field: ${fieldId}`, cacheEntry);
    }

    /**
     * Get cached field data
     * @param {string} fieldId - Field identifier
     * @returns {Object|null} Cached data or null
     */
    get(fieldId) {
        return this.cache.get(fieldId) || null;
    }

    /**
     * Check if field is in cache
     * @param {string} fieldId - Field identifier
     * @returns {boolean} True if cached
     */
    has(fieldId) {
        return this.cache.has(fieldId);
    }

    /**
     * Get just the value for a field
     * @param {string} fieldId - Field identifier
     * @returns {string} Cached value or empty string
     */
    getValue(fieldId) {
        const entry = this.cache.get(fieldId);
        return entry ? entry.value : '';
    }

    /**
     * Update the value for a cached field
     * @param {string} fieldId - Field identifier
     * @param {string} newValue - New value
     * @param {string} [source] - New source (defaults to 'user')
     */
    updateValue(fieldId, newValue, source = FIELD_SOURCE.USER) {
        let entry = this.cache.get(fieldId);

        if (!entry) {
            // Create a new entry if it doesn't exist
            this.set(fieldId, {
                value: newValue,
                source: source,
                confidence: source === FIELD_SOURCE.USER ? 1.0 : 0.5
            });
            return;
        }

        entry.value = newValue;
        entry.source = source;
        entry.confidence = source === FIELD_SOURCE.USER ? 1.0 : entry.confidence;
        entry.timestamp = Date.now();

        // Update metadata
        const meta = this.metadata.get(fieldId);
        if (meta) {
            meta.source = source;
            meta.confidence = entry.confidence;
        }
    }

    /**
     * Mark a field as saved to profile
     * @param {string} fieldId - Field identifier
     */
    markAsSaved(fieldId) {
        const meta = this.metadata.get(fieldId);
        if (meta) {
            meta.saved = true;
        }

        const entry = this.cache.get(fieldId);
        if (entry) {
            entry.source = FIELD_SOURCE.USER;
            entry.confidence = 1.0;
        }
    }

    /**
     * Get all fields that need LLM assistance
     * @returns {Array} Fields with low confidence
     */
    getUnresolvedFields() {
        const unresolved = [];

        this.cache.forEach((entry, fieldId) => {
            if (entry.confidence < CONFIDENCE.HIGH && entry.source !== FIELD_SOURCE.USER) {
                unresolved.push({
                    fieldId,
                    ...entry
                });
            }
        });

        return unresolved;
    }

    /**
     * Get all LLM-generated fields that haven't been saved
     * @returns {Array} Unsaved LLM fields
     */
    getUnsavedLLMFields() {
        const unsaved = [];

        this.metadata.forEach((meta, fieldId) => {
            if (meta.source === FIELD_SOURCE.LLM && !meta.saved) {
                const entry = this.cache.get(fieldId);
                if (entry) {
                    unsaved.push({
                        fieldId,
                        ...entry
                    });
                }
            }
        });

        return unsaved;
    }

    /**
     * Get confidence level for display
     * @param {string} fieldId - Field identifier
     * @returns {string} Confidence level (exact, inferred, uncertain)
     */
    getConfidenceLevel(fieldId) {
        const entry = this.cache.get(fieldId);
        if (!entry) return CONFIDENCE_LEVEL.UNCERTAIN;

        if (entry.source === FIELD_SOURCE.USER || entry.confidence >= CONFIDENCE.HIGH) {
            return CONFIDENCE_LEVEL.EXACT;
        }

        if (entry.source === FIELD_SOURCE.LLM || entry.confidence >= CONFIDENCE.MEDIUM) {
            return CONFIDENCE_LEVEL.INFERRED;
        }

        return CONFIDENCE_LEVEL.UNCERTAIN;
    }

    /**
     * Get all cached entries
     * @returns {Object} All cached data as object
     */
    getAll() {
        const all = {};
        this.cache.forEach((entry, fieldId) => {
            all[fieldId] = entry;
        });
        return all;
    }

    /**
     * Get count of cached entries
     * @returns {number} Number of cached fields
     */
    size() {
        return this.cache.size;
    }

    /**
     * Remove a specific field from cache
     * @param {string} fieldId - Field identifier
     */
    remove(fieldId) {
        this.cache.delete(fieldId);
        this.metadata.delete(fieldId);
    }

    /**
     * Clear all cached data
     */
    clear() {
        this.cache.clear();
        this.metadata.clear();
        console.log('[SessionCache] Cache cleared');
    }

    /**
     * Get statistics about cached data
     * @returns {Object} Cache statistics
     */
    getStats() {
        let deterministic = 0;
        let llm = 0;
        let user = 0;
        let saved = 0;

        this.metadata.forEach(meta => {
            if (meta.source === FIELD_SOURCE.DETERMINISTIC) deterministic++;
            else if (meta.source === FIELD_SOURCE.LLM) llm++;
            else if (meta.source === FIELD_SOURCE.USER) user++;

            if (meta.saved) saved++;
        });

        return {
            total: this.cache.size,
            deterministic,
            llm,
            user,
            saved,
            unsaved: this.cache.size - saved
        };
    }
}

// Create singleton instance for content script
const sessionCache = new SessionCache();

// Export for use in different contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SessionCache, sessionCache };
}
