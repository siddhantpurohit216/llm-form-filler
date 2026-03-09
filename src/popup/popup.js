/**
 * Popup JavaScript - Profile management, resume upload, and settings
 */

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initProfile();
    initResume();
    initSettings();
    updateStatus('Ready');
});

// ========== Tabs ==========
function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
        });
    });
}

// ========== Profile ==========
let profileData = null;

async function initProfile() {
    await loadProfile();
    setupProfileListeners();
}

async function loadProfile() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_PROFILE' });
        profileData = response.profile || getDefaultProfile();
        populateProfileForm(profileData);
    } catch (error) {
        console.error('Failed to load profile:', error);
        profileData = getDefaultProfile();
    }
}

function getDefaultProfile() {
    return {
        contact: { firstName: '', lastName: '', email: '', phone: '' },
        links: { linkedin: '', github: '', portfolio: '' },
        education: [],
        experience: [],
        skills: []
    };
}

function populateProfileForm(profile) {
    // Contact
    document.getElementById('firstName').value = profile.contact?.firstName || '';
    document.getElementById('lastName').value = profile.contact?.lastName || '';
    document.getElementById('email').value = profile.contact?.email || '';
    document.getElementById('phone').value = profile.contact?.phone || '';

    // Links
    document.getElementById('linkedin').value = profile.links?.linkedin || '';
    document.getElementById('github').value = profile.links?.github || '';
    document.getElementById('portfolio').value = profile.links?.portfolio || '';

    // Education
    renderEducationList(profile.education || []);

    // Experience
    renderExperienceList(profile.experience || []);

    // Skills
    renderSkillsList(profile.skills || []);
}

function setupProfileListeners() {
    // Save button
    document.getElementById('save-profile').addEventListener('click', saveProfile);

    // Add education
    document.getElementById('add-education').addEventListener('click', () => {
        profileData.education = profileData.education || [];
        profileData.education.push({ institution: '', degree: '', major: '', gpa: '', startDate: '', endDate: '' });
        renderEducationList(profileData.education);
    });

    // Add experience
    document.getElementById('add-experience').addEventListener('click', () => {
        profileData.experience = profileData.experience || [];
        profileData.experience.push({ company: '', title: '', startDate: '', endDate: '', description: '' });
        renderExperienceList(profileData.experience);
    });

    // Skills input
    const skillsInput = document.getElementById('skills-input');
    skillsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && skillsInput.value.trim()) {
            e.preventDefault();
            profileData.skills = profileData.skills || [];
            profileData.skills.push(skillsInput.value.trim());
            skillsInput.value = '';
            renderSkillsList(profileData.skills);
        }
    });
}

function renderEducationList(education) {
    const container = document.getElementById('education-list');
    container.innerHTML = '';

    education.forEach((edu, index) => {
        const template = document.getElementById('education-template');
        const clone = template.content.cloneNode(true);
        const card = clone.querySelector('.item-card');
        card.dataset.index = index;

        card.querySelector('.edu-institution').value = edu.institution || '';
        card.querySelector('.edu-degree').value = edu.degree || '';
        card.querySelector('.edu-major').value = edu.major || '';
        card.querySelector('.edu-gpa').value = edu.gpa || '';
        card.querySelector('.edu-start').value = edu.startDate || '';
        card.querySelector('.edu-end').value = edu.endDate || '';

        // Input listeners
        card.querySelectorAll('input').forEach(input => {
            input.addEventListener('change', () => updateEducation(index, card));
        });

        // Remove button
        card.querySelector('.btn-remove').addEventListener('click', () => {
            profileData.education.splice(index, 1);
            renderEducationList(profileData.education);
        });

        container.appendChild(clone);
    });
}

function updateEducation(index, card) {
    profileData.education[index] = {
        institution: card.querySelector('.edu-institution').value,
        degree: card.querySelector('.edu-degree').value,
        major: card.querySelector('.edu-major').value,
        gpa: card.querySelector('.edu-gpa').value,
        startDate: card.querySelector('.edu-start').value,
        endDate: card.querySelector('.edu-end').value
    };
}

function renderExperienceList(experience) {
    const container = document.getElementById('experience-list');
    container.innerHTML = '';

    experience.forEach((exp, index) => {
        const template = document.getElementById('experience-template');
        const clone = template.content.cloneNode(true);
        const card = clone.querySelector('.item-card');
        card.dataset.index = index;

        card.querySelector('.exp-company').value = exp.company || '';
        card.querySelector('.exp-title').value = exp.title || '';
        card.querySelector('.exp-start').value = exp.startDate || '';
        card.querySelector('.exp-end').value = exp.endDate || '';
        card.querySelector('.exp-description').value = exp.description || '';

        // Input listeners
        card.querySelectorAll('input, textarea').forEach(input => {
            input.addEventListener('change', () => updateExperience(index, card));
        });

        // Remove button
        card.querySelector('.btn-remove').addEventListener('click', () => {
            profileData.experience.splice(index, 1);
            renderExperienceList(profileData.experience);
        });

        container.appendChild(clone);
    });
}

function updateExperience(index, card) {
    profileData.experience[index] = {
        company: card.querySelector('.exp-company').value,
        title: card.querySelector('.exp-title').value,
        startDate: card.querySelector('.exp-start').value,
        endDate: card.querySelector('.exp-end').value,
        description: card.querySelector('.exp-description').value
    };
}

function renderSkillsList(skills) {
    const container = document.getElementById('skills-list');
    container.innerHTML = '';

    skills.forEach((skill, index) => {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.innerHTML = `${skill}<span class="remove-tag">×</span>`;
        tag.querySelector('.remove-tag').addEventListener('click', () => {
            profileData.skills.splice(index, 1);
            renderSkillsList(profileData.skills);
        });
        container.appendChild(tag);
    });
}

async function saveProfile() {
    // Gather form data
    profileData.contact = {
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value
    };

    profileData.links = {
        linkedin: document.getElementById('linkedin').value,
        github: document.getElementById('github').value,
        portfolio: document.getElementById('portfolio').value
    };

    try {
        updateStatus('Saving...');
        await chrome.runtime.sendMessage({ type: 'UPDATE_PROFILE', data: profileData });
        updateStatus('Profile saved!', 'success');
        setTimeout(() => updateStatus('Ready'), 2000);
    } catch (error) {
        console.error('Failed to save profile:', error);
        updateStatus('Save failed', 'error');
    }
}

// ========== Resume ==========
let parsedResumeData = null;

function initResume() {
    const uploadArea = document.getElementById('upload-area');
    const resumeInput = document.getElementById('resume-input');
    const browseBtn = document.getElementById('browse-btn');

    browseBtn.addEventListener('click', () => resumeInput.click());
    uploadArea.addEventListener('click', (e) => {
        if (e.target !== browseBtn) resumeInput.click();
    });

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handleResumeUpload(file);
    });

    resumeInput.addEventListener('change', () => {
        if (resumeInput.files[0]) handleResumeUpload(resumeInput.files[0]);
    });

    // Import buttons
    document.getElementById('cancel-import').addEventListener('click', () => {
        parsedResumeData = null;
        document.getElementById('resume-preview').classList.add('hidden');
        showUploadStatus('');
    });

    document.getElementById('confirm-import').addEventListener('click', confirmResumeImport);
}

async function handleResumeUpload(file) {
    const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    const validExtensions = ['pdf', 'docx', 'doc', 'txt'];
    const ext = file.name.split('.').pop().toLowerCase();

    if (!validExtensions.includes(ext)) {
        showUploadStatus('Unsupported file type', 'error');
        return;
    }

    showUploadStatus('Parsing resume...', 'loading');

    try {
        // Read file content
        const text = await extractTextFromFile(file);

        if (!text || text.length < 50) {
            throw new Error('Could not extract text from file');
        }

        // Send to background for LLM parsing
        const response = await chrome.runtime.sendMessage({
            type: 'PARSE_RESUME',
            data: { text, fileName: file.name }
        });

        if (response.success && response.data) {
            parsedResumeData = response.data;
            showResumePreview(parsedResumeData);
            showUploadStatus('Resume parsed successfully!', 'success');
        } else {
            throw new Error(response.error || 'Failed to parse resume');
        }
    } catch (error) {
        console.error('Resume upload error:', error);
        showUploadStatus(error.message, 'error');
    }
}

async function extractTextFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'txt') {
        return await file.text();
    }

    // For PDF files, use pdf.js
    if (ext === 'pdf') {
        if (window.pdfjsLib) {
            try {
                // Set worker source
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = '../../lib/pdf.worker.min.js';

                const arrayBuffer = await file.arrayBuffer();
                const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
                const pdf = await loadingTask.promise;

                let textParts = [];
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    textParts.push(pageText);
                }
                return textParts.join('\n\n');
            } catch (e) {
                console.error('PDF parsing error:', e);
                throw new Error(`PDF parsing failed: ${e.message}`);
            }
        } else {
            console.error('pdf.js library not loaded');
        }
    }

    // For DOCX, use mammoth.js
    if (ext === 'docx' || ext === 'doc') {
        if (window.mammoth) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const result = await window.mammoth.extractRawText({ arrayBuffer });
                return result.value;
            } catch (e) {
                console.error('DOCX parsing error:', e);
                throw new Error(`DOCX parsing failed: ${e.message}`);
            }
        } else {
            console.error('mammoth.js library not loaded');
        }
    }

    // Fallback: try to read as text (works for some text-based files)
    try {
        const text = await file.text();
        // Check if it looks like binary garbage
        if (text && !/[\x00-\x08\x0E-\x1F]/.test(text.substring(0, 1000))) {
            return text;
        }
    } catch (e) {
        console.warn('Could not read file as text:', e);
    }

    // Ultimate fallback: return error guidance
    throw new Error(`Cannot extract text from ${ext.toUpperCase()} file. Text extraction library not available.`);
}

// Helper functions loadPDFJS and loadMammoth are no longer needed


function showUploadStatus(message, type = '') {
    const status = document.getElementById('upload-status');
    if (!message) {
        status.classList.add('hidden');
        return;
    }

    status.classList.remove('hidden', 'loading', 'success', 'error');
    if (type) status.classList.add(type);

    const icons = { loading: '⏳', success: '✅', error: '❌' };
    status.querySelector('.status-icon').textContent = icons[type] || '';
    status.querySelector('.status-text').textContent = message;
}

function showResumePreview(data) {
    const preview = document.getElementById('resume-preview');
    const content = document.getElementById('preview-content');

    let html = '<div style="font-size: 11px;">';

    if (data.contact?.firstName || data.contact?.lastName) {
        html += `<p><strong>Name:</strong> ${data.contact.firstName || ''} ${data.contact.lastName || ''}</p>`;
    }
    if (data.contact?.email) html += `<p><strong>Email:</strong> ${data.contact.email}</p>`;
    if (data.education?.length) {
        html += `<p><strong>Education:</strong> ${data.education.length} entries</p>`;
    }
    if (data.experience?.length) {
        html += `<p><strong>Experience:</strong> ${data.experience.length} entries</p>`;
    }
    if (data.skills?.length) {
        html += `<p><strong>Skills:</strong> ${data.skills.slice(0, 5).join(', ')}${data.skills.length > 5 ? '...' : ''}</p>`;
    }

    html += '</div>';
    content.innerHTML = html;
    preview.classList.remove('hidden');
}

async function confirmResumeImport() {
    if (!parsedResumeData) return;

    try {
        // Merge with existing profile
        const merged = mergeProfiles(profileData, parsedResumeData);
        profileData = merged;

        await chrome.runtime.sendMessage({ type: 'UPDATE_PROFILE', data: profileData });

        // Update UI
        populateProfileForm(profileData);
        parsedResumeData = null;
        document.getElementById('resume-preview').classList.add('hidden');
        showUploadStatus('');

        // Switch to profile tab
        document.querySelector('[data-tab="profile"]').click();
        updateStatus('Resume imported!', 'success');
        setTimeout(() => updateStatus('Ready'), 2000);
    } catch (error) {
        console.error('Import error:', error);
        updateStatus('Import failed', 'error');
    }
}

function mergeProfiles(existing, newData) {
    return {
        contact: { ...existing.contact, ...newData.contact },
        links: { ...existing.links, ...newData.links },
        education: newData.education?.length ? newData.education : existing.education,
        experience: newData.experience?.length ? newData.experience : existing.experience,
        skills: [...new Set([...(existing.skills || []), ...(newData.skills || [])])],
        certifications: newData.certifications || existing.certifications || [],
        projects: newData.projects || existing.projects || [],
        customFields: { ...existing.customFields, ...newData.customFields }
    };
}

// ========== Settings ==========
function initSettings() {
    loadSettings();

    // API key visibility toggle
    document.getElementById('toggle-key').addEventListener('click', () => {
        const input = document.getElementById('api-key');
        input.type = input.type === 'password' ? 'text' : 'password';
    });

    // Provider change
    document.getElementById('llm-provider').addEventListener('change', updateModelOptions);

    // Validate API key
    document.getElementById('validate-key').addEventListener('click', validateApiKey);

    // Save settings
    document.getElementById('save-settings').addEventListener('click', saveSettings);

    // Export/Import
    document.getElementById('export-data').addEventListener('click', exportData);
    document.getElementById('import-data').addEventListener('click', () => {
        document.getElementById('import-input').click();
    });
    document.getElementById('import-input').addEventListener('change', importData);
    document.getElementById('clear-data').addEventListener('click', clearData);
}

async function validateApiKey() {
    const apiKey = document.getElementById('api-key').value.trim();
    const provider = document.getElementById('llm-provider').value;
    const model = document.getElementById('llm-model').value;

    if (!apiKey) {
        showValidationStatus('Please enter an API key', 'invalid');
        return;
    }

    showValidationStatus('Validating...', 'validating');

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'VALIDATE_API_KEY',
            data: { apiKey, provider, model }
        });

        if (response.success) {
            showValidationStatus('✅ API key is valid!', 'valid');
        } else {
            showValidationStatus(`❌ ${response.error || 'Invalid API key'}`, 'invalid');
        }
    } catch (error) {
        console.error('Validation error:', error);
        showValidationStatus('❌ Validation failed', 'invalid');
    }
}

function showValidationStatus(message, type) {
    const status = document.getElementById('validation-status');
    status.classList.remove('hidden', 'validating', 'valid', 'invalid');
    status.classList.add(type);

    const icons = { validating: '⏳', valid: '✅', invalid: '❌' };
    status.querySelector('.validation-icon').textContent = type === 'validating' ? icons.validating : '';
    status.querySelector('.validation-text').textContent = message;
}

async function loadSettings() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        const settings = response.settings || {};

        document.getElementById('llm-provider').value = settings.provider || 'openai';
        document.getElementById('api-key').value = settings.apiKey || '';
        updateModelOptions();
        if (settings.model) {
            document.getElementById('llm-model').value = settings.model;
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

function updateModelOptions() {
    const provider = document.getElementById('llm-provider').value;
    const openaiGroup = document.getElementById('openai-models');
    const anthropicGroup = document.getElementById('anthropic-models');
    const geminiGroup = document.getElementById('gemini-models');

    // Hide all groups first
    openaiGroup.style.display = 'none';
    anthropicGroup.style.display = 'none';
    if (geminiGroup) geminiGroup.style.display = 'none';

    // Show the selected provider's group and set default model
    if (provider === 'openai') {
        openaiGroup.style.display = '';
        document.getElementById('llm-model').value = 'gpt-4o-mini';
    } else if (provider === 'anthropic') {
        anthropicGroup.style.display = '';
        document.getElementById('llm-model').value = 'claude-3-haiku-20240307';
    } else if (provider === 'gemini') {
        if (geminiGroup) geminiGroup.style.display = '';
        document.getElementById('llm-model').value = 'gemini-2.5-flash';
    }
}

async function saveSettings() {
    const settings = {
        provider: document.getElementById('llm-provider').value,
        model: document.getElementById('llm-model').value,
        apiKey: document.getElementById('api-key').value
    };

    try {
        updateStatus('Saving...');
        await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', data: settings });
        updateStatus('Settings saved!', 'success');
        setTimeout(() => updateStatus('Ready'), 2000);
    } catch (error) {
        console.error('Failed to save settings:', error);
        updateStatus('Save failed', 'error');
    }
}

async function exportData() {
    try {
        const data = JSON.stringify({ profile: profileData, exportedAt: new Date().toISOString() }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `smart-job-autofill-backup-${Date.now()}.json`;
        a.click();

        URL.revokeObjectURL(url);
        updateStatus('Data exported!', 'success');
        setTimeout(() => updateStatus('Ready'), 2000);
    } catch (error) {
        console.error('Export error:', error);
        updateStatus('Export failed', 'error');
    }
}

async function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (data.profile) {
            profileData = data.profile;
            await chrome.runtime.sendMessage({ type: 'UPDATE_PROFILE', data: profileData });
            populateProfileForm(profileData);
            updateStatus('Data imported!', 'success');
        }
    } catch (error) {
        console.error('Import error:', error);
        updateStatus('Import failed', 'error');
    }

    e.target.value = '';
    setTimeout(() => updateStatus('Ready'), 2000);
}

async function clearData() {
    if (!confirm('Are you sure you want to clear all data? This cannot be undone.')) return;

    try {
        profileData = getDefaultProfile();
        await chrome.runtime.sendMessage({ type: 'UPDATE_PROFILE', data: profileData });
        await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', data: { apiKey: '', provider: 'openai', model: 'gpt-4o-mini' } });

        populateProfileForm(profileData);
        document.getElementById('api-key').value = '';

        updateStatus('Data cleared!', 'success');
        setTimeout(() => updateStatus('Ready'), 2000);
    } catch (error) {
        console.error('Clear error:', error);
        updateStatus('Clear failed', 'error');
    }
}

// ========== Status ==========
function updateStatus(text, type = '') {
    const indicator = document.getElementById('status-indicator');
    const dot = indicator.querySelector('.dot');
    const textEl = indicator.querySelector('.text');

    textEl.textContent = text;

    const colors = { success: '#10b981', error: '#ef4444', '': '#10b981' };
    dot.style.background = colors[type] || colors[''];
}
