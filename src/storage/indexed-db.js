/**
 * IndexedDB utility layer for persistent storage
 * Handles user profile and custom field mappings
 */

class ProfileDatabase {
    constructor() {
        this.db = null;
        this.dbName = DB_CONFIG.name;
        this.dbVersion = DB_CONFIG.version;
        this.isInitialized = false;
    }

    /**
     * Initialize the database
     * @returns {Promise<IDBDatabase>} Database instance
     */
    async init() {
        if (this.isInitialized && this.db) {
            return this.db;
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.isInitialized = true;
                console.log('IndexedDB initialized successfully');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create profile store
                if (!db.objectStoreNames.contains(DB_CONFIG.stores.profile)) {
                    const profileStore = db.createObjectStore(DB_CONFIG.stores.profile, {
                        keyPath: 'id'
                    });
                    profileStore.createIndex('type', 'type', { unique: false });

                    // Initialize with default profile
                    profileStore.transaction.oncomplete = () => {
                        const tx = db.transaction(DB_CONFIG.stores.profile, 'readwrite');
                        const store = tx.objectStore(DB_CONFIG.stores.profile);
                        store.put({
                            id: 'main',
                            type: 'profile',
                            data: deepClone(DEFAULT_PROFILE),
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        });
                    };
                }

                // Create custom fields store
                if (!db.objectStoreNames.contains(DB_CONFIG.stores.customFields)) {
                    const customStore = db.createObjectStore(DB_CONFIG.stores.customFields, {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    customStore.createIndex('fieldKey', 'fieldKey', { unique: false });
                    customStore.createIndex('domain', 'domain', { unique: false });
                }
            };
        });
    }

    /**
     * Ensure database is initialized
     */
    async ensureInit() {
        if (!this.isInitialized || !this.db) {
            await this.init();
        }
    }

    /**
     * Get the complete user profile
     * @returns {Promise<Object>} User profile data
     */
    async getProfile() {
        await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(DB_CONFIG.stores.profile, 'readonly');
            const store = tx.objectStore(DB_CONFIG.stores.profile);
            const request = store.get('main');

            request.onsuccess = () => {
                const result = request.result;
                if (result && result.data) {
                    resolve(result.data);
                } else {
                    resolve(deepClone(DEFAULT_PROFILE));
                }
            };

            request.onerror = () => {
                console.error('Error getting profile:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Update the entire user profile
     * @param {Object} profileData - Complete profile data
     * @returns {Promise<boolean>} Success status
     */
    async saveProfile(profileData) {
        await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(DB_CONFIG.stores.profile, 'readwrite');
            const store = tx.objectStore(DB_CONFIG.stores.profile);

            const request = store.put({
                id: 'main',
                type: 'profile',
                data: profileData,
                updatedAt: new Date().toISOString()
            });

            request.onsuccess = () => {
                console.log('Profile saved successfully');
                resolve(true);
            };

            request.onerror = () => {
                console.error('Error saving profile:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Update a specific field in the profile
     * @param {string} path - Dot-notation path (e.g., 'contact.email')
     * @param {*} value - Value to set
     * @returns {Promise<boolean>} Success status
     */
    async updateProfileField(path, value) {
        const profile = await this.getProfile();
        setNestedValue(profile, path, value);
        return this.saveProfile(profile);
    }

    /**
     * Add an item to an array field (education, experience, etc.)
     * @param {string} arrayPath - Path to the array
     * @param {Object} item - Item to add
     * @returns {Promise<boolean>} Success status
     */
    async addToArray(arrayPath, item) {
        const profile = await this.getProfile();
        const array = getNestedValue(profile, arrayPath) || [];

        if (!Array.isArray(array)) {
            throw new Error(`${arrayPath} is not an array`);
        }

        array.push(item);
        setNestedValue(profile, arrayPath, array);
        return this.saveProfile(profile);
    }

    /**
     * Remove an item from an array field by index
     * @param {string} arrayPath - Path to the array
     * @param {number} index - Index to remove
     * @returns {Promise<boolean>} Success status
     */
    async removeFromArray(arrayPath, index) {
        const profile = await this.getProfile();
        const array = getNestedValue(profile, arrayPath);

        if (!Array.isArray(array) || index < 0 || index >= array.length) {
            throw new Error(`Invalid array path or index`);
        }

        array.splice(index, 1);
        setNestedValue(profile, arrayPath, array);
        return this.saveProfile(profile);
    }

    /**
     * Get all custom field mappings
     * @param {string} domain - Optional domain filter
     * @returns {Promise<Array>} Custom field mappings
     */
    async getCustomFields(domain = null) {
        await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(DB_CONFIG.stores.customFields, 'readonly');
            const store = tx.objectStore(DB_CONFIG.stores.customFields);

            let request;
            if (domain) {
                const index = store.index('domain');
                request = index.getAll(domain);
            } else {
                request = store.getAll();
            }

            request.onsuccess = () => {
                resolve(request.result || []);
            };

            request.onerror = () => {
                console.error('Error getting custom fields:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Save a custom field mapping
     * @param {Object} mapping - Custom field mapping
     * @returns {Promise<number>} ID of saved mapping
     */
    async saveCustomField(mapping) {
        await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(DB_CONFIG.stores.customFields, 'readwrite');
            const store = tx.objectStore(DB_CONFIG.stores.customFields);

            const record = {
                ...mapping,
                createdAt: new Date().toISOString()
            };

            const request = store.add(record);

            request.onsuccess = () => {
                console.log('Custom field saved:', request.result);
                resolve(request.result);
            };

            request.onerror = () => {
                console.error('Error saving custom field:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Delete a custom field mapping
     * @param {number} id - ID of mapping to delete
     * @returns {Promise<boolean>} Success status
     */
    async deleteCustomField(id) {
        await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(DB_CONFIG.stores.customFields, 'readwrite');
            const store = tx.objectStore(DB_CONFIG.stores.customFields);
            const request = store.delete(id);

            request.onsuccess = () => {
                resolve(true);
            };

            request.onerror = () => {
                console.error('Error deleting custom field:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Clear all data (for reset functionality)
     * @returns {Promise<boolean>} Success status
     */
    async clearAll() {
        await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(
                [DB_CONFIG.stores.profile, DB_CONFIG.stores.customFields],
                'readwrite'
            );

            tx.objectStore(DB_CONFIG.stores.profile).clear();
            tx.objectStore(DB_CONFIG.stores.customFields).clear();

            tx.oncomplete = () => {
                console.log('All data cleared');
                resolve(true);
            };

            tx.onerror = () => {
                console.error('Error clearing data:', tx.error);
                reject(tx.error);
            };
        });
    }

    /**
     * Export profile as JSON
     * @returns {Promise<string>} JSON string of profile
     */
    async exportProfile() {
        const profile = await this.getProfile();
        const customFields = await this.getCustomFields();

        return JSON.stringify({
            profile,
            customFields,
            exportedAt: new Date().toISOString()
        }, null, 2);
    }

    /**
     * Import profile from JSON
     * @param {string} jsonString - JSON string to import
     * @returns {Promise<boolean>} Success status
     */
    async importProfile(jsonString) {
        try {
            const data = JSON.parse(jsonString);

            if (data.profile) {
                await this.saveProfile(data.profile);
            }

            if (data.customFields && Array.isArray(data.customFields)) {
                for (const field of data.customFields) {
                    await this.saveCustomField(field);
                }
            }

            return true;
        } catch (error) {
            console.error('Import error:', error);
            throw error;
        }
    }
}

// Create singleton instance
const profileDB = new ProfileDatabase();

// Export for use in different contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProfileDatabase, profileDB };
}
