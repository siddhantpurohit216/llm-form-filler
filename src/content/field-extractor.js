/**
 * Field Extractor - Universal Form Field Detection Engine
 * Detects fields generically across all websites including
 * Workday, Greenhouse, Lever, and React-based forms
 */

class FieldExtractor {
    constructor() {
        this.extractedFields = new Map();
    }

    /**
     * Universal selector list for form field detection
     */
    static FIELD_SELECTORS = [
        'input',
        'textarea',
        'select',
        '[role="textbox"]',
        '[role="combobox"]',
        'button[aria-haspopup="listbox"][name]',
        '[contenteditable="true"]'
    ].join(', ');

    /**
     * Extract all form fields from the page
     * @returns {Array} Array of FieldDescriptor objects
     */
    extractAllFields() {
        this.extractedFields.clear();
        const fields = [];
        const allElements = new Set();

        // Find all elements matching universal selectors
        const found = document.querySelectorAll(FieldExtractor.FIELD_SELECTORS);
        found.forEach(el => allElements.add(el));

        // Also check Shadow DOMs
        this.findShadowDOMInputs(document.body, allElements);

        let index = 0;
        allElements.forEach((element) => {
            if (this.shouldSkipField(element)) {
                return;
            }

            const fieldData = this.extractFieldData(element, index++);
            if (fieldData) {
                const record = element.id?.match(/^(workExperience|education|language)-[^-]+--/);
                if (record) {
                    const recordIds = [...allElements].map(el => el.id?.match(new RegExp(`^${record[1]}-[^-]+--`))?.[0]).filter(Boolean);
                    fieldData.recordType = record[1];
                    fieldData.recordIndex = [...new Set(recordIds)].indexOf(record[0]);
                }
                fields.push(fieldData);
                this.extractedFields.set(fieldData.id, fieldData);
            }
        });

        console.log(`[FieldExtractor] Extracted ${fields.length} fields`);
        return fields;
    }

    /**
     * Find inputs inside Shadow DOMs recursively
     * @param {HTMLElement} root - Root element to search
     * @param {Set} results - Set to add found elements to
     */
    findShadowDOMInputs(root, results) {
        if (!root) return;

        if (root.shadowRoot) {
            const shadowInputs = root.shadowRoot.querySelectorAll(FieldExtractor.FIELD_SELECTORS);
            shadowInputs.forEach(el => results.add(el));

            root.shadowRoot.querySelectorAll('*').forEach(child => {
                this.findShadowDOMInputs(child, results);
            });
        }

        root.querySelectorAll('*').forEach(child => {
            if (child.shadowRoot) {
                this.findShadowDOMInputs(child, results);
            }
        });
    }

    /**
     * Check if a field should be skipped
     * @param {HTMLElement} element - Form element
     * @returns {boolean} True if should skip
     */
    shouldSkipField(element) {
        const type = element.type?.toLowerCase() || '';

        // Skip these input types
        const skipTypes = ['hidden', 'password', 'submit', 'button', 'reset', 'image', 'file'];
        if (element.closest('[data-sja-ui], [data-automation-id="activeListContainer"]') || element.disabled || element.readOnly) return true;
        const isDropdown = element.matches('button[aria-haspopup="listbox"][name]');
        if (skipTypes.includes(type) && !isDropdown) {
            return true;
        }

        // Skip if not visible
        if (!isElementVisible(element)) {
            return true;
        }

        // Skip if it's a search box
        if (type === 'search' || element.role === 'searchbox') {
            return true;
        }

        return false;
    }

    /**
     * Normalize the field type to a standard enum
     * @param {HTMLElement} element
     * @returns {string} text|dropdown|checkbox|radio|textarea|combobox
     */
    normalizeFieldType(element) {
        const tag = element.tagName?.toLowerCase();
        const type = element.type?.toLowerCase() || '';
        const role = element.getAttribute('role');

        if (element.id === 'skills--skills') return 'skills';
        if (tag === 'input' && element.getAttribute('data-uxi-widget-type') === 'selectinput') return 'combobox';
        if (tag === 'select') return 'dropdown';
        if (tag === 'textarea') return 'textarea';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (role === 'combobox' || element.matches('button[aria-haspopup="listbox"][name]')) return 'combobox';
        if (role === 'textbox' || element.getAttribute('contenteditable') === 'true') return 'textarea';

        return 'text';
    }

    /**
     * Extract all relevant data from a form field
     * Produces a FieldDescriptor object
     * @param {HTMLElement} element - Form element
     * @param {number} index - Element index for fallback ID
     * @returns {Object} FieldDescriptor
     */
    extractFieldData(element, index) {
        const tagName = element.tagName?.toLowerCase() || '';
        let fieldType = this.normalizeFieldType(element);

        // Keep identity stable across scans and repeated SPA sections.
        if (!element.dataset.sjaFieldId) {
            element.dataset.sjaFieldId = `${element.id || element.name || 'sja_field'}--${generateId()}`;
        }
        const fieldId = element.dataset.sjaFieldId;

        // Label detection priority:
        // 1. associated <label> element
        // 2. placeholder
        // 3. aria-label
        // 4. name attribute
        // 5. nearest visible text in DOM
        const labelText = this.findLabelText(element);
        const placeholderText = element.placeholder || '';
        const ariaLabel = element.getAttribute('aria-label') || '';
        const ariaDescribedBy = this.getAriaDescribedByText(element);
        const nearbyText = getNearbyText(element);
        const dataAttributes = this.extractDataAttributes(element);

        // Resolved label using priority chain
        const label = [labelText, placeholderText, ariaLabel, element.name, nearbyText]
            .map(text => this.cleanQuestionLabel(text)).find(Boolean) || '';
        if (globalThis.FieldPolicy?.urlKind({label:labelText, name:element.name, placeholder:placeholderText, ariaLabel, element, type:element.type})) fieldType = 'url';

        // Combine all hints for matching
        const allHints = [
            labelText,
            placeholderText,
            ariaLabel,
            ariaDescribedBy,
            nearbyText,
            element.name || '',
            element.id || '',
            ...Object.values(dataAttributes)
        ].filter(Boolean);

        const normalizedHints = allHints.map(h => normalizeFieldName(h));
        const combinedHint = allHints.join(' ').toLowerCase();

        // Extract constraints
        const constraints = {
            required: element.required || element.getAttribute('aria-required') === 'true',
            maxLength: element.maxLength > 0 ? element.maxLength : null,
            minLength: element.minLength > 0 ? element.minLength : null,
            pattern: element.pattern || null,
            min: element.min || null,
            max: element.max || null
        };

        // Extract options for dropdowns and comboboxes
        const options = this.extractOptions(element, fieldType);

        // Determine if this is a long-form text field
        const isLongForm = fieldType !== 'url' && this.isLongFormField(element, combinedHint);

        return {
            id: fieldId,
            element: element,
            tagName: tagName,
            type: fieldType,
            name: element.name || '',

            // Label (resolved by priority)
            label: label,
            placeholder: placeholderText,
            ariaLabel: ariaLabel,
            nearbyText: nearbyText,
            allHints: allHints,
            normalizedHints: normalizedHints,
            combinedHint: combinedHint,

            // Constraints
            constraints: constraints,

            // Options (for dropdowns/comboboxes)
            options: options,
            hasOptions: options.length > 0,

            // Classification
            isLongForm: isLongForm,
            isRequired: constraints.required,

            // Confidence score (base: 1.0 for fields with clear labels)
            confidenceScore: label ? 1.0 : 0.5,

            // Current state
            currentValue: this.getCurrentValue(element),
            isFilledByExtension: false,

            // Matching info (filled by matcher)
            matchedProfilePath: null,
            matchConfidence: 0,
            matchSource: null
        };
    }

    getCurrentValue(element) {
        if (element.tagName === 'SELECT') {
            const selected = element.options?.[element.selectedIndex];
            if (globalThis.FieldPolicy?.isPlaceholderLabel(selected?.textContent || selected?.text)) return '';
            return element.value || '';
        }
        if (element.getAttribute('data-uxi-widget-type') === 'selectinput') {
            const container = element.closest('[data-automation-id="multiSelectContainer"]');
            // The search input is empty after selection; chips hold the saved value.
            return Array.from(container?.querySelectorAll('[data-automation-id="selectedItem"] [data-automation-label]') || [])
                .map(chip => chip.getAttribute('data-automation-label')).join(', ');
        }
        if (element.type === 'radio' && element.name) {
            const root = element.form || element.getRootNode();
            const selected = Array.from(root.querySelectorAll('input[type="radio"]'))
                .find(r => r.name === element.name && r.checked);
            return selected?.value || '';
        }
        if (['checkbox', 'radio'].includes(element.type)) return element.checked ? element.value : '';
        if (element.matches('button[aria-haspopup="listbox"][name]')) {
            const text = element.textContent?.trim() || '';
            return /^(select one|select|choose|please select)$/i.test(text) ? '' : text;
        }
        return element.value ?? element.textContent?.trim() ?? '';
    }

    /**
     * Extract options from dropdown/combobox elements
     * @param {HTMLElement} element
     * @param {string} fieldType
     * @returns {string[]}
     */
    extractOptions(element, fieldType) {
        // Native <select>
        if (element.tagName?.toLowerCase() === 'select') {
            return Array.from(element.options)
                .filter(opt => opt.value && !opt.disabled)
                .map(opt => opt.textContent.trim());
        }

        // Datalist
        if (element.list) {
            return Array.from(element.list.options).map(opt =>
                opt.textContent?.trim() || opt.value
            );
        }

        // Custom combobox — try to find associated listbox
        if (fieldType === 'combobox') {
            const controlsId = element.getAttribute('aria-controls') ||
                element.getAttribute('aria-owns');
            if (controlsId) {
                const listbox = document.getElementById(controlsId);
                if (listbox) {
                    return Array.from(listbox.querySelectorAll('[role="option"], li'))
                        .map(opt => (opt.textContent || opt.innerText || '').trim())
                        .filter(Boolean);
                }
            }

            // Look for nearby listbox
            const parent = element.closest('[data-automation-id], .form-field, .field-wrapper, .form-group') || element.parentElement;
            if (parent) {
                const listbox = parent.querySelector('[role="listbox"]');
                if (listbox) {
                    return Array.from(listbox.querySelectorAll('[role="option"], li'))
                        .map(opt => (opt.textContent || opt.innerText || '').trim())
                        .filter(Boolean);
                }
            }
        }

        return [];
    }

    /**
     * Find the label text for an element using priority chain
     * @param {HTMLElement} element - Form element
     * @returns {string} Label text
     */
    findLabelText(element) {
        const texts = [];
        // Workday questionnaires use a rich legend several wrappers above the
        // control. aria-label often contains only "Select One Required".
        const legend = element.closest('fieldset')?.querySelector?.(':scope > legend');
        if (legend) {
            const paragraphs = [...legend.querySelectorAll('p')].map(p=>p.textContent.trim()).filter(Boolean);
            const question = paragraphs.length ? paragraphs.join('\n') : legend.textContent.trim();
            if (question) return question.slice(0,4000);
        }

        // Method 1: Explicit label with for attribute
        if (element.id) {
            const label = document.querySelector(`label[for="${element.id}"]`);
            if (label) {
                texts.push(label.textContent.trim());
            }
        }

        // Method 2: Wrapping label
        const parentLabel = element.closest('label');
        if (parentLabel) {
            const clone = parentLabel.cloneNode(true);
            const input = clone.querySelector('input, select, textarea');
            if (input) input.remove();
            const text = clone.textContent.trim();
            if (text) texts.push(text);
        }

        // Method 3: aria-labelledby
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
            const ids = labelledBy.split(/\s+/);
            const labelTexts = ids.map(id => {
                const el = document.getElementById(id);
                return el ? el.textContent.trim() : '';
            }).filter(Boolean);
            if (labelTexts.length) texts.push(labelTexts.join(' '));
        }

        // Method 4: Previous sibling label
        let sibling = element.previousElementSibling;
        while (sibling) {
            if (sibling.tagName === 'LABEL') {
                texts.push(sibling.textContent.trim());
                break;
            }
            sibling = sibling.previousElementSibling;
        }

        // Method 5: Parent's previous sibling (common in form groups)
        const parent = element.parentElement;
        if (parent) {
            const parentSibling = parent.previousElementSibling;
            if (parentSibling && (parentSibling.tagName === 'LABEL' || parentSibling.classList?.contains('label'))) {
                texts.push(parentSibling.textContent.trim());
            }
        }

        const associated = texts.map(text => this.cleanQuestionLabel(text)).find(Boolean);
        if (associated) return associated;

        // Some application sites put the question in a div/span above a nested
        // select instead of associating a label with it. Stay within one field:
        // never borrow text from a neighbouring question or the page heading.
        let control = element;
        for (let depth = 0; control?.parentElement && depth < 5; depth++, control = control.parentElement) {
            const wrapper = control.parentElement;
            const others = [...wrapper.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="combobox"], [contenteditable="true"]')]
                .filter(node => node !== element && !node.contains(element) && !element.contains(node));
            if (others.length) break;
            const candidates = [...wrapper.querySelectorAll('label, [class*="label"], [class*="Label"], [data-automation-id="formLabel"]')]
                .filter(node => !node.contains(element) && !element.contains(node) &&
                    !node.closest('[role="listbox"], [role="option"], [data-sja-ui]'));
            for (const node of candidates) {
                const text = this.cleanQuestionLabel(node.textContent);
                if (text) return text;
            }
            let previous = control.previousElementSibling;
            while (previous) {
                if (!previous.matches('script, style, [data-sja-ui]') &&
                    !previous.querySelector('input, select, textarea, [role="option"], [role="listbox"]')) {
                    const text = this.cleanQuestionLabel(previous.textContent);
                    if (text && text.split(/\s+/).length >= 2) return text;
                }
                previous = previous.previousElementSibling;
            }
        }
        return '';
    }

    cleanQuestionLabel(text) {
        const label = String(text || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();
        if (!label || /^(?:select(?: one)?|please select|choose(?: one)?)(?: required)?$/i.test(label) ||
            /^(?:questionnaire|primaryquestionnaire|question)[-_\d]+$/i.test(label)) return '';
        return label.slice(0, 4000);
    }

    /**
     * Get text from aria-describedby elements
     * @param {HTMLElement} element - Form element
     * @returns {string} Description text
     */
    getAriaDescribedByText(element) {
        const describedBy = element.getAttribute('aria-describedby');
        if (!describedBy) return '';

        const ids = describedBy.split(/\s+/);
        const texts = ids.map(id => {
            const el = document.getElementById(id);
            return el ? el.textContent.trim() : '';
        }).filter(Boolean);

        return texts.join(' ');
    }

    /**
     * Extract relevant data-* attributes
     * @param {HTMLElement} element - Form element
     * @returns {Object} Data attributes
     */
    extractDataAttributes(element) {
        const dataAttrs = {};

        const relevantAttrs = [
            'data-field', 'data-type', 'data-name', 'data-label',
            'data-qa', 'data-testid', 'data-automation-id'
        ];

        relevantAttrs.forEach(attr => {
            const value = element.getAttribute(attr);
            if (value) {
                dataAttrs[attr] = value;
            }
        });

        return dataAttrs;
    }

    /**
     * Determine if this is a long-form text field
     * @param {HTMLElement} element - Form element
     * @param {string} combinedHint - Combined hint text
     * @returns {boolean} True if long-form
     */
    isLongFormField(element, combinedHint) {
        if (element.tagName?.toLowerCase() === 'textarea') {
            const rows = parseInt(element.getAttribute('rows')) || 3;
            if (rows >= 3) return true;
        }

        const maxLength = element.maxLength;
        if (maxLength > 500 || maxLength === -1) {
            if (isLongFormQuestion(combinedHint)) {
                return true;
            }
        }

        return isLongFormQuestion(combinedHint);
    }

    /**
     * Get a specific field by ID
     * @param {string} fieldId - Field ID
     * @returns {Object|null} Field data or null
     */
    getField(fieldId) {
        return this.extractedFields.get(fieldId) || null;
    }

    /**
     * Get all extracted fields
     * @returns {Map} All extracted fields
     */
    getAllFields() {
        return this.extractedFields;
    }

    /**
     * Re-extract a single field (after DOM changes)
     * @param {HTMLElement} element - Form element
     * @returns {Object} Updated field data
     */
    refreshField(element) {
        const index = Array.from(document.querySelectorAll(FieldExtractor.FIELD_SELECTORS)).indexOf(element);
        return this.extractFieldData(element, index);
    }

    /**
     * Group fields by form or section
     * @param {Array} fields - Array of field objects
     * @returns {Object} Fields grouped by form/section
     */
    groupFieldsBySection(fields) {
        const groups = new Map();

        fields.forEach(field => {
            const form = field.element.closest('form');
            const section = field.element.closest('section, fieldset, [role="group"]');

            const groupKey = form?.id || section?.id || 'default';

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey).push(field);
        });

        return groups;
    }

    /**
     * Clear extracted fields
     */
    clear() {
        this.extractedFields.clear();
    }
}

// Create singleton instance
const fieldExtractor = new FieldExtractor();

// Export for use in different contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FieldExtractor, fieldExtractor };
}
