/**
 * Shared constants for the Smart Job Autofill extension
 * These are used across content scripts, background worker, and popup
 */

// Database configuration
const DB_CONFIG = {
  name: 'SmartJobAutofillDB',
  version: 1,
  stores: {
    profile: 'userProfile',
    customFields: 'customFields'
  }
};

// Confidence thresholds
const CONFIDENCE = {
  HIGH: 0.8,      // Auto-fill without LLM
  MEDIUM: 0.6,    // May need LLM verification
  LOW: 0.4,       // Requires LLM assistance
  UNCERTAIN: 0.2  // Cannot determine
};

// Confidence levels for UI
const CONFIDENCE_LEVEL = {
  EXACT: 'exact',        // 🟢 User-approved or exact match
  INFERRED: 'inferred',  // 🟡 LLM inferred
  UNCERTAIN: 'uncertain' // 🔴 Unresolved
};

// Field source types
const FIELD_SOURCE = {
  DETERMINISTIC: 'deterministic',
  LLM: 'llm',
  USER: 'user',
  CACHED: 'cached'
};

// Common field type mappings with synonyms
const FIELD_SYNONYMS = {
  // Contact information
  email: ['email', 'e-mail', 'email_address', 'emailaddress', 'mail'],
  phone: ['phone', 'telephone', 'tel', 'mobile', 'cell', 'cellphone', 'phone_number', 'phonenumber', 'contact_number'],

  // Personal information
  firstName: ['firstname', 'first_name', 'fname', 'given_name', 'givenname', 'first'],
  lastName: ['lastname', 'last_name', 'lname', 'surname', 'family_name', 'familyname', 'last'],
  fullName: ['fullname', 'full_name', 'name', 'your_name', 'candidate_name'],

  // Address
  address: ['address', 'street', 'street_address', 'streetaddress', 'address1', 'address_line_1'],
  city: ['city', 'town', 'municipality'],
  state: ['state', 'province', 'region', 'state_province'],
  zipCode: ['zip', 'zipcode', 'zip_code', 'postal', 'postalcode', 'postal_code'],
  country: ['country', 'nation', 'country_code'],

  // Professional links
  linkedin: ['linkedin', 'linkedin_url', 'linkedinurl', 'linkedin_profile'],
  github: ['github', 'github_url', 'githuburl', 'github_profile'],
  portfolio: ['portfolio', 'website', 'personal_website', 'personal_site', 'portfolio_url'],

  // Education
  school: ['school', 'university', 'college', 'institution', 'alma_mater'],
  degree: ['degree', 'qualification', 'education_level'],
  major: ['major', 'field_of_study', 'concentration', 'specialization'],
  graduationYear: ['graduation_year', 'grad_year', 'year_graduated', 'graduation_date'],
  gpa: ['gpa', 'grade_point_average', 'cgpa'],

  // Work experience
  company: ['company', 'employer', 'organization', 'company_name', 'current_employer'],
  jobTitle: ['job_title', 'jobtitle', 'title', 'position', 'role', 'designation'],
  startDate: ['start_date', 'startdate', 'from_date', 'date_from'],
  endDate: ['end_date', 'enddate', 'to_date', 'date_to'],

  // Application specific
  salary: ['salary', 'expected_salary', 'salary_expectation', 'compensation', 'desired_salary'],
  availability: ['availability', 'start_date', 'available_from', 'notice_period'],
  workAuthorization: ['work_authorization', 'visa_status', 'authorized_to_work', 'work_permit'],
  sponsorship: ['sponsorship', 'visa_sponsorship', 'require_sponsorship', 'need_sponsorship'],

  // Diversity (optional)
  gender: ['gender', 'sex'],
  ethnicity: ['ethnicity', 'race', 'ethnic_background'],
  veteran: ['veteran', 'veteran_status', 'military'],
  disability: ['disability', 'disability_status', 'disabled']
};

// Regex patterns for field detection
const FIELD_PATTERNS = {
  email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  phone: /^[\+]?[(]?[0-9]{1,3}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}$/,
  zipCode: /^\d{5}(-\d{4})?$|^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/,
  url: /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/,
  linkedin: /linkedin\.com\/in\/[\w-]+/i,
  github: /github\.com\/[\w-]+/i,
  date: /^\d{4}[-\/]\d{2}[-\/]\d{2}$|^\d{2}[-\/]\d{2}[-\/]\d{4}$/
};

// Default empty profile structure
const DEFAULT_PROFILE = {
  contact: {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    country: ''
  },
  links: {
    linkedin: '',
    github: '',
    portfolio: '',
    other: []
  },
  education: [],
  experience: [],
  skills: [],
  certifications: [],
  projects: [],
  customFields: {}
};

// Education entry template
const EDUCATION_TEMPLATE = {
  institution: '',
  degree: '',
  major: '',
  minor: '',
  gpa: '',
  startDate: '',
  endDate: '',
  location: '',
  achievements: []
};

// Experience entry template
const EXPERIENCE_TEMPLATE = {
  company: '',
  title: '',
  location: '',
  startDate: '',
  endDate: '',
  current: false,
  description: '',
  achievements: []
};

// Long-form question detection patterns
const LONG_FORM_PATTERNS = [
  /why\s+(do\s+)?you\s+want/i,
  /tell\s+us\s+about/i,
  /describe\s+(your|a\s+time)/i,
  /what\s+makes\s+you/i,
  /explain\s+(your|how|why)/i,
  /cover\s+letter/i,
  /additional\s+information/i,
  /anything\s+else/i,
  /experience\s+with/i,
  /strengths?\s+and\s+weaknesses?/i,
  /goals?\s+(and\s+)?objectives?/i,
  /why\s+should\s+we\s+hire/i,
  /what\s+are\s+your\s+career/i,
  /how\s+did\s+you\s+hear/i
];

// Minimum field count to trigger form detection
const MIN_FORM_FIELDS = 1;

// LLM configuration
const LLM_CONFIG = {
  providers: {
    openai: {
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      defaultModel: 'gpt-4o-mini'
    },
    anthropic: {
      name: 'Anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      defaultModel: 'claude-3-haiku-20240307'
    },
    gemini: {
      name: 'Google Gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
      defaultModel: 'gemini-1.5-flash'
    }
  },
  maxRetries: 2,
  timeout: 30000, // 30 seconds
  batchSize: 10   // Max fields per LLM call
};

// Message types for extension communication
const MESSAGE_TYPES = {
  // Content script → Background
  GET_PROFILE: 'GET_PROFILE',
  LLM_BATCH_REQUEST: 'LLM_BATCH_REQUEST',
  LLM_GENERATE: 'LLM_GENERATE',
  LLM_FIELD_GENERATE: 'LLM_FIELD_GENERATE',
  SAVE_TO_PROFILE: 'SAVE_TO_PROFILE',

  // Background → Content script
  PROFILE_DATA: 'PROFILE_DATA',
  LLM_RESPONSE: 'LLM_RESPONSE',
  SAVE_RESULT: 'SAVE_RESULT',

  // Popup → Background
  GET_SETTINGS: 'GET_SETTINGS',
  SAVE_SETTINGS: 'SAVE_SETTINGS',
  PARSE_RESUME: 'PARSE_RESUME',
  UPDATE_PROFILE: 'UPDATE_PROFILE'
};

// Export for use in different contexts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DB_CONFIG,
    CONFIDENCE,
    CONFIDENCE_LEVEL,
    FIELD_SOURCE,
    FIELD_SYNONYMS,
    FIELD_PATTERNS,
    DEFAULT_PROFILE,
    EDUCATION_TEMPLATE,
    EXPERIENCE_TEMPLATE,
    LONG_FORM_PATTERNS,
    MIN_FORM_FIELDS,
    LLM_CONFIG,
    MESSAGE_TYPES
  };
}
