const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
function setup(extra = {}) {
    const ctx = vm.createContext({URL, console, ...extra});
    vm.runInContext(source('utils/field-policy.js'), ctx);
    vm.runInContext(source('llm/prompts.js').replaceAll('export const', 'const'), ctx);
    vm.runInContext(source('llm/orchestrator.js').replace(/^import .*;$/m, '').replace('export class', 'class'), ctx);
    vm.runInContext('globalThis.ai = new LLMOrchestrator()', ctx);
    return ctx;
}
test('selected-field prompt sends full question, options, context and constraints without instructions', async () => {
    const ctx = setup();
    ctx.field = {label:'Preferred language?', type:'dropdown', inputType:'select-one',
        hints:['Communication'], context:'Application preferences', currentValue:'',
        optionDetails:[{label:'English (UK)', value:'en-GB'}], constraints:{required:true},
        pageContext:{title:'Apply to Acme', url:'https://example.com/apply'}};
    ctx.profile = {communication:{language:'English'}};
    ctx.response = {value:'en-GB', answer:'English', profilePath:'communication.language', confidence:.95};
    vm.runInContext('ai.callLLM = async prompt => {globalThis.prompt = prompt; return JSON.stringify([{fieldId:"field-0",...response}])}', ctx);
    const result = await vm.runInContext('ai.generateFieldContent(field,"",profile,{})', ctx);
    assert.equal(result.value, 'en-GB');
    for (const expected of ['English (UK)', 'en-GB', 'Communication', 'Application preferences', 'required', 'Apply to Acme', 'saved profile information']) assert.ok(ctx.prompt.includes(expected));
    vm.runInContext('ai.mappingCache.clear()', ctx);
    ctx.response.value = 'invented-option';
    assert.equal((await vm.runInContext('ai.generateFieldContent(field,"",profile,{})', ctx)).value, null);
});
test('field AI rejects invalid formats, bounds, missing facts and malformed responses', async () => {
    const ctx = setup();
    ctx.field = {label:'Notice period', type:'text', inputType:'number', constraints:{min:'0', max:'90'}};
    ctx.response = {value:'100', confidence:.95};
    vm.runInContext('ai.callLLM = async () => JSON.stringify([{fieldId:"field-0",...response}])', ctx);
    assert.equal((await vm.runInContext('ai.generateFieldContent(field,"",{},{})', ctx)).value, null);
    ctx.field = {label:'Code', type:'text', constraints:{pattern:'[A-Z]{3}'}};
    ctx.response.value = '123';
    assert.equal((await vm.runInContext('ai.generateFieldContent(field,"",{},{})', ctx)).value, null);
    ctx.field = {label:'Are you legally eligible to work here?', type:'dropdown', optionDetails:[{label:'Yes',value:'yes'}]};
    ctx.response = {value:'yes', answer:'Yes', category:'work_eligibility', confidence:.95};
    assert.equal((await vm.runInContext('ai.generateFieldContent(field,"",{},{})', ctx)).value, null);
    vm.runInContext('ai.callLLM = async () => "unstructured answer"', ctx);
    assert.equal((await vm.runInContext('ai.generateFieldContent(field,"",{},{})', ctx)).value, null);
});
test('checkbox AI supports explicit false without guessing', async () => {
    const ctx = setup();
    ctx.field = {label:'Open to relocation?', type:'checkbox'};
    ctx.profile = {preferences:{relocation:false}};
    ctx.response = {value:false, answer:false, profilePath:'preferences.relocation', confidence:.95};
    vm.runInContext('ai.callLLM = async () => JSON.stringify([{fieldId:"field-0",...response}])', ctx);
    assert.equal((await vm.runInContext('ai.generateFieldContent(field,"",profile,{})', ctx)).value, false);
    vm.runInContext('ai.mappingCache.clear()', ctx);
    ctx.response.value = true;
    assert.equal((await vm.runInContext('ai.generateFieldContent(field,"",profile,{})', ctx)).value, null);
});
function uiSetup() {
    let request, resolve, fills = [];
    const element = {isConnected:true, tagName:'BUTTON', value:'', type:'button'};
    const field = {id:'selected', label:'Preferred language?', name:'language', type:'combobox', allHints:['Language'], nearbyText:'Communication', constraints:{required:true}};
    field.element = element;
    const ctx = vm.createContext({console, setTimeout, document:{title:'Apply'}, location:{origin:'https://example.com',pathname:'/apply'},
        MESSAGE_TYPES:{LLM_FIELD_GENERATE:'FIELD_AI'}, FIELD_SOURCE:{LLM:'llm'},
        fieldExtractor:{refreshField:()=>field, getCurrentValue:e=>e.value},
        autofillEngine:{captureFieldOptions:async()=>[{label:'English',value:'en'}], fill:async(e,v,t)=>{fills.push([e,v,t]);e.value=v;return {success:true}}},
        sessionCache:{set(){}}, chrome:{runtime:{sendMessage:message=>{request=message;return new Promise(r=>resolve=r)}}}});
    vm.runInContext(source('content/inline-ui.js'), ctx);
    vm.runInContext('inlineUI.updateConfidenceIndicator=()=>{};inlineUI.highlightField=()=>{}',ctx);
    ctx.element = element;
    return {ctx,element,fills,get request(){return request}, reply:r=>resolve(r)};
}
test('selected-field action targets one control and preserves edits made during AI request',async()=>{
    const ui = uiSetup();
    const pending = vm.runInContext('inlineUI.fillSelectedFieldWithAI(element)', ui.ctx);
    await new Promise(r=>setImmediate(r));
    assert.equal(ui.request.data.fieldInfo.optionDetails[0].value,'en');
    assert.equal(ui.request.data.fieldInfo.constraints.required,true);
    assert.equal(ui.request.data.userPrompt,'');
    ui.element.value = 'user edit';
    ui.reply({value:'en',confidence:.95});
    await assert.rejects(pending,/field changed/);
    assert.equal(ui.fills.length,0);
    const retry = vm.runInContext('inlineUI.fillSelectedFieldWithAI(element)', ui.ctx);
    await new Promise(r=>setImmediate(r));
    ui.reply({value:'en',confidence:.95});
    await retry;
    assert.equal(ui.fills.length,1);
    assert.equal(ui.fills[0][0],ui.element);
    assert.equal(ui.fills[0][1],'English');
});
test('closing field AI prevents delayed response from filling the control',async()=>{
    const ui = uiSetup();
    const pending = vm.runInContext('inlineUI.fillSelectedFieldWithAI(element,"",()=>false)', ui.ctx);
    await new Promise(r=>setImmediate(r));
    ui.reply({value:'en',confidence:.95});
    await assert.rejects(pending,/cancelled/);
    assert.equal(ui.fills.length,0);
});
function extractorContext(document) {
    const ctx = vm.createContext({console, document});
    vm.runInContext(source('content/field-extractor.js'), ctx);
    return ctx;
}
test('nested questionnaire control gets its own visible question instead of its technical label',()=>{
    const question = {tagName:'DIV',textContent:'Please select the option which best defines your gender.\n *',
        matches:()=>false,querySelector:()=>null,previousElementSibling:null};
    const wrapper = {previousElementSibling:question, querySelectorAll:()=>[], parentElement:null};
    const fieldGroup = {querySelectorAll:selector=>selector.startsWith('input')?[element]:[], parentElement:null};
    const element = {id:'QUESTIONNAIRE-6-748', getAttribute:()=>null, closest:()=>null,
        previousElementSibling:null, parentElement:wrapper, contains:()=>false};
    wrapper.parentElement = fieldGroup;
    const ctx = extractorContext({querySelector:()=>({textContent:'QUESTIONNAIRE-6-748'})});
    ctx.element=element;
    assert.equal(vm.runInContext('fieldExtractor.findLabelText(element)',ctx),
        'Please select the option which best defines your gender.');
});
test('question label fallback does not borrow a neighbouring field question',()=>{
    const element={id:'question',getAttribute:()=>null,closest:()=>null,previousElementSibling:null,contains:()=>false};
    const neighbour={contains:()=>false};
    element.parentElement={querySelectorAll:()=>[element,neighbour],previousElementSibling:null};
    const ctx=extractorContext({querySelector:()=>null});ctx.element=element;
    assert.equal(vm.runInContext('fieldExtractor.findLabelText(element)',ctx),'');
});
test('AI modal refreshes stale label metadata before displaying selected question',()=>{
    const modal={dataset:{}};
    const ctx=vm.createContext({console,document:{createElement:()=>modal,body:{appendChild(){throw new Error('render captured')}}},
        fieldExtractor:{refreshField:()=>({label:'Please select the option which best defines your gender.'})}});
    vm.runInContext(source('content/inline-ui.js'),ctx);
    ctx.element={};
    vm.runInContext('inlineUI.closeAllModals=()=>{};inlineUI.escapeHtml=text=>text',ctx);
    assert.throws(()=>vm.runInContext('inlineUI.showGenerateModal(element,{label:"QUESTIONNAIRE-6-748"})',ctx),/render captured/);
    assert.ok(modal.innerHTML.includes('Please select the option which best defines your gender.'));
    assert.ok(!modal.innerHTML.includes('QUESTIONNAIRE-6-748'));
});


test('AI fill waits for stale native validation and does not trigger invalid events', async () => {
    const ui = uiSetup();
    ui.element.willValidate = true;
    ui.element.validity = {valid:false};
    ui.element.checkValidity = () => {throw new Error('Must not dispatch invalid events');};
    const pending = vm.runInContext('inlineUI.fillSelectedFieldWithAI(element)', ui.ctx);
    await new Promise(r=>setImmediate(r));
    ui.reply({value:'en',confidence:.95});
    setTimeout(()=>ui.element.validity.valid=true, 40);
    const result = await pending;
    assert.equal(result.needsReview,false);
    assert.equal(ui.element.value,'English');
});

test('a filled value with remaining validation is review status rather than fill failure', async () => {
    const ui = uiSetup();
    ui.element.willValidate = true;
    ui.element.validity = {valid:false};
    ui.element.validationMessage = 'Please check the format.';
    const pending = vm.runInContext('inlineUI.fillSelectedFieldWithAI(element)', ui.ctx);
    await new Promise(r=>setImmediate(r));
    ui.reply({value:'en',confidence:.95});
    const result = await pending;
    assert.equal(result.needsReview,true);
    assert.equal(result.validationMessage,'Please check the format.');
    assert.equal(ui.element.value,'English');
});

test('Fiserv question uses identical resolver for field AI and page batch with saved No', async () => {
    const ctx = setup();
    ctx.field = {id:'fiserv',label:'Are you currently or have you ever worked for Fiserv, First Data or any of their affiliates, subsidiaries or predecessors as an employee or contractor?',
        type:'dropdown', optionDetails:[{label:'Yes',value:'yes-id'},{label:'No',value:'no-id'}],constraints:{required:true}};
    ctx.profile = {applicationDefaults:{previouslyEmployed:false}};
    vm.runInContext(`globalThis.calls=0; ai.callLLM=async()=>{calls++;return JSON.stringify([{fieldId:'field-0',value:'no-id',answer:'No',category:'previous_employment',confidence:.95}])}`,ctx);
    const single = await vm.runInContext('ai.generateFieldContent(field,"",profile,{})',ctx);
    const batch = await vm.runInContext('ai.batchMapFields([field],profile,{})',ctx);
    assert.equal(single.value,'no-id');
    assert.equal(batch[0].value,single.value);
    assert.equal(ctx.calls,1); // Same prompt inputs use the same cache.
    ctx.profile = {};
    assert.equal((await vm.runInContext('ai.generateFieldContent(field,"",profile,{})',ctx)).value,'no-id');
    assert.equal((await vm.runInContext('ai.batchMapFields([field],profile,{})',ctx))[0].value,'no-id');
});

test('optional field instructions change shared prompt and cache without altering page answers',async()=>{
    const ctx=setup();ctx.field={id:'summary',label:'Why this role?',type:'textarea',isLongForm:true};
    vm.runInContext(`globalThis.prompts=[];ai.callLLM=async prompt=>{prompts.push(prompt);return JSON.stringify([{fieldId:'field-0',value:'Profile-based answer',confidence:.95}])}`,ctx);
    await vm.runInContext('ai.generateFieldContent(field,"Keep it concise",{},{})',ctx);
    await vm.runInContext('ai.batchMapFields([field],{},{})',ctx);
    assert.equal(ctx.prompts.length,2);
    assert.ok(ctx.prompts[0].includes('Keep it concise'));
    assert.ok(!ctx.prompts[1].includes('Keep it concise'));
});

test('native dropdown placeholders are unresolved even when they have nonempty values',()=>{
    const ctx=setup();vm.runInContext(source('content/field-extractor.js'),ctx);
    ctx.element={tagName:'SELECT',selectedIndex:0,value:'placeholder-748',options:[{textContent:'Please Select'}]};
    assert.equal(vm.runInContext('fieldExtractor.getCurrentValue(element)',ctx),'');
    ctx.element.options[0].textContent='No';ctx.element.value='no-id';
    assert.equal(vm.runInContext('fieldExtractor.getCurrentValue(element)',ctx),'no-id');
});

test('original field AI value-only response works through shared resolver using requested previous-employment default',async()=>{
    const ctx=setup();ctx.field={id:'fiserv',label:'Are you currently or have you ever worked for Fiserv as an employee or contractor?',type:'dropdown',optionDetails:[{label:'No',value:'no-id'},{label:'Yes',value:'yes-id'}]};
    vm.runInContext(`ai.callLLM=async()=>JSON.stringify({value:'No',confidence:.85})`,ctx);
    const single=await vm.runInContext('ai.generateFieldContent(field,"",{},{})',ctx);
    const batch=await vm.runInContext('ai.batchMapFields([field],{},{})',ctx);
    assert.equal(single.value,'no-id');assert.equal(batch[0].value,single.value);
    ctx.profile={applicationDefaults:{previouslyEmployed:true}};
    assert.equal((await vm.runInContext('ai.generateFieldContent(field,"",profile,{})',ctx)).value,null);
    assert.equal((await vm.runInContext('ai.batchMapFields([field],profile,{})',ctx)).length,0);
});

test('multi-field generation fills remaining questions in one call using requested No default',async()=>{
    const ctx=setup();
    ctx.fields=[{id:'fiserv',label:'Have you ever worked for Fiserv?',type:'dropdown',optionDetails:[{label:'No',value:'no-id'}]},
        {id:'summary',label:'Why are you interested?',type:'textarea',isLongForm:true}];
    vm.runInContext(`globalThis.calls=0;ai.callLLM=async()=>{calls++;return JSON.stringify([{fieldId:'field-0',value:'No',confidence:.85},{fieldId:'field-1',value:'I build reliable backend services.',confidence:.95}])}`,ctx);
    const result=await vm.runInContext('ai.batchMapFields(fields,{experience:[{description:"Build backend services"}]},{})',ctx);
    assert.equal(result.length,2);assert.equal(result[0].value,'no-id');assert.equal(result[1].fieldId,'summary');assert.equal(ctx.calls,1);
});
