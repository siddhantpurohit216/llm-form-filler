const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = file => fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
function context() {
    const ctx = vm.createContext({console,setTimeout,document:{addEventListener(){}}});
    vm.runInContext(source('utils/resume-profile.js'),ctx);
    return ctx;
}
test('dates retain source precision, reject impossible dates, and leave missing dates empty', () => {
    const {ResumeProfile: resume} = context();
    for (const [raw,expected] of [[undefined,''],[null,''],['',''],['Present',''],['N/A',''],
        ['2020','2020'],['2024-07','2024-07'],['July 2024','2024-07'],['Sept. 2022','2022-09'],
        ['07/2024','2024-07'],['2024-02-29','2024-02-29'],['2023-02-29',''],['2024-13',''],['13/2024','']]) {
        assert.equal(resume.date(raw),expected,String(raw));
    }
});
test('all responsibilities and achievements remain with their own role, without duplicated bullets', () => {
    const {ResumeProfile: resume} = context();
    const result = resume.profile({experience:[
        {title:'Engineer',description:'Built APIs',achievements:['Reduced latency by 40%','Built APIs'],responsibilities:['Maintained Java services'],startDate:'July 2024',endDate:'Present'},
        {title:'Intern',description:['Built React screens','Wrote tests'],endDate:'2023'},
        {title:'Undated consultant',roleDescription:'Designed integrations'}]});
    assert.equal(result.experience[0].description,'Built APIs\n• Maintained Java services\n• Reduced latency by 40%');
    assert.equal(result.experience[0].startDate,'2024-07');
    assert.equal(result.experience[0].endDate,'');
    assert.equal(result.experience[0].current,true);
    assert.equal(result.experience[1].description,'Built React screens\nWrote tests');
    assert.equal(result.experience[1].startDate,'');
    assert.equal(result.experience[1].endDate,'2023');
    assert.equal(result.experience[1].current,false);
    assert.equal(result.experience[2].description,'Designed integrations');
    assert.equal(result.experience[2].endDate,'');
    assert.equal(result.experience[2].current,false);
    assert.equal(resume.profile(result).experience[0].description,result.experience[0].description);
});
test('PDF line boundaries survive extraction for role/date/bullet grouping', () => {
    const {ResumeProfile: resume} = context();
    assert.equal(resume.pdfText([{str:'Engineer',hasEOL:true},{str:'July 2024',transform:[0,0,0,0,0,100]},
        {str:'Built APIs',transform:[0,0,0,0,0,80],hasEOL:true}]),'Engineer\nJuly 2024\nBuilt APIs\n');
});
test('editing descriptions keeps dates and metadata; merge accepts undated imported roles', () => {
    const ctx = context();
    vm.runInContext(source('popup/popup.js'),ctx);
    const inputs = {'.exp-company':{value:'Acme'},'.exp-title':{value:'Engineer'},'.exp-start':{value:'2024-07-15'},
        '.exp-end':{value:''},'.exp-current':{checked:false},'.exp-description':{value:'Edited role details'}};
    ctx.card = {querySelector:key=>inputs[key]};
    vm.runInContext(`profileData={experience:[{company:'Acme',title:'Engineer',location:'Remote',description:'Original',achievements:['Original']}]};
        updateExperience(0,card); globalThis.entry=profileData.experience[0];`,ctx);
    assert.equal(ctx.entry.description,'Edited role details');
    assert.equal(ctx.entry.startDate,'2024-07-15');
    assert.equal(ctx.entry.endDate,'');
    assert.equal(ctx.entry.location,'Remote');
    assert.equal(ctx.ResumeProfile.experience(ctx.entry).description,'Edited role details');
    const merged = vm.runInContext(`mergeProfiles({experience:[{title:'Old'}],applicationDefaults:{previouslyEmployed:false}},
        {experience:[{title:'New',description:'Undated responsibilities'}]})`,ctx);
    assert.equal(merged.experience[0].startDate,'');
    assert.equal(merged.experience[0].endDate,'');
    assert.equal(merged.experience[0].current,false);
    assert.equal(merged.applicationDefaults.previouslyEmployed,false);
});
test('Workday does not invent months for year-only dates or values for missing dates', () => {
    const ctx=context();
    vm.runInContext(source('utils/constants.js')+source('utils/helpers.js')+source('content/deterministic-matcher.js'),ctx);
    ctx.profile={experience:[{startDate:'2020',endDate:''}]};
    for (const [leaf,expected] of [['startDate-dateSectionYear-input','2020'],['startDate-dateSectionMonth-input',null],['endDate-dateSectionYear-input',null]]) {
        ctx.field={recordType:'workExperience',recordIndex:0,element:{id:`workExperience-7--${leaf}`}};
        assert.equal(vm.runInContext('deterministicMatcher.matchField(field,profile)',ctx).value,expected);
    }
});
