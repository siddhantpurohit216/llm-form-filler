/**
 * DOCX Parser - Extract text from Word documents using mammoth.js
 */

/**
 * Parse DOCX file and extract text
 * @param {File} file - DOCX file
 * @returns {Promise<string>} Extracted text
 */
export async function parseDOCX(file) {
    const mammoth = await loadMammoth();

    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // Extract text using mammoth
    const result = await mammoth.extractRawText({ arrayBuffer });

    if (result.messages.length > 0) {
        console.warn('[DOCX Parser] Warnings:', result.messages);
    }

    return result.value;
}

/**
 * Load mammoth.js library
 */
async function loadMammoth() {
    if (window.mammoth) {
        return window.mammoth;
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('lib/mammoth.browser.min.js');
        script.onload = () => {
            if (window.mammoth) {
                resolve(window.mammoth);
            } else {
                reject(new Error('Failed to load mammoth.js'));
            }
        };
        script.onerror = () => reject(new Error('Failed to load mammoth.js script'));
        document.head.appendChild(script);
    });
}
