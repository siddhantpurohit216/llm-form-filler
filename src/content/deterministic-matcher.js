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
        const urlKind = globalThis.FieldPolicy?.urlKind(field);
        if (urlKind) {
            const value = profile.links?.[urlKind];
            const valid = globalThis.FieldPolicy.validURL(value,urlKind);
            return {value:valid ? value : null, confidence:valid ? 1 : 0, source:FIELD_SOURCE.DETERMINISTIC,
                profilePath:`links.${urlKind}`,reason:'Exact URL field; use a saved link only'};
        }
        if (globalThis.SemanticResolver && !field.recordType) {
            const resolved = SemanticResolver.resolve(field,profile);
            if (resolved) return {value:resolved.value ?? null,confidence:resolved.blocked ? 0 : .95,
                source:FIELD_SOURCE.DETERMINISTIC,profilePath:resolved.profilePath || resolved.fact?.profilePath,
                strictChoice:true,semanticIntent:resolved.identity.intent,reason:resolved.reason || 'Canonical profile match'};
        }
        const questionCategory = globalThis.FieldPolicy?.category(field);
        if (questionCategory === 'accuracy_declaration') {
            return {value:null,confidence:0,source:FIELD_SOURCE.DETERMINISTIC,reason:'Review declaration after completing the application'};
        }
        if (['work_eligibility','disability'].includes(questionCategory) ||
            (questionCategory === 'previous_employment' && field.type !== 'radio')) {
            return {value:null,confidence:0,source:FIELD_SOURCE.DETERMINISTIC,reason:'Match the actual options to saved application preferences'};
        }
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

        if (field.element?.id === 'skills--skills') return {
            value: profile.skills?.length ? profile.skills : null,
            confidence: 1, source: FIELD_SOURCE.DETERMINISTIC,
            profilePath: 'skills', reason: 'Skills from saved profile'
        };

        if (field.recordType) {
            const prefix = {workExperience:'experience', education:'education', language:'languages'}[field.recordType];
            const record = profile[prefix]?.[field.recordIndex];
            const leaf = field.element.id.split('--').slice(1).join('--');
            if (prefix === 'languages') {
                const candidate = typeof record === 'string' ? {language:record} : record;
                const language = candidate && (candidate.language || candidate.name) ? candidate : null;
                const hint = `${field.label || ''} ${field.name || ''} ${leaf}`;
                const ability = hint.match(/\b(overall|reading|writing|speaking|comprehension|listening)\b/i)?.[1]?.toLowerCase();
                const key = leaf === 'language' ? 'language' : leaf === 'native' ? (/fluent/i.test(hint) ? 'fluent' : 'native') : ability;
                let value = null;
                if (language && key === 'language') value = language.language || language.name;
                else if (language && key === 'fluent') value = language.fluent ?? /^(?:fluent|5\s*-\s*fluent)$/i.test(language.overall || language.proficiency || 'Fluent');
                else if (language && key === 'native') value = language.native ?? false;
                else if (language && ability) value = language[ability] || language.proficiency || 'Fluent';
                return {value:value ?? null, confidence:value != null ? .95 : 0,
                    source:FIELD_SOURCE.DETERMINISTIC, profilePath:`languages[${field.recordIndex}].${key || leaf}`,
                    reason:'Saved language and proficiency preference'};
            }
            const keys = prefix === 'experience'
                ? {jobTitle:'title', companyName:'company', location:'location', roleDescription:'description', currentlyWorkHere:'current'}
                : {schoolName:'institution', degree:'degree', fieldOfStudy:'major', gradeAverage:'gpa'};
            let value = record?.[keys[leaf]];
            if (leaf.includes('dateSection')) {
                const dateKey = /startDate|firstYearAttended/.test(leaf) ? 'startDate' : 'endDate';
                const date = parseResumeDate(String(record?.[dateKey] || ''));
                if (date) value = leaf.includes('Month')
                    ? (/^\d{4}$/.test(String(record?.[dateKey] || '').trim()) ? null : String(Number(date.slice(5,7))))
                    : date.slice(0,4);
            }
            // Never fall back to record zero for later repeated sections.
            return {value: value ?? null, confidence: value != null ? .95 : 0,
                source: FIELD_SOURCE.DETERMINISTIC, profilePath: `${prefix}[${field.recordIndex}].${keys[leaf] || leaf}`,
                reason: 'Matching saved entry for this Workday section'};
        }

        // User-requested default applies only to previous employment, not to
        // eligibility, consent, or other yes/no questions.
        const previousWorker = field.name === 'candidateIsPreviousWorker' ||
            (field.type === 'radio' && /(?:previously|ever).*(?:employed|worked)|(?:former|previous) employee/i.test(field.label || ''));
        if (previousWorker) {
            const answer = profile.applicationDefaults?.previouslyEmployed;
            return {
                value: answer === true || /^(yes|true)$/i.test(String(answer)) ? 'Yes' : 'No',
                confidence: 1, source: FIELD_SOURCE.DETERMINISTIC,
                profilePath: 'applicationDefaults.previouslyEmployed',
                reason: 'Previous-employment default requested by user'
            };
        }

        // Workday uses semantic IDs with section prefixes instead of simple names.
        const workdayPaths = {
            'name--legalName--firstName': 'contact.firstName',
            'name--legalName--middleName': 'contact.middleName',
            'name--legalName--lastName': 'contact.lastName',
            'address--addressLine1': 'contact.address',
            'address--addressLine2': 'contact.addressLine2',
            'address--addressLine3': 'contact.addressLine3',
            'address--city': 'contact.city',
            'address--postalCode': 'contact.zipCode',
            'address--countryRegion': 'contact.state',
            'country--country': 'contact.country',
            'phoneNumber--phoneNumber': 'contact.phone',
            'phoneNumber--phoneType': 'contact.phoneType'
        };
        const workdayPath = workdayPaths[field.element?.id];
        const workdayValue = workdayPath && getNestedValue(profile, workdayPath);
        if (workdayValue) return {
            value: workdayValue, confidence: 0.95,
            source: FIELD_SOURCE.DETERMINISTIC, profilePath: workdayPath,
            reason: 'Workday field match'
        };

        const customMatch = this.matchCustomField(field, profile);
        if (customMatch) return customMatch;

        // Saved gender is an explicit fact, not a generated demographic inference.
        // Match the question itself; nearby questions can mention other facts.
        if (/\b(?:gender|sex)\b/i.test([field.label,field.ariaLabel,field.placeholder].filter(Boolean).join(' '))) {
            const candidates = [['contact.gender',profile.contact?.gender],
                ['applicationDefaults.gender',profile.applicationDefaults?.gender], ['gender',profile.gender],
                ...Object.entries(profile.customFields || {}).filter(([label]) => /^(?:gender|sex)$/i.test(label.trim()))
                    .map(([label,value]) => [`customFields.${label}`,value])];
            const saved = candidates.find(([,value]) => typeof value === 'string' && value.trim());
            return saved ? {value:saved[1].trim(),confidence:.95,source:FIELD_SOURCE.DETERMINISTIC,
                profilePath:saved[0],strictChoice:true,reason:'Saved gender matched to question label'} :
                {value:null,confidence:0,source:null,reason:'No saved gender answer'};
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

        // Custom fields fallback — user-defined label/value pairs
        const customFields = profile.customFields || {};
        for (const [label, value] of Object.entries(customFields)) {
            if (!label || !value) continue;
            const normalizedLabel = normalizeFieldName(label);
            const matchedHint = field.normalizedHints?.find(hint =>
                hint && (
                    hint === normalizedLabel ||
                    hint.includes(normalizedLabel) ||
                    normalizedLabel.includes(hint) ||
                    stringSimilarity(hint, normalizedLabel) >= 0.6
                )
            );
            if (matchedHint) {
                return {
                    value: String(value),
                    confidence: 0.75,
                    source: FIELD_SOURCE.DETERMINISTIC,
                    profilePath: `customFields.${label}`,
                    reason: `Custom field match: ${label}`
                };
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

    /** Match explicit custom answers using the question's own label, not nearby text. */
    matchCustomField(field, profile) {
        const words = text => String(text || '').replace(/([a-z])([A-Z])/g, '$1 $2')
            .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        const questionKey = text => words(text)
            .replace(/^(?:please )?(?:select|choose) the option (?:which|that) best (?:defines|describes) your /, '')
            .replace(/^(?:please )?(?:enter|provide|specify|select|choose|indicate) (?:the |your )?/, '')
            .replace(/^(?:what is|what are) (?:the |your )?/, '')
            .replace(/^(?:your|the) /, '')
            .replace(/ required$/, '').trim();
        const hints = [field.label,field.ariaLabel,field.placeholder,field.name].filter(Boolean);
        const matches = [];
        for (const [label,value] of Object.entries(profile.customFields || {})) {
            if (!label.trim() || value == null || String(value).trim() === '' ||
                !['string','number','boolean'].includes(typeof value)) continue;
            const key = words(label);
            let confidence = 0;
            if (hints.some(hint => words(hint) === key)) confidence = .95;
            else if (hints.some(hint => questionKey(hint) === questionKey(label))) confidence = .9;
            if (confidence) matches.push({value,confidence,source:FIELD_SOURCE.DETERMINISTIC,
                profilePath:`customFields.${label}`,strictChoice:true,reason:`Saved custom field: ${label}`});
        }
        if (!matches.length) return null;
        matches.sort((a,b) => b.confidence - a.confidence);
        const best = matches.filter(match => match.confidence === matches[0].confidence);
        if (new Set(best.map(match => JSON.stringify(match.value))).size > 1) {
            return {value:null,confidence:0,source:null,reason:'Conflicting saved custom answers; review this field'};
        }
        return best[0];
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
                strictChoice: !!match.strictChoice,
                semanticIntent:match.semanticIntent,
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
        const hintWords = globalThis.SemanticResolver ? [field.label,field.name,field.placeholder,field.ariaLabel].filter(Boolean).map(normalizeFieldName) : field.normalizedHints;

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
                    const score = globalThis.SemanticResolver ? .75 : .8;
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
                confidence: Math.min(bestScore * 0.9, globalThis.SemanticResolver ? .75 : .8), // Cap fuzzy at 0.8
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
