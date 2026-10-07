/**
 * Universal Autofill Engine - Framework-agnostic DOM interaction
 * Handles filling fields across React, Angular, Workday, Greenhouse, etc.
 */

class AutofillEngine {
    constructor() {
        this.fillLog = new Map();
        this.optionWaitTimeout = 2000; // ms to wait for dropdown options
        this.optionPollInterval = 100; // ms between polls
        this.sectionFailures = new WeakMap();
    }

    async ensureProfileSections(profile, {manual = false} = {}) {
        const issues = [];
        // Scope Add buttons to their section; never click a global Add button.
        for (const [headingId, type, entries] of [
            ['Work-Experience-section', 'workExperience', profile.experience],
            ['Languages-section', 'language', profile.languages]
        ]) {
            if (!entries?.length) continue;
            const section = document.getElementById(headingId)?.parentElement;
            if (!section || !isElementVisible(section)) continue;
            const count = () => new Set([...section.querySelectorAll('[id]')]
                .map(el => el.id.match(new RegExp(`^${type}-[^-]+--`))?.[0]).filter(Boolean)).size;
            const previous = this.sectionFailures.get(section);
            if (!manual && previous?.target === entries.length && previous?.count === count()) {
                issues.push(previous.message);
                continue;
            }
            this.sectionFailures.delete(section);
            const fail = message => {
                issues.push(message);
                this.sectionFailures.set(section, {target:entries.length, count:count(), message});
            };
            // Each click must produce a new record before another click is sent.
            for (let attempt = 0; attempt < entries.length && count() < entries.length; attempt++) {
                const before = count();
                const add = [...section.querySelectorAll('button')].find(button =>
                    /^(add|add another|add more)$/i.test(button.textContent.trim()) &&
                    !button.disabled && isElementVisible(button));
                if (!add) { fail(`Add missing ${type === 'language' ? 'languages' : 'experience'} manually`); break; }
                add.click();
                const started = Date.now();
                while (section.isConnected && count() <= before && Date.now() - started < 3000) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                if (!section.isConnected || count() <= before) {
                    fail(`Could not add ${type === 'language' ? 'language' : 'experience'} section`);
                    break;
                }
            }
        }
        return issues;
    }

    /**
     * Fill a field with a value using the appropriate strategy
     * @param {HTMLElement} element - Target element
     * @param {string} value - Value to fill
     * @param {string} fieldType - Normalized type: text|dropdown|checkbox|radio|textarea|combobox
     * @returns {{ success: boolean, method: string }}
     */
    fill(element, value, fieldType, options={}) {
        if (!element || value === undefined || value === null) {
            return { success: false, method: 'none' };
        }

        try {
            if ((fieldType === 'url' || element.type === 'url') && value !== '' &&
                !globalThis.FieldPolicy?.validURL(value, globalThis.FieldPolicy.urlKind({element,type:fieldType}))) {
                return {success:false,method:'url:invalid'};
            }
            const tag = element.tagName?.toLowerCase();
            const type = element.type?.toLowerCase();

            if (fieldType === 'skills' || element.id === 'skills--skills') {
                return this.fillSearchSelectSkills(element, Array.isArray(value) ? value : String(value).split(/[,;\n]/).map(s => s.trim()).filter(Boolean),options);
            }

            // Determine strategy
            if (tag === 'select') {
                return this.fillNativeSelect(element, value);
            }

            if (type === 'checkbox') {
                return this.fillCheckbox(element, value);
            }

            if (type === 'radio') {
                return this.fillRadio(element, value);
            }

            if (element.getAttribute('contenteditable') === 'true') {
                return this.fillContentEditable(element, value);
            }

            if (element.getAttribute('data-uxi-widget-type') === 'selectinput' || element.getAttribute('role') === 'combobox' || fieldType === 'combobox' || fieldType === 'dropdown') {
                // Check if this is a native input inside a combobox wrapper, or a custom combobox
                if (tag === 'input') {
                    // It's an input with combobox role — fill via React-safe setter + try to open dropdown
                    return this.fillComboboxInput(element, value);
                }
                return this.fillCustomDropdown(element, value);
            }

            if (tag === 'textarea' || tag === 'input') {
                return this.fillTextInput(element, value);
            }

            // Fallback for role="textbox" or other editable elements
            if (element.getAttribute('role') === 'textbox') {
                return this.fillContentEditable(element, value);
            }

            // Last resort: try text input strategy
            return this.fillTextInput(element, value);
        } catch (error) {
            console.error('[AutofillEngine] Fill error:', error);
            return { success: false, method: 'error' };
        }
    }

    async captureFieldOptions(field) {
        const element = field.element;
        if (element.tagName === 'SELECT') return [...element.options].filter(o=>o.value && !o.disabled && !globalThis.FieldPolicy?.isPlaceholderLabel(o.textContent || o.text))
            .map(o=>({label:o.textContent.trim(),value:o.value}));
        if (field.type === 'radio') {
            return [...(element.form || element.getRootNode()).querySelectorAll('input[type="radio"]')]
                .filter(e=>e.name === element.name && !e.disabled).map(e=>({
                    label:document.querySelector(`label[for="${e.id}"]`)?.textContent.trim() || e.getAttribute('aria-label') || e.value,
                    value:e.value}));
        }
        if (!['combobox','dropdown'].includes(field.type) || element.getAttribute('data-uxi-widget-type') === 'selectinput') {
            return (field.options || []).map(label=>({label,value:label}));
        }
        // Only inspect controls; never send a full page's HTML or field values.
        if (!element.isConnected || element.disabled) return [];
        element.click();
        try {
            const options = await this.waitForDropdownOptions(element);
            return options.filter(option=>option.getAttribute('aria-disabled') !== 'true' &&
                !/^(select one|select|choose)$/i.test(this.optionText(option)))
                .map(option=>({label:this.optionText(option),value:option.getAttribute('data-value') || option.id || this.optionText(option)}));
        } finally {
            element.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
            element.blur();
            document.body.click();
        }
    }

    /**
     * Fill a text input or textarea using React-compatible native setter
     * Works with React, Angular, Vue, and vanilla forms
     * @param {HTMLElement} element
     * @param {string} value
     * @returns {{ success: boolean, method: string }}
     */
    fillTextInput(element, value) {
        // For date inputs, convert natural-language dates to YYYY-MM-DD
        let fillValue = this.normalizePhoneValue(element, value);
        if (element.type === 'date') {
            const parsed = parseResumeDate(value);
            if (parsed) fillValue = parsed;
        }

        // Workday commits segmented dates on focusout. A dispatched `blur`
        // alone doesn't reach React's delegated focus handlers.
        element.focus();

        // Strategy: Use native value setter to bypass React's internal state tracking
        const nativeSetter = this.getNativeValueSetter(element);

        // A previous fill may have updated the DOM/React value tracker without
        // updating Workday's form state. Replaying the same value alone is ignored
        // by React; a real input transition makes the final value observable.
        if (element.value !== '') {
            if (nativeSetter) nativeSetter.call(element, ''); else element.value = '';
            element.dispatchEvent(new Event('input', {bubbles:true}));
        }

        if (nativeSetter) {
            nativeSetter.call(element, fillValue);
        } else {
            element.value = fillValue;
        }

        // Dispatch events in the correct order for React and other frameworks
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur();

        this.logFill(element, fillValue, 'nativeSetter');
        return { success: true, method: 'nativeSetter' };
    }

    needsDateCommit(element, value) {
        if (!/dateSection(?:Month|Day|Year)-input$/.test(element.id || '')) return false;
        // Recommit the same visible value; preserve any different user entry.
        if (String(element.value) !== String(value)) return false;
        return this.hasFieldError(element);
    }

    hasFieldError(element) {
        const wrapper = element.closest('[data-automation-id="dateInputWrapper"]');
        if (element.getAttribute('aria-invalid') === 'true' ||
            /\bERROR\b/.test(wrapper?.getAttribute('aria-labelledby') || '')) return true;
        const describedBy = (element.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        return describedBy.some(id => {
            const alert = document.getElementById(id);
            return alert?.getAttribute('data-automation-id') === 'inputAlert' && isElementVisible(alert);
        });
    }

    needsValueCommit(element, value) {
        return ['INPUT','TEXTAREA'].includes(element.tagName) &&
            !['checkbox','radio','file','hidden'].includes(element.type) &&
            element.getAttribute('data-uxi-widget-type') !== 'selectinput' &&
            String(value || '').trim() !== '' && this.hasFieldError(element);
    }

    normalizePhoneValue(element, value) {
        // Workday has a separate country-code control. Its phone field expects
        // national digits, not the international prefix or display punctuation.
        if (element.id !== 'phoneNumber--phoneNumber') return String(value);
        const digits = String(value).replace(/\D/g, '');
        const country = document.getElementById('country--country')?.textContent || '';
        const code = document.getElementById('phoneNumber--countryPhoneCode');
        const codeText = code?.parentElement?.textContent || '';
        const isIndia = /india|\+91/i.test(codeText || country);
        if (isIndia && digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
        if (isIndia && digits.length === 14 && digits.startsWith('0091')) return digits.slice(4);
        return digits;
    }

    /**
     * Fill a native <select> dropdown
     * @param {HTMLSelectElement} element
     * @param {string} value
     * @returns {{ success: boolean, method: string }}
     */
    fillNativeSelect(element, value) {
        const normalizedValue = String(value).toLowerCase().trim();

        // Try exact match on value
        for (const option of element.options) {
            if (option.value.toLowerCase() === normalizedValue ||
                option.text.toLowerCase().trim() === normalizedValue) {
                element.value = option.value;
                element.dispatchEvent(new Event('change', { bubbles: true }));
                this.logFill(element, option.value, 'nativeSelect:exact');
                return { success: true, method: 'nativeSelect:exact' };
            }
        }

        // Try includes match
        for (const option of element.options) {
            const optText = option.text.toLowerCase().trim();
            const optVal = option.value.toLowerCase().trim();
            if (optText.includes(normalizedValue) || normalizedValue.includes(optText) ||
                optVal.includes(normalizedValue) || normalizedValue.includes(optVal)) {
                element.value = option.value;
                element.dispatchEvent(new Event('change', { bubbles: true }));
                this.logFill(element, option.value, 'nativeSelect:partial');
                return { success: true, method: 'nativeSelect:partial' };
            }
        }

        // Try fuzzy match using string similarity
        let bestMatch = null;
        let bestScore = 0;
        for (const option of element.options) {
            if (!option.value || option.disabled) continue;
            const textScore = stringSimilarity(normalizedValue, option.text.toLowerCase().trim());
            const valScore = stringSimilarity(normalizedValue, option.value.toLowerCase().trim());
            const score = Math.max(textScore, valScore);
            if (score > bestScore && score >= 0.6) {
                bestScore = score;
                bestMatch = option;
            }
        }

        if (bestMatch) {
            element.value = bestMatch.value;
            element.dispatchEvent(new Event('change', { bubbles: true }));
            this.logFill(element, bestMatch.value, 'nativeSelect:fuzzy');
            return { success: true, method: 'nativeSelect:fuzzy' };
        }

        return { success: false, method: 'nativeSelect:noMatch' };
    }

    /**
     * Fill a custom dropdown (Workday, Greenhouse, Lever-style)
     * Strategy: click → wait for options → find option → click
     * @param {HTMLElement} element
     * @param {string} value
     * @returns {Promise<{ success: boolean, method: string }>}
     */
    async fillCustomDropdown(element, value) {
        const normalizedValue = String(value).toLowerCase().trim();
        const proficiency = /^language-[^-]+--/.test(element.id || '') && !element.id.endsWith('--language');

        // Step 1: Click the combobox to open it
        element.click();
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        // Step 2: Wait for options to appear
        const options = await this.waitForDropdownOptions(element);

        if (!options || options.length === 0) {
            console.warn('[AutofillEngine] No dropdown options found');
            return { success: false, method: 'customDropdown:noOptions' };
        }

        // Step 3: Find the matching option
        let matchedOption = null;

        // Exact text match
        matchedOption = options.find(opt => {
            const text = (opt.textContent || opt.innerText || '').toLowerCase().trim();
            return (proficiency ? text.replace(/^\d+\s*[-–.:]\s*/, '') : text) === normalizedValue;
        });

        // Partial match
        if (!matchedOption && !proficiency) {
            matchedOption = options.find(opt => {
                const text = (opt.textContent || opt.innerText || '').toLowerCase().trim();
                return text.includes(normalizedValue) || normalizedValue.includes(text);
            });
        }

        // Fuzzy match
        if (!matchedOption && !proficiency) {
            let bestScore = 0;
            for (const opt of options) {
                const text = (opt.textContent || opt.innerText || '').toLowerCase().trim();
                const score = stringSimilarity(normalizedValue, text);
                if (score > bestScore && score >= 0.6) {
                    bestScore = score;
                    matchedOption = opt;
                }
            }
        }

        // Step 4: Click the matched option
        if (matchedOption) {
            matchedOption.scrollIntoView({ block: 'nearest' });
            if (globalThis.FieldPipeline && !FieldPipeline.canCommit(element)) return {success:false,method:'field:userEdit'};
            matchedOption.click();
            matchedOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            matchedOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

            this.logFill(element, value, 'customDropdown');
            return { success: true, method: 'customDropdown' };
        }

        // Close dropdown if no match
        document.body.click();
        return { success: false, method: 'customDropdown:noMatch' };
    }

    /**
     * Fill a combobox input (input with role="combobox")
     * Types the value and selects from filtered dropdown
     * @param {HTMLElement} element
     * @param {string} value
     * @returns {Promise<{ success: boolean, method: string }>}
     */
    selectedLabels(element) {
        const container = element.closest('[data-automation-id="multiSelectContainer"]');
        return Array.from(container?.querySelectorAll('[data-automation-id="selectedItem"] [data-automation-label]') || [])
            .map(chip => chip.getAttribute('data-automation-label') || chip.textContent.trim());
    }

    skillLabelsMatch(actual, expected) {
        if (globalThis.SkillAliases) return SkillAliases.matches(actual,expected);
        // Workday taxonomy qualifies language names without changing the skill.
        // Keep JavaScript, JavaFX and related skills distinct from Java.
        const normalize = text => String(text).trim().toLowerCase().replace(/\s+/g, ' ')
            .replace(/\s*\(programming language\)$/, '');
        return normalize(actual) === normalize(expected);
    }

    optionText(option) {
        const label = option.querySelector?.('[data-automation-id="promptOption"]');
        return (label?.getAttribute('data-automation-label') || option.getAttribute('data-automation-label') || option.textContent || '').trim();
    }

    async waitForMatch(element, value, timeout = this.optionWaitTimeout) {
        const norm = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
        const started = Date.now();
        while (element.isConnected && Date.now() - started < timeout) {
            const options = this.findDropdownOptions(element);
            const option = options.find(opt => this.optionText(opt).toLowerCase().replace(/\s+/g, ' ') === norm) ||
                (element.id === 'skills--skills' && options.find(opt => this.skillLabelsMatch(this.optionText(opt),value)));
            if (option) return option;
            await new Promise(resolve => setTimeout(resolve, element.id === 'skills--skills' ? 25 : this.optionPollInterval));
        }
        return null;
    }

    async fillComboboxInput(element, value) {
        let selectedLabel=String(value);
        const matchesSelected = () => this.selectedLabels(element).some(label => element.id === 'skills--skills'
            ? this.skillLabelsMatch(label,selectedLabel) : label.toLowerCase() === selectedLabel.trim().toLowerCase());
        if (matchesSelected()) {
            return {success:true, method:'comboboxInput:alreadySelected'};
        }
        const original = element.value;
        const setter = this.getNativeValueSetter(element);
        const type = text => {
            if (setter) setter.call(element, text); else element.value = text;
            element.dispatchEvent(new Event('input', {bubbles:true}));
        };
        element.focus();
        element.click();
        type(element.id==='skills--skills' ? (globalThis.SkillAliases?.searchTerm(value) || String(value)) : String(value));
        let option = await this.waitForMatch(element, value, this.optionWaitTimeout);
        if (globalThis.FieldPipeline && !FieldPipeline.canCommit(element)) return {success:false,method:'field:userEdit'};
        if (!option && element.id === 'skills--skills') {
            // Workday Skills allows free-text chips when no taxonomy option matches.
            for (const event of ['keydown', 'keypress', 'keyup']) {
                element.dispatchEvent(new KeyboardEvent(event, {key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true}));
            }
            // Some tenants search on Enter instead of creating a free-text chip.
            if (!matchesSelected()) option = await this.waitForMatch(element,value,this.optionWaitTimeout);
            if (globalThis.FieldPipeline && !FieldPipeline.canCommit(element)) return {success:false,method:'field:userEdit'};
            const workdaySkills=globalThis.activeAdapter?.id==='workday' || element.getAttribute('data-uxi-widget-type')==='selectinput';
            if (!option && !matchesSelected() && workdaySkills && globalThis.chrome?.runtime?.sendMessage) {
                const candidates=this.findDropdownOptions(element);
                const labels=[...new Set(candidates.map(candidate=>this.optionText(candidate)).filter(Boolean))].slice(0,60);
                if (labels.length) {
                    try {
                        const response=await chrome.runtime.sendMessage({type:'LLM_SKILL_MATCH',data:{skill:String(value),options:labels}});
                        if (!element.isConnected || (globalThis.FieldPipeline && !FieldPipeline.canCommit(element))) return {success:false,method:'field:userEdit'};
                        if (Number.isInteger(response?.optionIndex) && response.optionIndex>=0 && response.optionIndex<labels.length && response.confidence>=0.9) {
                            const label=labels[response.optionIndex];
                            const live=this.findDropdownOptions(element).filter(candidate=>this.optionText(candidate)===label);
                            if (live.length===1) {option=live[0];selectedLabel=label;}
                        }
                    } catch (error) {console.warn('[AutofillEngine] Skill AI fallback unavailable:',error.message);}
                }
            }
        } else if (!option) {
            element.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', code:'Escape', bubbles:true}));
            type(original);
            element.blur();
            return {success:false, method:'comboboxInput:noMatch'};
        }
        if (option && !matchesSelected()) {
            // Workday binds selection to the inner prompt leaf, not the outer
            // virtualized row. Clicking the row bypasses that event handler.
            const target = option.querySelector?.('[data-automation-id="promptLeafNode"]') ||
                option.querySelector?.('[role="checkbox"], input[type="checkbox"]') || option;
            target.click();
        }
        // Workday stores selected values in chips rather than the search input.
        if (element.getAttribute('data-uxi-widget-type') === 'selectinput') {
            const started = Date.now();
            while (Date.now() - started < this.optionWaitTimeout) {
                if (matchesSelected()) {
                    type('');
                    this.logFill(element, value, 'comboboxInput:selected');
                    return {success:true, method:'comboboxInput:selected',selectedLabel};
                }
                await new Promise(resolve => setTimeout(resolve, element.id === 'skills--skills' ? 25 : this.optionPollInterval));
            }
            type(original);
            return {success:false, method:'comboboxInput:notCommitted'};
        }
        this.logFill(element, value, 'comboboxInput:selected');
        return {success:true, method:'comboboxInput:selected'};
    }

    async fillSearchSelectSkills(element, skills,options={}) {
        const selected = [], missing = [];
        const resolutions=Object.create(null);
        const unique = [...new Map(skills.map(s => String(s).trim()).filter(Boolean).map(s => [globalThis.SkillAliases?.canonical(s) || s.toLowerCase(),s])).values()];
        for (const skill of unique) {
            if (!element.isConnected) { missing.push(skill); continue; }
            if (this.selectedLabels(element).some(label => this.skillLabelsMatch(label,skill))) continue;
            const result = await this.fillComboboxInput(element, skill,options);
            if (result.success && result.selectedLabel) resolutions[skill]=result.selectedLabel;
            (result.success ? selected : missing).push(skill);
        }
        element.blur();
        return {success:selected.length > 0, method:'searchSelectSkills', count:selected.length, selected, missing,resolutions};
    }

    /**
     * Fill a checkbox
     * @param {HTMLElement} element
     * @param {string} value - "true"/"yes"/"1" to check, "false"/"no"/"0" to uncheck
     * @returns {{ success: boolean, method: string }}
     */
    fillCheckbox(element, value) {
        const normalizedValue = String(value).toLowerCase().trim();
        const shouldCheck = ['true', 'yes', '1', 'on'].includes(normalizedValue) ||
            (!['false','no','0','off'].includes(normalizedValue) &&
                !!element.value && element.value.toLowerCase().trim() === normalizedValue);

        if (element.checked !== shouldCheck) {
            element.click();
        }

        if (element.checked !== shouldCheck) return {success:false, method:'checkbox:notCommitted'};
        this.logFill(element, String(shouldCheck), 'checkbox');
        return { success: true, method: 'checkbox' };
    }

    /**
     * Fill a radio button
     * Finds the correct radio in the group and selects it
     * @param {HTMLElement} element
     * @param {string} value
     * @returns {{ success: boolean, method: string }}
     */
    fillRadio(element, value) {
        const normalizedValue = String(value).toLowerCase().trim();
        const root = element.form || element.getRootNode();
        const radios = element.name
            ? Array.from(root.querySelectorAll('input[type="radio"]')).filter(r => r.name === element.name)
            : [element];
        const aliases = normalizedValue === 'no' ? ['no', 'false'] :
            normalizedValue === 'yes' ? ['yes', 'true'] : [normalizedValue];
        const matched = radios.find(r => aliases.includes(String(r.value).toLowerCase().trim())) ||
            radios.find(r => {
                const label = r.labels?.[0] || r.closest('label');
                const text = (label?.textContent || r.getAttribute('aria-label') || '').toLowerCase().trim();
                return text && aliases.includes(text);
            });

        if (matched && !matched.disabled) {
            // Native click updates both browser radio state and React's handler.
            matched.click();
            matched.dispatchEvent(new Event('input', { bubbles: true }));
            matched.dispatchEvent(new Event('change', { bubbles: true }));
            this.logFill(matched, value, 'radio');
            return { success: matched.checked, method: 'radio' };
        }

        return { success: false, method: 'radio:noMatch' };
    }

    /**
     * Fill a contenteditable element
     * @param {HTMLElement} element
     * @param {string} value
     * @returns {{ success: boolean, method: string }}
     */
    fillContentEditable(element, value) {
        element.focus();
        element.textContent = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));

        this.logFill(element, value, 'contentEditable');
        return { success: true, method: 'contentEditable' };
    }

    // ========== Helper Methods ==========

    /**
     * Get the native value setter for an element
     * This bypasses React/Angular/Vue value interception
     * @param {HTMLElement} element
     * @returns {Function|null}
     */
    getNativeValueSetter(element) {
        const tag = element.tagName?.toLowerCase();

        if (tag === 'textarea') {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
            return descriptor?.set || null;
        }

        if (tag === 'input') {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            return descriptor?.set || null;
        }

        return null;
    }

    /**
     * Wait for dropdown options to render after clicking a combobox
     * Searches for [role="option"], [role="listbox"] children, li elements, etc.
     * @param {HTMLElement} trigger - The combobox trigger element
     * @returns {Promise<HTMLElement[]>} Array of option elements
     */
    waitForDropdownOptions(trigger) {
        return new Promise((resolve) => {
            const startTime = Date.now();

            const poll = () => {
                const options = this.findDropdownOptions(trigger);

                if (options.length > 0) {
                    resolve(options);
                    return;
                }

                if (Date.now() - startTime >= this.optionWaitTimeout) {
                    resolve([]);
                    return;
                }

                setTimeout(poll, this.optionPollInterval);
            };

            poll();
        });
    }

    /**
     * Find dropdown options associated with a trigger element
     * @param {HTMLElement} trigger
     * @returns {HTMLElement[]}
     */
    findDropdownOptions(trigger) {
        let options = [];
        const selectable = nodes => Array.from(nodes).filter(o =>
            isElementVisible(o) && !o.closest('[data-automation-id="selectedItemList"]') &&
            o.getAttribute('aria-disabled') !== 'true');
        if (trigger.getAttribute('data-uxi-widget-type') === 'selectinput') {
            const owner = trigger.getAttribute('data-uxi-multiselect-id');
            const owned = document.querySelectorAll('[data-uxi-multiselect-id]');
            options = [...new Set(selectable(owned).filter(o => o.getAttribute('data-uxi-multiselect-id') === owner &&
                o.getAttribute('data-automation-id') === 'promptLeafNode').map(o => o.closest('[role="option"]')).filter(Boolean))];
            // An empty owned list must not fall through to another field's menu.
            return options;
        }

        // Strategy 1: aria-controls points to a listbox
        const controlsId = trigger.getAttribute('aria-controls') ||
            trigger.getAttribute('aria-owns');
        if (controlsId) {
            const listbox = document.getElementById(controlsId);
            if (listbox) {
                options = Array.from(listbox.querySelectorAll('[role="option"], li, [data-value]'));
                if (selectable(options).length > 0) return selectable(options);
            }
        }

        // Strategy 2: Look for open listbox/menu anywhere in the DOM
        const listboxes = document.querySelectorAll(
            '[role="listbox"], [role="menu"], .dropdown-menu, .select-options, .options-list, .listbox'
        );
        for (const lb of listboxes) {
            if (isElementVisible(lb)) {
                options = Array.from(lb.querySelectorAll('[role="option"], li, [data-value], .option'));
                if (selectable(options).length > 0) return selectable(options);
            }
        }

        // Strategy 3: Look for sibling/nearby containers with option-like elements
        const parent = trigger.closest('[data-automation-id], .form-field, .field-wrapper, .form-group') || trigger.parentElement;
        if (parent) {
            options = Array.from(parent.querySelectorAll('[role="option"], li[data-value], .option'));
            if (selectable(options).length > 0) return selectable(options);
        }

        // Strategy 4: Recently appeared elements (portal-rendered dropdowns)
        const allOptions = document.querySelectorAll('[role="option"]');
        options = selectable(allOptions);

        return options;
    }

    /**
     * Log a fill operation
     * @param {HTMLElement} element
     * @param {string} value
     * @param {string} method
     */
    logFill(element, value, method) {
        const id = element.id || element.name || element.getAttribute('data-automation-id') || 'unknown';
        this.fillLog.set(id, { value, method, timestamp: Date.now() });
        console.log(`[AutofillEngine] Filled "${id}" via ${method}`);
    }

    /**
     * Get fill history
     * @returns {Map}
     */
    getLog() {
        return this.fillLog;
    }

    /**
     * Clear fill log
     */
    clearLog() {
        this.fillLog.clear();
    }
}

// Create singleton instance
const autofillEngine = new AutofillEngine();

// Export for use in different contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AutofillEngine, autofillEngine };
}
