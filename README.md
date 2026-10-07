# Smart Job Autofill - Chrome Extension

**Intelligent, privacy-first job application autofill with optional LLM assistance.**

[![Chrome Web Store Ready](https://img.shields.io/badge/Chrome%20Web%20Store-Ready-green.svg)](https://chrome.google.com/webstore)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/)

## 🎯 Overview

Smart Job Autofill is a Chrome extension that intelligently fills job application forms using your saved profile data. It prioritizes **deterministic matching** and only uses LLM assistance when necessary, ensuring privacy and reliability.

## ✨ Features

- **Local profile storage**: Profile data stays in IndexedDB; requested AI operations send relevant data to your configured provider.
- **🧠 Intelligent Matching**: 5-tier deterministic matching before any LLM calls
- **📝 Resume Parsing**: Upload PDF/DOCX resumes and auto-populate your profile
- **🎨 Visual Confidence**: Green/Yellow/Red indicators show match confidence
- **✏️ User Control**: Edit, regenerate, or save any autofilled value
- **🔌 Optional LLM**: Bring your own API key (OpenAI, Anthropic, or Gemini) for advanced features

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
2. Select your LLM provider (OpenAI, Anthropic, or Gemini)
3. Enter your API key
4. Click "Save Settings"

### Autofilling Forms
1. Navigate to a job application page
2. Supported application pages automatically run local matching; enable other sites from the popup.
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

1. A small loader runs only on Workday, Greenhouse, Wellfound, Lever, Phenom/Fiserv, or explicitly remembered origins. It loads the full engine only when an application is present.
2. The platform adapter extracts normalized question/control/options/constraints from the application form.
3. The semantic resolver identifies canonical meanings and resolves typed, scoped profile facts. Existing Workday repeat/date/skills handling is retained.
   Workday skills use the explicit equivalents in `src/core/skill-aliases.js`, including full search names (JS searches JavaScript), exact option matching, and committed-chip verification. Related technologies remain distinct. If local matching and the Enter fallback fail, the Workday skills widget automatically sends just the skill and up to 60 available suggestion labels to the configured AI provider. The model returns an option index or abstains; only a valid index with confidence at least 0.9 is accepted, and the option must still exist before selection. Identical requests and abstentions are cached for 30 minutes in the worker; provider rate-limit cooldowns apply. This fallback also runs during automatic scans, only for the Workday skills widget and only when suggestions are available; other fields retain their existing AI activation rules.
4. The option mapper checks exact labels, boolean polarity, explicit duration units/ranges, and language proficiency options. Ambiguous options remain for review.
5. The shared field pipeline fills and verifies the actual control value. Failed verification is not counted as a successful fill.
6. On explicit AI request, known questions resolve locally with zero provider calls; unknown wording is classified in batches. Narrative generation uses the saved profile.
7. Explicitly saved field-to-meaning bindings persist locally and are keyed by question, control, options and schema version. Dynamic forms use scoped observers with replacement detection and bounded attempts.

### Modules

- `src/adapters/registry.js`: supported domains, platform signatures and application detection.
- `src/background/activation.js`: manual/automatic script injection and remembered-origin permissions.
- `src/adapters/runtime.js`: common adapter contract and Workday, Greenhouse, Wellfound, Lever, Phenom implementations.
- `src/core/semantic.js`: canonical meanings, typed facts, scopes, derived availability and option mapping.
- `src/core/field-pipeline.js`: shared filling, user-edit protection, verification and field states.

### Activation and custom facts

On other websites, open the popup and click **Enable autofill**. **Always enable on this site** requests origin access and remembers it for subsequent application forms. Automatic activation for individual platforms can be disabled in Settings. No form is submitted automatically.

Workday question preferences support family relationships, restrictive agreements, IP ownership, outside employment, government relationships, and accuracy acknowledgements. Configure explicit Yes/No answers in Profile; empty preferences stay for review. **Save my Intel answers** saves the user-specified Intel preset (No for the five conflict categories, Yes for accuracy acknowledgement and work eligibility in India) and enables matching scoped to Intel. Change the employer scope or clear it to apply your saved preferences across Workday employers. Known wording resolves locally; unfamiliar unanswered choices use the existing cached batch classifier automatically when this feature is enabled. AI identifies meaning and polarity; the application selects the actual option from saved facts. Privacy, marketing, data-processing consent and terms are not accuracy acknowledgements.

In **Add Field**, choose a meaning and answer type when your label differs from website wording. Optional scope restricts a fact to a country, employer or language. Existing custom labels/values remain compatible. An explicit start date takes priority over notice-period calculations; calculations require a notice start date or the configured “begins today” assumption. Month durations are not approximated as 30 days.

The non-Workday adapters currently share native/ARIA widget support. Platform-specific complex widgets should be added to their adapter with fixtures; baseline registration does not guarantee every live widget works. Cross-origin frames require host access for their origin.

Run regression tests with `node --test test/*.cjs`. `python3 test/ui-preview-server.py 8766` serves popup and application fixtures with demo data only.

## 🔐 Privacy Guarantees

- **No application backend**: Local matching runs in the browser; requested AI operations call the configured provider.
- **Local Storage Only**: Profile data stored in IndexedDB
- **API keys**: Stored in Chrome local extension storage; not independently encrypted by this extension.
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

### Fill one field with AI

Click or hover an editable field and choose **AI** in its toolbar. The **Fill this field with AI** dialog lets you add optional instructions or use your saved profile directly. Only that field is filled. The request includes its complete question, options, hints, current value, validation constraints, page title/path, and the saved profile. Configure an AI provider and API key in the extension settings first.

Missing personal facts or unsupported options remain for review. Closing the dialog or editing the field while the request is running prevents the delayed answer from replacing your input.

Manually added profile fields also participate in deterministic matching. Use a descriptive label such as **Notice period** or copy the exact question, then save the profile. Exact labels and common question wrappers (for example, “What is your notice period?”) can fill automatically. Dropdown answers must match an available option; approximate wording stays a suggestion or requires AI. Conflicting saved answers remain for review.

Field AI and page Autofill share the same batched AI resolver, prompt, saved-profile checks, answer validation, and cache. Field AI sends one selected field plus optional instructions; page Autofill sends eligible unanswered fields after deterministic filling and preserves existing/manual answers. Native “Please Select” placeholders count as unanswered even when their HTML value is nonempty.

Previous-employment questions use the saved application preference, or the user-configured **No** default when absent, consistently in field AI and page Autofill. An explicit saved **Yes** overrides that default. This is a configured answer, not a conclusion inferred from the resume. Failed deterministic fills that remain empty are included in page AI assistance.
