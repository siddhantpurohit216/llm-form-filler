/**
 * PDF Parser - Extract text from PDF files using pdf.js
 */

/**
 * Parse PDF file and extract text
 * @param {File} file - PDF file
 * @returns {Promise<string>} Extracted text
 */
export async function parsePDF(file) {
    // Load pdf.js library
    const pdfjsLib = await loadPDFJS();

    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // Load PDF document
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Extract text from all pages
    const textParts = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
            .map(item => item.str)
            .join(' ');
        textParts.push(pageText);
    }

    return textParts.join('\n\n');
}

/**
 * Load pdf.js library
 */
async function loadPDFJS() {
    if (window.pdfjsLib) {
        return window.pdfjsLib;
    }

    // Import from bundled library
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('lib/pdf.min.js');
        script.onload = () => {
            if (window.pdfjsLib) {
                // Set worker source
                window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                    chrome.runtime.getURL('lib/pdf.worker.min.js');
                resolve(window.pdfjsLib);
            } else {
                reject(new Error('Failed to load pdf.js'));
            }
        };
        script.onerror = () => reject(new Error('Failed to load pdf.js script'));
        document.head.appendChild(script);
    });
}
