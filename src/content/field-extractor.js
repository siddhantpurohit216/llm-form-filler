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
        '[contenteditable="true"]'
    ].join(', ');

    /**
     * Extract all form fields from the page
     * @returns {Array} Array of FieldDescriptor objects
     */
    extractAllFields() {
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
        const skipTypes = ['hidden', 'submit', 'button', 'reset', 'image', 'file'];
        if (skipTypes.includes(type)) {
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

        if (tag === 'select') return 'dropdown';
        if (tag === 'textarea') return 'textarea';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (role === 'combobox') return 'combobox';
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
        const fieldType = this.normalizeFieldType(element);

        // Generate unique ID if none exists
        const fieldId = element.id || element.name ||
            element.getAttribute('data-automation-id') ||
            `sja_field_${index}`;

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
        const label = labelText || placeholderText || ariaLabel ||
            element.name || nearbyText || '';

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
        const isLongForm = this.isLongFormField(element, combinedHint);

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
            currentValue: element.value || element.textContent?.trim() || '',
            isFilledByExtension: false,

            // Matching info (filled by matcher)
            matchedProfilePath: null,
            matchConfidence: 0,
            matchSource: null
        };
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

        return texts.filter(t => t.length > 0 && t.length < 200)[0] || '';
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
