const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
function widget({labels=['sklearn'],answer={optionIndex:0,confidence:.95}}={}) {
    const chips=[],clicks=[],requests=[];
    const ctx=vm.createContext({console:{log(){},warn(){}},setTimeout,clearTimeout,
        Event:class{constructor(type){this.type=type}},KeyboardEvent:class{constructor(type){this.type=type}},
        chrome:{runtime:{sendMessage:async message=>{requests.push(message);return answer;}}}});
    ctx.el={id:'skills--skills',tagName:'INPUT',value:'',isConnected:true,
        getAttribute:key=>key==='data-uxi-widget-type'?'selectinput':null,
        closest:()=>({querySelectorAll:()=>chips.map(label=>({getAttribute:()=>label}))}),
        focus(){},click(){},blur(){},dispatchEvent(){}};
    ctx.options=labels.map(label=>({textContent:label,getAttribute:()=>null,
        click(){clicks.push(label);chips.push(label);}}));
    vm.runInContext(source('core/skill-aliases.js')+source('content/autofill-engine.js'),ctx);
    vm.runInContext('autofillEngine.getNativeValueSetter=()=>null;autofillEngine.findDropdownOptions=()=>options;autofillEngine.optionWaitTimeout=1;',ctx);
    return {ctx,chips,clicks,requests};
}
test('explicit skill aliases match equivalent names and preserve related technologies',()=>{
    const {ctx}=widget();
    for(const [a,b] of [['JS','JavaScript'],['React','React.js'],['TS','TypeScript'],['K8s','Kubernetes'],['Postgres','PostgreSQL'],['AWS','Amazon Web Services']])
        assert.equal(ctx.SkillAliases.matches(a,b),true,`${a}/${b}`);
    for(const [a,b] of [['Java','JavaScript'],['React','React Native'],['Angular','AngularJS'],['SQL','Microsoft SQL Server'],['C','C++'],['.NET','ASP.NET']])
        assert.equal(ctx.SkillAliases.matches(a,b),false,`${a}/${b}`);
    assert.equal(ctx.SkillAliases.searchTerm('JS'),'JavaScript');
    assert.equal(ctx.SkillAliases.searchTerm('K8s'),'Kubernetes');
    assert.equal(ctx.SkillAliases.matches('CD','Continuous Delivery'),false);
});
test('alias matches add once without any AI request',async()=>{
    const {ctx,chips,requests}=widget({labels:['React Native','React.js']});
    const result=await vm.runInContext("autofillEngine.fill(el,['React','ReactJS'],'skills')",ctx);
    assert.equal(result.success,true);assert.equal(result.count,1);
    assert.deepEqual(chips,['React.js']);assert.equal(requests.length,0);
});
test('unmatched Workday skills automatically use only supplied options and verify chips',async()=>{
    const {ctx,chips,requests}=widget();
    const result=await vm.runInContext("autofillEngine.fill(el,['Scikit-learn'],'skills')",ctx);
    assert.equal(result.success,true);assert.deepEqual(chips,['sklearn']);
    assert.equal(result.resolutions['Scikit-learn'],'sklearn');
    assert.equal(requests.length,1);assert.deepEqual(Object.keys(requests[0].data),['skill','options']);
    ctx.document={querySelector:()=>null};ctx.location={href:'https://example.com/apply'};
    ctx.AdapterRegistry={detect:()=>({id:'generic',name:'Generic'})};
    vm.runInContext(source('adapters/runtime.js'),ctx);
    assert.equal((await vm.runInContext("activeAdapter.verify(el,['sklearn'],'skills')",ctx)).verified,true);
    assert.equal((await vm.runInContext("activeAdapter.fill(el,['Scikit-learn'],'skills')",ctx)).verified,true);
    assert.deepEqual(chips,['sklearn']);
});
test('invalid AI indices and low confidence never select fallback options',async()=>{
    for(const answer of [{optionIndex:9,confidence:1},{optionIndex:0,confidence:.5},{optionIndex:null}]){
        const {ctx,clicks}=widget({answer});
        const result=await vm.runInContext("autofillEngine.fill(el,['Scikit-learn'],'skills')",ctx);
        assert.equal(result.success,false);assert.deepEqual(clicks,[]);
    }
});
test('non-Workday fields and empty skill search results never call skill AI',async()=>{
    for(const mode of ['otherField','otherPlatform','empty']) {
        const {ctx,requests}=widget({labels:mode==='empty'?[]:['sklearn']});
        if(mode==='otherField')ctx.el.id='generic-skills';
        if(mode==='otherPlatform')ctx.el.getAttribute=()=>null;
        await vm.runInContext("autofillEngine.fill(el,['Scikit-learn'],'skills')",ctx);
        assert.equal(requests.length,0,mode);
    }
});
test('an unresolved skill is skipped while the next skill still gets added',async()=>{
    const {ctx,chips,requests}=widget({labels:['React.js'],answer:{optionIndex:null}});
    const result=await vm.runInContext("autofillEngine.fill(el,['Unavailable','React'],'skills')",ctx);
    assert.deepEqual(Array.from(result.missing),['Unavailable']);
    assert.deepEqual(chips,['React.js']);assert.equal(requests.length,1);
});
test('AI skill fallback cannot select stale options or overwrite a newer user edit',async()=>{
    for(const mode of ['stale','edit']) {
        const {ctx,clicks}=widget();
        ctx.FieldPipeline={canCommit:()=>true};
        ctx.chrome.runtime.sendMessage=async()=>{
            if(mode==='stale')ctx.options=[];
            else ctx.FieldPipeline.canCommit=()=>false;
            return {optionIndex:0,confidence:1};
        };
        const result=await vm.runInContext("autofillEngine.fill(el,['Scikit-learn'],'skills')",ctx);
        assert.equal(result.success,false);assert.deepEqual(clicks,[]);
    }
});
test('skill API deduplicates requests, caches abstentions and validates provider responses',async()=>{
    const ctx=vm.createContext({console,setTimeout,clearTimeout});
    vm.runInContext(source('llm/orchestrator.js').replace(/^import .*;$/m,'').replace('export class','class'),ctx);
    let calls=0,prompt='';ctx.provider=async p=>{calls++;prompt=p;return JSON.stringify({optionIndex:0,confidence:.95});};
    vm.runInContext('globalThis.ai=new LLMOrchestrator();ai.callLLM=provider;globalThis.settings={apiKey:"test",provider:"gemini"}',ctx);
    const results=await vm.runInContext('Promise.all([ai.matchSkill("Scikit-learn",["sklearn"],settings),ai.matchSkill("Scikit-learn",["sklearn"],settings)])',ctx);
    assert.equal(results[0].optionIndex,0);assert.equal(calls,1);assert.ok(!prompt.includes('USER PROFILE'));
    await vm.runInContext('ai.matchSkill("Scikit-learn",["sklearn"],settings)',ctx);assert.equal(calls,1);
    ctx.ai.callLLM=async()=>{calls++;return '{"optionIndex":99,"confidence":1}';};
    assert.equal((await vm.runInContext('ai.matchSkill("Scikit-learn",["Different"],settings)',ctx)).optionIndex,null);
    await vm.runInContext('ai.matchSkill("Scikit-learn",["Different"],settings)',ctx);assert.equal(calls,2);
    await vm.runInContext('ai.matchSkill("Scikit-learn",[],settings)',ctx);assert.equal(calls,2);
});
