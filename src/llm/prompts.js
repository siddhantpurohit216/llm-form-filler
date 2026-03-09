/**
 * LLM Prompt Templates
 * Centralized prompts for field mapping, long-form generation, field generation, and resume parsing
 */

export const FIELD_MAPPING_PROMPT = `You are an expert at filling job application forms using user profile data.

Given the following form fields and user profile, determine the actual value to fill into each field.

FORM FIELDS:
{FIELDS}

USER PROFILE:
{PROFILE}

For each field, return a JSON array with the VALUE to fill (not a profile path):
[
  {
    "fieldId": "the field id",
    "value": "the actual value to fill into the field",
    "confidence": 0.0 to 1.0,
    "reason": "brief explanation"
  }
]

Rules:
- Only include fields you can confidently fill (confidence >= 0.6)
- Return the actual value, not a path reference
- For dropdown fields, return a value that matches one of the provided options
- For yes/no fields, return "Yes" or "No"
- For checkboxes, return "true" or "false"
- Be precise with names, emails, phone numbers — use exact values from the profile
- For fields with isLongForm=true (text areas for essays/cover letters/open questions), write a full, professional, multi-sentence response using the profile data as context
- Never generate executable code
- Return ONLY the JSON array, no other text`;

export const LONG_FORM_PROMPT = `You are a professional career advisor helping someone fill out a job application.

CONTEXT:
{CONTEXT}

{REGENERATE}

Write a professional, compelling response to the question. Guidelines:
- Be concise but substantive
- Use specific examples from the provided experience/skills
- Match the tone to a professional job application
- Stay within the character limit if specified
- Be authentic and avoid clichés

Return your response as JSON:
{
  "answer": "your response text",
  "confidence": 0.8
}

Return ONLY the JSON, no other text.`;

export const FIELD_GENERATE_PROMPT = `You are a professional career advisor. A user is filling out a job application and wants help generating content for a specific form field.

USER INSTRUCTIONS:
{USER_PROMPT}

FIELD INFORMATION:
Label: {FIELD_LABEL}
Type: {FIELD_TYPE}
Max Length: {MAX_LENGTH}

USER PROFILE:
{PROFILE}

PAGE CONTEXT (if available):
{PAGE_CONTEXT}

Generate content based on the user's instructions. Guidelines:
- Follow the user's specific instructions precisely
- Use information from the user profile to personalize the content
- Be professional and compelling
- Stay within any character limits
- Never generate executable code

Return your response as JSON:
{
  "value": "the generated text content",
  "confidence": 0.85
}

Return ONLY the JSON, no other text.`;

export const RESUME_STRUCTURE_PROMPT = `Parse the following resume text and extract structured data.

RESUME TEXT:
{RESUME_TEXT}

Extract and return a JSON object with this structure:
{
  "contact": {
    "firstName": "",
    "lastName": "",
    "email": "",
    "phone": "",
    "address": "",
    "city": "",
    "state": "",
    "zipCode": "",
    "country": ""
  },
  "links": {
    "linkedin": "",
    "github": "",
    "portfolio": ""
  },
  "education": [
    {
      "institution": "",
      "degree": "",
      "major": "",
      "gpa": "",
      "startDate": "",
      "endDate": "",
      "location": ""
    }
  ],
  "experience": [
    {
      "company": "",
      "title": "",
      "location": "",
      "startDate": "",
      "endDate": "",
      "current": false,
      "description": "",
      "achievements": []
    }
  ],
  "skills": [],
  "certifications": [],
  "projects": []
}

Rules:
- Extract as much information as possible
- Use ISO date format (YYYY-MM) for dates when possible
- For skills, extract individual skill names as strings
- Return ONLY the JSON object, no other text`;
