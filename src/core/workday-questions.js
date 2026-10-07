/** Workday categories use explicit saved answers, never population guesses. */
(() => {
    const registry=[
        ['familyRelationship','Family relationship with an employee'],
        ['restrictiveAgreement','Non-competition or non-solicitation restrictions'],
        ['ipOwnership','Ownership or economic interest in intellectual property'],
        ['secondaryEmployment','Intention to retain outside employment or business activity'],
        ['governmentRelationship','Government official involvement or close relationship'],
        ['accuracyAcknowledgement','Acknowledgement of consequences of false application information']
    ].map(([key,label])=>({id:'workday.'+key,key,label,type:'boolean',aliases:[]}));
    const enabled=(field,profile)=>{
        if(field.adapter!=='workday' || !profile.workdayQuestions?.enabled)return false;
        const employer=String(profile.workdayQuestions.employer || '').trim().toLowerCase();
        if(!employer)return true;
        try {
            const host=new URL(field.pageContext?.url).hostname.split('.')[0].toLowerCase();
            return host===employer.replace(/\s+/g,'') || String(field.pageContext?.company || '').toLowerCase()===employer;
        } catch{return false;}
    };
    const classifiable=(field,profile)=>enabled(field,profile) && ['dropdown','combobox','radio','checkbox'].includes(field.type) &&
        !/privacy|\bterms\b|\bconsent\b|marketing|\bsms\b|processing.*(?:data|information)|(?:data|information).*processing/i.test(field.label || '');
    function identify(field,profile,suggestion) {
        if(!classifiable(field,profile))return null;
        const label=String(field.label || '').toLowerCase();
        // Privacy, terms, marketing and data-processing consent are separate.
        let key;
        if(/government official/.test(label) && /relationship|worked|working|business/.test(label))key='governmentRelationship';
        else if(/immediate family member|family member.*(?:employee|employer|company)|(?:employee|employer|company).*family member/.test(label))key='familyRelationship';
        else if(/non[- ]?competition|non[- ]?solicitation|non[- ]?compete/.test(label))key='restrictiveAgreement';
        else if(/(?:own|control|economic interest).*intellectual property/.test(label))key='ipOwnership';
        else if(/(?:maintain|retain|intend|engage).*(?:secondary|outside|non[- ][a-z][a-z -]*).*(?:employment|business)/.test(label))key='secondaryEmployment';
        else if(/(?:false information|misrepresentation|omission of facts|information.*(?:true|accurate))/.test(label) && /understand|agree|certify|declare|undertake/.test(label))key='accuracyAcknowledgement';
        // Inverted wording is classified by AI rather than a positive-question rule.
        if(/\bnot (?:an?|have|own|control|sign|intend|maintain)|\bno (?:family|restrictions|interest)/.test(label))key=null;
        if(key)return {intent:'workday.'+key,qualifiers:{},polarity:1,confidence:1};
        if(registry.some(item=>item.id===suggestion?.intent) && suggestion.confidence>=.9 && [1,-1].includes(suggestion.polarity ?? 1))
            return {intent:suggestion.intent,qualifiers:{},polarity:suggestion.polarity ?? 1,confidence:suggestion.confidence};
        return null;
    }
    globalThis.WorkdayQuestions={registry,enabled,classifiable,identify};
})();
