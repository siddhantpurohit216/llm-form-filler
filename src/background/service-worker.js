/**
 * Background Service Worker - LLM Orchestration & Message Handling
 * Handles communication between content script, popup, and LLM APIs
 */

import { LLMOrchestrator } from '../llm/orchestrator.js';
import '../utils/resume-profile.js';
import '../utils/field-policy.js';
import '../core/workday-questions.js';
import '../core/semantic.js';
import {activate,rememberSite,registerSites,pageStatus,triggerPage} from './activation.js';
chrome.runtime.onInstalled.addListener(() => registerSites().catch(console.error));
chrome.runtime.onStartup.addListener(() => registerSites().catch(console.error));
chrome.permissions.onRemoved.addListener(() => registerSites().catch(console.error));
chrome.tabs.onRemoved.addListener(tabId=>chrome.storage.session.remove('sjaFrames:'+tabId));

// Initialize LLM orchestrator
const llmOrchestrator = new LLMOrchestrator();

// IndexedDB for background context
let db = null;
const DB_NAME = 'SmartJobAutofillDB';
const DB_VERSION = 1;

/**
 * Initialize IndexedDB
 */
async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains('userProfile')) {
                const store = database.createObjectStore('userProfile', { keyPath: 'id' });
                store.createIndex('type', 'type', { unique: false });
            }
            if (!database.objectStoreNames.contains('customFields')) {
                database.createObjectStore('customFields', { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

/**
 * Get user profile from IndexedDB
 */
async function getProfile() {
    if (!db) await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction('userProfile', 'readonly');
        const store = tx.objectStore('userProfile');
        const request = store.get('main');

        request.onsuccess = () => {
            resolve(request.result?.data || getDefaultProfile());
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Save profile to IndexedDB
 */
async function saveProfile(profileData) {
    if (!db) await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction('userProfile', 'readwrite');
        const store = tx.objectStore('userProfile');
        const request = store.put({
            id: 'main',
            type: 'profile',
            data: profileData,
            updatedAt: new Date().toISOString()
        });

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Update a specific field in profile
 */
async function updateProfileField(path, value) {
    const profile = await getProfile();
    setNestedValue(profile, path, value);
    return saveProfile(profile);
}

/** Persist an explicitly saved field-to-meaning binding, never an AI guess. */
async function saveFieldAnswer(data) {
    const profile = await getProfile();
    const field=data.fieldInfo;
    const cachedIdentity=field && SemanticResolver.identify(field,profile);
    const identity=cachedIdentity || (data.intent && SemanticResolver.registry.some(item=>item.id===data.intent)
        ? {intent:data.intent,polarity:data.polarity || 1,qualifiers:data.qualifiers || {},confidence:1} : null);
    if (data.path.startsWith('customFields.')) profile.customFields={...profile.customFields,[data.path.slice('customFields.'.length)]:data.value};
    else setNestedValue(profile,data.path,data.value);
    if (identity && data.path.startsWith('customFields.')) {
        const label=data.path.slice('customFields.'.length);
        const entry=SemanticResolver.registry.find(item=>item.id===identity.intent);
        profile.customFieldMeta={...profile.customFieldMeta,[label]:{intent:identity.intent,type:entry?.type || 'text',
            scope:identity.qualifiers.employer || identity.qualifiers.country || identity.qualifiers.language || ''}};
    }
    await saveProfile(profile);
    if (field && identity && SemanticResolver.registry.some(item=>item.id===identity.intent)) {
        const {semanticQuestionBindings={}}=await chrome.storage.local.get('semanticQuestionBindings');
        semanticQuestionBindings[SemanticResolver.bindingKey(field)]={...identity,version:SemanticResolver.version,confirmed:true};
        const entries=Object.entries(semanticQuestionBindings).slice(-250);
        await chrome.storage.local.set({semanticQuestionBindings:Object.fromEntries(entries)});
    }
}

/**
 * Get settings from chrome.storage
 */
async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['apiKey', 'llmProvider', 'llmModel'], (result) => {
            resolve({
                apiKey: result.apiKey || '',
                provider: result.llmProvider || 'openai',
                model: result.llmModel || 'gpt-4o-mini'
            });
        });
    });
}

/**
 * Save settings to chrome.storage
 */
async function saveSettings(settings) {
    return new Promise((resolve) => {
        chrome.storage.local.set({
            apiKey: settings.apiKey,
            llmProvider: settings.provider,
            llmModel: settings.model
        }, () => resolve(true));
    });
}

/**
 * Default profile structure
 */
function getDefaultProfile() {
    return {
        contact: { firstName: '', lastName: '', email: '', phone: '', address: '', city: '', state: '', zipCode: '', country: '' },
        links: { linkedin: '', github: '', portfolio: '', other: [] },
        education: [],
        experience: [],
        skills: [],
        certifications: [],
        projects: [],
        customFields: {}
    };
}

/**
 * Set nested value in object
 */
function setNestedValue(obj, path, value) {
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (current[key] === undefined) {
            current[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
        }
        current = current[key];
    }
    current[keys[keys.length - 1]] = value;
    return obj;
}

/**
 * Message handler
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
        .then(sendResponse)
        .catch(error => {
            console.error('[Background] Error:', error);
            sendResponse({ error: error.message });
        });
    return true; // Keep channel open for async response
});

/**
 * Handle incoming messages
 */
async function handleMessage(message, sender) {
    console.log('[Background] Message received:', message.type);

    switch (message.type) {
        case 'GET_ACTIVE_FORM_STATUS':
            return pageStatus(message.data.tabId);
        case 'TRIGGER_ACTIVE_AUTOFILL':
            return triggerPage(message.data.tabId);
        case 'ACTIVATE_AUTOFILL':
            return activate(message.data || {},sender);
        case 'REMEMBER_AUTOFILL_SITE':
            return rememberSite(message.data.origin);
        case 'GET_PROFILE':
            return { profile: await getProfile(),bindings:(await chrome.storage.local.get('semanticQuestionBindings')).semanticQuestionBindings || {} };

        case 'UPDATE_PROFILE':
            await saveProfile(message.data);
            notifyContentScripts('PROFILE_UPDATED');
            return { success: true };

        case 'SAVE_TO_PROFILE':
            await saveFieldAnswer(message.data);
            notifyContentScripts('PROFILE_UPDATED');
            return { success: true };

        case 'GET_SETTINGS':
            return { settings: await getSettings() };

        case 'SAVE_SETTINGS':
            await saveSettings(message.data);
            return { success: true };

        case 'VALIDATE_API_KEY':
            return await validateApiKey(message.data);

        case 'LLM_BATCH_REQUEST':
            return await handleLLMBatchRequest(message.data);

        case 'LLM_GENERATE':
            return await handleLLMGenerate(message.data);

        case 'LLM_FIELD_GENERATE':
            return await handleLLMFieldGenerate(message.data);

        case 'LLM_SKILL_MATCH':
            try {
                return await llmOrchestrator.matchSkill(message.data?.skill,message.data?.options,await getSettings());
            } catch (error) {
                return {optionIndex:null,error:error.message,retryAfterMs:error.retryAfterMs || 0};
            }

        case 'PARSE_RESUME':
            return await handleResumeUpload(message.data);

        default:
            return { error: 'Unknown message type' };
    }
}

/**
 * Validate API key by making a test request
 */
async function validateApiKey(data) {
    const { apiKey, provider, model } = data;

    if (!apiKey) {
        return { success: false, error: 'No API key provided' };
    }

    try {
        const testPrompt = 'Say "ok" in one word.';
        let response;

        if (provider === 'openai') {
            response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model || 'gpt-4o-mini',
                    messages: [{ role: 'user', content: testPrompt }],
                    max_tokens: 5
                })
            });
        } else if (provider === 'anthropic') {
            response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: model || 'claude-3-haiku-20240307',
                    max_tokens: 5,
                    messages: [{ role: 'user', content: testPrompt }]
                })
            });
        } else if (provider === 'gemini') {
            const modelName = model || 'gemini-1.5-flash';
            response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: testPrompt }] }],
                        generationConfig: { maxOutputTokens: 5 }
                    })
                }
            );
        } else {
            return { success: false, error: 'Unknown provider' };
        }

        if (response.ok) {
            return { success: true };
        } else {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData.error?.message ||
                errorData.error?.error?.message ||
                `HTTP ${response.status}`;
            return { success: false, error: errorMessage };
        }
    } catch (error) {
        console.error('[Background] API validation error:', error);
        return { success: false, error: error.message || 'Connection failed' };
    }
}

/**
 * Handle batch LLM request for field mapping
 */
async function handleLLMBatchRequest(data) {
    const settings = await getSettings();

    if (!settings.apiKey) {
        console.log('[Background] No API key, skipping LLM');
        return { mappings: [], error: 'No API key configured' };
    }

    try {
        const profile = await getProfile();
        SemanticResolver.setBindings((await chrome.storage.local.get('semanticQuestionBindings')).semanticQuestionBindings);
        const mappings = await llmOrchestrator.batchMapFields(
            data.fields,
            profile,
            settings
        );
        return { mappings };
    } catch (error) {
        console.error('[Background] LLM batch request failed:', error);
        return { mappings: [], error: error.message, retryAfterMs:error.retryAfterMs || 0 };
    }
}

/**
 * Handle LLM generation for long-form fields
 */
async function handleLLMGenerate(data) {
    const settings = await getSettings();

    if (!settings.apiKey) {
        return { value: null, error: 'No API key configured' };
    }

    try {
        const profile = await getProfile();
        const result = await llmOrchestrator.generateLongForm(
            data.fieldInfo,
            profile,
            settings,
            data.regenerate
        );
        return result;
    } catch (error) {
        console.error('[Background] LLM generate failed:', error);
        return { value: null, error: error.message };
    }
}

/**
 * Handle field-level AI generation ("Generate with AI" feature)
 */
async function handleLLMFieldGenerate(data) {
    const settings = await getSettings();

    if (!settings.apiKey) {
        return { value: null, error: 'No API key configured' };
    }

    try {
        const profile = await getProfile();
        SemanticResolver.setBindings((await chrome.storage.local.get('semanticQuestionBindings')).semanticQuestionBindings);
        const result = await llmOrchestrator.generateFieldContent(
            data.fieldInfo,
            data.userPrompt,
            profile,
            settings
        );
        return result;
    } catch (error) {
        console.error('[Background] Field generate failed:', error);
        return { value: null, error: error.message };
    }
}

/**
 * Handle resume upload and parsing
 */
async function handleResumeUpload(data) {
    const settings = await getSettings();

    try {
        // Parse resume text using LLM if available
        if (settings.apiKey && data.text) {
            const structuredData = await llmOrchestrator.structureResume(
                data.text,
                settings
            );
            return { success: true, data: ResumeProfile.profile(structuredData) };
        }

        return { success: false, error: 'No API key or text provided' };
    } catch (error) {
        console.error('[Background] Resume parsing failed:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Notify all content scripts of changes
 */
function notifyContentScripts(type, data = {}) {
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type, data }).catch(() => { });
        });
    });
}

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
    console.log('[Background] Extension installed');
    await initDB();
});

// Keep service worker alive
chrome.runtime.onStartup.addListener(async () => {
    console.log('[Background] Extension started');
    await initDB();
});

console.log('[Background] Service worker loaded');
