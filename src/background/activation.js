import '../adapters/registry.js';
const scripts = ['src/adapters/registry.js','src/utils/constants.js','src/utils/helpers.js','src/utils/field-policy.js',
    'src/core/workday-questions.js','src/core/semantic.js','src/core/skill-aliases.js','src/storage/session-cache.js','src/content/field-extractor.js',
    'src/content/deterministic-matcher.js','src/content/autofill-engine.js','src/content/inline-ui.js',
    'src/adapters/runtime.js','src/core/field-pipeline.js','src/content/content.js'];
const inFlight = new Map();
let contextQueue=Promise.resolve();
let registrationQueue=Promise.resolve();
export async function activate(data, sender) {
    const tabId = sender.tab?.id ?? data.tabId;
    const frameId = sender.tab ? sender.frameId || 0 : 0;
    if (!Number.isInteger(tabId)) throw new Error('No active website tab');
    const tab = await chrome.tabs.get(tabId);
    // Content scripts identify their own frame. Popup messages identify the
    // selected tab; sender.url there is the extension's popup, not the website.
    const url = sender.tab ? (sender.url || tab.url) : tab.url;
    if (!/^https?:\/\//i.test(url || '')) throw new Error('Open a regular website to enable autofill');
    const origin = new URL(url).origin;
    if (!data.manual) {
        const {autofillSites=[],disabledAdapters=[]} = await chrome.storage.local.get(['autofillSites','disabledAdapters']);
        if (disabledAdapters.includes(AdapterRegistry.byURL(url)?.id)) throw new Error('Automatic activation is disabled for this platform');
        if (!AdapterRegistry.byURL(url) && !autofillSites.includes(origin)) throw new Error('Enable autofill manually on this site first');
    }
    const key = `${tabId}:${frameId}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const operation = (async () => {
        const target = {tabId,frameIds:[frameId]};
        if (!data.manual) {
            const [page]=await chrome.scripting.executeScript({target,func:()=>AdapterRegistry.isApplication(location.href,document,AdapterRegistry.detect(location.href,document))});
            if (!page?.result) throw new Error('No application form on this page');
        }
        // Guard before loading files with top-level class/const declarations.
        const [probe] = await chrome.scripting.executeScript({target,func:()=>!!window.__smartJobAutofillInitialized});
        if (!probe?.result) {
            await chrome.scripting.insertCSS({target,files:['styles/injected.css']});
            await chrome.scripting.executeScript({target,files:scripts});
        }
        const record=async()=>{
            const key='sjaFrames:'+tabId;
            const saved=await chrome.storage.session.get(key);
            await chrome.storage.session.set({[key]:{...saved[key],[frameId]:url}});
        };
        contextQueue=contextQueue.then(record,record);
        await contextQueue;
        return {success:true};
    })();
    inFlight.set(key,operation);
    try { return await operation; } finally { inFlight.delete(key); }
}
export async function rememberSite(origin) {
    const url = new URL(origin);
    if (!['https:','http:'].includes(url.protocol) || url.origin !== origin) throw new Error('Invalid website origin');
    if (!await chrome.permissions.contains({origins:[origin+'/*']})) throw new Error('Website access has not been granted');
    const {autofillSites=[]} = await chrome.storage.local.get('autofillSites');
    await chrome.storage.local.set({autofillSites:[...new Set([...autofillSites,origin])]});
    await registerSites();
    return {success:true};
}
export async function registerSites() {
    registrationQueue=registrationQueue.then(updateSiteRegistration,updateSiteRegistration);
    return registrationQueue;
}
async function updateSiteRegistration() {
    const {autofillSites=[]} = await chrome.storage.local.get('autofillSites');
    const allowed = [];
    for (const origin of autofillSites) {
        if (await chrome.permissions.contains({origins:[origin+'/*']})) allowed.push(origin+'/*');
    }
    const existing = await chrome.scripting.getRegisteredContentScripts({ids:['sja-remembered-sites']});
    if (existing.length) await chrome.scripting.unregisterContentScripts({ids:['sja-remembered-sites']});
    if (allowed.length) await chrome.scripting.registerContentScripts([{id:'sja-remembered-sites',matches:allowed,
        js:['src/adapters/registry.js','src/content/bootstrap.js'],runAt:'document_idle',allFrames:true,persistAcrossSessions:true}]);
}

/** Include supported cross-origin application frames that activated themselves. */
export async function pageStatus(tabId) {
    const key='sjaFrames:'+tabId;
    const saved=await chrome.storage.session.get(key);
    const frameIds=[...new Set([0,...Object.keys(saved[key] || {}).map(Number)])];
    const responses=await Promise.all(frameIds.map(async frameId=>{
        try {return {...await chrome.tabs.sendMessage(tabId,{type:'GET_FORM_STATUS'},{frameId}),frameId};}
        catch {return null;}
    }));
    const frames=responses.filter(Boolean);
    return {hasForm:frames.some(frame=>frame.hasForm),fieldCount:frames.reduce((sum,frame)=>sum+(frame.fieldCount || 0),0),frames};
}
export async function triggerPage(tabId) {
    const status=await pageStatus(tabId);
    const targets=status.frames.filter(frame=>frame.hasForm);
    if(!targets.length) targets.push({frameId:0});
    const results=await Promise.all(targets.map(frame=>chrome.tabs.sendMessage(tabId,{type:'TRIGGER_AUTOFILL'},{frameId:frame.frameId})));
    return {success:results.every(result=>result?.success),fieldCount:results.reduce((sum,result)=>sum+(result?.fieldCount || 0),0)};
}
