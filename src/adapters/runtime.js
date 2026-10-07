/** Adapters own DOM operations; semantic decisions live in core/. */
(() => {
    class GenericAdapter {
        constructor(platform) { this.id = platform.id; this.name = platform.name; }
        detectApplication() { return this.id === 'generic' || AdapterRegistry.isApplication(location.href,document,AdapterRegistry.detect(location.href,document)); }
        formRoot() {
            const selectors = {workday:'[data-automation-id="jobApplicationPage"], [data-automation-id="applyFlowPage"]',
                greenhouse:'#application_form, #application',wellfound:'[role="dialog"] form, [data-test="application-form"], [data-testid="application-form"]',
                lever:'.application-form',phenom:'[data-ph-at-id="apply-form"], [data-ph-at-id="apply-form-container"], form.rjsf'};
            const identified = selectors[this.id] && document.querySelector(selectors[this.id]);
            if (identified) return identified;
            const forms=[...document.querySelectorAll('form, [role="form"]')];
            const ranked=forms.map(root=>({root,count:root.querySelectorAll(FieldExtractor.FIELD_SELECTORS).length})).sort((a,b)=>b.count-a.count);
            return ranked[0]?.root || document.querySelector('[role="main"], main') || document.body;
        }
        scanElements() { return this.formRoot().querySelectorAll(FieldExtractor.FIELD_SELECTORS); }
        extractFields() {
            return fieldExtractor.extractAllFields(this.formRoot()).map(field => ({...field,adapter:this.id,
                question:field.label,control:field.type,pageContext:{title:document.title,url:location.origin+location.pathname},constraints:{...field.constraints,inputType:field.element.type},
                stableKey:[this.id,field.name || field.element.id || '',field.label,field.recordType || '',field.recordIndex ?? ''].join('|')}));
        }
        readOptions(field) { return autofillEngine.captureFieldOptions(field); }
        readValue(element) { return fieldExtractor.getCurrentValue(element); }
        async fill(element,value,type,options={}) {
            const result = await autofillEngine.fill(element,value,type,options);
            if (!result.success) return result;
            const skills=type==='skills' ? (Array.isArray(value)?value:String(value).split(/[,;\n]/).map(skill=>skill.trim()).filter(Boolean)) : [];
            const expected = type==='skills' ? skills.map(skill=>result.resolutions?.[skill] || skill) : value;
            const verification = await this.verify(element,expected,type);
            return {...result,...verification};
        }
        async verify(element,value,type) {
            const normalize = text => String(text ?? '').trim().replace(/\s+/g,' ').toLowerCase();
            const expected = normalize(element.type==='tel' || element.id==='phoneNumber--phoneNumber' ? autofillEngine.normalizePhoneValue(element,value) : value);
            const matches = () => {
                if (!element.isConnected) return false;
                if (element.type === 'checkbox') return element.checked === (value === true || /^(true|yes|1)$/i.test(String(value)));
                if (type === 'skills') return value.every(skill => autofillEngine.selectedLabels(element).some(label => autofillEngine.skillLabelsMatch(label,skill)));
                if (element.getAttribute('data-uxi-widget-type') === 'selectinput') return autofillEngine.selectedLabels(element).some(label => normalize(label) === expected);
                return normalize(this.readValue(element)) === expected;
            };
            const start = Date.now();
            while (Date.now()-start < 400) {
                if (matches() && !(element.willValidate && element.validity?.valid === false)) return {success:true,verified:true};
                await new Promise(resolve => setTimeout(resolve,25));
            }
            return {success:false,verified:false,entered:matches(),method:'verification:needsReview'};
        }
        addRepeatedSection() { return Promise.resolve([]); }
        observeChanges(callback) {
            const observer = new MutationObserver(callback);
            let root=this.formRoot();
            const watch=()=>observer.observe(root,{childList:true,subtree:true,characterData:true,attributes:true,attributeOldValue:true,
                attributeFilter:['hidden','style','class','disabled','readonly','aria-label','aria-labelledby','aria-required','aria-invalid','value']});
            watch();
            const replacement=new MutationObserver(mutations=>{
                const next=this.formRoot();
                if (next!==root) {observer.disconnect();root=next;watch();callback(mutations);}
            });
            replacement.observe(document.body,{childList:true,subtree:true});
            return {disconnect(){observer.disconnect();replacement.disconnect();}};
        }

    }
    class WorkdayAdapter extends GenericAdapter {
        addRepeatedSection(profile, options) { return autofillEngine.ensureProfileSections(profile,options); }
    }
    // Native controls and ARIA widgets share the base implementation. Platform
    // classes provide a stable place for selectors/widget overrides as fixtures grow.
    class GreenhouseAdapter extends GenericAdapter {}
    class WellfoundAdapter extends GenericAdapter {}
    class LeverAdapter extends GenericAdapter {}
    class PhenomAdapter extends GenericAdapter {}
    const classes = {workday:WorkdayAdapter,greenhouse:GreenhouseAdapter,wellfound:WellfoundAdapter,lever:LeverAdapter,phenom:PhenomAdapter,generic:GenericAdapter};
    const platform = AdapterRegistry.detect(location.href,document);
    globalThis.activeAdapter = new (classes[platform.id] || GenericAdapter)(platform);
    globalThis.PlatformAdapters = classes;
})();
