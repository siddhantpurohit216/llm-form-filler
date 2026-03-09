/**
 * Deterministic Matcher - Rule-based field matching engine
 * Matches form fields to profile data without using LLM
 * Only auto-fills when confidence >= 0.9
 */

class DeterministicMatcher {
    constructor() {
        this.userOverrides = new Map(); // User-corrected mappings
        this.matchHistory = new Map();  // Successful matches for learning
    }

    /**
     * Match a single field to profile data
     * @param {Object} field - Extracted field data
     * @param {Object} profile - User profile data
     * @returns {Object} Match result with value and confidence
     */
    matchField(field, profile) {
        // Check for user override first (highest priority)
        if (this.userOverrides.has(field.id)) {
            const override = this.userOverrides.get(field.id);
            return {
                value: getNestedValue(profile, override.profilePath) || override.value,
                confidence: 1.0,
                source: FIELD_SOURCE.USER,
                profilePath: override.profilePath,
                reason: 'User-defined mapping'
            };
        }

        // Try matching strategies in order of confidence
        const strategies = [
            this.exactIdMatch.bind(this),
            this.exactNameMatch.bind(this),
            this.synonymMatch.bind(this),
            this.fuzzyMatch.bind(this),
            this.patternMatch.bind(this)
        ];

        for (const strategy of strategies) {
            const result = strategy(field, profile);
            if (result && result.confidence >= CONFIDENCE.LOW) {
                return result;
            }
        }

        // No match found
        return {
            value: null,
            confidence: 0,
            source: null,
            profilePath: null,
            reason: 'No deterministic match found'
        };
    }

    /**
     * Match all fields to profile data
     * @param {Array} fields - Array of extracted fields
     * @param {Object} profile - User profile data
     * @returns {Array} Fields with match results
     */
    matchAllFields(fields, profile) {
        return fields.map(field => {
            const match = this.matchField(field, profile);
            return {
                ...field,
                matchedValue: match.value,
                matchConfidence: match.confidence,
                matchSource: match.source,
                matchedProfilePath: match.profilePath,
                matchReason: match.reason
            };
        });
    }

    /**
     * Strategy 1: Exact ID match
     * Highest confidence for direct field ID → profile path mapping
     */
    exactIdMatch(field, profile) {
        const idMappings = {
            // Contact
            'email': 'contact.email',
            'phone': 'contact.phone',
            'firstName': 'contact.firstName',
            'first_name': 'contact.firstName',
            'lastName': 'contact.lastName',
            'last_name': 'contact.lastName',
            'address': 'contact.address',
            'city': 'contact.city',
            'state': 'contact.state',
            'zip': 'contact.zipCode',
            'zipCode': 'contact.zipCode',
            'country': 'contact.country',

            // Links
            'linkedin': 'links.linkedin',
            'linkedinUrl': 'links.linkedin',
            'github': 'links.github',
            'githubUrl': 'links.github',
            'portfolio': 'links.portfolio',
            'website': 'links.portfolio'
        };

        const normalizedId = normalizeFieldName(field.id);
        const normalizedName = normalizeFieldName(field.name);

        // Try ID first, then name
        let profilePath = idMappings[normalizedId] || idMappings[normalizedName];

        if (profilePath) {
            const value = getNestedValue(profile, profilePath);
            if (value) {
                return {
                    value: value,
                    confidence: 0.95,
                    source: FIELD_SOURCE.DETERMINISTIC,
                    profilePath: profilePath,
                    reason: `Exact ID/name match: ${field.id || field.name}`
                };
            }
        }

        return null;
    }

    /**
     * Strategy 2: Exact name match
     * Check if field name directly matches profile structure
     */
    exactNameMatch(field, profile) {
        const name = normalizeFieldName(field.name || field.id);

        // Direct path lookup in profile
        const directPaths = [
            `contact.${name}`,
            `links.${name}`,
            `customFields.${name}`
        ];

        for (const path of directPaths) {
            const value = getNestedValue(profile, path);
            if (value) {
                return {
                    value: value,
                    confidence: 0.9,
                    source: FIELD_SOURCE.DETERMINISTIC,
                    profilePath: path,
                    reason: `Direct path match: ${path}`
                };
            }
        }

        return null;
    }

    /**
     * Strategy 3: Synonym match
     * Use FIELD_SYNONYMS to match field hints to profile paths
     */
    synonymMatch(field, profile) {
        const hintWords = field.normalizedHints;

        // Profile path mappings for each canonical field
        const pathMappings = {
            email: 'contact.email',
            phone: 'contact.phone',
            firstName: 'contact.firstName',
            lastName: 'contact.lastName',
            fullName: null, // Special handling needed
            address: 'contact.address',
            city: 'contact.city',
            state: 'contact.state',
            zipCode: 'contact.zipCode',
            country: 'contact.country',
            linkedin: 'links.linkedin',
            github: 'links.github',
            portfolio: 'links.portfolio',
            school: 'education[0].institution',
            degree: 'education[0].degree',
            major: 'education[0].major',
            graduationYear: 'education[0].endDate',
            gpa: 'education[0].gpa',
            company: 'experience[0].company',
            jobTitle: 'experience[0].title'
        };

        // Find best matching canonical field
        let bestMatch = null;
        let bestScore = 0;

        console.log(`[Matcher] SynonymMatch checking hints:`, hintWords);

        for (const [canonical, synonyms] of Object.entries(FIELD_SYNONYMS)) {
            for (const hint of hintWords) {
                if (synonyms.includes(hint)) {
                    const score = 0.9;
                    if (score > bestScore) {
                        bestScore = score;
                        bestMatch = canonical;
                    }
                }
                // Partial match
                else if (synonyms.some(syn => hint.includes(syn) || syn.includes(hint))) {
                    const score = 0.8;
                    if (score > bestScore) {
                        bestScore = score;
                        bestMatch = canonical;
                    }
                }
            }
        }

        if (bestMatch && pathMappings[bestMatch]) {
            const profilePath = pathMappings[bestMatch];

            // Special handling for fullName
            if (bestMatch === 'fullName') {
                const firstName = getNestedValue(profile, 'contact.firstName') || '';
                const lastName = getNestedValue(profile, 'contact.lastName') || '';
                if (firstName || lastName) {
                    return {
                        value: `${firstName} ${lastName}`.trim(),
                        confidence: bestScore,
                        source: FIELD_SOURCE.DETERMINISTIC,
                        profilePath: 'contact.firstName+lastName',
                        reason: `Synonym match: ${bestMatch}`
                    };
                }
            }

            const value = getNestedValue(profile, profilePath);
            console.log(`[Matcher] Matched to: ${bestMatch} (${profilePath}), Value found: ${!!value}, Score: ${bestScore}`);

            if (value) {
                return {
                    value: value,
                    confidence: bestScore,
                    source: FIELD_SOURCE.DETERMINISTIC,
                    profilePath: profilePath,
                    reason: `Synonym match: ${bestMatch}`
                };
            }
        }

        return null;
    }

    /**
     * Strategy 4: Fuzzy match using string similarity
     * Uses Levenshtein distance for approximate matching
     */
    fuzzyMatch(field, profile) {
        const combinedHint = field.combinedHint.toLowerCase();

        // Flatten profile for searching
        const flatProfile = this.flattenProfile(profile);

        let bestMatch = null;
        let bestScore = 0;

        for (const [path, value] of Object.entries(flatProfile)) {
            if (!value || typeof value !== 'string') continue;

            // Get the key name from path
            const keyName = path.split('.').pop().toLowerCase();

            // Calculate similarity between hint and key
            const similarity = stringSimilarity(combinedHint, keyName);

            if (similarity > bestScore && similarity >= 0.6) {
                bestScore = similarity;
                bestMatch = { path, value };
            }
        }

        if (bestMatch) {
            return {
                value: bestMatch.value,
                confidence: Math.min(bestScore * 0.9, 0.8), // Cap fuzzy at 0.8
                source: FIELD_SOURCE.DETERMINISTIC,
                profilePath: bestMatch.path,
                reason: `Fuzzy match: ${(bestScore * 100).toFixed(0)}% similar`
            };
        }

        return null;
    }

    /**
     * Strategy 5: Pattern match for specific field types
     * Uses FIELD_PATTERNS for validation-based matching
     */
    patternMatch(field, profile) {
        const type = field.type.toLowerCase();

        // Email fields
        if (type === 'email' || field.combinedHint.includes('email')) {
            const email = getNestedValue(profile, 'contact.email');
            if (email && FIELD_PATTERNS.email.test(email)) {
                return {
                    value: email,
                    confidence: 0.9,
                    source: FIELD_SOURCE.DETERMINISTIC,
                    profilePath: 'contact.email',
                    reason: 'Email pattern match'
                };
            }
        }

        // Phone/Tel fields
        if (type === 'tel' || field.combinedHint.includes('phone')) {
            const phone = getNestedValue(profile, 'contact.phone');
            if (phone) {
                return {
                    value: phone,
                    confidence: 0.9,
                    source: FIELD_SOURCE.DETERMINISTIC,
                    profilePath: 'contact.phone',
                    reason: 'Phone pattern match'
                };
            }
        }

        // URL fields
        if (type === 'url') {
            const hint = field.combinedHint.toLowerCase();
            if (hint.includes('linkedin')) {
                const linkedin = getNestedValue(profile, 'links.linkedin');
                if (linkedin) {
                    return {
                        value: linkedin,
                        confidence: 0.9,
                        source: FIELD_SOURCE.DETERMINISTIC,
                        profilePath: 'links.linkedin',
                        reason: 'LinkedIn URL match'
                    };
                }
            }
            if (hint.includes('github')) {
                const github = getNestedValue(profile, 'links.github');
                if (github) {
                    return {
                        value: github,
                        confidence: 0.9,
                        source: FIELD_SOURCE.DETERMINISTIC,
                        profilePath: 'links.github',
                        reason: 'GitHub URL match'
                    };
                }
            }
        }

        return null;
    }

    /**
     * Match dropdown options to profile values
     * @param {Object} field - Field with options
     * @param {Object} profile - User profile
     * @returns {Object} Match result
     */
    matchDropdown(field, profile) {
        if (!field.hasOptions || field.options.length === 0) {
            return null;
        }

        // First try to find what this dropdown is asking for
        const fieldMatch = this.matchField(field, profile);
        if (!fieldMatch.value) {
            return null;
        }

        // Try to find the best matching option
        const targetValue = fieldMatch.value.toLowerCase();

        // Exact match
        let matchedOption = field.options.find(opt =>
            opt.value.toLowerCase() === targetValue ||
            opt.text.toLowerCase() === targetValue
        );

        // Partial/fuzzy match
        if (!matchedOption) {
            let bestScore = 0;
            field.options.forEach(opt => {
                const valueScore = stringSimilarity(targetValue, opt.value.toLowerCase());
                const textScore = stringSimilarity(targetValue, opt.text.toLowerCase());
                const score = Math.max(valueScore, textScore);

                if (score > bestScore && score >= 0.7) {
                    bestScore = score;
                    matchedOption = opt;
                }
            });
        }

        if (matchedOption) {
            return {
                value: matchedOption.value,
                confidence: 0.85,
                source: FIELD_SOURCE.DETERMINISTIC,
                profilePath: fieldMatch.profilePath,
                reason: `Dropdown match: ${matchedOption.text}`
            };
        }

        return null;
    }

    /**
     * Flatten profile object for easier searching
     * @param {Object} obj - Profile object
     * @param {string} prefix - Current path prefix
     * @returns {Object} Flattened object
     */
    flattenProfile(obj, prefix = '') {
        const flat = {};

        for (const [key, value] of Object.entries(obj)) {
            const path = prefix ? `${prefix}.${key}` : key;

            if (value && typeof value === 'object' && !Array.isArray(value)) {
                Object.assign(flat, this.flattenProfile(value, path));
            } else if (Array.isArray(value)) {
                value.forEach((item, index) => {
                    if (typeof item === 'object') {
                        Object.assign(flat, this.flattenProfile(item, `${path}[${index}]`));
                    } else {
                        flat[`${path}[${index}]`] = item;
                    }
                });
            } else {
                flat[path] = value;
            }
        }

        return flat;
    }

    /**
     * Add a user override mapping
     * @param {string} fieldId - Field identifier
     * @param {string} profilePath - Profile path to map to
     * @param {string} value - Optional fixed value
     */
    addUserOverride(fieldId, profilePath, value = null) {
        this.userOverrides.set(fieldId, { profilePath, value });
        console.log(`[Matcher] Added user override: ${fieldId} → ${profilePath}`);
    }

    /**
     * Remove a user override
     * @param {string} fieldId - Field identifier
     */
    removeUserOverride(fieldId) {
        this.userOverrides.delete(fieldId);
    }

    /**
     * Get fields that need LLM assistance
     * @param {Array} matchedFields - Fields with match results
     * @returns {Array} Fields with confidence < threshold
     */
    getUnresolvedFields(matchedFields) {
        return matchedFields.filter(field =>
            field.matchConfidence < CONFIDENCE.HIGH &&
            !field.isFilledByExtension
        );
    }

    /**
     * Check if all required fields are filled
     * @param {Array} matchedFields - Fields with match results
     * @returns {Object} Status with filled/unfilled counts
     */
    checkRequiredFields(matchedFields) {
        const required = matchedFields.filter(f => f.isRequired);
        const filled = required.filter(f => f.matchConfidence >= CONFIDENCE.HIGH);

        return {
            total: required.length,
            filled: filled.length,
            unfilled: required.length - filled.length,
            complete: required.length === filled.length
        };
    }

    /**
     * Clear all cached data
     */
    clear() {
        this.matchHistory.clear();
        // Note: userOverrides are preserved as they represent user intent
    }
}

// Create singleton instance
const deterministicMatcher = new DeterministicMatcher();

// Export for use in different contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DeterministicMatcher, deterministicMatcher };
}
