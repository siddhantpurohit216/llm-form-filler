/** Small loader. Runs only on supported or explicitly remembered origins. */
(() => {
    if (window.__sjaBootstrap) return;
    window.__sjaBootstrap = true;
    let pending = false;
    let observer;
    async function check() {
        if (pending || window.__smartJobAutofillInitialized) return;
        const platform = AdapterRegistry.detect(location.href, document);
        if (!AdapterRegistry.isApplication(location.href, document, platform)) return;
        pending = true;
        try {
            const {disabledAdapters=[]} = await chrome.storage.local.get('disabledAdapters');
            if (disabledAdapters.includes(platform.id)) return;
            const result = await chrome.runtime.sendMessage({type:'ACTIVATE_AUTOFILL',data:{manual:false}});
            if (result?.success) observer?.disconnect();
        } catch (error) { console.warn('[SmartJobAutofill] Activation unavailable:',error.message); }
        finally { pending = false; }
    }
    let timer;
    observer = new MutationObserver(mutations => {
        if (mutations.every(m => m.target.closest?.('[data-sja-ui]'))) return;
        clearTimeout(timer);
        timer = setTimeout(check, 300);
    });
    observer.observe(document.documentElement,{childList:true,subtree:true});
    window.addEventListener('popstate',check);
    check();
})();
