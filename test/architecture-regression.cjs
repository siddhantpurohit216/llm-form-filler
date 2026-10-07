const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
function core(extra={}) {
    const ctx=vm.createContext({URL,console:{log(){},error(){},warn(){}},setTimeout,clearTimeout,...extra});
    vm.runInContext(source('utils/field-policy.js')+source('core/semantic.js')+source('adapters/registry.js'),ctx);
    return ctx;
}
const field=(label,type='text',options=[])=>({id:'test',label,type,optionDetails:options.map(([label,value])=>({label,value}))});
test('registry restricts auto injection to supported domains and application routes',()=>{
    const {AdapterRegistry:r}=core();
    for(const [url,id] of [['https://foo.wd1.myworkdayjobs.com/job/1/apply','workday'],['https://boards.greenhouse.io/acme/jobs/12','greenhouse'],['https://wellfound.com/jobs/1','wellfound'],['https://jobs.lever.co/acme/1/apply','lever'],['https://careers.fiserv.com/us/en/apply','phenom']]) assert.equal(r.byURL(url).id,id);
    assert.equal(r.byURL('https://myworkdayjobs.com.evil.test/apply'),null);
    assert.equal(r.byURL('https://example.com/contact'),null);
    assert.equal(r.isApplication('https://wellfound.com/login',{querySelector:()=>null},r.byURL('https://wellfound.com/login')),false);
    const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json')));
    assert.ok(!manifest.content_scripts[0].matches.includes('<all_urls>'));
    assert.deepEqual(manifest.content_scripts[0].js,['src/adapters/registry.js','src/content/bootstrap.js']);
    assert.ok(manifest.permissions.includes('scripting'));
});
test('canonical profile answers resolve label variations and exact option values',()=>{
    const {SemanticResolver:r}=core();
    const p={customFields:{'Preferred language':'English',Gender:'Male','Notice period':'30 days'},employment:{noticePeriod:{amount:30,unit:'days'}}};
    assert.equal(r.resolve(field('What is your current notice period?'),p).value,'30 days');
    assert.equal(r.resolve(field('Please select the option which best defines your gender.','dropdown',[['Male','m-id'],['Female','f-id']]),p).value,'m-id');
    assert.equal(r.resolve(field('Your preferred communication language','dropdown',[['English','en']]),p).value,'en');
    assert.equal(r.resolve(field('Please select your gender','dropdown',[['Female','f-id']]),p).value,null);
    assert.equal(r.resolve(field('Gender'),{contact:{firstName:'John'}}).value,null);
    assert.equal(r.parse('2026-99-99','date'),null);
});
test('notice dates use explicit anchor, respect explicit date, and do not approximate months',()=>{
    const {SemanticResolver:r}=core();
    const f=field('What would be your earliest availability?','date');
    const p={employment:{noticePeriod:{amount:30,unit:'days'}}};
    assert.equal(r.resolve(f,p).value,null);
    p.employment.noticeStartDate='2026-10-07';
    assert.equal(r.resolve(f,p).value,'2026-11-06');
    p.employment.earliestStartDate='2026-12-01';
    assert.equal(r.resolve(f,p).value,'2026-12-01');
    p.employment.earliestStartDate=null;p.employment.noticePeriod.unit='months';
    assert.equal(r.resolve(f,p).value,null);
});
test('boolean polarity and country/employer scopes never use a conflicting personal fact',()=>{
    const {SemanticResolver:r}=core();
    const p={applicationDefaults:{applicationCountry:'India',workEligibility:{India:'Yes',Canada:'No'},requiresSponsorship:false,
        employerHistory:{Fiserv:true},previouslyEmployed:false}};
    assert.equal(r.resolve(field('Are you legally eligible to work here?','dropdown',[['Yes','y'],['No','n']]),p).value,'y');
    assert.equal(r.resolve(field('Can you work without sponsorship?','dropdown',[['Yes','y'],['No','n']]),p).value,'y');
    assert.equal(r.resolve(field('Are you NOT legally authorized to work?','dropdown',[['Yes','y'],['No','n']]),p).value,'n');
    assert.equal(r.resolve(field('Have you ever worked for Fiserv as an employee?','dropdown',[['Yes','y'],['No','n']]),p).value,'y');
    assert.equal(r.resolve(field('Have you ever worked for Another Company?','dropdown',[['Yes','y'],['No','n']]),p).value,'n');
    assert.equal(r.resolve(field('I agree to the terms and privacy policy','checkbox'),p).value,null);
});
test('duration ranges are explicit, ambiguous boundaries stay for review',()=>{
    const {SemanticResolver:r}=core();
    assert.equal(r.optionValue('30 days',[{label:'15-45 days',value:'range'}],'employment.noticePeriod').value,'range');
    assert.equal(r.optionValue('30 days',[{label:'0-30 days',value:'a'},{label:'30-60 days',value:'b'}],'employment.noticePeriod'),null);
    assert.equal(r.optionValue('30 days',[{label:'1 month',value:'month'}],'employment.noticePeriod'),null);
});
test('manually typed meanings disambiguate nomenclature, preserve false, and reject conflicts',()=>{
    const {SemanticResolver:r}=core();
    const p={customFields:{'Can join':'14','Relocate':'No'},customFieldMeta:{'Can join':{intent:'employment.noticePeriod',type:'duration',unit:'days'},Relocate:{intent:'preferences.relocation',type:'boolean'}}};
    assert.equal(r.resolve(field('Notice period'),p).value,'14 days');
    assert.equal(r.resolve(field('Are you willing to relocate?','checkbox'),p).value,false);
    p.customFields['Notice period']='30 days';
    assert.equal(r.resolve(field('Notice period'),p).value,null);
});
test('confirmed question mappings survive reload and are invalidated by changed options/version',()=>{
    const {SemanticResolver:r}=core();
    const f=field('Which source brought you here?','dropdown',[['LinkedIn','li']]);
    const key=r.bindingKey(f);
    r.setBindings({[key]:{intent:'application.source',polarity:1,qualifiers:{},confidence:1,version:r.version,confirmed:true}});
    assert.equal(r.resolve(f,{application:{source:'LinkedIn'}}).value,'li');
    assert.equal(r.resolve({...f,optionDetails:[{label:'Referral',value:'ref'}]},{application:{source:'LinkedIn'}}),null);
    r.setBindings({[key]:{intent:'application.source',confidence:1,version:0}});
    assert.equal(r.identify(f),null);
});
test('both AI entry points resolve known facts locally and classify unknown wording in one batch',async()=>{
    const ctx=core();
    vm.runInContext(source('llm/prompts.js').replaceAll('export const','const'),ctx);
    vm.runInContext(source('llm/orchestrator.js').replace(/^import .*;$/m,'').replace('export class','class'),ctx);
    vm.runInContext('globalThis.ai=new LLMOrchestrator();globalThis.calls=0;ai.callLLM=async()=>{calls++;return JSON.stringify([{fieldId:"field-0",intent:"application.source",polarity:1,confidence:.95}])}',ctx);
    ctx.profile={customFields:{Gender:'Male'},application:{source:'LinkedIn'}};
    ctx.known=field('Gender','dropdown',[['Male','m']]);
    ctx.unknown=field('Which channel led you to us?','dropdown',[['LinkedIn','li']]);
    assert.equal((await vm.runInContext('ai.generateFieldContent(known,"",profile,{})',ctx)).value,'m');
    assert.equal(ctx.calls,0);
    const mapped=await vm.runInContext('ai.batchMapFields([known, {...unknown,id:"unknown"}],profile,{})',ctx);
    assert.equal(mapped.length,2);assert.equal(mapped[1].value,'li');assert.equal(ctx.calls,1);
    ctx.profile.application.source='Referral';
    assert.equal((await vm.runInContext('ai.batchMapFields([unknown],profile,{})',ctx)).length,0);
});
test('adapter verification counts accepted values, not setter success, for every platform',async()=>{
    for(const hostname of ['acme.myworkdayjobs.com','boards.greenhouse.io','wellfound.com','jobs.lever.co','careers.fiserv.com','example.com']) {
        const element={isConnected:true,type:'text',value:'',getAttribute:()=>null};
        const ctx=core({location:{href:`https://${hostname}/apply`},document:{querySelector:()=>null},
            fieldExtractor:{getCurrentValue:el=>el.value},autofillEngine:{fill:async(el,value)=>{el.value=value;return {success:true}}}});
        vm.runInContext(source('adapters/runtime.js')+source('core/field-pipeline.js'),ctx);ctx.element=element;
        const result=await vm.runInContext('FieldPipeline.fill(element,"Alex","text")',ctx);
        assert.equal(result.verified,true,hostname);
        assert.equal(vm.runInContext('FieldPipeline.state(element).status',ctx),'verified');
    }
});

test('automatic and manual activation enforce origin access and deduplicate engine injection',async()=>{
    let executions=[],css=0,loaded=false;
    const ctx=core({chrome:{tabs:{get:async()=>({url:'https://example.com/apply'})},
        storage:{local:{get:async()=>({autofillSites:[]})},session:{get:async()=>({}),set:async()=>{}}},
        scripting:{executeScript:async options=>{executions.push(options);if(options.func)return [{result:loaded}];loaded=true;},insertCSS:async()=>{css++;}}}});
    vm.runInContext(source('background/activation.js').replace(/^import .*;$/m,'').replaceAll('export async function','async function'),ctx);
    await assert.rejects(vm.runInContext('activate({manual:false},{tab:{id:1},url:"https://example.com/apply",frameId:0})',ctx),/manually/);
    const [a,b]=await Promise.all([vm.runInContext('activate({tabId:1,manual:true},{url:"chrome-extension://test/src/popup/popup.html"})',ctx),vm.runInContext('activate({tabId:1,manual:true},{url:"chrome-extension://test/src/popup/popup.html"})',ctx)]);
    assert.equal(a.success,true);assert.equal(b.success,true);
    assert.equal(executions.filter(call=>call.files).length,1);assert.equal(css,1);
    await vm.runInContext('activate({tabId:1,manual:true},{url:"chrome-extension://test/src/popup/popup.html"})',ctx);
    assert.equal(executions.filter(call=>call.files).length,1);
    assert.ok(executions.find(call=>call.files).files.includes('src/core/semantic.js'));
    assert.equal(ctx.AdapterRegistry.byURL('https://careers.wexinc.com/us/en/apply').id,'phenom');
    const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json'),'utf8'));
    for(const pattern of ctx.AdapterRegistry.matches){
        assert.ok(manifest.content_scripts[0].matches.includes(pattern),pattern);
        assert.ok(manifest.host_permissions.includes(pattern),pattern);
    }
});
test('page autofill routes to active embedded forms and ignores stale frames',async()=>{
    const calls=[];
    const ctx=core({chrome:{storage:{session:{get:async()=>({'sjaFrames:1':{2:'https://jobs.lever.co/a',3:'https://old.test'}})}},
        tabs:{sendMessage:async(tabId,message,{frameId})=>{
            calls.push({type:message.type,frameId});
            if(frameId===3)throw new Error('Frame removed');
            if(message.type==='GET_FORM_STATUS')return {hasForm:frameId===2,fieldCount:frameId===2?4:0};
            return {success:true,fieldCount:4};
        }}}});
    vm.runInContext(source('background/activation.js').replace(/^import .*;$/m,'').replaceAll('export async function','async function'),ctx);
    const status=await vm.runInContext('pageStatus(1)',ctx);
    assert.equal(status.hasForm,true);assert.equal(status.fieldCount,4);
    const result=await vm.runInContext('triggerPage(1)',ctx);
    assert.equal(result.success,true);assert.equal(result.fieldCount,4);
    assert.deepEqual(calls.filter(call=>call.type==='TRIGGER_AUTOFILL'),[{type:'TRIGGER_AUTOFILL',frameId:2}]);
});
test('adapter rejects DOM-only setter success and guards user edits during async widget filling',async()=>{
    let listeners={};
    const element={isConnected:true,type:'text',value:'',getAttribute:()=>null};
    const ctx=core({location:{href:'https://example.com/apply'},document:{querySelector:()=>null,addEventListener:(event,fn)=>listeners[event]=fn},
        fieldExtractor:{getCurrentValue:el=>el.value},autofillEngine:{fill:async()=>({success:true})}});
    vm.runInContext(source('adapters/runtime.js')+source('core/field-pipeline.js'),ctx);ctx.element=element;
    const result=await vm.runInContext('FieldPipeline.fill(element,"Alex","text")',ctx);
    assert.equal(result.success,false);assert.equal(result.verified,false);
    let release;
    ctx.autofillEngine.fill=async()=>{await new Promise(resolve=>release=resolve);return {success:false};};
    const pending=vm.runInContext('FieldPipeline.fill(element,"New","text")',ctx);
    listeners.input({isTrusted:true,target:element});
    assert.equal(vm.runInContext('FieldPipeline.canCommit(element)',ctx),false);
    release();await pending;
});
test('explicit country in a question overrides default country and requires its own saved fact',()=>{
    const {SemanticResolver:r}=core();
    const p={applicationDefaults:{applicationCountry:'India',workEligibility:{India:'Yes',Canada:'No'}}};
    assert.equal(r.resolve(field('Are you legally authorized to work in Canada?','dropdown',[['Yes','y'],['No','n']]),p).value,'n');
    assert.equal(r.resolve(field('Are you legally authorized to work in Germany?','dropdown',[['Yes','y'],['No','n']]),p).value,null);
});
