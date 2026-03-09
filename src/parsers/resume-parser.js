/**
 * Resume Parser - Coordinates file parsing and LLM structuring
 */

import { parsePDF } from './pdf-parser.js';
import { parseDOCX } from './docx-parser.js';

/**
 * Parse a resume file and extract text
 * @param {File} file - The resume file
 * @returns {Promise<string>} Extracted text
 */
export async function parseResumeFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();

    switch (extension) {
        case 'pdf':
            return await parsePDF(file);
        case 'docx':
        case 'doc':
            return await parseDOCX(file);
        case 'txt':
            return await file.text();
        default:
            throw new Error(`Unsupported file type: ${extension}`);
    }
}

/**
 * Parse resume and send to background for structuring
 * @param {File} file - Resume file
 * @returns {Promise<Object>} Structured resume data
 */
export async function parseAndStructureResume(file) {
    // Extract text from file
    const text = await parseResumeFile(file);

    if (!text || text.trim().length < 50) {
        throw new Error('Could not extract sufficient text from resume');
    }

    // Send to background for LLM structuring
    const response = await chrome.runtime.sendMessage({
        type: 'PARSE_RESUME',
        data: { text, fileName: file.name }
    });

    if (!response.success) {
        throw new Error(response.error || 'Failed to structure resume');
    }

    return response.data;
}
