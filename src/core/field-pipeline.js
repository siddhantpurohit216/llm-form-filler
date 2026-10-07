/** Shared filling and verification for page autofill and field AI. */
(() => {
    const states = new WeakMap();
    const pending = new WeakMap();
    const revisions = new WeakMap();
    const started = new WeakMap();
    const track = event => {
        if (event.isTrusted && event.target) revisions.set(event.target,(revisions.get(event.target) || 0)+1);
    };
    if (typeof document !== 'undefined') {document.addEventListener?.('input',track,true);document.addEventListener?.('change',track,true);}
    const canCommit = element => !started.has(element) || started.get(element)===(revisions.get(element) || 0);
    async function fill(element,value,type,options={}) {
        if (!element?.isConnected || element.disabled || element.readOnly) return {success:false,method:'field:notEditable'};
        if (pending.has(element)) return {success:false,method:'field:busy'};
        states.set(element,{status:'attempted',value});
        started.set(element,revisions.get(element) || 0);
        const request = (async () => {
            try {
                const result = await activeAdapter.fill(element,value,type,options);
                states.set(element,{...result,status:result.verified?'verified':'needs_review',value});
                return result;
            } catch (error) {
                states.set(element,{status:'needs_review',value,error:error.message});
                return {success:false,verified:false,method:'adapter:error',error:error.message};
            }
        })();
        pending.set(element,request);
        try { return await request; } finally { pending.delete(element);started.delete(element); }
    }
    globalThis.FieldPipeline = {fill,canCommit,state:element=>states.get(element)};
})();
