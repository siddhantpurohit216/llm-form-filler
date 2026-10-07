const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
function setup(){
    const ctx=vm.createContext({URL,console:{log(){},error(){}},setTimeout,clearTimeout});
    vm.runInContext(source('core/workday-questions.js')+source('utils/field-policy.js')+source('core/semantic.js'),ctx);
    ctx.profile={workdayQuestions:{enabled:true,employer:'Intel',answers:{familyRelationship:false,restrictiveAgreement:false,ipOwnership:false,secondaryEmployment:false,governmentRelationship:false,accuracyAcknowledgement:true}},
        applicationDefaults:{applicationCountry:'India',workEligibility:{India:'Yes'}}};
    return ctx;
}
const field=label=>({id:label,label,adapter:'workday',type:'dropdown',pageContext:{url:'https://intel.wd1.myworkdayjobs.com/apply'},optionDetails:[{label:'Yes',value:'yes-id'},{label:'No',value:'no-id'}]});
test('disability options map explicit saved preferences without guessing a missing disclosure',()=>{
    const ctx=setup();
    const f={...field('Please indicate your disability status.'),optionDetails:[
        {label:"No, I don't have a disability (India)",value:'no-disability'},
        {label:'Yes, I have a disability (India)',value:'has-disability'}]};
    assert.equal(ctx.SemanticResolver.resolve(f,ctx.profile).blocked,true);
    ctx.profile.applicationDefaults.disability='No';
    assert.equal(ctx.SemanticResolver.resolve(f,ctx.profile).value,'no-disability');
    ctx.profile.applicationDefaults.disability='Yes';
    assert.equal(ctx.SemanticResolver.resolve(f,ctx.profile).value,'has-disability');
    f.optionDetails.push({label:'No, I do not have a disability (another region)',value:'other'});
    ctx.profile.applicationDefaults.disability='No';
    assert.equal(ctx.SemanticResolver.resolve(f,ctx.profile).blocked,true);
});
test('terms checkboxes require an explicit preference and exclude separate marketing choices',()=>{
    const ctx=setup();
    const terms={...field('Yes, I have read and consent to the terms and conditions'),type:'checkbox'};
    assert.equal(ctx.SemanticResolver.resolve(terms,ctx.profile).blocked,true);
    ctx.profile.applicationDefaults.acceptTerms=true;
    const answer=ctx.SemanticResolver.resolve(terms,ctx.profile);
    assert.equal(answer.value,true);
    assert.equal(ctx.FieldPolicy.validate(terms,{...answer,intent:answer.identity.intent},ctx.profile),true);
    for(const label of ['I accept the terms and conditions and marketing SMS','I consent to receive promotional SMS','I consent to join the talent network']) {
        const resolved=ctx.SemanticResolver.resolve({...terms,label},ctx.profile);
        assert.ok(!resolved || resolved.blocked);
    }
    ctx.profile.applicationDefaults.acceptTerms=false;
    assert.equal(ctx.SemanticResolver.resolve(terms,ctx.profile).blocked,true);
});
test('Intel question categories resolve explicit saved answers and real option values',()=>{
    const ctx=setup();
    for(const [label,value] of [
        ['Are you an immediate family member?','no-id'],
        ['Did you sign any non-competition or non-solicitation agreement with your current employer that might impact your work for Intel?','no-id'],
        ['Do you own, control or have an economic interest in any intellectual property right (patents, trademarks, or copyrights)?','no-id'],
        ['If hired, do you intend to maintain any secondary non-Intel employment or engage in a non-Intel business activity?','no-id'],
        ['Are you a government official who has worked with Intel or do you have a close relationship with a government official?','no-id'],
        ['I understand and agree that any false information, misrepresentation, or omission of facts will be justification for refusal to hire or termination.','yes-id'],
        ['Are you legally entitled to work in India for which you are applying and can provide evidence?','yes-id']]) {
        const f=field(label),answer=ctx.SemanticResolver.resolve(f,ctx.profile);
        assert.equal(answer.value,value,label);
        assert.equal(ctx.FieldPolicy.validate(f,{...answer,intent:answer.identity.intent},ctx.profile),true);
    }
});
test('Workday preferences never become guessed defaults or accept unrelated consent',()=>{
    const ctx=setup();
    for(const f of [{...field('Are you an immediate family member?'),adapter:'greenhouse'},
        {...field('Are you an immediate family member?'),pageContext:{url:'https://other.wd1.myworkdayjobs.com/apply'}},
        field('I agree to terms and conditions and the privacy policy.'),
        field('I agree to the Terms of Service.'),field('I consent to processing my information.')]) {
        const answer=ctx.SemanticResolver.resolve(f,ctx.profile,{intent:'workday.accuracyAcknowledgement',confidence:1});
        assert.ok(!answer || answer.blocked);assert.notEqual(answer?.value,'yes-id');
    }
    delete ctx.profile.workdayQuestions.answers.familyRelationship;
    assert.equal(ctx.SemanticResolver.resolve(field('Are you an immediate family member?'),ctx.profile).blocked,true);
    ctx.profile.workdayQuestions.enabled=false;
    assert.ok(!ctx.SemanticResolver.resolve(field('Are you an immediate family member?'),ctx.profile));
});
test('one AI batch classifies varied categories; app applies saved answers, not model guesses',async()=>{
    const ctx=setup();
    vm.runInContext(source('llm/prompts.js').replaceAll('export const','const')+source('llm/orchestrator.js').replace(/^import .*;$/m,'').replace('export class','class'),ctx);
    ctx.fields=[field('Disclose any related persons at the hiring organization.'),field('Will you keep any outside occupation after joining?')];
    let calls=0,prompt='';ctx.provider=async p=>{calls++;prompt=p;return JSON.stringify([
        {fieldId:'field-0',intent:'workday.familyRelationship',value:'yes-id',confidence:.95,polarity:1},
        {fieldId:'field-1',intent:'workday.secondaryEmployment',value:'yes-id',confidence:.95,polarity:1}]);};
    vm.runInContext('globalThis.ai=new LLMOrchestrator();ai.callLLM=provider;',ctx);
    const answers=await vm.runInContext('ai.batchMapFields(fields,profile,{})',ctx);
    assert.equal(calls,1);assert.equal(answers.length,2);
    assert.ok(answers.every(answer=>answer.value==='no-id'));
    assert.ok(prompt.includes('workday.familyRelationship'));assert.ok(prompt.includes('yes-id'));
    await vm.runInContext('ai.batchMapFields(fields,profile,{})',ctx);assert.equal(calls,1);
});
test('accuracy acknowledgement maps statement options while citizenship needs an explicit basis',()=>{
    const ctx=setup();
    const ack=field('I understand and agree that false information may cause termination.');
    ack.optionDetails=[{label:'I certify and warrant that the information and details supplied by me are true, accurate and correct',value:'certify'},
        {label:'I do not wish to agree',value:'decline'}];
    assert.equal(ctx.SemanticResolver.resolve(ack,ctx.profile).value,'certify');
    const eligible=field('Are you legally entitled to work in India?');
    eligible.optionDetails=[{label:'Yes, I am an Indian citizen/India passport holder',value:'citizen'}];
    assert.equal(ctx.SemanticResolver.resolve(eligible,ctx.profile).blocked,true);
    eligible.optionDetails.push({label:'Yes, I have an OCI card',value:'oci'});
    ctx.profile.applicationDefaults.workAuthorizationBasis={India:'Yes, I am an Indian citizen/India passport holder'};
    assert.equal(ctx.SemanticResolver.resolve(eligible,ctx.profile).value,'citizen');
});
