/**
 * LLM Orchestrator - Manages API calls to OpenAI/Anthropic/Gemini
 * Handles batching, retries, and fail-safe fallbacks
 */

import { FIELD_MAPPING_PROMPT, LONG_FORM_PROMPT, FIELD_GENERATE_PROMPT, RESUME_STRUCTURE_PROMPT } from './prompts.js';

export class LLMOrchestrator {
    constructor() {
        this.maxRetries = 2;
        this.timeout = 30000;
        this.batchSize = 10;
    }

    /**
     * Batch map fields to values using LLM
     * Now sends full profile and expects actual values back
     */
    async batchMapFields(fields, profile, settings) {
        if (!fields.length) return [];

        const batches = this.createBatches(fields, this.batchSize);
        const allMappings = [];

        for (const batch of batches) {
            try {
                const mappings = await this.mapFieldBatch(batch, profile, settings);
                allMappings.push(...mappings);
            } catch (error) {
                console.error('[LLM] Batch mapping failed:', error);
            }
        }

        return allMappings;
    }

    /**
     * Map a single batch of fields
     */
    async mapFieldBatch(fields, profile, settings) {
        const prompt = this.buildFieldMappingPrompt(fields, profile);
        const response = await this.callLLM(prompt, settings);

        if (!response) return [];

        try {
            const parsed = this.extractJSON(response);
            if (!parsed) return [];
            return Array.isArray(parsed) ? parsed : parsed.mappings || [];
        } catch (error) {
            console.error('[LLM] Failed to parse mapping response:', error);
            return [];
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
        const prompt = this.buildFieldGeneratePrompt(fieldInfo, userPrompt, profile);
        const response = await this.callLLM(prompt, settings);

        if (!response) {
            return { value: null, confidence: 0, error: 'LLM call failed' };
        }

        try {
            const parsed = this.extractJSON(response);
            if (parsed) {
                return {
                    value: parsed.value || parsed.answer || parsed.response || response,
                    confidence: parsed.confidence || 0.85
                };
            }
            return { value: response.trim(), confidence: 0.8 };
        } catch {
            return { value: response.trim(), confidence: 0.8 };
        }
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
            hints: f.hints?.slice(0, 5) || [],
            type: f.type,
            options: f.options?.slice(0, 20) || []
        }));

        return FIELD_MAPPING_PROMPT
            .replace('{FIELDS}', JSON.stringify(fieldsList, null, 2))
            .replace('{PROFILE}', JSON.stringify(profile, null, 2));
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
     * Build field generation prompt for "Generate with AI" feature
     */
    buildFieldGeneratePrompt(fieldInfo, userPrompt, profile) {
        // Gather some page context
        const pageTitle = typeof document !== 'undefined' ? document.title : '';
        const pageContext = pageTitle || 'Job application page';

        return FIELD_GENERATE_PROMPT
            .replace('{USER_PROMPT}', userPrompt || 'Generate appropriate content for this field')
            .replace('{FIELD_LABEL}', fieldInfo.label || 'Unknown field')
            .replace('{FIELD_TYPE}', fieldInfo.type || 'text')
            .replace('{MAX_LENGTH}', String(fieldInfo.maxLength || 'No limit'))
            .replace('{PROFILE}', JSON.stringify(profile, null, 2))
            .replace('{PAGE_CONTEXT}', pageContext);
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
                if (attempt === this.maxRetries) return null;
                await this.delay(1000 * (attempt + 1));
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
                throw new Error(`OpenAI API error: ${response.status}`);
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
                throw new Error(`Anthropic API error: ${response.status}`);
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
                throw new Error(`Gemini API error: ${response.status}`);
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
