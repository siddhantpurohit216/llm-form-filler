const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
function context(extra={}) {
    const ctx=vm.createContext({URL,console:{log(){},error(){},warn(){}},setTimeout,clearTimeout,...extra});
    vm.runInContext(source('utils/field-policy.js'),ctx);
    return ctx;
}
test('manual batch repairs a bad URL, sends choice DOM once, and keeps declaration for review',async()=>{
    let click,requests=[],fills=[];
    const el=(id,value='')=>({id,value,isConnected:true,tagName:'BUTTON',getAttribute:()=>null});
    const fields=[{id:'linkedin',label:'LinkedIn URL',type:'url',element:{...el('linkedin','A role description'),tagName:'INPUT'},currentValue:'A role description'},
        {id:'eligible',label:'Are you legally eligible to work in the country where this position is located?',type:'combobox',element:el('eligible'),currentValue:''},
        {id:'declaration',label:'I undertake that the information provided is true and accurate.',type:'combobox',element:el('declaration'),currentValue:''}];
    const profile={links:{linkedin:'https://linkedin.com/in/demo'},applicationDefaults:{applicationCountry:'India',workEligibility:{India:'Yes'}}};
    const cache=new Map([['linkedin',{source:'llm'}]]);
    const ctx=context({window:{addEventListener(){}},document:{readyState:'complete',body:{},addEventListener(){},querySelectorAll:s=>s==='fields'?fields.map(f=>f.element):[]},
        MutationObserver:class{observe(){}},debounce:fn=>fn,
        inlineUI:{init(){},showPageStatus(text,fn){click=fn},updatePageStatus(){},setPageBusy(){},addFieldIndicators(){},highlightField(){}},
        FieldExtractor:{FIELD_SELECTORS:'fields'},
        fieldExtractor:{shouldSkipField:()=>false,extractAllFields:()=>fields,getCurrentValue:e=>e.value},
        sessionCache:{get:id=>cache.get(id),set:(id,data)=>cache.set(id,data),remove:id=>cache.delete(id)},
        autofillEngine:{async fill(e,value){fills.push([e.id,value]);e.value=value;return {success:true}},
            async captureFieldOptions(){return [{label:'Yes, authorized',value:'yes-id'},{label:'No authorization',value:'no-id'}]}},
        chrome:{runtime:{async sendMessage(message){
            if(message.type==='AI'){requests.push(message.data);return {mappings:[{fieldId:'eligible',value:'yes-id',answer:'Yes',category:'work_eligibility',confidence:.95}]}}
            return {profile};},onMessage:{addListener(){}}}}});
    vm.runInContext(source('utils/constants.js')+source('utils/helpers.js')+source('content/deterministic-matcher.js'),ctx);
    vm.runInContext("MESSAGE_TYPES.LLM_BATCH_REQUEST='AI'",ctx);
    vm.runInContext(source('content/content.js'),ctx);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(requests.length,0);
    await click();
    assert.equal(requests.length,1);
    assert.deepEqual(requests[0].fields.map(f=>f.id),['eligible']);
    assert.equal(requests[0].fields[0].optionDetails[0].value,'yes-id');
    assert.deepEqual(fills,[['linkedin',''],['linkedin','https://linkedin.com/in/demo'],['eligible','Yes, authorized']]);
    assert.equal(fields[2].element.value,'');
});
test('URL fields match only saved links, despite nearby role descriptions and profile experience',()=>{
    const ctx=context();
    vm.runInContext(source('utils/constants.js')+source('utils/helpers.js')+source('content/deterministic-matcher.js'),ctx);
    ctx.field={label:'LinkedIn URL:',type:'text',isLongForm:true,combinedHint:'Employment Details Product Engineer role description',element:{id:'q123'}};
    ctx.profile={links:{linkedin:'https://www.linkedin.com/in/demo'},experience:[{description:'Architected an RBAC platform'}]};
    assert.equal(vm.runInContext('deterministicMatcher.matchField(field,profile)',ctx).value,ctx.profile.links.linkedin);
    ctx.profile.links.linkedin='Architected an RBAC platform';
    assert.equal(vm.runInContext('deterministicMatcher.matchField(field,profile)',ctx).value,null);
    const policy=ctx.FieldPolicy;
    assert.equal(policy.validURL('https://example.com/project','portfolio'),true);
    assert.equal(policy.validURL('https://example.com A project description','portfolio'),false);
    assert.equal(policy.validURL('https://linkedin.com.evil.test/in/demo','linkedin'),false);
    assert.equal(policy.validURL('javascript:alert(1)','url'),false);
});
test('choice mapping requires saved factual preferences and exact available options',()=>{
    const {FieldPolicy:policy}=context();
    const field={label:'Were you previously employed with Jiostar?',type:'combobox',optionDetails:[{label:'No, never employed here',value:'option-no'},{label:'Yes, former employee',value:'option-yes'}]};
    const profile={applicationDefaults:{previouslyEmployed:false}};
    const mapping={value:'option-no',answer:'No',category:'previous_employment',confidence:.95};
    assert.equal(policy.validate(field,mapping,profile),true);
    assert.equal(policy.validate(field,{...mapping,value:'invented'},profile),false);
    assert.equal(policy.validate(field,{...mapping,answer:'Yes'},profile),false);
    assert.equal(policy.validate(field,mapping,{}),true); // User-configured previous-employment default No.
    assert.equal(policy.validate({...field,label:'Are you a person suffering from any disability?'},{...mapping,category:'disability'},profile),false);
    assert.equal(policy.validate({...field,label:'Are you legally eligible to work in the country where this position is located?'},
        {...mapping,category:'work_eligibility'},{applicationDefaults:{applicationCountry:'India',workEligibility:{India:'No'}}}),true);
    assert.equal(policy.validate({...field,label:'I undertake that the information provided is true and accurate.'},mapping,profile),false);
});
test('DOM option capture preserves labels and values and closes the dropdown',async()=>{
    let opened=0,closed=0;
    const ctx=context({document:{body:{click(){closed++}}},KeyboardEvent:class{}});
    vm.runInContext(source('content/autofill-engine.js'),ctx);
    ctx.field={type:'combobox',element:{tagName:'BUTTON',isConnected:true,getAttribute:()=>null,click(){opened++},dispatchEvent(){},blur(){}}};
    ctx.options=[{id:'no-id',textContent:'No, never employed here',getAttribute:()=>null},
        {id:'yes-id',textContent:'Yes, former employee',getAttribute:()=>null}];
    vm.runInContext('autofillEngine.waitForDropdownOptions=async()=>options',ctx);
    const result=await vm.runInContext('autofillEngine.captureFieldOptions(field)',ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(result)),[{label:'No, never employed here',value:'no-id'},{label:'Yes, former employee',value:'yes-id'}]);
    assert.equal(opened,1);assert.equal(closed,1);
});
test('Gemini prompt retains option values and constraints; option changes invalidate cached mappings',async()=>{
    const ctx=context({FIELD_MAPPING_PROMPT:'{FIELDS}\n{PROFILE}'});
    vm.runInContext(source('llm/orchestrator.js').replace(/^import .*;$/m,'').replace('export class','class'),ctx);
    vm.runInContext('globalThis.ai=new LLMOrchestrator()',ctx);
    ctx.fields=[{id:'question',label:'Previously employed?',type:'combobox',optionDetails:[{label:'No, never',value:'no-id'}],constraints:{required:true},context:'Declaration',category:'previous_employment'}];
    const prompt=vm.runInContext('ai.buildFieldMappingPrompt(fields,{})',ctx);
    assert.match(prompt,/no-id/);assert.match(prompt,/required/);assert.match(prompt,/Declaration/);
    let calls=0;
    ctx.respond=()=>{calls++;return JSON.stringify([{fieldId:'field-0',value:'no-id',answer:'No',category:'previous_employment',confidence:.95}])};
    vm.runInContext('ai.callLLM=async()=>respond(); globalThis.profile={applicationDefaults:{previouslyEmployed:false}}',ctx);
    await vm.runInContext('ai.mapFieldBatch(fields,profile,{provider:"gemini"})',ctx);
    await vm.runInContext('ai.mapFieldBatch(fields,profile,{provider:"gemini"})',ctx);
    assert.equal(calls,1);
    ctx.fields[0].optionDetails=[{label:'No, never',value:'new-id'}];
    const rejected=await vm.runInContext('ai.mapFieldBatch(fields,profile,{provider:"gemini"})',ctx);
    assert.equal(calls,2); assert.equal(rejected.length,0);
});

test('gender question matches explicit saved custom profile value above auto-fill threshold',()=>{
    const ctx=context();
    vm.runInContext(source('utils/constants.js')+source('utils/helpers.js')+source('content/deterministic-matcher.js'),ctx);
    ctx.field={id:'QUESTIONNAIRE-6-748',name:'QUESTIONNAIRE-6-748',type:'dropdown',
        label:'Please select the option which best defines your gender.',normalizedHints:['pleaseselecttheoptionwhichbestdefinesyourgender'],combinedHint:'gender'};
    ctx.profile={customFields:{Gender:'Male'}};
    const result=vm.runInContext('deterministicMatcher.matchField(field,profile)',ctx);
    assert.equal(result.value,'Male');
    assert.equal(result.confidence,.9);
    assert.equal(result.profilePath,'customFields.Gender');
    assert.equal(result.strictChoice,true);
    ctx.profile={contact:{gender:'Female'}};
    assert.equal(vm.runInContext('deterministicMatcher.matchField(field,profile)',ctx).value,'Female');
    ctx.profile={contact:{firstName:'John'}};
    assert.equal(vm.runInContext('deterministicMatcher.matchField(field,profile)',ctx).value,null);
});

test('initial scan fills saved gender without AI and rejects a nonmatching gender option',async()=>{
    for (const optionLabel of ['Male','Female']) {
        const element={id:'QUESTIONNAIRE-6-748',value:'',isConnected:true,tagName:'SELECT',
            closest:()=>({contains:()=>true}),contains:()=>true,getAttribute:()=>null};
        const field={id:'gender',name:element.id,element,type:'dropdown',label:'Please select the option which best defines your gender.',
            normalizedHints:['gender'],combinedHint:'gender',allHints:['gender']};
        const cache=new Map(),fills=[],messages=[];let status='';
        const ctx=context({window:{addEventListener(){}},document:{readyState:'complete',body:{},addEventListener(){},querySelectorAll:()=>[element]},
            MutationObserver:class{observe(){}},debounce:fn=>fn,FieldExtractor:{FIELD_SELECTORS:'fields'},
            fieldExtractor:{shouldSkipField:()=>false,extractAllFields:()=>[field],getCurrentValue:e=>e.value},
            inlineUI:{init(){},showPageStatus(){},updatePageStatus:text=>status=text,setPageBusy(){},addFieldIndicators(){},highlightField(){}},
            sessionCache:{get:id=>cache.get(id),set:(id,data)=>cache.set(id,data)},
            autofillEngine:{captureFieldOptions:async()=>[{label:optionLabel,value:'option-id'}],
                fill:async(e,v)=>{fills.push(v);e.value=v;return {success:true}}},
            chrome:{runtime:{sendMessage:async m=>{messages.push(m.type);return {profile:{customFields:{Gender:'Male'}}}},onMessage:{addListener(){}}}}});
        vm.runInContext(source('utils/constants.js')+source('utils/helpers.js')+source('content/deterministic-matcher.js'),ctx);
        vm.runInContext(source('content/content.js'),ctx);
        await new Promise(r=>setImmediate(r));
        assert.deepEqual(fills,optionLabel==='Male'?['option-id']:[]);
        assert.equal(messages.length,1); // Only GET_PROFILE; no LLM call.
        assert.match(status,optionLabel==='Male'?/1 filled from profile/:/0 filled from profile/);
    }
});

test('custom profile fields fill by exact question and boilerplate wording without borrowing context',()=>{
    const ctx=context();
    vm.runInContext(source('utils/constants.js')+source('utils/helpers.js')+source('content/deterministic-matcher.js'),ctx);
    ctx.profile={customFields:{'Notice period':'30 days','Open to relocation':false}};
    ctx.field={label:'What is your notice period? *',name:'q-927',type:'dropdown',normalizedHints:[],combinedHint:''};
    let result=vm.runInContext('deterministicMatcher.matchField(field,profile)',ctx);
    assert.equal(result.value,'30 days');assert.equal(result.confidence,.9);assert.equal(result.strictChoice,true);
    ctx.field.label='Notice period';
    assert.equal(vm.runInContext('deterministicMatcher.matchField(field,profile)',ctx).confidence,.95);
    ctx.field.label='Open to relocation';ctx.field.type='checkbox';
    assert.equal(vm.runInContext('deterministicMatcher.matchField(field,profile)',ctx).value,false);
    ctx.field.label='Desired salary';ctx.field.nearbyText='Notice period';
    assert.equal(vm.runInContext('deterministicMatcher.matchCustomField(field,profile)',ctx),null);
    ctx.field.label='Do you NOT agree to relocate?';
    assert.equal(vm.runInContext('deterministicMatcher.matchCustomField(field,profile)',ctx),null);
    ctx.profile={customFields:{'Notice Period':'30 days','notice_period':'60 days'}};
    ctx.field.label='Notice period';
    assert.equal(vm.runInContext('deterministicMatcher.matchField(field,profile)',ctx).value,null);
});
