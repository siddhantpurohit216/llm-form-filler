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
    let rescanPending = false;
    let skillAttempts = new WeakMap();
    let dropdownAttempts = new WeakMap();
    const aiAttempts = new WeakMap();
    const elementIds = new WeakMap();
    const filledAnswers = new Map();
    const answerKey = field => field.stableKey || JSON.stringify([field.type,field.element.id || field.name || field.label,field.label,field.recordType,field.recordIndex]);
    const answerSnapshot = field => JSON.stringify(field.type==='checkbox' ? field.element.checked : fieldExtractor.getCurrentValue(field.element));
    const rememberFill = (field,source) => filledAnswers.set(answerKey(field),{source:source || FIELD_SOURCE.DETERMINISTIC || 'deterministic',snapshot:answerSnapshot(field)});
    let nextElementId = 0;
    let lastFormSnapshot = null;
    let processingFinished = Promise.resolve();
    let finishProcessing;
    const fillElement = (element,value,type,options={}) => globalThis.FieldPipeline
        ? FieldPipeline.fill(element,value,type,options) : autofillEngine.fill(element,value,type,options);

    function formSnapshot(elements) {
        return JSON.stringify(Array.from(elements).filter(el => !fieldExtractor.shouldSkipField(el)).map(el => {
            if (!elementIds.has(el)) elementIds.set(el, ++nextElementId);
            return [elementIds.get(el), el.id, fieldExtractor.getCurrentValue(el), el.checked,
                el.getAttribute?.('aria-invalid'), el.getAttribute?.('aria-describedby'),
                fieldExtractor.findLabelText?.(el), el.getAttribute?.('aria-label'),
                el.tagName==='SELECT' ? [...(el.options || [])].map(option=>[option.textContent,option.value,option.disabled]) : null];
        }));
    }

    /**
     * Initialize the content script
     */
    async function init() {
        console.log('[SmartJobAutofill] Initializing...');

        // Initialize inline UI
        inlineUI.init();
        inlineUI.showPageStatus('Looking for application fields…', async () => {
            skillAttempts = new WeakMap();
            dropdownAttempts = new WeakMap();
            await loadProfile();
            await processForm({manual:true});
        });
        // Install listeners before awaiting storage so early SPA updates aren't lost.
        setupFormObserver();
        setupInteractionDelegation();
        setupMessageListener();

        // Load user profile from background
        await loadProfile();

        // Check for forms on initial load
        if (document.readyState === 'complete') {
            checkForForms();
        } else {
            window.addEventListener('load', checkForForms);
        }

        console.log('[SmartJobAutofill] Initialization complete');
    }

    /**
     * Load user profile from background/storage
     */
    async function loadProfile() {
        lastFormSnapshot = null;
        try {
            const response = await chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.GET_PROFILE
            });

            if (response && response.profile) {
                profile = response.profile;
                globalThis.SemanticResolver?.setBindings(response.bindings);
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
        if (isProcessing) { rescanPending = true; return; }

        // Use universal selectors for detection
        const inputs = globalThis.activeAdapter ? activeAdapter.scanElements() : document.querySelectorAll(FieldExtractor.FIELD_SELECTORS);

        // Count visible inputs
        const visibleInputs = Array.from(inputs).filter(el =>
            !fieldExtractor.shouldSkipField(el)
        );
        const snapshot = formSnapshot(visibleInputs);
        if (snapshot === lastFormSnapshot) return;

        // Detection logic
        const forms = document.querySelectorAll('form, [role="form"], [role="main"]');
        const hasForm = Array.from(forms).some(f => f.contains(visibleInputs[0]));
        const hasEnoughFields = visibleInputs.length >= MIN_FORM_FIELDS;

        console.log(`[SmartJobAutofill] Detection: visibleInputs=${visibleInputs.length}, hasForm=${hasForm}, hasEnoughFields=${hasEnoughFields}`);

        if (hasForm || hasEnoughFields) {
            console.log(`[SmartJobAutofill] Detected application form. Starting processForm...`);
            processForm();
        } else {
            lastFormSnapshot = snapshot;
            detectedFields = [];
            inlineUI.updatePageStatus('No editable fields yet. Open the application form.');
        }
    }

    /**
     * Process detected form - main autofill pipeline
     */
    async function processForm({manual = false} = {}) {
        if (isProcessing) {
            if (manual) { await processingFinished; return processForm({manual}); }
            return;
        }
        if (!profile) return;
        isProcessing = true;
        processingFinished = new Promise(resolve=>{finishProcessing=resolve;});
        inlineUI.updatePageStatus('Checking application fields…', true);

        try {
            const sectionIssues = await (globalThis.activeAdapter ? activeAdapter.addRepeatedSection(profile,{manual}) : autofillEngine.ensureProfileSections?.(profile, {manual})) || [];
            // Phase 1: Extract all fields using universal detection
            console.log('[SmartJobAutofill] Phase 1: Extracting fields...');
            detectedFields = globalThis.activeAdapter ? activeAdapter.extractFields() : fieldExtractor.extractAllFields();

            if (detectedFields.length === 0) {
                inlineUI.updatePageStatus('No editable fields on this step.');
                return;
            }

            // Repair the formatting of an existing Workday phone value too,
            // so a number rejected on the previous attempt can be corrected.
            for (const field of detectedFields) {
                if (manual && field.type === 'url' && field.currentValue && !globalThis.FieldPolicy?.validURL(field.currentValue,globalThis.FieldPolicy.urlKind(field))) {
                    await fillElement(field.element,'','url');
                    field.currentValue = '';
                    sessionCache.remove?.(field.id);
                }
                if (manual && autofillEngine.needsValueCommit?.(field.element, field.currentValue)) {
                    // Recommit the displayed answer, including user edits, rather
                    // than replacing it with a potentially different profile value.
                    await fillElement(field.element, field.currentValue, field.type);
                }
                if (field.element.id !== 'phoneNumber--phoneNumber' || !field.currentValue) continue;
                const normalized = autofillEngine.normalizePhoneValue(field.element, field.currentValue);
                if (normalized !== field.currentValue) {
                    const result = await fillElement(field.element, normalized, field.type);
                    if (result.success) field.currentValue = normalized;
                }
            }

            // Phase 2: Deterministic matching
            console.log('[SmartJobAutofill] Phase 2: Deterministic matching...');
            console.log('[SmartJobAutofill] Profile keys available:', Object.keys(profile));
            const matchedFields = deterministicMatcher.matchAllFields(detectedFields, profile);

            // Controls are available for unanswered fields too, allowing users
            // to save a manual answer without needing an AI/profile match first.
            matchedFields.forEach(field => inlineUI.addFieldIndicators(field.element, {
                fieldId:field.id, label:field.label, type:field.type, isLongForm:field.isLongForm,
                confidence:field.matchConfidence, source:field.matchSource,
                reason:field.matchReason, profilePath:field.matchedProfilePath
            }));

            // Detailed match results for debugging
            matchedFields.forEach(f => {
                if (f.matchConfidence > 0) {
                    console.log(`[SmartJobAutofill] Match result for ${f.id}: score=${f.matchConfidence}, value=${!!f.matchedValue}, path=${f.matchedProfilePath}`);
                }
            });

            // Phase 3: Fill high-confidence fields via universal autofill engine
            console.log('[SmartJobAutofill] Phase 3: Filling matched fields...');
            const fillSummary = await fillMatchedFields(matchedFields, {manual});
            const filledCount = fillSummary.count;
            console.log(`[SmartJobAutofill] Filled ${filledCount} fields deterministically`);

            // Phase 4: Batch all unresolved fields into one LLM call
            // Both low-confidence short-form AND long-form fields go in the same batch
            const unresolvedFields = matchedFields.filter(f =>
                f.type !== 'url' && (globalThis.FieldPolicy?.category(f) !== 'accuracy_declaration' || globalThis.WorkdayQuestions?.enabled(f,profile)) &&
                !(f.recordType && /dateSection/.test(f.element.id || '')) &&
                f.type !== 'skills' && !f.isFilledByExtension && !fieldExtractor.getCurrentValue(f.element) &&
                sessionCache.get(f.id)?.source !== FIELD_SOURCE.USER
            );

            let aiNote = '';
            if (unresolvedFields.length > 0) {
                const categoryFields=unresolvedFields.filter(field=>['dropdown','combobox','radio','checkbox'].includes(field.type) && globalThis.WorkdayQuestions?.enabled(field,profile));
                aiNote = manual
                    ? await requestLLMBatch(unresolvedFields)
                    : categoryFields.length ? await requestLLMBatch(categoryFields) : 'Click Autofill for AI assistance';
            }
            const skillsField = detectedFields.find(field => field.type === 'skills');
            const skillStatus = skillsField
                ? ` · ${profile.skills?.length || 0} saved skills / ${autofillEngine.selectedLabels(skillsField.element).length} selected`
                : '';
            let answeredTotal=0,filledTotal=0,aiTotal=0,existingTotal=0;
            matchedFields.forEach(field => {
                const cached = sessionCache.get(field.id);
                const remembered=filledAnswers.get(answerKey(field));
                const retained=remembered?.snapshot===answerSnapshot(field) ? remembered : null;
                const source=cached?.source===FIELD_SOURCE.USER ? FIELD_SOURCE.USER : remembered ? retained?.source : cached?.source;
                const answered=!!fieldExtractor.getCurrentValue(field.element) || field.type==='checkbox' &&
                    (cached?.value===false || retained?.snapshot==='false');
                if(!answered)return;
                answeredTotal++;
                if(source && source===FIELD_SOURCE.LLM)aiTotal++;
                else if(source && source!==FIELD_SOURCE.USER)filledTotal++;
                else existingTotal++;
            });
            const manualSkills = skillsField && !manual && sessionCache.get(skillsField.id)?.source === FIELD_SOURCE.USER;
            inlineUI.updatePageStatus(`${detectedFields.length} fields detected · ${answeredTotal} have answers · ${filledTotal} filled from profile${aiTotal ? ` · ${aiTotal} filled with AI` : ''}${existingTotal ? ` · ${existingTotal} already present or edited` : ''}${skillStatus}${manualSkills ? ' · Click Autofill to add missing saved skills' : ''}${fillSummary.missingSkills.length ? ` · ${fillSummary.missingSkills.length} skills need review` : ''}${fillSummary.failedDropdowns.length ? ` · Check ${fillSummary.failedDropdowns.join(', ')}` : ''}${sectionIssues.length ? ` · ${sectionIssues.join(', ')}` : ''}${aiNote ? ` · ${aiNote}` : ''}`);
        } catch (error) {
            inlineUI.updatePageStatus('Autofill failed. Reload the extension and page.');
            console.error('[SmartJobAutofill] Error processing form:', error);
        } finally {
            // Use only the nodes we actually processed. A new/replaced field that
            // arrived during an async fill must still trigger the pending scan.
            lastFormSnapshot = formSnapshot(detectedFields.map(field => field.element).filter(el => el.isConnected));
            isProcessing = false;
            finishProcessing?.();
            inlineUI.setPageBusy(false);
            if (rescanPending) {
                rescanPending = false;
                checkForForms();
            }
        }
    }

    /**
     * Fill fields that have high confidence matches
     * Uses the Universal Autofill Engine for all DOM writes
     * @param {Array} matchedFields - Fields with match results
     * @returns {number} Count of filled fields
     */
    async function fillMatchedFields(matchedFields, {manual = false} = {}) {
        let filledCount = 0;
        const missingSkills = [];
        const failedDropdowns = [];

        for (const field of matchedFields) {
            const repairDate = manual && autofillEngine.needsDateCommit?.(field.element, field.matchedValue);
            // Check if field was manually edited by user
            const cached = sessionCache.get(field.id);
            if (cached && cached.source === FIELD_SOURCE.USER && !(manual && field.type === 'skills') && !repairDate) {
                console.log(`[SmartJobAutofill] Skipping user-edited field: ${field.id}`);
                continue;
            }
            // Preserve values entered by the user or Workday's resume import.
            if (!field.element.isConnected || field.element.disabled || field.element.readOnly) continue;
            if (field.type === 'skills') {
                const signature = JSON.stringify([field.matchedValue,field.label,field.options]);
                const attempt = skillAttempts.get(field.element);
                if (attempt?.signature === signature) {
                    missingSkills.push(...(attempt.result?.missing || []));
                    continue;
                }
                skillAttempts.set(field.element, {signature});
            } else if (fieldExtractor.getCurrentValue(field.element) && !repairDate) continue;

            if (['combobox', 'dropdown'].includes(field.type) && field.matchedValue != null) {
                const signature = JSON.stringify([field.matchedValue,field.label,field.options]);
                const attempt = dropdownAttempts.get(field.element);
                if (attempt?.signature === signature) {
                    if (!attempt.result?.success) failedDropdowns.push(field.label || field.name);
                    continue;
                }
                dropdownAttempts.set(field.element, {signature});
            }

            // Only auto-fill if confidence is high enough
            if (field.matchConfidence >= CONFIDENCE.HIGH && field.matchedValue != null && field.matchedValue !== '') {
                console.log(`[SmartJobAutofill] Auto-filling ${field.id} with "${field.matchedValue}" (Confidence: ${field.matchConfidence})`);
                let fillValue = field.matchedValue;
                if (field.strictChoice && ['dropdown','combobox','radio'].includes(field.type)) {
                    const details = await autofillEngine.captureFieldOptions(field);
                    const resolved = globalThis.SemanticResolver && field.semanticIntent
                        ? SemanticResolver.resolve(field,profile,null,{options:details}) : null;
                    const expected = String(field.matchedValue).trim().toLowerCase();
                    const option = resolved && !resolved.blocked ? details.find(option=>String(option.value)===String(resolved.value)) :
                        !resolved ? details.find(option=>option.label.trim().toLowerCase()===expected) : null;
                    if (!option) {
                        const result = {success:false,method:'strictChoice:noExactOption'};
                        if (dropdownAttempts.has(field.element)) dropdownAttempts.get(field.element).result = result;
                        failedDropdowns.push(field.label || field.name);
                        continue;
                    }
                    fillValue = field.element.tagName === 'SELECT' || field.type === 'radio' ? option.value : option.label;
                }
                const result = await fillElement(field.element, fillValue, field.type);

                if (['combobox', 'dropdown'].includes(field.type)) {
                    dropdownAttempts.get(field.element).result = result;
                    if (!result.success) failedDropdowns.push(field.label || field.name);
                }
                if (field.type === 'skills') {
                    skillAttempts.get(field.element).result = result;
                    missingSkills.push(...(result.missing || []));
                }
                if (result.success) {
                    filledCount++;
                    field.isFilledByExtension = true;
                    rememberFill(field,field.matchSource);

                    // Cache the fill
                    sessionCache.set(field.id, {
                        value: field.matchedValue,
                        confidence: field.matchConfidence,
                        source: field.matchSource,
                        reason: field.matchReason,
                        profilePath: field.matchedProfilePath, intent:field.semanticIntent
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
                    profilePath: field.matchedProfilePath, intent:field.semanticIntent
                });
            }
        }

        return {count:filledCount, missingSkills, failedDropdowns};
    }

    /**
     * Request LLM assistance for ALL unresolved fields in a SINGLE batch call.
     * This covers both low-confidence short-form fields and long-form text fields.
     * Per-field AI generation (user prompt) is a separate opt-in via the ✨ button.
     * @param {Array} fields - All unresolved fields
     */
    async function requestLLMBatch(fields) {
        const missingPreferences = new Set();
        fields.forEach(field => {
            if (fieldExtractor.refreshField) Object.assign(field, fieldExtractor.refreshField(field.element));
        });
        fields = fields.filter(field => {
            const category = globalThis.FieldPolicy?.category(field);
            if (['work_eligibility','previous_employment','disability'].includes(category) && globalThis.FieldPolicy.preference(category,profile) == null) {
                missingPreferences.add({work_eligibility:'work eligibility',previous_employment:'previous employment',disability:'disability disclosure'}[category]);
                return false;
            }
            return true;
        });
        const preferenceNote = missingPreferences.size ? `Save Profile → Application preferences: ${[...missingPreferences].join(', ')}` : '';
        const withPreferences = note => [preferenceNote,note].filter(Boolean).join(' · ');
        for (const field of fields) {
            if (autofillEngine.captureFieldOptions) {
                field.optionDetails = await autofillEngine.captureFieldOptions(field);
                field.options = field.optionDetails.map(option=>option.label);
            }
        }
        // Filter out fields that were already manually edited
        const profileSignature = JSON.stringify(profile);
        let previousNote = '';
        const actualUnresolved = fields.filter(f => {
            const attempt = aiAttempts.get(f.element);
            if (attempt?.profileSignature === profileSignature && attempt.fieldSignature === JSON.stringify([f.label,f.type,f.options,f.optionDetails]) && Date.now() < attempt.retryAt) {
                previousNote = attempt.note;
                return false;
            }
            const cached = sessionCache.get(f.id);
            return !(cached && cached.source === FIELD_SOURCE.USER);
        });

        if (actualUnresolved.length === 0) return withPreferences(previousNote);

        try {
            const fieldData = actualUnresolved.map(f => inlineUI.describeAIField
                ? inlineUI.describeAIField(f, f.optionDetails) : ({
                id: f.id,
                label: f.label,
                placeholder: f.placeholder,
                type: f.type,
                isLongForm: !!f.isLongForm,
                hints: f.allHints,
                options: f.options,
                optionDetails:f.optionDetails,
                context:String(f.nearbyText || '').slice(0,2000),
                inputType:f.element.type,
                category:globalThis.FieldPolicy?.category(f),
                adapter:f.adapter,pageContext:f.pageContext,
                constraints: f.constraints
            }));

            console.log(`[SmartJobAutofill] Sending batch LLM request for ${fieldData.length} fields`);

            const response = await chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.LLM_BATCH_REQUEST,
                data: {
                    fields: fieldData,
                    profile: profile
                }
            });

            const note = response?.error ? `AI unavailable: ${response.error}` :
                !response?.mappings?.length ? 'Remaining questions need a saved answer or manual review' : '';
            const retryAt = response?.error ? Date.now() + (response.retryAfterMs || 60000) :
                response?.mappings?.length ? Infinity : Date.now() + 60000;
            actualUnresolved.forEach(field => aiAttempts.set(field.element, {profileSignature, fieldSignature:JSON.stringify([field.label,field.type,field.options,field.optionDetails]), note, retryAt}));
            if (response?.error) return withPreferences(note);
            if (response && response.mappings) {
                console.log(`[SmartJobAutofill] LLM returned ${response.mappings.length} mappings`);
                await applyLLMMappings(response.mappings, fields);
                if (!response.mappings.length) return withPreferences(note);
            }
            return withPreferences('');
        } catch (error) {
            console.error('[SmartJobAutofill] LLM batch request failed:', error);
            actualUnresolved.forEach(field => aiAttempts.set(field.element, {profileSignature, fieldSignature:JSON.stringify([field.label,field.type,field.options,field.optionDetails]), note:'AI request failed', retryAt:Date.now()+60000}));
            return withPreferences('AI request failed');
        }
    }

    /**
     * Apply LLM field mappings
     * Now the LLM returns actual values, not profile paths
     * @param {Array} mappings - LLM mapping results with { fieldId, value, confidence, reason }
     * @param {Array} fields - Original fields
     */
    async function applyLLMMappings(mappings, fields) {
        for (const mapping of mappings) {
            const field = fields.find(f => f.id === mapping.fieldId);
            if (!field || mapping.value == null || mapping.value === '' || !field.element.isConnected) continue;
            if (globalThis.FieldPolicy && !globalThis.FieldPolicy.validate(field,mapping,profile)) continue;
            if (fieldExtractor.getCurrentValue(field.element) || sessionCache.get(field.id)?.source === FIELD_SOURCE.USER) continue;

            const option = field.optionDetails?.find(option=>String(option.value) === String(mapping.value) || option.label === String(mapping.value));
            const fillValue = field.element.tagName !== 'SELECT' && field.type !== 'radio' && option ? option.label : mapping.value;
            const result = await fillElement(field.element, fillValue, field.type);

            if (result.success) {
                field.isFilledByExtension = true;
                rememberFill(field,FIELD_SOURCE.LLM);

                sessionCache.set(field.id, {
                    value: mapping.value,
                    confidence: mapping.confidence || 0.7,
                    source: FIELD_SOURCE.LLM,
                    reason: mapping.reason || 'LLM mapping', intent:mapping.intent,qualifiers:mapping.qualifiers
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
        }
    }

    /**
     * Set up global event delegation to detect manual user interaction
     * This is more robust than per-element listeners on dynamic React sites
     */
    function setupInteractionDelegation() {
        const handleInteraction = (e) => {
            // event.isTrusted is true if triggered by user (keyboard/mouse)
            // false if triggered by dispatchEvent (our autofill engine)
            if (!e.isTrusted) return;

            const el = e.target;
            // Check if it's a form field we care about
            if (!el.matches?.(FieldExtractor.FIELD_SELECTORS)) return;

            // Calculate ID the same way FieldExtractor does
            const fieldId = el.dataset.sjaFieldId;

            if (fieldId) {
                console.log(`[SmartJobAutofill] Global delegation: Manual entry detected for ${fieldId}`);
                sessionCache.updateValue(fieldId,el.type==='checkbox'?el.checked:fieldExtractor.getCurrentValue(el), FIELD_SOURCE.USER);
            }
        };

        // Capture phase to ensure we get it before any page-level stoppers
        document.addEventListener('input', handleInteraction, true);
        document.addEventListener('change', handleInteraction, true);
    }

    // REMOVED: addInteractionListeners (replaced by global delegation)


    /**
     * Set up mutation observer for dynamic forms
     * Now also detects ARIA/role-based elements
     */
    function setupFormObserver() {
        if (formObserver) {
            formObserver.disconnect();
        }

        const scheduleScan = debounce(checkForForms, 250);
        const onMutations = mutations => {
            // Filter before debouncing: unrelated later mutations must not discard
            // the batch that inserted the application inputs.
            const relevant = mutations.some(mutation => {
                if ((mutation.target.nodeType===3 ? mutation.target.parentElement : mutation.target).closest?.('[data-sja-ui], .sja-field-overlay')) return false;
                if (mutation.type === 'characterData') return true;
                if (mutation.type === 'attributes') {
                    if (mutation.attributeName === 'class') {
                        const pageClasses = value => String(value || '').split(/\s+/).filter(token => token && !token.startsWith('sja-')).sort().join(' ');
                        if (pageClasses(mutation.oldValue) === pageClasses(mutation.target.getAttribute('class'))) return false;
                    }
                    return mutation.target.matches?.(FieldExtractor.FIELD_SELECTORS) ||
                        mutation.target.querySelector?.(FieldExtractor.FIELD_SELECTORS);
                }
                return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
                    node.nodeType === Node.ELEMENT_NODE &&
                    !node.matches?.('[data-sja-ui], .sja-field-overlay') &&
                    (node.matches?.(FieldExtractor.FIELD_SELECTORS) ||
                        node.querySelector?.(FieldExtractor.FIELD_SELECTORS))
                );
            });
            if (relevant) scheduleScan();
        };
        if (globalThis.activeAdapter) formObserver=activeAdapter.observeChanges(onMutations);
        else {
            formObserver=new MutationObserver(onMutations);
            formObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeOldValue:true,
                attributeFilter:['hidden','style','class','disabled','readonly']});
        }

    }

    /**
     * Set up message listener for popup/background communication
     */
    function setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.type) {
                case 'TRIGGER_AUTOFILL':
                    skillAttempts = new WeakMap();
                    dropdownAttempts = new WeakMap();
                    loadProfile().then(() => processForm({manual:true})).then(() =>
                        sendResponse({ success: true, fieldCount: detectedFields.length }));
                    break;

                case 'GET_FORM_STATUS':
                    sendResponse({
                        hasForm: detectedFields.length > 0,
                        fieldCount: detectedFields.length,
                        adapter:globalThis.activeAdapter?.name || 'Generic',
                        stats: sessionCache.getStats()
                    });
                    break;

                case 'PROFILE_UPDATED':
                    loadProfile().then(checkForForms);
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
