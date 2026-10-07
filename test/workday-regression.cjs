const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
test('autofill class mutations and unchanged form scans settle; replacement fields still get processed', async () => {
    let observer, scheduled, scans=0, fills=0;
    const makeElement=()=>({id:'workExperience-7--currentlyWorkHere',checked:false,isConnected:true,
        getAttribute:key=>key==='class'?'workday-checkbox sja-autofilled sja-autofilled-exact':null,
        closest:()=>null,matches:()=>true});
    let el=makeElement();
    const ctx=context({window:{addEventListener(){}},Node:{ELEMENT_NODE:1},
        document:{readyState:'complete',body:{},addEventListener(){},querySelectorAll:s=>s==='fields'?[el]:[]},
        MutationObserver:class{constructor(fn){observer=fn}observe(){}},debounce:fn=>()=>{scheduled=fn},
        inlineUI:{init(){},showPageStatus(){},updatePageStatus(){},setPageBusy(){},addFieldIndicators(){},highlightField(){}},
        FieldExtractor:{FIELD_SELECTORS:'fields'},MIN_FORM_FIELDS:1,CONFIDENCE:{HIGH:.9,MEDIUM:.7},FIELD_SOURCE:{USER:'user'},
        fieldExtractor:{shouldSkipField:()=>false,getCurrentValue:()=>'',extractAllFields:()=>[{id:'current',element:el,type:'checkbox',matchConfidence:1,matchedValue:false}]},
        deterministicMatcher:{matchAllFields:fields=>{scans++;return fields}},
        sessionCache:{get:()=>null,set(){}},autofillEngine:{fill(){fills++;return {success:true}}},
        MESSAGE_TYPES:{GET_PROFILE:'GET_PROFILE'},DEFAULT_PROFILE:{},deepClone:x=>x,
        chrome:{runtime:{async sendMessage(){return {profile:{experience:[{current:false}]}}},onMessage:{addListener(){}}}}});
    vm.runInContext(source('content/content.js'),ctx);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(scans,1); assert.equal(fills,1);
    observer([{type:'attributes',attributeName:'class',oldValue:'workday-checkbox',target:el}]);
    assert.equal(scheduled,undefined); // our highlight is not a scan trigger
    observer([{type:'attributes',attributeName:'style',target:el}]);
    scheduled(); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(scans,1); assert.equal(fills,1); // page styling can't restart filling
    const old=el; el=makeElement(); old.isConnected=false;
    observer([{type:'childList',target:{},addedNodes:[{...el,nodeType:1}],removedNodes:[]}]);
    scheduled(); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(scans,2); assert.equal(fills,2);
});
test('transparent native checkbox is detected when its visible Workday wrapper remains interactive', () => {
    const styles = new Map();
    const wrapper = {getBoundingClientRect:()=>({width:24,height:24})};
    const input = {type:'checkbox',parentElement:wrapper,getBoundingClientRect:()=>({width:24,height:24})};
    styles.set(wrapper,{display:'block',visibility:'visible',opacity:'1'});
    styles.set(input,{display:'block',visibility:'visible',opacity:'0'});
    const ctx=context({window:{getComputedStyle:el=>styles.get(el)}});
    vm.runInContext(source('utils/helpers.js'),ctx);
    ctx.input=input;
    assert.equal(vm.runInContext('isElementVisible(input)',ctx),true);
    input.type='text';
    assert.equal(vm.runInContext('isElementVisible(input)',ctx),false);
    input.type='checkbox';
    styles.set(wrapper,{display:'none'});
    assert.equal(vm.runInContext('isElementVisible(input)',ctx),false);
});

test('same-value textarea repair triggers React change after a stale tracker fill', () => {
    let tracker='Stored description', committed='', focused=false;
    class Textarea {
        constructor() {this.id='workExperience-7--roleDescription';this.tagName='TEXTAREA';this._value=tracker;}
        get value(){return this._value;}
        set value(v){this._value=v;}
        focus(){focused=true;}
        blur(){focused=false;}
        dispatchEvent(event){if(event.type==='input' && tracker!==this.value){tracker=this.value;committed=this.value;}}
        getAttribute(name){return name==='aria-invalid'?'true':null;}
        closest(){return null;}
    }
    const ctx=context({HTMLTextAreaElement:Textarea,Event:class{constructor(type){this.type=type}}});
    ctx.el=new Textarea();
    vm.runInContext(source('content/autofill-engine.js'),ctx);
    assert.equal(vm.runInContext("autofillEngine.needsValueCommit(el,el.value)",ctx),true);
    vm.runInContext('autofillEngine.fillTextInput(el,el.value)',ctx);
    assert.equal(committed,'Stored description');
    assert.equal(ctx.el.value,'Stored description');
    assert.equal(focused,false);
});
test('repeated sections wait for insertion, stay scoped, and are idempotent across rescans', async () => {
    let experience = ['workExperience-7--jobTitle'], languages = [], clicks = [];
    const section = (type, ids) => ({isConnected:true, querySelectorAll(selector) {
        return selector === '[id]' ? ids.map(id=>({id})) : [{textContent:'Add Another',click(){
            clicks.push(type);
            setTimeout(()=>ids.push(`${type}-${ids.length + 10}--${type === 'language' ? 'language' : 'jobTitle'}`),5);
        }}];
    }});
    const sections = {'Work-Experience-section':section('workExperience',experience),'Languages-section':section('language',languages)};
    const ctx = context({document:{getElementById:id=>sections[id]?{parentElement:sections[id]}:null},isElementVisible:()=>true});
    vm.runInContext(source('content/autofill-engine.js'),ctx);
    ctx.profile = {experience:[{},{},{}],languages:['English','Hindi']};
    const issues = await vm.runInContext('autofillEngine.ensureProfileSections(profile)',ctx);
    assert.deepEqual(Array.from(issues),[]);
    assert.deepEqual(clicks,['workExperience','workExperience','language','language']);
    await vm.runInContext('autofillEngine.ensureProfileSections(profile)',ctx);
    assert.equal(clicks.length,4);
    sections['Languages-section'].querySelectorAll = selector=>selector === '[id]' ? [{id:'language-10--language'}] : [];
    assert.match((await vm.runInContext('autofillEngine.ensureProfileSections(profile)',ctx))[0],/manually/);
});

test('language matching uses labels for dynamic proficiency IDs and respects per-language overrides', () => {
    const ctx=context();
    vm.runInContext(source('utils/constants.js') + source('utils/helpers.js') + source('content/deterministic-matcher.js'),ctx);
    ctx.profile={languages:['English',{language:'Hindi',reading:'Intermediate',overall:'Advanced',native:true}]};
    for (const [index,leaf,label,expected] of [
        [0,'language','Language','English'],[1,'language','Language','Hindi'],
        [0,'uuid123','Overall','Fluent'],[0,'uuid234','Reading','Fluent'],
        [1,'uuid234','Reading','Intermediate'],[1,'uuid123','Overall','Advanced'],
        [0,'uuid345','Speaking','Fluent'],[0,'uuid456','Writing','Fluent'],[0,'uuid567','Comprehension','Fluent'],
        [0,'native','I am fluent in this language.',true],[1,'native','I am fluent in this language.',false],
        [0,'native','Native language',false],[1,'native','Native language',true],
        [2,'language','Language',null],[0,'unknown','Unknown rating',null]
    ]) {
        ctx.field={recordType:'language',recordIndex:index,label,element:{id:`language-195--${leaf}`}};
        const result=vm.runInContext('deterministicMatcher.matchField(field,profile)',ctx);
        assert.equal(result.value,expected,`${index} ${label}`);
    }
});

test('language fluency checkbox uses native click and preserves explicit false', () => {
    let clicked=0;
    const el={id:'language-1--native',value:'false',checked:false,click(){this.checked=!this.checked;clicked++}};
    const ctx=context(); ctx.el=el;
    vm.runInContext(source('content/autofill-engine.js'),ctx);
    vm.runInContext('autofillEngine.fillCheckbox(el,false)',ctx);
    assert.equal(clicked,0);
    vm.runInContext('autofillEngine.fillCheckbox(el,true)',ctx);
    assert.equal(el.checked,true);
    assert.equal(clicked,1);
});

test('numbered language proficiency chooses Fluent and never a contradictory partial match', async () => {
    let selected = '';
    const option = text => ({textContent:text,scrollIntoView(){},click(){selected=text},dispatchEvent(){}});
    const ctx=context({document:{body:{click(){}}},MouseEvent:class {}});
    ctx.el={id:'language-195--dynamic-rating',click(){},dispatchEvent(){}};
    ctx.options=[option('Not Fluent'),option('5 - Fluent')];
    vm.runInContext(source('content/autofill-engine.js'),ctx);
    vm.runInContext('autofillEngine.waitForDropdownOptions = async () => options',ctx);
    assert.equal((await vm.runInContext("autofillEngine.fillCustomDropdown(el,'Fluent')",ctx)).success,true);
    assert.equal(selected,'5 - Fluent');
    ctx.options=[option('Not Fluent')]; selected='';
    assert.equal((await vm.runInContext("autofillEngine.fillCustomDropdown(el,'Fluent')",ctx)).success,false);
    assert.equal(selected,'');
});

test('skills allow the full bounded taxonomy search wait before Enter fallback', async () => {
    let timeout;
    const ctx=context({Event:class {},KeyboardEvent:class {}});
    ctx.el={id:'skills--skills',value:'',isConnected:true,getAttribute:()=>null,focus(){},click(){},dispatchEvent(){}};
    vm.runInContext(source('content/autofill-engine.js'),ctx);
    ctx.capture = t=>{timeout=t};
    vm.runInContext(`autofillEngine.selectedLabels=()=>[]; autofillEngine.getNativeValueSetter=()=>null;
        autofillEngine.waitForMatch=async (el,value,t)=>{capture(t);return null}`,ctx);
    await vm.runInContext("autofillEngine.fillComboboxInput(el,'Java')",ctx);
    assert.equal(timeout,2000);
});
test('Workday segmented dates commit through real focus and blur, including unchanged visible years', () => {
    let active = null, committed = '', events = [];
    class Input {
        constructor() { this.id = 'education-8--firstYearAttended-dateSectionYear-input'; this.tagName = 'INPUT'; this.type = 'text'; this.value = '2020'; }
        focus() { active = this; events.push('focusin'); }
        dispatchEvent(event) { events.push(event.type); }
        blur() { if (active === this) { committed = this.value; active = null; events.push('focusout'); } }
        getAttribute(name) { return name === 'aria-invalid' ? 'true' : null; }
        closest() { return {getAttribute: () => 'hiddenDateValueId ERROR'}; }
    }
    const ctx = context({HTMLInputElement: Input, Event: class {constructor(type) {this.type = type;}}});
    vm.runInContext(source('content/autofill-engine.js'), ctx);
    ctx.el = new Input();
    vm.runInContext(`globalThis.repair = autofillEngine.needsDateCommit(el, '2020'); globalThis.result = autofillEngine.fillTextInput(el, '2020');`, ctx);
    assert.equal(ctx.repair, true);
    assert.equal(ctx.result.success, true);
    assert.equal(committed, '2020');
    assert.deepEqual(events, ['focusin', 'input', 'input', 'change', 'focusout']);
    vm.runInContext(`globalThis.repair = autofillEngine.needsDateCommit(el, '2021')`, ctx);
    assert.equal(ctx.repair, false); // never replace a different existing year
});
function context(extra = {}) {
    return vm.createContext({ console: {log() {}, error() {}, warn() {}}, setTimeout, clearTimeout, ...extra });
}
test('explicit Autofill recommits invalid visible dates even when cached as user entries', async () => {
    let click, fills = 0;
    const el = {id:'education-8--firstYearAttended-dateSectionYear-input',value:'2020',isConnected:true};
    const field = {id:el.id,type:'text',element:el,currentValue:'2020',matchConfidence:.95,matchedValue:'2020'};
    const ctx = context({window:{addEventListener(){}},document:{readyState:'complete',body:{},addEventListener(){},querySelectorAll:s=>s==='fields'?[el]:[]},
        MutationObserver:class{observe(){}},debounce:fn=>fn,
        inlineUI:{init(){},showPageStatus(text,fn){click=fn},updatePageStatus(){},setPageBusy(){},addFieldIndicators(){},highlightField(){}},
        FieldExtractor:{FIELD_SELECTORS:'fields'},MIN_FORM_FIELDS:1,CONFIDENCE:{HIGH:.9,MEDIUM:.7},FIELD_SOURCE:{USER:'user'},
        fieldExtractor:{shouldSkipField:()=>false,extractAllFields:()=>[field],getCurrentValue:e=>e.value},
        deterministicMatcher:{matchAllFields:fs=>fs},sessionCache:{get:()=>({source:'user'}),set(){}},
        autofillEngine:{needsDateCommit:(e,v)=>e.value===v,fill(){fills++;return {success:true}}},
        MESSAGE_TYPES:{GET_PROFILE:'GET_PROFILE'},DEFAULT_PROFILE:{},deepClone:x=>x,
        chrome:{runtime:{async sendMessage(){return {profile:{education:[{startDate:'2020'}]}}},onMessage:{addListener(){}}}}});
    vm.runInContext(source('content/content.js'),ctx);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(fills,0);
    await click();
    assert.equal(fills,1);
    el.value='2021';
    await click();
    assert.equal(fills,1);
});
test('Workday dropdowns are detected; selected values and stable identity survive rescans', () => {
    const ctx = context({window: {}, document: {querySelector() {return null}}, isElementVisible: () => true,
        generateId: () => 'stable', normalizeFieldName: s => s, getNearbyText: () => '', isLongFormQuestion: () => false});
    vm.runInContext(source('content/field-extractor.js'), ctx);
    vm.runInContext(`
        const el = {tagName:'BUTTON', type:'button', id:'address--countryRegion', name:'countryRegion',
            dataset:{}, textContent:'Select One', getAttribute: k => k === 'aria-haspopup' ? 'listbox' : null,
            matches: () => true, closest: () => null};
        globalThis.skipped = fieldExtractor.shouldSkipField(el);
        globalThis.type = fieldExtractor.normalizeFieldType(el);
        globalThis.empty = fieldExtractor.getCurrentValue(el);
        const first = fieldExtractor.extractFieldData(el, 1);
        el.textContent = 'Karnataka';
        globalThis.selected = fieldExtractor.getCurrentValue(el);
        globalThis.stable = first.id === fieldExtractor.extractFieldData(el, 7).id;
        el.disabled = true;
        globalThis.disabledSkipped = fieldExtractor.shouldSkipField(el);
    `, ctx);
    assert.equal(ctx.skipped, false);
    assert.equal(ctx.type, 'combobox');
    assert.equal(ctx.empty, '');
    assert.equal(ctx.selected, 'Karnataka');
    assert.equal(ctx.stable, true);
    assert.equal(ctx.disabledSkipped, true);
});
test('Workday first name and phone use specific semantic fields', () => {
    const ctx = context();
    vm.runInContext(source('utils/constants.js') + source('utils/helpers.js') + source('content/deterministic-matcher.js'), ctx);
    for (const [id, expected] of [['name--legalName--firstName', 'Ada'], ['phoneNumber--phoneNumber', '1234567890']]) {
        ctx.id = id;
        vm.runInContext(`globalThis.result = deterministicMatcher.matchField({id, element:{id}}, {contact:{firstName:'Ada', phone:'1234567890'}})`, ctx);
        assert.equal(ctx.result.value, expected);
        assert.ok(ctx.result.confidence >= .9);
    }
});
test('SPA insertion is not lost when unrelated mutations follow; async fill preserves existing/manual entries', async () => {
    let observer, listener, fills = [], statuses = [], timer;
    let fields = [];
    const cache = new Map();
    const ctx = context({
        window: {addEventListener(){}}, Node:{ELEMENT_NODE:1},
        document: {readyState:'complete', body:{}, addEventListener(){}, querySelectorAll: selector => selector === 'fields' ? fields.map(f=>f.element) : []},
        MutationObserver: class {constructor(fn){observer=fn} observe(){} disconnect(){}},
        debounce: fn => () => { timer = fn; },
        inlineUI: {init(){}, showPageStatus(){}, updatePageStatus(s){statuses.push(s)}, setPageBusy(){}, addFieldIndicators(){}, highlightField(){}},
        fieldExtractor: {shouldSkipField:()=>false, extractAllFields:()=>fields, getCurrentValue:el=>el.value || ''},
        FieldExtractor:{FIELD_SELECTORS:'fields'}, MIN_FORM_FIELDS:1,
        CONFIDENCE:{HIGH:.9,MEDIUM:.7}, FIELD_SOURCE:{USER:'user'},
        MESSAGE_TYPES:{GET_PROFILE:'GET_PROFILE'}, DEFAULT_PROFILE:{}, deepClone:x=>x,
        deterministicMatcher:{matchAllFields:fs=>fs},
        sessionCache:{get:id=>id==='manual'?{source:'user'}:cache.get(id), set(id,data){cache.set(id,data)}, getStats(){return {}}},
        autofillEngine:{async fill(el){await new Promise(r=>setTimeout(r,5)); fills.push(el.id); el.value='Ada'; return {success:true}}},
        chrome:{runtime:{async sendMessage(){return {profile:{contact:{firstName:'Ada'}}}}, onMessage:{addListener(fn){listener=fn}}}}
    });
    vm.runInContext(source('content/content.js'),ctx);
    await new Promise(r=>setImmediate(r));
    const field = (id, value='') => ({id,element:{id,value,isConnected:true},currentValue:value,matchConfidence:.95,matchedValue:'Ada'});
    fields = [field('new'),field('existing','Workday resume name'),field('manual')];
    const relevantNode = {nodeType:1,matches:s=>s==='fields',querySelector:()=>null};
    const irrelevantNode = {nodeType:1,matches:()=>false,querySelector:()=>null};
    observer([{type:'childList',target:{},addedNodes:[relevantNode],removedNodes:[]}]);
    observer([{type:'childList',target:{},addedNodes:[irrelevantNode],removedNodes:[]}]);
    assert.equal(typeof timer,'function');
    timer();
    assert.deepEqual(fills,[]); // promise hasn't completed yet
    await new Promise(r=>setTimeout(r,30));
    assert.deepEqual(fills,['new']);
    assert.ok(statuses.some(s=>s.includes('3 fields detected · 2 have answers · 1 filled from profile')));
    assert.equal(typeof listener,'function');
});

test('Indian Workday numbers use national digits while ordinary phone inputs retain their format', () => {
    const ctx = context({document:{getElementById:id=>id==='country--country'?{textContent:'India'}:null}});
    vm.runInContext(source('content/autofill-engine.js'),ctx);
    for (const number of ['+91 98765-43210','919876543210','0091 9876543210','9876543210']) {
        ctx.number = number;
        vm.runInContext(`globalThis.result = autofillEngine.normalizePhoneValue({id:'phoneNumber--phoneNumber'}, number)`,ctx);
        assert.equal(ctx.result,'9876543210');
    }
    vm.runInContext(`globalThis.result = autofillEngine.normalizePhoneValue({id:'phone'}, '+91 9876543210')`,ctx);
    assert.equal(ctx.result,'+91 9876543210');
    ctx.document.getElementById = () => ({textContent:'United States'});
    vm.runInContext(`globalThis.result = autofillEngine.normalizePhoneValue({id:'phoneNumber--phoneNumber'}, '+91 9876543210')`,ctx);
    assert.equal(ctx.result,'919876543210');
});

test('previous employment defaults to No and supports an explicit saved Yes', () => {
    const ctx = context();
    vm.runInContext(source('utils/constants.js') + source('utils/helpers.js') + source('content/deterministic-matcher.js'),ctx);
    vm.runInContext(`globalThis.result = deterministicMatcher.matchField({id:'prior', name:'candidateIsPreviousWorker'}, {})`,ctx);
    assert.equal(ctx.result.value,'No');
    vm.runInContext(`globalThis.result = deterministicMatcher.matchField({id:'prior', name:'candidateIsPreviousWorker'}, {applicationDefaults:{previouslyEmployed:true}})`,ctx);
    assert.equal(ctx.result.value,'Yes');
    vm.runInContext(`globalThis.result = deterministicMatcher.matchField({id:'consent',name:'consent',type:'radio',label:'Do you agree to share your data?',normalizedHints:[],combinedHint:''}, {})`,ctx);
    assert.equal(ctx.result.value,null);
});

test('No selects Workday false radio; existing Yes is visible from either group member', () => {
    const group = [];
    const root = {querySelectorAll:()=>group};
    for (const value of ['true','false']) group.push({
        id:value,name:'candidateIsPreviousWorker',type:'radio',value,checked:false,
        getAttribute:()=>null, getRootNode:()=>root, click(){for(const r of group) r.checked=r===this}, dispatchEvent(){},
    });
    const ctx=context({document:{},Event:class {}});
    ctx.group=group;
    vm.runInContext(source('content/autofill-engine.js') + source('content/field-extractor.js'),ctx);
    vm.runInContext(`globalThis.result = autofillEngine.fillRadio(group[0], 'No')`,ctx);
    assert.equal(ctx.result.success,true);
    assert.equal(group[1].checked,true);
    group[0].click();
    vm.runInContext(`globalThis.current = fieldExtractor.getCurrentValue(group[1])`,ctx);
    assert.equal(ctx.current,'true');
});

test('skills commits exact options and free text chips, preserves existing chips and reports failures', async () => {
    const labels=['Python'], typed=[], clicked=[];
    const chips=()=>labels.map(label=>({getAttribute:()=>label}));
    const el={id:'skills--skills',tagName:'INPUT',value:'',isConnected:true,
        getAttribute:key=>key==='data-uxi-widget-type'?'selectinput':null,
        closest:()=>({querySelectorAll:chips}),focus(){},click(){},blur(){},
        dispatchEvent(event){
            if(event.type==='input') typed.push(this.value);
            if(event.type==='keydown' && this.value==='C++') labels.push('C++');
        }};
    const ctx=context({document:{},Event:class {constructor(type){this.type=type}},KeyboardEvent:class {constructor(type){this.type=type}}});
    ctx.el=el;
    vm.runInContext(source('content/autofill-engine.js'),ctx);
    vm.runInContext(`autofillEngine.getNativeValueSetter = () => null; autofillEngine.optionWaitTimeout=15; autofillEngine.optionPollInterval=1`,ctx);
    ctx.exact={textContent:'Java',getAttribute:()=>null,click(){clicked.push('Java');labels.push('Java')}};
    ctx.wrong={textContent:'JavaScript',getAttribute:()=>null,click(){clicked.push('wrong')}};
    vm.runInContext(`autofillEngine.findDropdownOptions = () => [wrong, exact]`,ctx);
    const result=await vm.runInContext(`autofillEngine.fill(el,['Python','Java','java','C++','Unavailable'])`,ctx);
    assert.deepEqual(labels,['Python','Java','C++']);
    assert.deepEqual(clicked,['Java']);
    assert.equal(result.count,2);
    assert.deepEqual(Array.from(result.missing),['Unavailable']);
    assert.ok(!typed.includes('Python'));
    assert.equal(el.value,'');
});

test('skills select qualified taxonomy labels via checkbox and wait for committed chips', async () => {
    const labels=[],clicked=[];
    const el={id:'skills--skills',tagName:'INPUT',value:'',isConnected:true,
        getAttribute:key=>key==='data-uxi-widget-type'?'selectinput':null,
        closest:()=>({querySelectorAll:()=>labels.map(label=>({getAttribute:()=>label}))}),
        focus(){},click(){},blur(){},dispatchEvent(){}};
    const ctx=context({document:{},Event:class{constructor(type){this.type=type}},KeyboardEvent:class{}});
    ctx.el=el;
    vm.runInContext(source('content/autofill-engine.js'),ctx);
    const checkbox={click(){clicked.push('checkbox');labels.push('Java (Programming Language)');}};
    ctx.java={textContent:'Java (Programming Language)',getAttribute:()=>null,
        querySelector:selector=>selector.includes('checkbox')?checkbox:null,
        click(){throw new Error('Outer option is not the selection target');}};
    ctx.wrong={textContent:'JavaScript',getAttribute:()=>null,click(){throw new Error('Wrong skill');}};
    vm.runInContext('autofillEngine.getNativeValueSetter=()=>null; autofillEngine.findDropdownOptions=()=>[wrong,java]',ctx);
    const result=await vm.runInContext("autofillEngine.fill(el,['Java','java'])",ctx);
    assert.equal(result.success,true);assert.equal(result.count,1);
    assert.deepEqual(labels,['Java (Programming Language)']);assert.deepEqual(clicked,['checkbox']);
    assert.equal(await vm.runInContext("autofillEngine.skillLabelsMatch('JavaScript','Java')",ctx),false);
    const again=await vm.runInContext("autofillEngine.fillComboboxInput(el,'Java')",ctx);
    assert.equal(again.method,'comboboxInput:alreadySelected');
});

test('selected search-control chips count as saved values and skills map directly from profile', () => {
    const ctx=context();
    vm.runInContext(source('utils/constants.js') + source('utils/helpers.js') + source('content/field-extractor.js') + source('content/deterministic-matcher.js'),ctx);
    vm.runInContext(`
        const input={tagName:'INPUT',id:'skills--skills',getAttribute:()=> 'selectinput',
            closest:()=>({querySelectorAll:()=>[{getAttribute:()=> 'Java'}]})};
        globalThis.type=fieldExtractor.normalizeFieldType(input);
        globalThis.current=fieldExtractor.getCurrentValue(input);
        globalThis.match=deterministicMatcher.matchField({element:input}, {skills:['Java','Python']});
    `,ctx);
    assert.equal(ctx.type,'skills');
    assert.equal(ctx.current,'Java');
    assert.deepEqual(Array.from(ctx.match.value),['Java','Python']);
});

test('repeated Workday sections use their own entries, dates, and missing-record handling', () => {
    const ctx=context();
    vm.runInContext(source('utils/constants.js') + source('utils/helpers.js') + source('content/deterministic-matcher.js'),ctx);
    ctx.profile={experience:[{company:'First'},{company:'Second',startDate:'July 2024'}],education:[{major:'IT'}]};
    for(const [leaf,index,expected] of [['companyName',1,'Second'],['startDate-dateSectionMonth-input',1,'7'],['startDate-dateSectionYear-input',1,'2024'],['companyName',2,null]]) {
        ctx.field={element:{id:`workExperience-18--${leaf}`},recordType:'workExperience',recordIndex:index};
        vm.runInContext(`globalThis.result=deterministicMatcher.matchField(field,profile)`,ctx);
        assert.equal(ctx.result.value,expected);
    }
});

test('AI mapping failures reach the UI instead of being reported as zero answers', async () => {
    const ctx=context();
    vm.runInContext(source('llm/orchestrator.js').replace(/^import .*;$/m,'').replace('export class','class'),ctx);
    vm.runInContext(`globalThis.ai=new LLMOrchestrator(); ai.buildFieldMappingPrompt=()=> 'test'; ai.callLLM=async()=>{throw new Error('Provider HTTP 401')}`,ctx);
    await assert.rejects(vm.runInContext(`ai.batchMapFields([{id:'test'}],{}, {})`,ctx),/401/);
    vm.runInContext(`ai.callLLM=async()=> 'not json'`,ctx);
    await assert.rejects(vm.runInContext(`ai.batchMapFields([{id:'test'}],{}, {})`,ctx),/valid JSON/);
    vm.runInContext(`ai.callLLM=async()=> '{"mappings":[]}'`,ctx);
    const result=await vm.runInContext(`ai.batchMapFields([{id:'test'}],{}, {})`,ctx);
    assert.equal(result.length,0);
});

test('explicit Autofill adds saved skills despite manual-edit protection and status survives rescans', async () => {
    let click, observer, timer;
    const selected=['Java'], fills=[], statuses=[], cache=new Map([['skills',{source:'user'}]]);
    const el={id:'skills--skills',isConnected:true};
    const field={id:'skills',type:'skills',element:el,currentValue:'Java',matchConfidence:1,matchedValue:['Java','Python'],matchSource:'profile'};
    const ctx=context({window:{addEventListener(){}},Node:{ELEMENT_NODE:1},
        document:{readyState:'complete',body:{},addEventListener(){},querySelectorAll:selector=>selector==='fields'?[el]:[]},
        MutationObserver:class {constructor(fn){observer=fn}observe(){}},debounce:fn=>()=>{timer=fn},
        inlineUI:{init(){},showPageStatus(text,fn){click=fn},updatePageStatus(s){statuses.push(s)},setPageBusy(){},addFieldIndicators(){},highlightField(){}},
        FieldExtractor:{FIELD_SELECTORS:'fields'},MIN_FORM_FIELDS:1,CONFIDENCE:{HIGH:.9,MEDIUM:.7},FIELD_SOURCE:{USER:'user'},
        fieldExtractor:{shouldSkipField:()=>false,extractAllFields:()=>[field],getCurrentValue:()=>selected.join(', ')},
        deterministicMatcher:{matchAllFields:fs=>fs},sessionCache:{get:id=>cache.get(id),set(id,data){cache.set(id,data)}},
        autofillEngine:{selectedLabels:()=>selected,async fill(){fills.push('Python');selected.push('Python');return {success:true,missing:[]}}},
        MESSAGE_TYPES:{GET_PROFILE:'GET_PROFILE'},DEFAULT_PROFILE:{},deepClone:x=>x,
        chrome:{runtime:{async sendMessage(){return {profile:{skills:['Java','Python']}}},onMessage:{addListener(){}}}}});
    vm.runInContext(source('content/content.js'),ctx);
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(fills,[]);
    assert.ok(statuses.some(s=>s.includes('2 saved skills / 1 selected')));
    await click();
    assert.deepEqual(selected,['Java','Python']);
    observer([{type:'childList',target:{},addedNodes:[{nodeType:1,matches:s=>s==='fields',querySelector:()=>null}],removedNodes:[]}]);
    timer();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(fills,['Python']);
    assert.ok(statuses.at(-1).includes('1 filled from profile'));
    assert.ok(statuses.at(-1).includes('2 saved skills / 2 selected'));
});

test('Field of Study clicks the Workday leaf control and verifies the selected chip', async () => {
    const labels=[], root={querySelectorAll:()=>labels.map(text=>({getAttribute:()=>text}))};
    const label={getAttribute:()=> 'Information Technology'};
    const leaf={click(){labels.push('Information Technology')}};
    const option={textContent:'svg Information Technology not checked',getAttribute:()=>null,
        querySelector:selector=>selector.includes('promptOption')?label:leaf,
        click(){throw new Error('Outer row does not handle selection')}};
    const el={id:'education-8--fieldOfStudy',tagName:'INPUT',value:'',isConnected:true,
        getAttribute:()=> 'selectinput',closest:()=>root,focus(){},click(){},blur(){},dispatchEvent(){}};
    const ctx=context({document:{},Event:class {},el,option});
    vm.runInContext(source('content/autofill-engine.js'),ctx);
    vm.runInContext(`autofillEngine.getNativeValueSetter=()=>null; autofillEngine.findDropdownOptions=()=>[option];`,ctx);
    const result=await vm.runInContext(`autofillEngine.fill(el,'Information Technology','combobox')`,ctx);
    assert.equal(result.success,true);
    assert.deepEqual(labels,['Information Technology']);
    const existing=await vm.runInContext(`autofillEngine.fill(el,'Information Technology','combobox')`,ctx);
    assert.equal(existing.method,'comboboxInput:alreadySelected');
    assert.equal(labels.length,1);
});

test('failed study selection stops automatic retry loops and explicit Autofill retries once', async () => {
    let click, observer, timer, fills=0;
    const statuses=[],el={id:'education-8--fieldOfStudy',isConnected:true};
    const field={id:'study',name:'major',label:'Field of Study',type:'combobox',element:el,currentValue:'',matchConfidence:.95,matchedValue:'Information Technology'};
    const ctx=context({window:{addEventListener(){}},Node:{ELEMENT_NODE:1},
        document:{readyState:'complete',body:{},addEventListener(){},querySelectorAll:s=>s==='fields'?[el]:[]},
        MutationObserver:class{constructor(fn){observer=fn}observe(){}},debounce:fn=>()=>{timer=fn},
        inlineUI:{init(){},showPageStatus(text,fn){click=fn},updatePageStatus(s){statuses.push(s)},setPageBusy(){},addFieldIndicators(){},highlightField(){}},
        FieldExtractor:{FIELD_SELECTORS:'fields'},MIN_FORM_FIELDS:1,CONFIDENCE:{HIGH:.9,MEDIUM:.7},FIELD_SOURCE:{USER:'user'},
        fieldExtractor:{shouldSkipField:()=>false,extractAllFields:()=>[field],getCurrentValue:()=>''},
        deterministicMatcher:{matchAllFields:fs=>fs},sessionCache:{get:()=>null,set(){}},
        autofillEngine:{async fill(){fills++;return {success:false}}},
        MESSAGE_TYPES:{GET_PROFILE:'GET_PROFILE'},DEFAULT_PROFILE:{},deepClone:x=>x,
        chrome:{runtime:{async sendMessage(){return {profile:{education:[{major:'Information Technology'}]},mappings:[]}},onMessage:{addListener(){}}}}});
    vm.runInContext(source('content/content.js'),ctx);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(fills,1);
    observer([{type:'childList',target:{},addedNodes:[{nodeType:1,matches:s=>s==='fields',querySelector:()=>null}],removedNodes:[]}]);
    timer();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(fills,1);
    assert.ok(statuses.at(-1).includes('Check Field of Study'));
    await click();
    assert.equal(fills,2);
});

test('mapping cache deduplicates concurrent requests and remaps answers after field IDs change', async () => {
    let calls=0;
    const ctx=context();
    vm.runInContext(source('llm/orchestrator.js').replace(/^import .*;$/m,'').replace('export class','class'),ctx);
    ctx.request=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));return [{fieldId:'field-0',value:'answer'}]};
    vm.runInContext(`globalThis.ai=new LLMOrchestrator(); ai.requestFieldBatch=request`,ctx);
    const results=await vm.runInContext(`Promise.all([
        ai.mapFieldBatch([{id:'old',label:'Question'}],{}, {provider:'gemini',model:'test'}),
        ai.mapFieldBatch([{id:'new',label:'Question'}],{}, {provider:'gemini',model:'test'})
    ])`,ctx);
    assert.equal(calls,1);
    assert.equal(results[0][0].fieldId,'old');
    assert.equal(results[1][0].fieldId,'new');
    await vm.runInContext(`ai.mapFieldBatch([{id:'third',label:'Question'}],{}, {provider:'gemini',model:'test'})`,ctx);
    assert.equal(calls,1);
    await vm.runInContext(`ai.mapFieldBatch([{id:'fourth',label:'Question'}],{skills:['New skill']}, {provider:'gemini',model:'test'})`,ctx);
    assert.equal(calls,2);
});

test('429 stops retries, honors RetryInfo, and blocks further calls during cooldown', async () => {
    let calls=0;
    const ctx=context({AbortController,fetch:async()=>{calls++;return {ok:false,status:429,headers:{get:()=>null},json:async()=>({error:{message:'Quota exhausted',details:[{retryDelay:'120s'}]}})}}});
    vm.runInContext(source('llm/orchestrator.js').replace(/^import .*;$/m,'').replace('export class','class'),ctx);
    vm.runInContext(`globalThis.ai=new LLMOrchestrator(); globalThis.settings={apiKey:'fake',provider:'gemini',model:'test'}`,ctx);
    await assert.rejects(vm.runInContext(`ai.callLLM('prompt',settings)`,ctx),error=>error.status===429 && error.retryAfterMs===120000 && /Quota exhausted/.test(error.message));
    assert.equal(calls,1);
    await assert.rejects(vm.runInContext(`ai.callLLM('other prompt',settings)`,ctx),/wait/);
    assert.equal(calls,1);
});

test('automatic scans make zero AI requests and repeated Autofill does not resend unchanged unknown fields', async () => {
    let click,calls=0;
    const el={id:'question',isConnected:true};
    const field={id:'question',type:'textarea',element:el,currentValue:'',matchConfidence:0,matchedValue:null};
    const ctx=context({window:{addEventListener(){}},document:{readyState:'complete',body:{},addEventListener(){},querySelectorAll:s=>s==='fields'?[el]:[]},
        MutationObserver:class{observe(){}},debounce:fn=>fn,
        inlineUI:{init(){},showPageStatus(text,fn){click=fn},updatePageStatus(){},setPageBusy(){},addFieldIndicators(){}},
        FieldExtractor:{FIELD_SELECTORS:'fields'},MIN_FORM_FIELDS:1,CONFIDENCE:{HIGH:.9,MEDIUM:.7},FIELD_SOURCE:{USER:'user'},
        fieldExtractor:{shouldSkipField:()=>false,extractAllFields:()=>[field],getCurrentValue:()=>''},
        deterministicMatcher:{matchAllFields:fs=>fs},sessionCache:{get:()=>null,set(){}},autofillEngine:{},
        MESSAGE_TYPES:{GET_PROFILE:'GET_PROFILE',LLM_BATCH_REQUEST:'AI'},DEFAULT_PROFILE:{},deepClone:x=>x,
        chrome:{runtime:{async sendMessage(message){if(message.type==='AI'){calls++;return {mappings:[]}}return {profile:{skills:[]}}},onMessage:{addListener(){}}}}});
    vm.runInContext(source('content/content.js'),ctx);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls,0);
    await click();
    assert.equal(calls,1);
    await click();
    assert.equal(calls,1);
});
