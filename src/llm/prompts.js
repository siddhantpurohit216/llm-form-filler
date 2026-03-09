/**
 * LLM Prompt Templates
 * Centralized prompts for field mapping, long-form generation, and resume parsing
 */

export const FIELD_MAPPING_PROMPT = `You are an expert at mapping job application form fields to user profile data.

Given the following form fields and user profile summary, determine which profile path each field should be filled from.

FORM FIELDS:
{FIELDS}

USER PROFILE PATHS AVAILABLE:
{PROFILE}

For each field, return a JSON array with mappings in this exact format:
[
  {
    "fieldId": "the field id",
    "profilePath": "the dot-notation path in profile (e.g., contact.email, education[0].institution)",
    "confidence": 0.0 to 1.0,
    "reason": "brief explanation"
  }
]

Rules:
- Only include fields you can confidently map (confidence >= 0.6)
- Use exact profile paths like: contact.email, contact.phone, links.linkedin, education[0].degree
- For dropdown fields, consider the options when determining the mapping
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
