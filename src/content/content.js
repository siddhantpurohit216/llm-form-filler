/**
 * Main Content Script - Form Detection & Autofill Orchestration
 * Entry point for the content script that runs on all pages
 * Uses the Universal Autofill Engine for all DOM interactions
 */

(function () {
    'use strict';

    // Prevent multiple initialization
    if (window.__smartJobAutofillInitialized) {
        console.log('[SmartJobAutofill] Already initialized on this page');
        return;
    }
    window.__smartJobAutofillInitialized = true;

    console.log('[SmartJobAutofill] Content script loaded');

    // State
    let profile = null;
    let detectedFields = [];
    let isProcessing = false;
    let formObserver = null;

    /**
     * Initialize the content script
     */
    async function init() {
        console.log('[SmartJobAutofill] Initializing...');

        // Initialize inline UI
        inlineUI.init();

        // Load user profile from background
        await loadProfile();

        // Check for forms on initial load
        if (document.readyState === 'complete') {
            checkForForms();
        } else {
            window.addEventListener('load', checkForForms);
        }

        // Set up mutation observer for dynamic forms
        setupFormObserver();

        // Listen for messages from popup/background
        setupMessageListener();

        console.log('[SmartJobAutofill] Initialization complete');
    }

    /**
     * Load user profile from background/storage
     */
    async function loadProfile() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.GET_PROFILE
            });

            if (response && response.profile) {
                profile = response.profile;
                console.log('[SmartJobAutofill] Profile loaded');
            } else {
                profile = deepClone(DEFAULT_PROFILE);
                console.log('[SmartJobAutofill] Using default profile');
            }
        } catch (error) {
            console.error('[SmartJobAutofill] Failed to load profile:', error);
            profile = deepClone(DEFAULT_PROFILE);
        }
    }

    /**
     * Check page for job application forms
     */
    function checkForForms() {
        if (isProcessing) return;

        // Use universal selectors for detection
        const inputs = document.querySelectorAll(FieldExtractor.FIELD_SELECTORS);

        // Count visible inputs
        const visibleInputs = Array.from(inputs).filter(el =>
            isElementVisible(el) &&
            !['hidden', 'submit', 'button', 'reset'].includes(el.type?.toLowerCase())
        );

        // Detection logic
        const forms = document.querySelectorAll('form, [role="form"], [role="main"]');
        const hasForm = Array.from(forms).some(f => f.contains(visibleInputs[0]));
        const hasEnoughFields = visibleInputs.length >= MIN_FORM_FIELDS;

        console.log(`[SmartJobAutofill] Detection: visibleInputs=${visibleInputs.length}, hasForm=${hasForm}, hasEnoughFields=${hasEnoughFields}`);

        if (hasForm || hasEnoughFields) {
            console.log(`[SmartJobAutofill] Detected application form. Starting processForm...`);
            processForm();
        } else {
            console.log('[SmartJobAutofill] No full form detected yet. Waiting for interaction or dynamic loading.');
        }
    }

    /**
     * Process detected form - main autofill pipeline
     */
    async function processForm() {
        if (isProcessing) return;
        isProcessing = true;

        try {
            // Phase 1: Extract all fields using universal detection
            console.log('[SmartJobAutofill] Phase 1: Extracting fields...');
            detectedFields = fieldExtractor.extractAllFields();

            if (detectedFields.length === 0) {
                console.log('[SmartJobAutofill] No fields to process');
                return;
            }

            // Phase 2: Deterministic matching
            console.log('[SmartJobAutofill] Phase 2: Deterministic matching...');
            console.log('[SmartJobAutofill] Profile keys available:', Object.keys(profile));
            const matchedFields = deterministicMatcher.matchAllFields(detectedFields, profile);

            // Detailed match results for debugging
            matchedFields.forEach(f => {
                if (f.matchConfidence > 0) {
                    console.log(`[SmartJobAutofill] Match result for ${f.id}: score=${f.matchConfidence}, value=${!!f.matchedValue}, path=${f.matchedProfilePath}`);
                }
            });

            // Phase 3: Fill high-confidence fields via universal autofill engine
            console.log('[SmartJobAutofill] Phase 3: Filling matched fields...');
            const filledCount = fillMatchedFields(matchedFields);
            console.log(`[SmartJobAutofill] Filled ${filledCount} fields deterministically`);

            // Phase 4: Identify unresolved fields for LLM
            const unresolvedFields = matchedFields.filter(f =>
                f.matchConfidence < CONFIDENCE.HIGH &&
                !f.isFilledByExtension &&
                !f.currentValue
            );

            if (unresolvedFields.length > 0) {
                console.log(`[SmartJobAutofill] ${unresolvedFields.length} fields need LLM assistance`);
                requestLLMAssistance(unresolvedFields);
            }

            // Phase 5: Handle long-form questions
            const longFormFields = matchedFields.filter(f => f.isLongForm && !f.currentValue);
            if (longFormFields.length > 0) {
                console.log(`[SmartJobAutofill] ${longFormFields.length} long-form questions detected`);
                requestLongFormGeneration(longFormFields);
            }

        } catch (error) {
            console.error('[SmartJobAutofill] Error processing form:', error);
        } finally {
            isProcessing = false;
        }
    }

    /**
     * Fill fields that have high confidence matches
     * Uses the Universal Autofill Engine for all DOM writes
     * @param {Array} matchedFields - Fields with match results
     * @returns {number} Count of filled fields
     */
    function fillMatchedFields(matchedFields) {
        let filledCount = 0;

        matchedFields.forEach(field => {
            // Only auto-fill if confidence is high enough
            if (field.matchConfidence >= CONFIDENCE.HIGH && field.matchedValue) {
                console.log(`[SmartJobAutofill] Auto-filling ${field.id} with "${field.matchedValue}" (Confidence: ${field.matchConfidence})`);
                const result = autofillEngine.fill(field.element, field.matchedValue, field.type);

                if (result.success) {
                    filledCount++;
                    field.isFilledByExtension = true;

                    // Cache the fill
                    sessionCache.set(field.id, {
                        value: field.matchedValue,
                        confidence: field.matchConfidence,
                        source: field.matchSource,
                        reason: field.matchReason,
                        profilePath: field.matchedProfilePath
                    });

                    // Add UI indicators
                    inlineUI.addFieldIndicators(field.element, {
                        fieldId: field.id,
                        confidence: field.matchConfidence,
                        source: field.matchSource,
                        reason: field.matchReason,
                        profilePath: field.matchedProfilePath,
                        label: field.label,
                        type: field.type,
                        isLongForm: field.isLongForm
                    });

                    inlineUI.highlightField(field.element, 'exact');
                }
            } else if (field.matchConfidence >= CONFIDENCE.MEDIUM && field.matchedValue) {
                // Medium confidence - suggest but don't auto-fill
                sessionCache.set(field.id, {
                    value: field.matchedValue,
                    confidence: field.matchConfidence,
                    source: field.matchSource,
                    reason: field.matchReason,
                    profilePath: field.matchedProfilePath
                });
            }
        });

        return filledCount;
    }

    /**
     * Request LLM assistance for unresolved fields
     * @param {Array} fields - Unresolved fields
     */
    async function requestLLMAssistance(fields) {
        if (fields.length === 0) return;

        try {
            const fieldData = fields.map(f => ({
                id: f.id,
                label: f.label,
                placeholder: f.placeholder,
                type: f.type,
                hints: f.allHints,
                options: f.options,
                constraints: f.constraints
            }));

            const response = await chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.LLM_BATCH_REQUEST,
                data: {
                    fields: fieldData,
                    profile: profile
                }
            });

            if (response && response.mappings) {
                applyLLMMappings(response.mappings, fields);
            }
        } catch (error) {
            console.error('[SmartJobAutofill] LLM request failed:', error);
        }
    }

    /**
     * Request long-form answer generation
     * @param {Array} fields - Long-form fields
     */
    async function requestLongFormGeneration(fields) {
        for (const field of fields) {
            try {
                const response = await chrome.runtime.sendMessage({
                    type: MESSAGE_TYPES.LLM_GENERATE,
                    data: {
                        fieldId: field.id,
                        fieldInfo: {
                            label: field.label,
                            placeholder: field.placeholder,
                            type: field.type,
                            maxLength: field.constraints.maxLength,
                            hints: field.allHints.join(' ')
                        }
                    }
                });

                if (response && response.value) {
                    const result = autofillEngine.fill(field.element, response.value, field.type);

                    if (result.success) {
                        field.isFilledByExtension = true;

                        sessionCache.set(field.id, {
                            value: response.value,
                            confidence: response.confidence || 0.8,
                            source: FIELD_SOURCE.LLM,
                            reason: 'LLM generated response'
                        });

                        inlineUI.addFieldIndicators(field.element, {
                            fieldId: field.id,
                            confidence: response.confidence || 0.8,
                            source: FIELD_SOURCE.LLM,
                            reason: 'LLM generated response',
                            label: field.label,
                            type: field.type,
                            isLongForm: true
                        });

                        inlineUI.highlightField(field.element, 'inferred');
                    }
                }
            } catch (error) {
                console.error('[SmartJobAutofill] Long-form generation failed:', error);
            }
        }
    }

    /**
     * Apply LLM field mappings
     * Now the LLM returns actual values, not profile paths
     * @param {Array} mappings - LLM mapping results with { fieldId, value, confidence, reason }
     * @param {Array} fields - Original fields
     */
    function applyLLMMappings(mappings, fields) {
        mappings.forEach(mapping => {
            const field = fields.find(f => f.id === mapping.fieldId);
            if (!field || !mapping.value) return;

            const result = autofillEngine.fill(field.element, mapping.value, field.type);

            if (result.success) {
                field.isFilledByExtension = true;

                sessionCache.set(field.id, {
                    value: mapping.value,
                    confidence: mapping.confidence || 0.7,
                    source: FIELD_SOURCE.LLM,
                    reason: mapping.reason || 'LLM mapping'
                });

                inlineUI.addFieldIndicators(field.element, {
                    fieldId: field.id,
                    confidence: mapping.confidence || 0.7,
                    source: FIELD_SOURCE.LLM,
                    reason: mapping.reason || 'LLM mapping',
                    label: field.label,
                    type: field.type
                });

                inlineUI.highlightField(field.element, 'inferred');
            }
        });
    }

    /**
     * Set up mutation observer for dynamic forms
     * Now also detects ARIA/role-based elements
     */
    function setupFormObserver() {
        if (formObserver) {
            formObserver.disconnect();
        }

        formObserver = new MutationObserver(
            debounce((mutations) => {
                let hasNewInputs = false;

                for (const mutation of mutations) {
                    if (mutation.addedNodes.length > 0) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                // Check for standard inputs AND ARIA/role-based elements
                                if (node.matches?.(FieldExtractor.FIELD_SELECTORS) ||
                                    node.querySelector?.(FieldExtractor.FIELD_SELECTORS)) {
                                    hasNewInputs = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (hasNewInputs) break;
                }

                if (hasNewInputs) {
                    console.log('[SmartJobAutofill] New form elements detected');
                    checkForForms();
                }
            }, 500)
        );

        formObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Set up message listener for popup/background communication
     */
    function setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.type) {
                case 'TRIGGER_AUTOFILL':
                    loadProfile().then(() => processForm());
                    sendResponse({ success: true });
                    break;

                case 'GET_FORM_STATUS':
                    sendResponse({
                        hasForm: detectedFields.length > 0,
                        fieldCount: detectedFields.length,
                        stats: sessionCache.getStats()
                    });
                    break;

                case 'PROFILE_UPDATED':
                    loadProfile();
                    sendResponse({ success: true });
                    break;

                default:
                    break;
            }
            return true;
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
