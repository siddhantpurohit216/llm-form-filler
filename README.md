# Smart Job Autofill - Chrome Extension

**Intelligent, privacy-first job application autofill with optional LLM assistance.**

[![Chrome Web Store Ready](https://img.shields.io/badge/Chrome%20Web%20Store-Ready-green.svg)](https://chrome.google.com/webstore)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/)

## 🎯 Overview

Smart Job Autofill is a Chrome extension that intelligently fills job application forms using your saved profile data. It prioritizes **deterministic matching** and only uses LLM assistance when necessary, ensuring privacy and reliability.

## ✨ Features

- **🔒 Privacy-First**: All data stored locally in IndexedDB. No external servers. Your data never leaves your browser.
- **🧠 Intelligent Matching**: 5-tier deterministic matching before any LLM calls
- **📝 Resume Parsing**: Upload PDF/DOCX resumes and auto-populate your profile
- **🎨 Visual Confidence**: Green/Yellow/Red indicators show match confidence
- **✏️ User Control**: Edit, regenerate, or save any autofilled value
- **🔌 Optional LLM**: Bring your own API key (OpenAI or Anthropic) for advanced features

## 🚀 Installation

### From Chrome Web Store
*(Coming soon)*

### Developer Installation
1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `llm-form-filler` folder

## 📖 Usage

### Setting Up Your Profile
1. Click the extension icon in Chrome toolbar
2. Fill in your contact information, links, education, and experience
3. Click "Save Profile"

### Uploading a Resume
1. Go to the "Resume" tab in the popup
2. Drag & drop or browse for your resume (PDF/DOCX/TXT)
3. Review the parsed data
4. Click "Save to Profile" to import

### Configuring LLM (Optional)
1. Go to the "Settings" tab
2. Select your LLM provider (OpenAI or Anthropic)
3. Enter your API key
4. Click "Save Settings"

### Autofilling Forms
1. Navigate to a job application page
2. The extension automatically detects and fills form fields
3. Look for confidence indicators:
   - 🟢 High confidence / User-approved
   - 🟡 LLM-inferred
   - 🔴 Uncertain / Needs review
4. Use inline buttons to Edit, Regenerate, or Save to Profile

## 🏗️ Architecture

```
llm-form-filler/
├── manifest.json           # MV3 manifest
├── src/
│   ├── background/         # Service worker
│   ├── content/            # Content scripts (form detection, autofill)
│   ├── popup/              # Extension popup UI
│   ├── storage/            # IndexedDB & session cache
│   ├── llm/                # LLM orchestration
│   ├── parsers/            # Resume parsing
│   └── utils/              # Shared utilities
└── styles/                 # Injected CSS
```

### Data Flow

1. **Form Detection**: Content script detects forms with ≥3 input fields
2. **Field Extraction**: Extract labels, placeholders, aria-labels, nearby text
3. **Deterministic Matching**: 5-tier matching without LLM:
   - Exact ID/name match
   - Normalized name match
   - Synonym dictionary
   - Fuzzy string similarity
   - Pattern matching (email, phone, URL)
4. **High-Confidence Fill**: Only auto-fill fields with ≥90% confidence
5. **LLM Assistance** (if configured): Batch unresolved fields for mapping
6. **User Review**: Visual indicators, edit controls, save-to-profile option

## 🔐 Privacy Guarantees

- **No Backend Servers**: All processing happens in your browser
- **Local Storage Only**: Profile data stored in IndexedDB
- **API Keys Encrypted**: Stored in Chrome's secure storage
- **LLM is Optional**: Extension works fully without any API key
- **No Silent Persistence**: LLM-generated data only saved with explicit confirmation
- **Session Cache**: Ephemeral data cleared on page navigation

## 📊 Confidence System

| Level | Indicator | Meaning |
|-------|-----------|---------|
| Exact | 🟢 | User-approved or ≥90% match confidence |
| Inferred | 🟡 | LLM-inferred or 70-89% confidence |
| Uncertain | 🔴 | Needs review, <70% confidence |

## ⚙️ Configuration Options

### LLM Providers
- **OpenAI**: GPT-4o Mini (recommended), GPT-4o, GPT-3.5 Turbo
- **Anthropic**: Claude 3 Haiku (fast), Claude 3 Sonnet

### Supported File Types for Resume
- PDF (via pdf.js)
- DOCX (via mammoth.js)
- Plain text (.txt)

## 🛠️ Development

### Prerequisites
- Chrome browser
- Node.js (optional, for bundling libraries)

### Loading for Development
1. Make changes to source files
2. Go to `chrome://extensions`
3. Click the refresh icon on the extension card

### Adding PDF/DOCX Support
Download and add to `lib/` folder:
- [pdf.js](https://mozilla.github.io/pdf.js/)
- [mammoth.js](https://github.com/mwilliamson/mammoth.js)

## 📋 Chrome Web Store Readiness

### Permissions Used
- `storage`: Save user profile and settings
- `activeTab`: Access current tab for form detection
- Host permissions for OpenAI/Anthropic APIs (optional LLM features)

### Privacy Policy Requirements
- [ ] Create privacy policy page
- [ ] Document data handling practices
- [ ] No analytics or tracking

### Store Listing Checklist
- [ ] Screenshots of popup and inline UI
- [ ] Promotional images (440x280, 1400x560)
- [ ] Detailed description
- [ ] Category: Productivity

## 🤝 Contributing

Contributions welcome! Please read our contributing guidelines before submitting PRs.

## 📄 License

MIT License - see LICENSE file for details.

---

**Made with ❤️ for job seekers everywhere**
