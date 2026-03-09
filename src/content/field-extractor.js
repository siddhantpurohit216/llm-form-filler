/**
 * Field Extractor - Extracts and normalizes form field information
 * Gathers all relevant metadata for intelligent field matching
 */

class FieldExtractor {
    constructor() {
        this.extractedFields = new Map();
    }

    /**
     * Extract all form fields from the page
     * @returns {Array} Array of normalized field objects
     */
    extractAllFields() {
        const fields = [];

        // Find all standard input, select, and textarea elements
        const standardInputs = document.querySelectorAll('input, select, textarea');

        // Find Workday custom elements
        const workdayInputs = document.querySelectorAll([
            '[data-automation-id*="input"]',
            '[data-automation-id*="text"]',
            '[data-automation-id*="select"]',
            '[data-automation-id*="dropdown"]',
            '[data-automation-id*="name"]',
            '[data-automation-id*="email"]',
            '[data-automation-id*="phone"]',
            '[data-automation-id*="address"]',
            '[data-automation-id*="city"]',
            '[data-automation-id*="postal"]',
            '[data-automation-id*="formField"]',
            '[role="textbox"]',
            '[role="combobox"]',
            '[role="listbox"]',
            '[contenteditable="true"]',
            '.wd-form-field input',
            '.wd-form-field textarea'
        ].join(', '));

        // Combine and dedupe elements
        const allElements = new Set([...standardInputs, ...workdayInputs]);

        // Also check Shadow DOMs
        this.findShadowDOMInputs(document.body, allElements);

        let index = 0;
        allElements.forEach((element) => {
            // Skip hidden and submit/button types
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

        // Check if element has shadow root
        if (root.shadowRoot) {
            const shadowInputs = root.shadowRoot.querySelectorAll('input, select, textarea, [role="textbox"], [role="combobox"]');
            shadowInputs.forEach(el => results.add(el));

            // Recurse into shadow DOM children
            root.shadowRoot.querySelectorAll('*').forEach(child => {
                this.findShadowDOMInputs(child, results);
            });
        }

        // Check all children for shadow roots
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
     * Extract all relevant data from a form field
     * @param {HTMLElement} element - Form element
     * @param {number} index - Element index for fallback ID
     * @returns {Object} Normalized field data
     */
    extractFieldData(element, index) {
        const tagName = element.tagName.toLowerCase();
        const type = element.type?.toLowerCase() || tagName;

        // Generate unique ID if none exists
        const fieldId = element.id || element.name || `sja_field_${index}`;

        // Collect all text hints for this field
        const labelText = this.findLabelText(element);
        const placeholderText = element.placeholder || '';
        const ariaLabel = element.getAttribute('aria-label') || '';
        const ariaDescribedBy = this.getAriaDescribedByText(element);
        const nearbyText = getNearbyText(element);
        const dataAttributes = this.extractDataAttributes(element);

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

        // Normalize the hints for matching
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

        // Extract options for select/datalist elements
        let options = [];
        if (tagName === 'select') {
            options = extractSelectOptions(element);
        } else if (element.list) {
            // Datalist options
            options = Array.from(element.list.options).map(opt => ({
                value: opt.value,
                text: opt.textContent.trim()
            }));
        }

        // Determine if this is a long-form text field
        const isLongForm = this.isLongFormField(element, combinedHint);

        return {
            id: fieldId,
            element: element,
            tagName: tagName,
            type: type,
            name: element.name || '',

            // Text hints
            label: labelText,
            placeholder: placeholderText,
            ariaLabel: ariaLabel,
            nearbyText: nearbyText,
            allHints: allHints,
            normalizedHints: normalizedHints,
            combinedHint: combinedHint,

            // Constraints
            constraints: constraints,

            // Options (for dropdowns)
            options: options,
            hasOptions: options.length > 0,

            // Classification
            isLongForm: isLongForm,
            isRequired: constraints.required,

            // Current state
            currentValue: element.value || '',
            isFilledByExtension: false,

            // Matching info (filled by matcher)
            matchedProfilePath: null,
            matchConfidence: 0,
            matchSource: null
        };
    }

    /**
     * Find the label text for an element
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
            // Get text content excluding the input element itself
            const clone = parentLabel.cloneNode(true);
            const input = clone.querySelector('input, select, textarea');
            if (input) input.remove();
            const text = clone.textContent.trim();
            if (text) texts.push(text);
        }

        // Method 3: aria-labelledby
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
            const labelElement = document.getElementById(labelledBy);
            if (labelElement) {
                texts.push(labelElement.textContent.trim());
            }
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
            if (parentSibling && (parentSibling.tagName === 'LABEL' || parentSibling.classList.contains('label'))) {
                texts.push(parentSibling.textContent.trim());
            }
        }

        // Return first non-empty text, cleaned up
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

        // Common data attributes that might contain field hints
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
        // Textareas with sufficient size
        if (element.tagName.toLowerCase() === 'textarea') {
            const rows = parseInt(element.getAttribute('rows')) || 3;
            if (rows >= 3) return true;
        }

        // Check maxlength - long form usually has higher limit or none
        const maxLength = element.maxLength;
        if (maxLength > 500 || maxLength === -1) {
            // Also check if the hint suggests a long-form question
            if (isLongFormQuestion(combinedHint)) {
                return true;
            }
        }

        // Check for common long-form patterns in hints
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
        const index = Array.from(document.querySelectorAll('input, select, textarea')).indexOf(element);
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
