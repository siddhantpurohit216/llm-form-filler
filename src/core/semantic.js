/** Canonical meanings, typed profile facts, local answer resolution and option mapping. */
(() => {
    const version = 1;
    const registry = [
        ['contact.firstName','First name','text',['first name','given name']],
        ['contact.lastName','Last name','text',['last name','family name','surname']],
        ['contact.fullName','Full name','text',['full name','your name']],
        ['contact.email','Email','text',['email','e mail','email address']],
        ['contact.phone','Phone','text',['phone','phone number','mobile number','telephone']],
        ['contact.city','City','text',['city']], ['contact.country','Country','text',['country of residence']],
        ['links.linkedin','LinkedIn URL','url',['linkedin','linkedin url','linkedin profile']],
        ['links.github','GitHub URL','url',['github','github url']],
        ['links.portfolio','Portfolio URL','url',['portfolio','portfolio url','personal website']],
        ['personal.gender','Gender','text',['gender','sex']],
        ['consent.terms','Accept terms and conditions','boolean',['terms and conditions','terms of service']],
        ['communication.preferredLanguage','Preferred language','text',['preferred language','preferred communication language']],
        ['languages.language','Language','text',['language']],
        ['languages.reading','Reading proficiency','text',['reading proficiency','reading ability','reading']],
        ['languages.writing','Writing proficiency','text',['writing proficiency','writing ability','writing']],
        ['languages.speaking','Speaking proficiency','text',['speaking proficiency','speaking ability','speaking']],
        ['languages.comprehension','Listening proficiency','text',['listening proficiency','listening','comprehension']],
        ['languages.overall','Overall language proficiency','text',['overall proficiency','overall language proficiency']],
        ['employment.noticePeriod','Notice period','duration',['notice period','current notice period','how much notice must you give']],
        ['employment.earliestStartDate','Earliest start date','date',['earliest availability','earliest start date','preferred start date','date of joining','when can you start','when could you start']],
        ['workAuthorization.eligible','Work eligibility','boolean',['legally eligible to work','legally authorized to work','legally authorised to work']],
        ['workAuthorization.sponsorship','Requires sponsorship','boolean',['require sponsorship','requires sponsorship','need sponsorship','sponsorship']],
        ['employmentHistory.withEmployer','Previous employment','boolean',['previous employment','previously employed','ever worked','former employee']],
        ['preferences.onsite','Open to on-site work','boolean',['open to working on site','willing to work on site','on site five days']],
        ['preferences.relocation','Open to relocation','boolean',['open to relocation','willing to relocate']],
        ['application.source','Application source','text',['how did you hear about us','how did you hear about this opportunity','application source']],
        ['personal.disability','Disability disclosure','text',['disability','disability status']],
        ['compensation.expected','Expected compensation','number',['expected salary','salary expectations','compensation expectations']],
        ['compensation.current','Current compensation','number',['current salary','current compensation']]
    ].map(([id,label,type,aliases]) => ({id,label,type,aliases})).concat(globalThis.WorkdayQuestions?.registry || []);
    const normalize = value => String(value ?? '').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const question = value => normalize(value)
        .replace(/^(?:please )?(?:select|choose) the option (?:which|that) best (?:defines|describes) your /,'')
        .replace(/^(?:please )?(?:enter|provide|specify|select|choose|indicate) (?:the |your )?/,'')
        .replace(/^(?:what is|what are) (?:the |your )?/,'').replace(/^(?:your|the) /,'').replace(/ required$/,'');
    const get = (object,path) => String(path).replace(/\[(\d+)\]/g,'.$1').split('.').reduce((value,key) => value?.[key],object);
    const bool = value => typeof value === 'boolean' ? value : /^(yes|true)$/i.test(String(value)) ? true : /^(no|false)$/i.test(String(value)) ? false : null;
    function parse(value,type='text',unit='days') {
        if (value == null || value === '') return null;
        if (type === 'boolean') return bool(value);
        if (type === 'number') return Number.isFinite(Number(value)) ? Number(value) : null;
        if (type === 'duration') {
            if (typeof value === 'object' && Number.isFinite(value.amount) && ['days','weeks','months'].includes(value.unit)) return value;
            const match = String(value).trim().match(/^(\d+)\s*(days?|weeks?|months?)?$/i);
            return match ? {amount:Number(match[1]),unit:match[2] ? match[2].toLowerCase().replace(/s?$/,'s') : unit} : null;
        }
        if (type === 'date') {
            const text = String(value).trim();
            try {return /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(text+'T00:00:00Z').toISOString().slice(0,10) === text ? text : null;} catch {return null;}
        }
        return String(value).trim();
    }
    function facts(profile) {
        const result = [];
        const add = (intent,value,path,type='text',scope={},source='user',unit='days') => {
            const parsed = parse(value,type,unit);
            if (parsed !== null && parsed !== '') result.push({intent,value:parsed,type,scope,source,profilePath:path,confirmed:source==='user'});
        };
        for (const id of ['contact.firstName','contact.lastName','contact.email','contact.phone','contact.city','contact.country','links.linkedin','links.github','links.portfolio','communication.preferredLanguage','application.source']) add(id,get(profile,id),id);
        if (profile.contact?.firstName || profile.contact?.lastName) add('contact.fullName',[profile.contact?.firstName,profile.contact?.lastName].filter(Boolean).join(' '),'contact.fullName');
        add('personal.gender',profile.contact?.gender || profile.applicationDefaults?.gender || profile.gender,'contact.gender');
        if (profile.applicationDefaults?.acceptTerms === true) add('consent.terms',true,'applicationDefaults.acceptTerms','boolean');
        add('employment.noticePeriod',profile.employment?.noticePeriod,'employment.noticePeriod','duration');
        add('employment.earliestStartDate',profile.employment?.earliestStartDate,'employment.earliestStartDate','date');
        add('workAuthorization.sponsorship',profile.applicationDefaults?.requiresSponsorship,'applicationDefaults.requiresSponsorship','boolean', {country:profile.applicationDefaults?.applicationCountry || ''});
        add('preferences.onsite',profile.preferences?.onsite,'preferences.onsite','boolean');
        add('preferences.relocation',profile.preferences?.relocation,'preferences.relocation','boolean');
        for (const [country,value] of Object.entries(profile.applicationDefaults?.workEligibility || {})) add('workAuthorization.eligible',value,`applicationDefaults.workEligibility.${country}`,'boolean',{country});
        for (const [employer,value] of Object.entries(profile.applicationDefaults?.employerHistory || {})) add('employmentHistory.withEmployer',value,`applicationDefaults.employerHistory.${employer}`,'boolean',{employer});
        const previous = profile.applicationDefaults?.previouslyEmployed;
        add('employmentHistory.withEmployer',previous ?? false,'applicationDefaults.previouslyEmployed','boolean',{},previous == null ? 'user_default' : 'user');
        add('personal.disability',profile.applicationDefaults?.disability,'applicationDefaults.disability');
        for(const category of globalThis.WorkdayQuestions?.registry || [])
            add(category.id,profile.workdayQuestions?.answers?.[category.key],`workdayQuestions.answers.${category.key}`,'boolean');
        for (const [index,entry] of (profile.languages || []).entries()) {
            const language = typeof entry === 'string' ? entry : entry.language || entry.name;
            add('languages.language',language,`languages[${index}].language`,'text',{language,index});
            for (const ability of ['reading','writing','speaking','comprehension','overall']) add(`languages.${ability}`,entry[ability] || entry.proficiency || 'Fluent',`languages[${index}].${ability}`,'text',{language,index});
        }
        for (const [label,value] of Object.entries(profile.customFields || {})) {
            const meta = profile.customFieldMeta?.[label] || {};
            const known = registry.find(item => item.aliases.some(alias => question(alias) === question(label)));
            const intent = registry.some(item => item.id === meta.intent) ? meta.intent : known?.id || `custom.${normalize(label)}`;
            const scope = meta.scope ? {[intent.startsWith('languages.') ? 'language' : intent==='employmentHistory.withEmployer' ? 'employer' : 'country']:meta.scope} : {};
            add(intent,value,`customFields.${label}`,registry.find(item=>item.id===intent)?.type || meta.type || 'text',scope,'user',meta.unit || 'days');
            const fact = result.at(-1);
            if (fact?.profilePath === `customFields.${label}`) fact.label = label;
        }
        return result;
    }
    const bindingKey = field => JSON.stringify([version,normalize(field.label),field.type,
        field.recordType || '',(field.optionDetails || []).map(option => normalize(option.label))]);
    let bindings = {};
    const countryNames=[];
    try {
        const names=new Intl.DisplayNames(['en'],{type:'region',fallback:'none'});
        for(let a=65;a<=90;a++) for(let b=65;b<=90;b++) {
            const name=names.of(String.fromCharCode(a,b));
            if(name) countryNames.push(name);
        }
    } catch {}
    countryNames.push('United States','United Kingdom','UK','USA');
    function identify(field,profile={},suggestion=null) {
        const termsLabel = String(field.label || '');
        if (field.type === 'checkbox' && /\bterms\s*(?:and|&)\s*conditions\b|\bterms of service\b/i.test(termsLabel) &&
            /\b(?:agree|accept|consent|acknowledge)\b/i.test(termsLabel) &&
            !/\b(?:sms|marketing|promotional|newsletter|talent network)\b/i.test(termsLabel))
            return {intent:'consent.terms',qualifiers:{},polarity:1,confidence:1};
        const workday=globalThis.WorkdayQuestions?.identify(field,profile,suggestion);
        if(workday)return workday;
        if(suggestion?.intent?.startsWith('workday.') && !workday)return {intent:'review',qualifiers:{},confidence:1};
        const label = normalize(field.label || field.question);
        const defaults = profile.applicationDefaults || {};
        const qualifiers = {country:field.country || defaults.applicationCountry || '',
            employer:field.employer || '',language:field.language || '',recordIndex:field.recordIndex};
        if (/undertake|information.*(?:true|accurate)|false information|misrepresentation|(?:agree|consent|acknowledge|accept).*(?:terms|privacy|policy|sms|processing)/i.test(field.label || '')) return {intent:'review',qualifiers,confidence:1};
        if (/\b(?:work|employment|sponsorship|authori[sz]ed|eligible)\b/.test(label)) {
            const possible=[...new Set([...countryNames,...Object.keys(defaults.workEligibility || {})])]
                .filter(country=>(` ${label} `).includes(` ${normalize(country)} `));
            const canonical=possible.map(country=>['usa','united states'].includes(normalize(country))?'United States':normalize(country)==='uk'?'United Kingdom':country);
            const distinct=[...new Set(canonical)];
            if(distinct.length>1) return {intent:'review',qualifiers,confidence:1};
            if(distinct.length) qualifiers.country=Object.keys(defaults.workEligibility || {}).find(country=>normalize(country)===normalize(distinct[0])) || distinct[0];
        }
        const exact = Object.entries(profile.customFields || {}).filter(([saved]) => question(saved) === question(field.label));
        if (exact.length) {
            const ids = [...new Set(exact.map(([saved]) => profile.customFieldMeta?.[saved]?.intent || registry.find(item=>item.aliases.some(alias=>question(alias)===question(saved)))?.id || `custom.${normalize(saved)}`))];
            if (ids.length === 1) return {intent:ids[0],qualifiers,polarity:1,confidence:1};
        }
        let candidates = registry.flatMap(item => item.aliases.filter(alias => (` ${label} `).includes(` ${normalize(alias)} `)).map(alias=>({intent:item.id,length:normalize(alias).length})));
        if (/\b(?:eligible|authori[sz]ed|legal(?:ly)?)\b.*\bwork\b/.test(label)) candidates.push({intent:'workAuthorization.eligible',length:100});
        if (/\b(?:previously|ever)\b.*\b(?:employed|worked)\b/.test(label)) candidates.push({intent:'employmentHistory.withEmployer',length:100});
        if (/earliest.*(?:availability|start)|preferred start date|date of joining/.test(label)) candidates.push({intent:'employment.earliestStartDate',length:100});
        candidates.sort((a,b)=>b.length-a.length);
        let selected = candidates[0];
        if (!selected) {
            const cached = bindings[bindingKey(field)];
            const value = cached?.version === version && cached.confirmed === true ? cached : suggestion;
            if (value && registry.some(item=>item.id===value.intent) && Number(value.confidence)>=.9 && [1,-1].includes(value.polarity ?? 1)) selected = value;
        }
        if (!selected) return null;
        if (selected.intent==='employmentHistory.withEmployer') qualifiers.employer = field.employer || String(field.label || '').match(/(?:worked|work|employed) (?:for|with|by|at) (.+?)(?: as (?:an? )?(?:employee|contractor)|\?|$)/i)?.[1] || '';
        if (selected.qualifiers?.country) {
            // Model-provided geography cannot silently override the configured country.
            if (qualifiers.country && normalize(qualifiers.country)!==normalize(selected.qualifiers.country)) return null;
            qualifiers.country=selected.qualifiers.country;
        }
        const inverted = selected.intent==='workAuthorization.sponsorship' && /not (?:require|need)|without (?:any )?sponsorship/.test(label) ||
            selected.intent==='workAuthorization.eligible' && /not (?:legally )?(?:eligible|authori[sz]ed)/.test(label);
        const polarity = selected.polarity ?? (inverted ? -1 : 1);
        return {intent:selected.intent,qualifiers,polarity,confidence:selected.confidence || .95};
    }
    function selectFact(identity,profile) {
        const candidates = facts(profile).filter(fact=>fact.intent===identity.intent).filter(fact=>{
            if (fact.scope.country && normalize(fact.scope.country)!==normalize(identity.qualifiers.country)) return false;
            if (fact.scope.employer && !(` ${normalize(identity.qualifiers.employer)} `).includes(` ${normalize(fact.scope.employer)} `)) return false;
            if (fact.scope.language && identity.qualifiers.language && normalize(fact.scope.language)!==normalize(identity.qualifiers.language)) return false;
            if (fact.scope.index != null && identity.qualifiers.recordIndex != null && fact.scope.index!==identity.qualifiers.recordIndex) return false;
            return true;
        });
        const scoped = candidates.filter(fact=>fact.scope.employer || fact.scope.country || fact.profilePath.startsWith('customFields.'));
        const relevant = scoped.length ? scoped : candidates;
        if (new Set(relevant.map(fact=>JSON.stringify(fact.value))).size>1) return {error:'Conflicting saved answers'};
        return relevant[0] || null;
    }
    function render(fact,identity,field) {
        if (fact.type==='duration') return field.element?.type==='number' || field.inputType==='number' ? fact.value.amount : `${fact.value.amount} ${fact.value.unit}`;
        if (fact.type==='boolean') return identity.polarity === -1 ? !fact.value : fact.value;
        return fact.value;
    }
    function optionValue(answer,options,intent) {
        const text = normalize(answer);
        const candidates = options.filter(option=>{
            if(typeof answer==='boolean' && intent==='workAuthorization.eligible' &&
                /citizen|passport|\boci\b|visa|employment pass|residen|permit/i.test(option.label))return false;
            if (normalize(option.label)===text || normalize(option.value)===text) return true;
            if (intent==='personal.disability') {
                const label=normalize(option.label);
                const saved=bool(answer);
                if(saved!==null && /\bdisabilit/.test(label)) {
                    if(saved===false && /^no\b/.test(label) && /\b(?:don t|do not|not|no)\b/.test(label))return true;
                    if(saved===true && /^yes\b/.test(label) && !/\b(?:don t|do not|not)\b/.test(label))return true;
                }
                if(text==='prefer not to say' && /^(?:prefer not to say|i (?:do not wish|don t wish|choose not) to (?:answer|disclose)|decline to (?:answer|disclose))(?: |$)/.test(label))return true;
            }
            if(typeof answer==='boolean' && intent==='workday.accuracyAcknowledgement') {
                const label=normalize(option.label);
                if(answer && /(?:certify|warrant|declare).*(?:true|accurate|correct)/.test(label) && !/\bnot\b/.test(label))return true;
                if(!answer && /^(?:i )?(?:do not wish to agree|disagree)$/.test(label))return true;
            }
            if (typeof answer==='boolean') return /^(yes|no|true|false)\b/i.test(option.label.trim()) && bool(option.label.trim().split(/[\s,]/)[0])===answer;
            if (intent==='employment.noticePeriod') {
                const duration=parse(answer,'duration');
                const label=normalize(option.label);
                if (duration) {
                    if (duration.amount===0 && /^(immediate|immediately|available immediately|no notice)$/.test(label)) return true;
                    const unit=label.match(/\b(days?|weeks?|months?)\b/)?.[1]?.replace(/s?$/,'s');
                    const equivalent=unit===duration.unit ? duration.amount :
                        unit==='days' && duration.unit==='weeks' ? duration.amount*7 :
                        unit==='weeks' && duration.unit==='days' ? duration.amount/7 : null;
                    if (equivalent!=null) {
                        const raw=String(option.label).toLowerCase();
                        const range=raw.match(/^(\d+)\s*[-–]\s*(\d+)\s*(?:days?|weeks?|months?)$/);
                        if (range) return equivalent>=Number(range[1]) && equivalent<=Number(range[2]);
                        const exact=parse(option.label,'duration');
                        if (exact && exact.unit===unit) return equivalent===exact.amount;
                    }
                }
            }
            if (intent.startsWith('languages.') && intent!=='languages.language') return normalize(option.label).replace(/^\d+ /,'')===text;
            return false;
        });
        return candidates.length===1 ? candidates[0] : null;
    }
    function resolve(field,profile,suggestion=null,{options=field.optionDetails || []}={}) {
        const identity = identify(field,profile,suggestion);
        if (!identity) return null;
        if(identity.intent.startsWith('workday.') && !globalThis.WorkdayQuestions?.enabled(field,profile))return {identity,value:null,blocked:true,reason:'Workday question preferences are disabled or outside employer scope'};
        if (identity.intent==='review') return {identity,value:null,reason:'Review declaration or consent',blocked:true};
        let fact = selectFact(identity,profile);
        if (!fact && identity.intent==='employment.earliestStartDate') {
            const notice = selectFact({intent:'employment.noticePeriod',qualifiers:identity.qualifiers},profile);
            const anchor = profile.employment?.noticeStartDate || (profile.employment?.noticeStartMode==='today' ? new Date().toLocaleDateString('en-CA') : null);
            if (notice?.type==='duration' && anchor && ['days','weeks'].includes(notice.value.unit)) {
                const start = parse(anchor,'date');
                if (start) {
                    const date = new Date(start+'T00:00:00Z');
                    date.setUTCDate(date.getUTCDate()+notice.value.amount*(notice.value.unit==='weeks'?7:1));
                    fact={intent:identity.intent,value:date.toISOString().slice(0,10),type:'date',source:'derived',profilePath:notice.profilePath};
                }
            }
        }
        if (!fact || fact.error) return {identity,value:null,reason:fact?.error || 'Save an answer for '+identity.intent,blocked:true};
        const answer = render(fact,identity,field);
        let value = answer;
        if (['dropdown','combobox','radio'].includes(field.type)) {
            if (!options.length) return {identity,fact,answer,value:typeof answer==='boolean' ? answer?'Yes':'No' : answer,pendingOptions:true};
            const basis=identity.intent==='workAuthorization.eligible' && profile.applicationDefaults?.workAuthorizationBasis?.[identity.qualifiers.country];
            const exactBasis=basis ? options.filter(option=>normalize(option.label)===normalize(basis) &&
                bool(option.label.trim().split(/[\s,]/)[0])===answer) : [];
            const option = exactBasis.length===1 ? exactBasis[0] : optionValue(answer,options,identity.intent);
            if (!option) return {identity,fact,value:null,reason:'No unambiguous matching option',blocked:true};
            value=option.value;
        }
        if (field.type==='checkbox' && typeof answer!=='boolean') return {identity,value:null,blocked:true,reason:'Save a boolean answer for this checkbox'};
        return {identity,fact,answer,value,confidence:1,profilePath:fact.profilePath,reason:fact.source==='user_default'?'Configured previous-employment default':'Saved answer: '+identity.intent};
    }
    function validateMapping(field,mapping,profile) {
        const resolved = resolve(field,profile,mapping);
        return !!resolved && !resolved.blocked && !resolved.pendingOptions && resolved.value!=null &&
            String(resolved.value)===String(mapping.value) && Number(mapping.confidence)>=.9;
    }
    globalThis.SemanticResolver = {registry,version,normalize,question,facts,parse,identify,resolve,optionValue,bindingKey,validateMapping,
        setBindings:value=>{bindings=value || {};}};
})();
