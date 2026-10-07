/**
 * LLM Orchestrator - Manages API calls to OpenAI/Anthropic/Gemini
 * Handles batching, retries, and fail-safe fallbacks
 */

import { FIELD_MAPPING_PROMPT, LONG_FORM_PROMPT, RESUME_STRUCTURE_PROMPT } from './prompts.js';

export class LLMOrchestrator {
    constructor() {
        this.maxRetries = 2;
        this.timeout = 30000;
        this.batchSize = 10;
        this.mappingCache = new Map();
        this.mappingInFlight = new Map();
        this.providerCooldowns = new Map();
        this.cacheTTL = 30 * 60 * 1000;
    }

    /**
     * Batch map fields to values using LLM
     * Now sends full profile and expects actual values back
     */
    async batchMapFields(fields, profile, settings) {
        if (!fields.length) return [];

        const batches = this.createBatches(fields, this.batchSize);
        const allMappings = [];
        const failures = [];
        let completedBatches = 0;

        for (const batch of batches) {
            try {
                const mappings = await this.mapFieldBatch(batch, profile, settings);
                allMappings.push(...mappings);
                completedBatches++;
            } catch (error) {
                console.error('[LLM] Batch mapping failed:', error);
                failures.push(error);
                if (error.status === 429) break;
            }
        }

        if (!completedBatches && failures.length) throw failures[0];
        return allMappings;
    }

    /**
     * Map a single batch of fields
     */
    async mapFieldBatch(fields, profile, settings) {
        // Stable IDs let cached answers survive page refreshes and different tabs.
        const canonical = fields.map((field, index) => ({...field, id:`field-${index}`}));
        const key = JSON.stringify([settings.provider, settings.model, settings.apiKey, profile,
            canonical]);
        let cached = this.mappingCache.get(key);
        if (cached && Date.now() - cached.time >= this.cacheTTL) {
            this.mappingCache.delete(key);
            cached = null;
        }
        let mappings;
        if (cached) mappings = cached.mappings;
        else {
            let request = this.mappingInFlight.get(key);
            if (!request) {
                request = this.requestFieldBatch(canonical, profile, settings);
                this.mappingInFlight.set(key, request);
            }
            try {
                mappings = await request;
                if (mappings.length) this.mappingCache.set(key, {time:Date.now(), mappings});
                if (this.mappingCache.size > 50) this.mappingCache.delete(this.mappingCache.keys().next().value);
            } finally { this.mappingInFlight.delete(key); }
        }
        return mappings.flatMap(mapping => {
            const index = canonical.findIndex(field => field.id === mapping.fieldId);
            return index < 0 ? [] : [{...mapping, fieldId:fields[index].id}];
        });
    }

    async requestFieldBatch(fields, profile, settings) {
        const prompt = this.buildFieldMappingPrompt(fields, profile);
        const response = await this.callLLM(prompt, settings);

        if (!response) throw new Error('AI returned an empty response; check provider settings and connection');

        try {
            const parsed = this.extractJSON(response);
            if (!parsed) throw new Error('AI response was not valid JSON');
            const mappings = Array.isArray(parsed) ? parsed : parsed.mappings || parsed.answers ||
                (fields.length === 1 && Object.prototype.hasOwnProperty.call(parsed,'value') ? [{...parsed,fieldId:fields[0].id}] : null);
            if (!Array.isArray(mappings)) throw new Error('AI response did not contain a mappings array');
            return mappings.flatMap(mapping => {
                const field = fields.find(field=>field.id === mapping.fieldId);
                if (!field) return [];
                const answer = this.normalizeFieldAnswer(field, mapping, profile);
                return this.validateFieldAnswer(field, answer, profile).value != null ? [answer] : [];
            });
        } catch (error) {
            console.error('[LLM] Failed to parse mapping response:', error);
            throw error;
        }
    }

    /**
     * Generate long-form answer
     */
    async generateLongForm(fieldInfo, profile, settings, regenerate = false) {
        const prompt = this.buildLongFormPrompt(fieldInfo, profile, regenerate);
        const response = await this.callLLM(prompt, settings);

        if (!response) {
            return { value: null, confidence: 0, error: 'LLM call failed' };
        }

        try {
            const parsed = this.extractJSON(response);
            if (parsed) {
                return {
                    value: parsed.answer || parsed.response || parsed.value || response,
                    confidence: parsed.confidence || 0.8
                };
            }
            return { value: response.trim(), confidence: 0.75 };
        } catch {
            return { value: response.trim(), confidence: 0.75 };
        }
    }

    /**
     * Generate content for a specific field based on user instructions
     * Used by the "Generate with AI" feature
     */
    async generateFieldContent(fieldInfo, userPrompt, profile, settings) {
        const field = {...fieldInfo, id:fieldInfo.id || 'selected-field'};
        if (userPrompt?.trim()) field.userInstructions = userPrompt.trim();
        try {
            const mappings = await this.batchMapFields([field], profile, settings);
            return mappings[0] || {value:null,error:'No supported answer found. Save the missing profile preference or review the question.'};
        } catch (error) {
            return {value:null,error:error.message,retryAfterMs:error.retryAfterMs || 0};
        }
    }

    normalizeFieldAnswer(field, mapping, profile) {
        const answer = {...mapping};
        const options = field.optionDetails || [];
        // The original field-generation response may contain just a label/value.
        // Resolve it to the actual HTML option before the shared validator runs.
        const option = options.find(option => String(option.value) === String(answer.value) ||
            option.label.trim().toLowerCase() === String(answer.value).trim().toLowerCase());
        if (option) answer.value = option.value;
        const category = globalThis.FieldPolicy?.category(field);
        if (category) answer.category = category;
        if (category === 'previous_employment' && option) {
            const yesNo = option.label.trim().match(/^(yes|no)\b/i)?.[1];
            if (yesNo) {
                const selected = yesNo.toLowerCase() === 'yes' ? 'Yes' : 'No';
                const saved = globalThis.FieldPolicy.preference(category, profile);
                if (selected !== saved) return {...answer,value:null};
                if (answer.answer == null) answer.answer = selected;
                // Confidence comes from an exact option matching the explicit
                // saved answer/user default, rather than the model's prose score.
                answer.confidence = .95;
            }
        }
        return answer;
    }

    validateFieldAnswer(fieldInfo, parsed, profile) {
        if (parsed.value == null || parsed.value === '') return {value:null};
        if (globalThis.FieldPolicy && !globalThis.FieldPolicy.validate(fieldInfo, parsed, profile)) {
            return {value: null, error: 'This answer needs a saved profile fact, an available option, or manual review.'};
        }
        if (fieldInfo.type === 'checkbox') {
            const saved = String(parsed.profilePath || '').split('.').reduce((data, key) => data?.[key], profile);
            if (typeof parsed.value !== 'boolean' || typeof saved !== 'boolean' ||
                parsed.answer !== saved || parsed.value !== saved) {
                return {value: null, error: 'Save an explicit yes/no preference for this checkbox first.'};
            }
        }
        const text = String(parsed.value);
        const c = fieldInfo.constraints || {};
        if ((c.maxLength != null && text.length > c.maxLength) ||
            (c.minLength != null && text.length < c.minLength)) {
            return {value: null, error: 'AI answer does not meet the field length limits.'};
        }
        if (c.pattern) {
            try {
                if (!new RegExp(`^(?:${c.pattern})$`, 'v').test(text)) {
                    return {value: null, error: 'AI answer does not match the required format.'};
                }
            } catch { return {value: null, error: 'Review this field: its format could not be validated.'}; }
        }
        const inputType = fieldInfo.inputType || fieldInfo.type;
        if (['number', 'date', 'month', 'time'].includes(inputType)) {
            const numeric = inputType === 'number';
            const value = numeric ? Number(parsed.value) : text;
            if ((numeric && !Number.isFinite(value)) ||
                (c.min != null && c.min !== '' && value < (numeric ? Number(c.min) : c.min)) ||
                (c.max != null && c.max !== '' && value > (numeric ? Number(c.max) : c.max))) {
                return {value: null, error: 'AI answer is outside the field limits.'};
            }
        }
        return parsed;
    }

    /**
     * Structure resume text into profile format
     */
    async structureResume(resumeText, settings) {
        const prompt = this.buildResumePrompt(resumeText);
        const response = await this.callLLM(prompt, settings);

        if (!response) {
            throw new Error('LLM returned empty response');
        }

        try {
            const jsonData = this.extractJSON(response);
            if (!jsonData) {
                console.error('[LLM] Failed to extract JSON from response');
                console.error('[LLM] Raw response:', response);
                throw new Error('Failed to parse LLM response as JSON');
            }
            return jsonData;
        } catch (error) {
            console.error('[LLM] Failed to parse resume structure:', error);
            console.error('[LLM] Raw response:', response);
            throw new Error('Failed to parse LLM response as JSON');
        }
    }

    /**
     * Build field mapping prompt — now sends full profile data
     */
    buildFieldMappingPrompt(fields, profile) {
        const fieldsList = fields.map(f => ({
            id: f.id,
            label: f.label,
            name:f.name, inputType:f.inputType, currentValue:f.currentValue,
            pageContext:f.pageContext, userInstructions:f.userInstructions,
            hints: f.hints?.slice(0, 5) || [],
            type: f.type,
            options: f.options || [],
            optionDetails:f.optionDetails || [],
            placeholder:f.placeholder || '',
            context:f.context || '',
            constraints:f.constraints || {},
            isLongForm:!!f.isLongForm,
            category:f.category || null
        }));

        const values = {FIELDS:JSON.stringify(fieldsList, null, 2), PROFILE:JSON.stringify(profile, null, 2)};
        return FIELD_MAPPING_PROMPT.replace(/\{(FIELDS|PROFILE)\}/g, (_, key) => values[key]);
    }

    /**
     * Build long-form prompt
     */
    buildLongFormPrompt(fieldInfo, profile, regenerate) {
        const context = {
            question: fieldInfo.label || fieldInfo.hints || 'Unknown question',
            maxLength: fieldInfo.maxLength || 500,
            experience: profile.experience?.[0] || null,
            skills: profile.skills?.slice(0, 10) || [],
            education: profile.education?.[0] || null
        };

        return LONG_FORM_PROMPT
            .replace('{CONTEXT}', JSON.stringify(context, null, 2))
            .replace('{REGENERATE}', regenerate ? 'Generate a different response than before.' : '');
    }

    /**
     * Build resume structuring prompt
     */
    buildResumePrompt(resumeText) {
        return RESUME_STRUCTURE_PROMPT.replace('{RESUME_TEXT}', resumeText);
    }

    /**
     * Call LLM API
     */
    async callLLM(prompt, settings) {
        const { apiKey, provider, model } = settings;

        if (!apiKey) return null;
        const cooldownKey = JSON.stringify([provider, model, apiKey]);
        const cooldown = this.providerCooldowns.get(cooldownKey);
        if (cooldown && Date.now() < cooldown.until) {
            const error = new Error(`AI rate limit: wait ${Math.ceil((cooldown.until-Date.now())/1000)} seconds before retrying`);
            error.status = 429;
            error.retryAfterMs = cooldown.until-Date.now();
            throw error;
        }

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                if (provider === 'anthropic') {
                    return await this.callAnthropic(prompt, apiKey, model);
                } else if (provider === 'gemini') {
                    return await this.callGemini(prompt, apiKey, model);
                } else {
                    return await this.callOpenAI(prompt, apiKey, model);
                }
            } catch (error) {
                console.error(`[LLM] Attempt ${attempt + 1} failed:`, error);
                if (error.status === 429) {
                    const retryAfterMs = Math.max(60000, error.retryAfterMs || 0);
                    this.providerCooldowns.set(cooldownKey, {until:Date.now()+retryAfterMs});
                    error.retryAfterMs = retryAfterMs;
                    throw error;
                }
                // Invalid requests/credentials need correction, not more calls.
                if ((error.status && error.status < 500 && error.status !== 408) || attempt === this.maxRetries) throw error;
                await this.delay(1000 * (2 ** attempt) + Math.floor(Math.random()*250));
            }
        }

        return null;
    }

    /**
     * Call OpenAI API
     */
    async callOpenAI(prompt, apiKey, model) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model || 'gpt-4o-mini',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    max_tokens: 1000
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = new Error(`OpenAI API error: ${response.status}`);
                error.status = response.status;
                throw error;
            }

            const data = await response.json();
            return data.choices?.[0]?.message?.content || null;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Call Anthropic API
     */
    async callAnthropic(prompt, apiKey, model) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: model || 'claude-3-haiku-20240307',
                    max_tokens: 1000,
                    messages: [{ role: 'user', content: prompt }]
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = new Error(`Anthropic API error: ${response.status}`);
                error.status = response.status;
                throw error;
            }

            const data = await response.json();
            return data.content?.[0]?.text || null;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Call Google Gemini API
     */
    async callGemini(prompt, apiKey, model) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        const modelName = model || 'gemini-1.5-flash';

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.7,
                            maxOutputTokens: 4096,
                            responseMimeType: 'application/json'
                        }
                    }),
                    signal: controller.signal
                }
            );

            clearTimeout(timeoutId);

            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                const error = new Error(`Gemini API error: ${response.status}${body.error?.message ? ` — ${body.error.message}` : ''}`);
                error.status = response.status;
                const retry = body.error?.details?.find(detail => detail.retryDelay)?.retryDelay;
                const header = response.headers?.get('Retry-After');
                const headerMs = header ? (/^\d+(\.\d+)?$/.test(header) ? Number(header)*1000 : Math.max(0, Date.parse(header)-Date.now())) : 0;
                error.retryAfterMs = Math.max(parseFloat(retry || '0')*1000, headerMs || 0);
                throw error;
            }

            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Create batches of fields
     */
    createBatches(items, size) {
        const batches = [];
        for (let i = 0; i < items.length; i += size) {
            batches.push(items.slice(i, i + size));
        }
        return batches;
    }

    /**
     * Delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Extract JSON from LLM response, handling various formats
     */
    extractJSON(response) {
        if (!response) return null;

        let text = response.trim();

        // Strategy 1: Try parsing as-is
        try {
            return JSON.parse(text);
        } catch (e) {
            // Continue to other strategies
        }

        // Strategy 2: Remove markdown code blocks
        const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
        if (codeBlockMatch) {
            try {
                return JSON.parse(codeBlockMatch[1].trim());
            } catch (e) {
                // Continue to other strategies
            }
        }

        // Strategy 3: Find JSON object in the text
        const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
        if (jsonObjectMatch) {
            try {
                return JSON.parse(jsonObjectMatch[0]);
            } catch (e) {
                // Continue to other strategies
            }
        }

        // Strategy 4: Find JSON array in the text
        const jsonArrayMatch = text.match(/\[[\s\S]*\]/);
        if (jsonArrayMatch) {
            try {
                return JSON.parse(jsonArrayMatch[0]);
            } catch (e) {
                // Failed all strategies
            }
        }

        return null;
    }
}
