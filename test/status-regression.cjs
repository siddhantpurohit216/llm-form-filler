const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
test('status includes pre-existing answers and retains attribution after Workday replaces nodes',async()=>{
    let listener;
    const cache=new Map(),statuses=[];
    const field=(id,htmlId,value)=>({id,label:htmlId,type:'text',element:{id:htmlId,value,isConnected:true},
        matchConfidence:1,matchedValue:'Ada',matchSource:'deterministic'});
    let fields=[field('first-1','firstName',''),field('last-1','lastName','Existing')];
    const ctx=vm.createContext({console:{log(){},error(){}},setTimeout,clearTimeout,
        window:{addEventListener(){}},document:{readyState:'complete',body:{},addEventListener(){},querySelectorAll:s=>s==='fields'?fields.map(f=>f.element):[]},
        MutationObserver:class{observe(){}},debounce:fn=>fn,
        inlineUI:{init(){},showPageStatus(){},updatePageStatus:text=>statuses.push(text),setPageBusy(){},addFieldIndicators(){},highlightField(){}},
        FieldExtractor:{FIELD_SELECTORS:'fields'},MIN_FORM_FIELDS:1,CONFIDENCE:{HIGH:.8,MEDIUM:.6},FIELD_SOURCE:{USER:'user',LLM:'llm',DETERMINISTIC:'deterministic'},
        fieldExtractor:{shouldSkipField:()=>false,extractAllFields:()=>fields,getCurrentValue:el=>el.value},
        deterministicMatcher:{matchAllFields:fs=>fs},sessionCache:{get:id=>cache.get(id),set:(id,value)=>cache.set(id,value)},
        autofillEngine:{fill(el,value){el.value=value;return {success:true};}},
        MESSAGE_TYPES:{GET_PROFILE:'GET_PROFILE'},DEFAULT_PROFILE:{},deepClone:x=>x,
        chrome:{runtime:{sendMessage:async()=>({profile:{contact:{firstName:'Ada'}}}),onMessage:{addListener:fn=>listener=fn}}}});
    vm.runInContext(source('content/content.js'),ctx);
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(statuses.at(-1),/2 fields detected · 2 have answers · 1 filled from profile · 1 already present/);
    fields=[field('first-2','firstName','Ada'),field('last-2','lastName','Existing')];
    const scan=()=>new Promise(resolve=>listener({type:'TRIGGER_AUTOFILL'},{},resolve));
    await scan();
    assert.match(statuses.at(-1),/2 have answers · 1 filled from profile · 1 already present/);
    fields[0].element.value='Changed by website';
    await scan();
    assert.match(statuses.at(-1),/2 have answers · 0 filled from profile · 2 already present/);
});
test('session cache retains explicit false answers',()=>{
    const ctx=vm.createContext({console:{log(){}},window:{addEventListener(){}},document:{addEventListener(){}},FIELD_SOURCE:{DETERMINISTIC:'deterministic'}});
    vm.runInContext(source('storage/session-cache.js')+';sessionCache.set("checkbox",{value:false});globalThis.answer=sessionCache.get("checkbox").value;',ctx);
    assert.equal(ctx.answer,false);
});
