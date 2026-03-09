/**
 * Universal Autofill Engine - Framework-agnostic DOM interaction
 * Handles filling fields across React, Angular, Workday, Greenhouse, etc.
 */

class AutofillEngine {
    constructor() {
        this.fillLog = new Map();
        this.optionWaitTimeout = 2000; // ms to wait for dropdown options
        this.optionPollInterval = 100; // ms between polls
    }

    /**
     * Fill a field with a value using the appropriate strategy
     * @param {HTMLElement} element - Target element
     * @param {string} value - Value to fill
     * @param {string} fieldType - Normalized type: text|dropdown|checkbox|radio|textarea|combobox
     * @returns {{ success: boolean, method: string }}
     */
    fill(element, value, fieldType) {
        if (!element || value === undefined || value === null) {
            return { success: false, method: 'none' };
        }

        try {
            const tag = element.tagName?.toLowerCase();
            const type = element.type?.toLowerCase();

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

            if (element.getAttribute('role') === 'combobox' || fieldType === 'combobox' || fieldType === 'dropdown') {
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

    /**
     * Fill a text input or textarea using React-compatible native setter
     * Works with React, Angular, Vue, and vanilla forms
     * @param {HTMLElement} element
     * @param {string} value
     * @returns {{ success: boolean, method: string }}
     */
    fillTextInput(element, value) {
        // Strategy: Use native value setter to bypass React's internal state tracking
        const nativeSetter = this.getNativeValueSetter(element);

        if (nativeSetter) {
            nativeSetter.call(element, value);
        } else {
            element.value = value;
        }

        // Dispatch events in the correct order for React and other frameworks
        element.dispatchEvent(new Event('focus', { bubbles: true }));
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));

        this.logFill(element, value, 'nativeSetter');
        return { success: true, method: 'nativeSetter' };
    }

    /**
     * Fill a native <select> dropdown
     * @param {HTMLSelectElement} element
     * @param {string} value
     * @returns {{ success: boolean, method: string }}
     */
    fillNativeSelect(element, value) {
        const normalizedValue = value.toLowerCase().trim();

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
        const normalizedValue = value.toLowerCase().trim();

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
            return text === normalizedValue;
        });

        // Partial match
        if (!matchedOption) {
            matchedOption = options.find(opt => {
                const text = (opt.textContent || opt.innerText || '').toLowerCase().trim();
                return text.includes(normalizedValue) || normalizedValue.includes(text);
            });
        }

        // Fuzzy match
        if (!matchedOption) {
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
    async fillComboboxInput(element, value) {
        // Clear existing value
        const nativeSetter = this.getNativeValueSetter(element);
        if (nativeSetter) {
            nativeSetter.call(element, '');
        } else {
            element.value = '';
        }

        // Focus and type the value
        element.focus();
        element.dispatchEvent(new Event('focus', { bubbles: true }));

        if (nativeSetter) {
            nativeSetter.call(element, value);
        } else {
            element.value = value;
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));

        // Wait for filtered options to appear
        const options = await this.waitForDropdownOptions(element);

        if (options && options.length > 0) {
            // Try to find and click exact or best match
            const normalizedValue = value.toLowerCase().trim();
            let matchedOption = options.find(opt => {
                const text = (opt.textContent || opt.innerText || '').toLowerCase().trim();
                return text === normalizedValue || text.includes(normalizedValue);
            });

            if (!matchedOption) matchedOption = options[0]; // Take first filtered result

            if (matchedOption) {
                matchedOption.scrollIntoView({ block: 'nearest' });
                matchedOption.click();
                this.logFill(element, value, 'comboboxInput:selected');
                return { success: true, method: 'comboboxInput:selected' };
            }
        }

        // Even if dropdown didn't open, the typed value may be accepted
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        this.logFill(element, value, 'comboboxInput:typed');
        return { success: true, method: 'comboboxInput:typed' };
    }

    /**
     * Fill a checkbox
     * @param {HTMLElement} element
     * @param {string} value - "true"/"yes"/"1" to check, "false"/"no"/"0" to uncheck
     * @returns {{ success: boolean, method: string }}
     */
    fillCheckbox(element, value) {
        const normalizedValue = value.toLowerCase().trim();
        const shouldCheck = ['true', 'yes', '1', 'on'].includes(normalizedValue) ||
            element.value.toLowerCase().trim() === normalizedValue;

        if (element.checked !== shouldCheck) {
            element.checked = shouldCheck;
            element.dispatchEvent(new Event('click', { bubbles: true }));
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }

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
        const normalizedValue = value.toLowerCase().trim();
        const radioName = element.name;

        // Find all radios in the same group
        let radios = [element];
        if (radioName) {
            radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${radioName}"]`));
        }

        // Find matching radio
        let matched = radios.find(r => r.value.toLowerCase().trim() === normalizedValue);

        // Try label text match
        if (!matched) {
            matched = radios.find(r => {
                const label = document.querySelector(`label[for="${r.id}"]`);
                const labelText = label ? label.textContent.toLowerCase().trim() : '';
                return labelText.includes(normalizedValue) || normalizedValue.includes(labelText);
            });
        }

        if (matched) {
            matched.checked = true;
            matched.dispatchEvent(new Event('click', { bubbles: true }));
            matched.dispatchEvent(new Event('input', { bubbles: true }));
            matched.dispatchEvent(new Event('change', { bubbles: true }));
            this.logFill(matched, value, 'radio');
            return { success: true, method: 'radio' };
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

        // Strategy 1: aria-controls points to a listbox
        const controlsId = trigger.getAttribute('aria-controls') ||
            trigger.getAttribute('aria-owns');
        if (controlsId) {
            const listbox = document.getElementById(controlsId);
            if (listbox) {
                options = Array.from(listbox.querySelectorAll('[role="option"], li, [data-value]'));
                if (options.length > 0) return options.filter(o => isElementVisible(o));
            }
        }

        // Strategy 2: Look for open listbox/menu anywhere in the DOM
        const listboxes = document.querySelectorAll(
            '[role="listbox"], [role="menu"], .dropdown-menu, .select-options, .options-list, .listbox'
        );
        for (const lb of listboxes) {
            if (isElementVisible(lb)) {
                options = Array.from(lb.querySelectorAll('[role="option"], li, [data-value], .option'));
                if (options.length > 0) return options.filter(o => isElementVisible(o));
            }
        }

        // Strategy 3: Look for sibling/nearby containers with option-like elements
        const parent = trigger.closest('[data-automation-id], .form-field, .field-wrapper, .form-group') || trigger.parentElement;
        if (parent) {
            options = Array.from(parent.querySelectorAll('[role="option"], li[data-value], .option'));
            if (options.length > 0) return options.filter(o => isElementVisible(o));
        }

        // Strategy 4: Recently appeared elements (portal-rendered dropdowns)
        const allOptions = document.querySelectorAll('[role="option"]');
        options = Array.from(allOptions).filter(o => isElementVisible(o));

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
