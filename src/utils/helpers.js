/**
 * Utility helper functions used across the extension
 */

/**
 * Normalize a string for comparison
 * Converts to lowercase, removes special characters, trims whitespace
 * @param {string} str - Input string
 * @returns {string} Normalized string
 */
function normalizeString(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]/g, '')
        .replace(/\s+/g, '');
}

/**
 * Normalize a field name for matching
 * @param {string} fieldName - Field name or label
 * @returns {string} Normalized field name
 */
function normalizeFieldName(fieldName) {
    if (!fieldName || typeof fieldName !== 'string') return '';
    return fieldName
        .toLowerCase()
        .trim()
        .replace(/[_-]/g, '')
        .replace(/\s+/g, '')
        .replace(/\*/g, '') // Remove required asterisk
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Get text content from nearby elements (labels, siblings)
 * @param {HTMLElement} element - Input element
 * @returns {string} Combined nearby text
 */
function getNearbyText(element) {
    const texts = [];

    // Check for associated label
    if (element.id) {
        const label = document.querySelector(`label[for="${element.id}"]`);
        if (label) {
            texts.push(label.textContent.trim());
        }
    }

    // Check for wrapping label
    const parentLabel = element.closest('label');
    if (parentLabel) {
        const labelText = parentLabel.textContent
            .replace(element.value || '', '')
            .trim();
        if (labelText) texts.push(labelText);
    }

    // Check previous sibling
    let sibling = element.previousElementSibling;
    if (sibling && (sibling.tagName === 'LABEL' || sibling.tagName === 'SPAN')) {
        texts.push(sibling.textContent.trim());
    }

    // Check parent's previous sibling (common in form layouts)
    const parent = element.parentElement;
    if (parent) {
        sibling = parent.previousElementSibling;
        if (sibling && (sibling.tagName === 'LABEL' || sibling.tagName === 'DIV')) {
            texts.push(sibling.textContent.trim());
        }
    }

    return texts.filter(t => t.length > 0 && t.length < 200).join(' ');
}

/**
 * Deep clone an object
 * @param {Object} obj - Object to clone
 * @returns {Object} Cloned object
 */
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Get value from nested object path
 * @param {Object} obj - Object to traverse
 * @param {string} path - Dot-notation path (e.g., 'contact.email')
 * @returns {*} Value at path or undefined
 */
function getNestedValue(obj, path) {
    if (!obj || !path) return undefined;

    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = obj;

    for (const key of keys) {
        if (current === null || current === undefined) return undefined;
        current = current[key];
    }

    return current;
}

/**
 * Set value in nested object path
 * @param {Object} obj - Object to modify
 * @param {string} path - Dot-notation path
 * @param {*} value - Value to set
 * @returns {Object} Modified object
 */
function setNestedValue(obj, path, value) {
    if (!obj || !path) return obj;

    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (current[key] === undefined) {
            // Create array if next key is numeric, otherwise object
            current[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
        }
        current = current[key];
    }

    current[keys[keys.length - 1]] = value;
    return obj;
}

/**
 * Debounce function execution
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function execution
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Generate unique ID
 * @returns {string} Unique identifier
 */
function generateId() {
    return `sja_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if element is visible in viewport
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} True if visible
 */
function isElementVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

/**
 * Check if string is a long-form question
 * @param {string} text - Text to check
 * @returns {boolean} True if appears to be long-form question
 */
function isLongFormQuestion(text) {
    if (!text || text.length < 10) return false;
    return LONG_FORM_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Truncate text to max length with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

/**
 * Format date to standard format
 * @param {string|Date} date - Date to format
 * @param {string} format - Output format ('YYYY-MM-DD' or 'MM/YYYY')
 * @returns {string} Formatted date
 */
function formatDate(date, format = 'YYYY-MM-DD') {
    if (!date) return '';

    const d = new Date(date);
    if (isNaN(d.getTime())) return date; // Return original if invalid

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    if (format === 'MM/YYYY') {
        return `${month}/${year}`;
    }

    return `${year}-${month}-${day}`;
}

/**
 * Safely parse JSON
 * @param {string} jsonString - JSON string to parse
 * @param {*} defaultValue - Default value if parsing fails
 * @returns {*} Parsed object or default value
 */
function safeJsonParse(jsonString, defaultValue = null) {
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.warn('JSON parse error:', e);
        return defaultValue;
    }
}

/**
 * Calculate string similarity using Levenshtein distance
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score 0-1
 */
function stringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;

    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    if (s1 === s2) return 1;

    const len1 = s1.length;
    const len2 = s2.length;

    if (len1 === 0 || len2 === 0) return 0;

    // Calculate Levenshtein distance
    const matrix = Array(len2 + 1).fill().map(() => Array(len1 + 1).fill(0));

    for (let i = 0; i <= len1; i++) matrix[0][i] = i;
    for (let j = 0; j <= len2; j++) matrix[j][0] = j;

    for (let j = 1; j <= len2; j++) {
        for (let i = 1; i <= len1; i++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(
                matrix[j][i - 1] + 1,
                matrix[j - 1][i] + 1,
                matrix[j - 1][i - 1] + cost
            );
        }
    }

    const distance = matrix[len2][len1];
    return 1 - distance / Math.max(len1, len2);
}

/**
 * Extract dropdown options from select element
 * @param {HTMLSelectElement} selectElement - Select element
 * @returns {Array} Array of {value, text} objects
 */
function extractSelectOptions(selectElement) {
    if (!selectElement || selectElement.tagName !== 'SELECT') return [];

    return Array.from(selectElement.options)
        .filter(opt => opt.value && !opt.disabled)
        .map(opt => ({
            value: opt.value,
            text: opt.textContent.trim()
        }));
}

/**
 * Format phone number to standard format
 * @param {string} phone - Phone number
 * @returns {string} Formatted phone number
 */
function formatPhoneNumber(phone) {
    if (!phone) return '';

    // Remove all non-numeric characters except +
    const digits = phone.replace(/[^\d+]/g, '');

    // US format: (XXX) XXX-XXXX
    if (digits.length === 10) {
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    // With country code: +X (XXX) XXX-XXXX
    if (digits.length === 11 && digits.startsWith('1')) {
        return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }

    return phone; // Return original if not standard format
}

// Export for use in different contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        normalizeString,
        normalizeFieldName,
        getNearbyText,
        deepClone,
        getNestedValue,
        setNestedValue,
        debounce,
        throttle,
        generateId,
        isElementVisible,
        isLongFormQuestion,
        truncateText,
        formatDate,
        safeJsonParse,
        stringSimilarity,
        extractSelectOptions,
        formatPhoneNumber
    };
}
