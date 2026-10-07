/**
 * Popup JavaScript - Profile management, resume upload, and settings
 */

document.addEventListener('DOMContentLoaded', () => {
    initAccordions();
    initTabs();
    initPageActions();
    initProfile();
    initResume();
    initSettings();
    updateStatus('Ready');
});

function initAccordions() {
    document.querySelectorAll('.tab-panel > .section').forEach(section => {
        const heading = section.querySelector('h2');
        if (!heading) return;
        const details = document.createElement('details');
        details.className = section.className + ' profile-accordion';
        const summary = document.createElement('summary');
        summary.textContent = heading.textContent;
        heading.remove();
        details.append(summary);
        const body = document.createElement('div');
        body.className = 'accordion-body';
        body.append(...section.childNodes);
        details.append(body);
        section.replaceWith(details);
        const list = body.querySelector('.item-list');
        if (list) {
            const title = summary.textContent;
            const update = () => {summary.textContent = `${title} (${list.children.length})`;};
            new MutationObserver(update).observe(list, {childList:true});
            update();
        }
    });
}

function collapseRecord(card, index, type) {
    const details = document.createElement('details');
    details.className = 'record-accordion';
    const summary = document.createElement('summary');
    const header = card.querySelector('.item-header');
    summary.append(...header.childNodes);
    header.remove();
    const body = document.createElement('div');
    body.className = 'record-body';
    body.append(...card.childNodes);
    details.append(summary, body);
    card.append(details);
    const update = () => {
        const primary = card.querySelector(type === 'Experience' ? '.exp-title' : '.edu-degree').value.trim();
        const organization = card.querySelector(type === 'Experience' ? '.exp-company' : '.edu-institution').value.trim();
        summary.querySelector('.item-title').textContent = [primary || `${type} ${index + 1}`, organization].filter(Boolean).join(' · ');
    };
    card.addEventListener('input', update);
    summary.querySelector('.btn-remove').addEventListener('click', event => {event.preventDefault(); event.stopPropagation();});
    update();
    // A just-added empty record is immediately editable; saved records start collapsed.
    details.open = !body.querySelector('input')?.value;
}

async function initPageActions() {
    const summary = document.getElementById('page-summary');
    const button = document.getElementById('popup-autofill');
    const remember = document.getElementById('remember-site');
    let tab;
    let enabled = false;
    try {
        [tab] = await chrome.tabs.query({active:true,currentWindow:true});
        if (!/^https?:\/\//i.test(tab?.url || '')) throw new Error('Open a regular website to enable autofill');
        try {
            const status = await chrome.runtime.sendMessage({type:'GET_ACTIVE_FORM_STATUS',data:{tabId:tab.id}});
            enabled = !!status?.frames?.length;
            if (!enabled) throw new Error('Not active');
            summary.textContent = status.hasForm ? `${status.fieldCount} fields detected · ${status.adapter || 'This site'}` : 'No editable fields on this step';
        } catch {
            summary.textContent = AdapterRegistry.byURL(tab.url) ? 'Enable autofill when the application is open' : 'Autofill is inactive on this site';
        }
        button.textContent = enabled ? 'Autofill' : 'Enable autofill';
        button.disabled = false;
        remember.disabled = false;
    } catch (error) {
        summary.textContent = error.message;
        button.disabled = true;
        remember.disabled = true;
    }
    button.addEventListener('click',async()=>{
        button.disabled = true;
        button.textContent = 'Filling…';
        try {
            if (!enabled) {
                const activation = await chrome.runtime.sendMessage({type:'ACTIVATE_AUTOFILL',data:{tabId:tab.id,manual:true}});
                if (!activation?.success) throw new Error(activation?.error || 'Could not enable autofill');
            }
            enabled = true;
            const response = await chrome.runtime.sendMessage({type:'TRIGGER_ACTIVE_AUTOFILL',data:{tabId:tab.id}});
            if (!response?.success) throw new Error(response?.error || 'Autofill failed');
            summary.textContent = response.fieldCount ? 'Done. Review your answers on the page.' : 'No editable fields on this page';
        } catch (error) { summary.textContent = error.message; }
        finally { button.disabled = false; button.textContent = enabled?'Autofill':'Enable autofill'; }
    });
    remember.addEventListener('click',async()=>{
        const origin = new URL(tab.url).origin;
        try {
            const granted = await chrome.permissions.request({origins:[origin+'/*']});
            if (!granted) {summary.textContent='Site access was not granted';return;}
            const response = await chrome.runtime.sendMessage({type:'REMEMBER_AUTOFILL_SITE',data:{origin}});
            if (!response?.success) throw new Error(response?.error || 'Could not remember this site');
            summary.textContent = 'Automatic activation enabled for application forms on this site';
        } catch (error) {summary.textContent=error.message;}
    });
    const controls = document.getElementById('adapter-controls');
    const {disabledAdapters=[]} = await chrome.storage.local.get('disabledAdapters');
    for (const platform of AdapterRegistry.platforms) {
        const label = document.createElement('label');label.className='preference-check';
        const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=!disabledAdapters.includes(platform.id);
        label.append(checkbox,document.createTextNode(platform.name));controls.appendChild(label);
        checkbox.addEventListener('change',async()=>{
            const saved=await chrome.storage.local.get('disabledAdapters');
            const disabled=new Set(saved.disabledAdapters || []);
            checkbox.checked?disabled.delete(platform.id):disabled.add(platform.id);
            await chrome.storage.local.set({disabledAdapters:[...disabled]});
        });
    }
}

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
        profileData = ResumeProfile.profile(response.profile || getDefaultProfile());
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
        languages: [],
        skills: []
    };
}

function populateWorkdayQuestions(preferences={}) {
    preferences=preferences || {};
    document.getElementById('workday-questions-enabled').checked=!!preferences.enabled;
    document.getElementById('workday-question-employer').value=preferences.employer || '';
    const container=document.getElementById('workday-question-answers');container.replaceChildren();
    for(const category of globalThis.WorkdayQuestions?.registry || []) {
        const row=document.createElement('div');row.className='form-group';
        const label=document.createElement('label');label.textContent=category.label;
        const select=document.createElement('select');select.id='workday-answer-'+category.key;label.htmlFor=select.id;
        for(const [value,text] of [['','Answer manually'],['No','No'],['Yes','Yes']]) {
            const option=document.createElement('option');option.value=value;option.textContent=text;select.appendChild(option);
        }
        const answer=preferences.answers?.[category.key];select.value=answer===true?'Yes':answer===false?'No':'';
        row.append(label,select);container.appendChild(row);
    }
}

function populateProfileForm(profile) {
    populateWorkdayQuestions(profile.workdayQuestions);
    document.getElementById('notice-period').value = profile.employment?.noticePeriod?.amount ?? '';
    document.getElementById('notice-unit').value = profile.employment?.noticePeriod?.unit || 'days';
    document.getElementById('earliest-start-date').value = profile.employment?.earliestStartDate || '';
    document.getElementById('notice-start-date').value = profile.employment?.noticeStartDate || '';
    document.getElementById('notice-start-today').checked = profile.employment?.noticeStartMode === 'today';
    const defaults = profile.applicationDefaults || {};
    document.getElementById('accept-terms').checked = defaults.acceptTerms === true;
    document.getElementById('application-country').value = defaults.applicationCountry || '';
    document.getElementById('work-eligibility').value = defaults.workEligibility?.[defaults.applicationCountry] || '';
    document.getElementById('work-authorization-basis').value=defaults.workAuthorizationBasis?.[defaults.applicationCountry] || '';
    document.getElementById('previous-employment').value = defaults.previouslyEmployed === true ? 'Yes' : 'No';
    document.getElementById('disability-answer').value = defaults.disability || '';
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
    renderLanguagesList(profile.languages || []);

    // Skills
    renderSkillsList(profile.skills || []);

    // Custom Fields
    renderCustomFieldsList(profile.customFields || {});
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

    // Add custom field
    document.getElementById('add-language').addEventListener('click', () => {
        profileData.languages = profileData.languages || [];
        profileData.languages.push({language:'', proficiency:'Fluent'});
        renderLanguagesList(profileData.languages);
    });

    document.getElementById('add-custom-field').addEventListener('click', () => {
        addCustomField('', '');
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
        collapseRecord(card, index, 'Education');

        // Input listeners
        card.querySelectorAll('input').forEach(input => {
            input.addEventListener('input', () => updateEducation(index, card));
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
        ...profileData.education[index],
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
        card.querySelector('.exp-current').checked = exp.current === true;
        card.querySelector('.exp-end').disabled = exp.current === true;
        collapseRecord(card, index, 'Experience');

        // Input listeners
        card.querySelectorAll('input, textarea').forEach(input => {
            input.addEventListener('input', () => updateExperience(index, card));
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
    const previous = profileData.experience[index];
    const description = card.querySelector('.exp-description').value;
    const current = card.querySelector('.exp-current').checked;
    card.querySelector('.exp-end').disabled = current;
    if (current) card.querySelector('.exp-end').value = '';
    profileData.experience[index] = {
        ...previous,
        company: card.querySelector('.exp-company').value,
        title: card.querySelector('.exp-title').value,
        startDate: card.querySelector('.exp-start').value,
        endDate: card.querySelector('.exp-end').value,
        current,
        description,
        ...(description !== previous.description ? {achievements:[],responsibilities:[]} : {})
    };
}

function renderLanguagesList(languages) {
    const container = document.getElementById('languages-list');
    container.replaceChildren();
    languages.forEach((entry, index) => {
        const record = typeof entry === 'string' ? {language:entry} : entry;
        profileData.languages[index] = record;
        const card = document.createElement('div');
        card.className = 'item-card';
        for (const key of ['language','overall','comprehension','reading','speaking','writing','listening']) {
            const group = document.createElement('div');
            group.className = 'form-group';
            const label = document.createElement('label');
            label.textContent = key[0].toUpperCase() + key.slice(1);
            const input = document.createElement(key === 'language' ? 'input' : 'select');
            input.id = `language-${index}-${key}`;
            label.htmlFor = input.id;
            if (key !== 'language') {
                for (const value of ['Fluent','Advanced','Intermediate','Classroom Study','Beginner']) {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = value;
                    input.appendChild(option);
                }
            }
            input.value = key === 'language' ? record.language || record.name || '' : record[key] || record.proficiency || 'Fluent';
            const update = () => {
                profileData.languages[index] = {...record, ...profileData.languages[index], [key]:input.value};
                if (key === 'overall') profileData.languages[index].fluent = input.value === 'Fluent';
            };
            input.addEventListener('input', update);
            input.addEventListener('change', update);
            group.append(label,input);
            card.appendChild(group);
        }
        const remove = document.createElement('button');
        remove.className = 'btn btn-remove';
        remove.textContent = 'Remove language';
        remove.addEventListener('click', () => {
            profileData.languages.splice(index,1);
            renderLanguagesList(profileData.languages);
        });
        card.appendChild(remove);
        container.appendChild(card);
    });
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
    for (const kind of ['linkedin','github','portfolio']) {
        const input = document.getElementById(kind);
        if (input.value.trim() && !FieldPolicy.validURL(input.value,kind)) {
            updateStatus(`Enter a valid ${kind} http(s) URL, or leave it blank.`, 'error');
            input.focus();
            return;
        }
    }
    const period = document.getElementById('notice-period');
    if (!period.checkValidity()) {updateStatus('Enter a valid notice period','error');period.focus();return;}
    profileData.employment = {...profileData.employment,
        noticePeriod:period.value === '' ? null : {amount:Number(period.value),unit:document.getElementById('notice-unit').value},
        earliestStartDate:document.getElementById('earliest-start-date').value || null,
        noticeStartDate:document.getElementById('notice-start-date').value || null,
        noticeStartMode:document.getElementById('notice-start-today').checked?'today':null};
    const country = document.getElementById('application-country').value.trim();
    profileData.applicationDefaults = {...profileData.applicationDefaults,
        acceptTerms:document.getElementById('accept-terms').checked,
        applicationCountry:country,
        workEligibility:{...profileData.applicationDefaults?.workEligibility,[country]:document.getElementById('work-eligibility').value},
        workAuthorizationBasis:{...profileData.applicationDefaults?.workAuthorizationBasis,[country]:document.getElementById('work-authorization-basis').value.trim()},
        previouslyEmployed:document.getElementById('previous-employment').value === 'Yes',
        disability:document.getElementById('disability-answer').value};
    profileData.workdayQuestions={enabled:document.getElementById('workday-questions-enabled').checked,
        employer:document.getElementById('workday-question-employer').value.trim(),
        answers:Object.fromEntries((globalThis.WorkdayQuestions?.registry || []).map(category=>{
            const value=document.getElementById('workday-answer-'+category.key).value;
            return [category.key,value===''?null:value==='Yes'];
        }))};
    const invalidDate = [...document.querySelectorAll('.exp-start,.exp-end,.edu-start,.edu-end')]
        .find(input => !input.disabled && input.value.trim() && !ResumeProfile.date(input.value));
    if (invalidDate) {
        for (let ancestor=invalidDate.parentElement; ancestor; ancestor=ancestor.parentElement)
            if (ancestor.tagName === 'DETAILS') ancestor.open = true;
        updateStatus('Use YYYY, YYYY-MM, or YYYY-MM-DD for dates, or leave them blank.', 'error');
        invalidDate.focus();
        return;
    }
    document.querySelectorAll('#experience-list .item-card').forEach(card => updateExperience(Number(card.dataset.index),card));
    document.querySelectorAll('#education-list .item-card').forEach(card => updateEducation(Number(card.dataset.index),card));
    profileData = ResumeProfile.profile(profileData);
    profileData.languages = (profileData.languages || []).filter(entry =>
        String(typeof entry === 'string' ? entry : entry.language || entry.name || '').trim());
    renderLanguagesList(profileData.languages);
    // Gather form data
    profileData.contact = {
        ...profileData.contact,
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

    // Serialize custom fields
    profileData.customFields = {};
    profileData.customFieldMeta = {};
    let invalidCustom;
    document.querySelectorAll('.custom-field-row').forEach(row => {
        const label = row.querySelector('.custom-field-label').value.trim();
        const value = row.querySelector('.custom-field-value').value.trim();
        if (!label) return;
        const meta = {intent:row.querySelector('.custom-field-intent').value,type:row.querySelector('.custom-field-type').value,
            unit:row.querySelector('.custom-field-unit').value,scope:row.querySelector('.custom-field-scope').value.trim()};
        if (value && SemanticResolver.parse(value,meta.type,meta.unit)==null) invalidCustom=label;
        if (Object.hasOwn(profileData.customFields,label)) invalidCustom=label+' (duplicate label)';
        profileData.customFields[label]=value;
        profileData.customFieldMeta[label]=meta;
    });
    if (invalidCustom) {updateStatus(`Check the saved answer and type for ${invalidCustom}`,'error');return;}

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

// ========== Custom Fields ==========
function renderCustomFieldsList(customFields) {
    const container = document.getElementById('custom-fields-list');
    container.innerHTML = '';
    Object.entries(customFields || {}).forEach(([label, value]) => {
        addCustomField(label, value);
    });
}

function addCustomField(label = '', value = '') {
    const container = document.getElementById('custom-fields-list');
    const row = document.createElement('div');row.className='custom-field-row';
    const main=document.createElement('div');main.className='custom-field-main';
    const labelInput=document.createElement('input');labelInput.type='text';labelInput.className='custom-field-label';labelInput.placeholder='Label or exact question';labelInput.value=label;
    const valueInput=document.createElement('input');valueInput.type='text';valueInput.className='custom-field-value';valueInput.placeholder='Saved answer';valueInput.value=String(value);
    const remove=document.createElement('button');remove.type='button';remove.className='btn btn-remove';remove.textContent='×';remove.title='Remove';remove.addEventListener('click',()=>row.remove());
    main.append(labelInput,valueInput,remove);
    const details=document.createElement('div');details.className='custom-field-details';
    const meta=profileData?.customFieldMeta?.[label] || {};
    const select=(className,items,selected,title)=>{
        const input=document.createElement('select');input.className=className;input.setAttribute('aria-label',title);
        for(const [value,label] of items){const option=document.createElement('option');option.value=value;option.textContent=label;input.appendChild(option);}
        input.value=selected;const wrapper=document.createElement('label');wrapper.className='custom-detail';wrapper.textContent=title;wrapper.appendChild(input);details.appendChild(wrapper);return input;
    };
    const intent=select('custom-field-intent',[['','Match my label'],...SemanticResolver.registry.map(item=>[item.id,item.label])],meta.intent || '','Meaning');
    intent.parentElement.classList.add('custom-detail-wide');
    const type=select('custom-field-type',['text','number','boolean','date','duration'].map(value=>[value,value==='boolean'?'Yes / No':value.charAt(0).toUpperCase()+value.slice(1)]),meta.type || 'text','Answer type');
    const unitSelect=select('custom-field-unit',['days','weeks','months'].map(value=>[value,value]),meta.unit || 'days','Duration unit');
    const scope=document.createElement('input');scope.className='custom-field-scope';scope.placeholder='Country, employer or language (optional)';scope.value=meta.scope || '';scope.setAttribute('aria-label','Answer scope');const scopeLabel=document.createElement('label');scopeLabel.className='custom-detail custom-detail-wide';scopeLabel.textContent='Country, employer or language (optional)';scopeLabel.appendChild(scope);details.appendChild(scopeLabel);
    const updateUnit=()=>{unitSelect.parentElement.hidden=type.value!=='duration';};
    updateUnit();type.addEventListener('change',updateUnit);
    intent.addEventListener('change',()=>{type.value=SemanticResolver.registry.find(item=>item.id===intent.value)?.type || 'text';updateUnit();});
    row.append(main,details);container.appendChild(row);
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

    // Retry button — resets to initial upload state
    document.getElementById('retry-resume-btn').addEventListener('click', () => {
        resetResumeUpload();
        resumeInput.value = '';
        resumeInput.click();
    });

    // Import buttons
    document.getElementById('cancel-import').addEventListener('click', () => {
        parsedResumeData = null;
        document.getElementById('resume-preview').classList.add('hidden');
        showUploadStatus('');
        document.getElementById('retry-resume-area').classList.add('hidden');
    });

    document.getElementById('confirm-import').addEventListener('click', confirmResumeImport);
}

function resetResumeUpload() {
    document.getElementById('upload-area').classList.remove('hidden');
    document.getElementById('upload-status').classList.add('hidden');
    document.getElementById('retry-resume-area').classList.add('hidden');
    document.getElementById('resume-preview').classList.add('hidden');
    parsedResumeData = null;
}

async function handleResumeUpload(file) {
    const validExtensions = ['pdf', 'docx', 'doc', 'txt'];
    const ext = file.name.split('.').pop().toLowerCase();

    if (!validExtensions.includes(ext)) {
        showUploadStatus('❌ Unsupported file type. Please use PDF, DOCX, or TXT.', 'error');
        document.getElementById('retry-resume-area').classList.remove('hidden');
        return;
    }

    // Show loading state
    document.getElementById('upload-area').classList.add('hidden');
    document.getElementById('retry-resume-area').classList.add('hidden');
    showUploadStatus('⏳ Parsing resume... please wait.', 'loading');

    try {
        const text = await extractTextFromFile(file);
        console.log('[Popup] Extracted resume text length:', text?.length);

        if (!text || text.length < 50) {
            throw new Error('Could not extract text from file. Is it a scanned image PDF?');
        }

        const response = await chrome.runtime.sendMessage({
            type: 'PARSE_RESUME',
            data: { text, fileName: file.name }
        });

        if (response.success && response.data) {
            parsedResumeData = ResumeProfile.profile(response.data);
            showResumePreview(parsedResumeData);
            showUploadStatus('✅ Resume parsed successfully!', 'success');
            document.getElementById('retry-resume-area').classList.remove('hidden');
        } else {
            throw new Error(response.error || 'Failed to parse resume');
        }
    } catch (error) {
        console.error('Resume upload error:', error);
        showUploadStatus(`❌ ${error.message}`, 'error');
        document.getElementById('upload-area').classList.remove('hidden');
        document.getElementById('retry-resume-area').classList.remove('hidden');
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
                    const pageText = ResumeProfile.pdfText(textContent.items);
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

    content.replaceChildren();
    const add = (label, value) => {
        const p = document.createElement('p');
        const strong = document.createElement('strong');
        strong.textContent = `${label}: `;
        p.append(strong, document.createTextNode(String(value)));
        content.appendChild(p);
    };

    if (data.contact?.firstName || data.contact?.lastName) {
        add('Name', `${data.contact.firstName || ''} ${data.contact.lastName || ''}`);
    }
    if (data.contact?.email) add('Email', data.contact.email);
    if (data.education?.length) {
        add('Education', `${data.education.length} entries`);
    }
    if (data.experience?.length) {
        add('Experience', `${data.experience.length} entries`);
        data.experience.forEach((entry,index) => {
            add(`Role ${index + 1}`, [entry.title,entry.company].filter(Boolean).join(' · ') || 'Not provided');
            add('Dates', `${entry.startDate || 'Start not provided'} → ${entry.current ? 'Present' : entry.endDate || 'End not provided'}`);
            const description = document.createElement('p');
            description.style.whiteSpace = 'pre-wrap';
            description.textContent = entry.description || 'Role description not provided';
            content.appendChild(description);
        });
    }
    if (data.skills?.length) {
        add('Skills', `${data.skills.slice(0, 5).join(', ')}${data.skills.length > 5 ? '...' : ''}`);
    }

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
    newData = ResumeProfile.profile(newData);
    return {
        ...existing,
        contact: { ...existing.contact, ...newData.contact },
        links: { ...existing.links, ...newData.links },
        education: newData.education?.length ? newData.education : existing.education,
        experience: newData.experience?.length ? newData.experience : existing.experience,
        languages: newData.languages?.length ? newData.languages : existing.languages || [],
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
