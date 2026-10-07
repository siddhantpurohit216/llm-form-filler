/** Constraints shared by DOM filling and AI mapping. */
(() => {
    const identity = field => [field.label,field.name,field.placeholder,field.ariaLabel,field.element?.id].filter(Boolean).join(' ');
    function urlKind(field) {
        const hint = identity(field);
        if (/linkedin/i.test(hint)) return 'linkedin';
        if (/github/i.test(hint)) return 'github';
        if (/(portfolio|blog|project).*(url|link)|portfolio/i.test(hint)) return 'portfolio';
        if (field.type === 'url' || /\b(url|website)\b/i.test(hint)) return 'url';
        return null;
    }
    function validURL(value, kind) {
        try {
            const text = String(value).trim();
            if (/\s/.test(text)) return false;
            const url = new URL(text);
            if (!['https:','http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) return false;
            if (kind === 'linkedin') return /(^|\.)linkedin\.com$/i.test(url.hostname);
            if (kind === 'github') return /(^|\.)github\.com$/i.test(url.hostname);
            return true;
        } catch { return false; }
    }
    function category(field) {
        const label = field.label || '';
        if (/undertake|information.*(?:true|accurate)|(?:certify|declare|agree).*accuracy/i.test(label)) return 'accuracy_declaration';
        if (/(?:eligible|authori[sz]ed|legal(?:ly)?).*(?:work|employment)/i.test(label)) return 'work_eligibility';
        if (/disabilit/i.test(label)) return 'disability';
        if (/(?:previously|ever).*(?:employed|worked)|(?:former|previous) employee/i.test(label)) return 'previous_employment';
        return null;
    }
    function preference(category, profile) {
        const defaults = profile.applicationDefaults || {};
        if (category === 'previous_employment') {
            const value = defaults.previouslyEmployed;
            return value === true || value === 'Yes' ? 'Yes' : value === false || value === 'No' ? 'No' : null;
        }
        if (category === 'disability') return defaults.disability ?? null;
        if (category === 'work_eligibility') return defaults.applicationCountry ? defaults.workEligibility?.[defaults.applicationCountry] ?? null : null;
        return null;
    }
    function validate(field, mapping, profile) {
        const value = mapping.value;
        if (value === null || value === undefined || value === '' || !Number.isFinite(Number(mapping.confidence)) || Number(mapping.confidence) < .9) return false;
        const kind = urlKind(field);
        if (kind && !validURL(value,kind)) return false;
        const questionCategory = category(field) || mapping.category;
        if (questionCategory === 'accuracy_declaration') return false;
        if (['work_eligibility','previous_employment','disability'].includes(questionCategory)) {
            const saved = preference(questionCategory, profile);
            // Require a saved fact and an exact available option linked to it.
            const normalized = answer => answer === true ? 'yes' : answer === false ? 'no' : String(answer).trim().toLowerCase();
            if (saved == null || saved === '' || normalized(mapping.answer) !== normalized(saved)) return false;
        }
        if (['combobox','dropdown','radio'].includes(field.type)) {
            if (!['work_eligibility','previous_employment','disability'].includes(questionCategory)) {
                const saved = String(mapping.profilePath || '').split('.').reduce((data,key)=>data?.[key],profile);
                if (saved == null || String(mapping.answer) !== String(saved)) return false;
            }
            const details = field.optionDetails || (field.options || []).map(label=>({label,value:label}));
            if (!details.length || !details.some(option=>String(value) === String(option.value) || String(value) === option.label)) return false;
        }
        return true;
    }
    globalThis.FieldPolicy = {urlKind,validURL,category,preference,validate};
})();
