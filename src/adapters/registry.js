/** Platform registry shared by the service worker, bootstrap and popup. */
(() => {
    const platforms = [
        {id:'workday',name:'Workday',hosts:['myworkdayjobs.com','myworkdaysite.com'],signature:'[data-automation-id="jobApplicationPage"], [data-automation-id="applyFlowPage"], [data-automation-id="legalNameSection"]'},
        {id:'greenhouse',name:'Greenhouse',hosts:['greenhouse.io','greenhouse.com'],signature:'#application_form, #application, [data-provides="application-form"]'},
        {id:'wellfound',name:'Wellfound',hosts:['wellfound.com'],signature:'form[action*="application"], [data-test="application-form"], [data-testid="application-form"]'},
        {id:'lever',name:'Lever',hosts:['jobs.lever.co'],signature:'.application-form, form[action*="apply"]'},
        {id:'phenom',name:'Phenom',hosts:['phenompeople.com','careers.fiserv.com','careers.wexinc.com'],signature:'[data-ph-at-id="apply-form"], [data-ph-at-id="apply-form-container"], [id^="QUESTIONNAIRE-"]'}
    ];
    const matches = platforms.flatMap(platform => platform.hosts.flatMap(host => [`https://${host}/*`,`https://*.${host}/*`]));
    const byURL = url => {
        try {
            const hostname = new URL(url).hostname.toLowerCase();
            return platforms.find(platform => platform.hosts.some(host => hostname === host || hostname.endsWith('.'+host))) || null;
        } catch { return null; }
    };
    function detect(url, document) {
        const host = byURL(url);
        if (host) return host;
        // On manually enabled/remembered company domains, require actual DOM signatures.
        return platforms.find(platform => document?.querySelector(platform.signature)) || {id:'generic',name:'This site'};
    }
    function isApplication(url, document, platform) {
        if (document?.querySelector(platform.signature || 'form, [role="form"]')) return true;
        try {
            const path = new URL(url).pathname;
            if (platform.id==='wellfound' && /\/jobs\//.test(path) && document?.querySelector('input[type="file"], [role="dialog"] form')) return true;
            return /(?:^|\/)(?:apply|application|applications)(?:\/|$)|\/jobs\/[^/]+\/applications?|\/application_form/i.test(path);
        } catch { return false; }
    }
    globalThis.AdapterRegistry = {platforms,matches,byURL,detect,isApplication,version:1};
})();
