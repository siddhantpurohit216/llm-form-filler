"""Local UI review using demo data; no extension storage or API access."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import re, posixpath, sys
ROOT = Path(__file__).resolve().parents[1]
MOCK = '''<script>
const demoProfile={contact:{firstName:'Alex',lastName:'Morgan',email:'alex@example.com',phone:'+91 9876543210'},links:{},education:[{institution:'Example University',degree:'B.Tech'}],experience:[{company:'Example Labs',title:'Product Engineer',startDate:'2023-05',current:true},{company:'Demo Systems',title:'Software Developer',startDate:'2020',endDate:'2023'}],skills:['Java','React','Spring Boot'],customFields:{Gender:'Male','Notice period':'30 days'}};
window.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}},permissions:{request:async()=>true},runtime:{onMessage:{addListener(){}},sendMessage:async m=>m.type==='GET_ACTIVE_FORM_STATUS'?{hasForm:true,fieldCount:29,frames:[{frameId:0,adapter:'Demo'}]}:m.type==='GET_PROFILE'?{profile:demoProfile}:m.type==='GET_SETTINGS'?{settings:{}}:{success:true}},tabs:{query:async()=>[{id:1,url:'https://example.com/apply'}],sendMessage:async(id,m)=>m.type==='GET_FORM_STATUS'?{hasForm:true,fieldCount:29}:{success:true}}};
</script>'''
PAGE = '''<!doctype html><html><head><meta charset="utf-8"><title>Autofill UI preview</title><link rel="stylesheet" href="/styles/injected.css"><style>
body{margin:0;background:#f7f8fa;color:#243044;font:14px/1.6 system-ui}main{width:min(560px,calc(100% - 40px));margin:50px auto}h1{font-size:24px;margin:0}p{color:#7a8699}.preview-card{padding:28px;border:1px solid #e4e8ef;border-radius:12px;background:white;margin:24px 0}label{display:block;margin-bottom:6px;color:#607087;font-size:12px}input,textarea{box-sizing:border-box;width:100%;padding:12px;border:1px solid #dce2eb;border-radius:7px;color:#243044;font:14px system-ui;margin-bottom:28px}.long-section{height:1100px}a{color:#496eaf}
</style></head><body><main><p>LOCAL PREVIEW · DEMO DATA</p><h1>Software Development Engineer</h1><p>Application / My information · <a href="/popup-preview">View extension popup</a></p><section class="preview-card"><label for="name">Full name</label><input id="name" value="Alex Morgan"><label for="email">Email address</label><input id="email" value="alex@example.com"><label for="description">Why are you interested in this role?</label><textarea id="description" rows="4" placeholder="Write your answer…"></textarea></section><div class="long-section"><p>Scroll to check that off-screen field controls disappear.</p></div><section class="preview-card"><label for="skills">Skills</label><input id="skills" value="Java, React"></section></main>
<script src="/src/utils/constants.js"></script><script src="/src/utils/helpers.js"></script><script src="/src/content/inline-ui.js"></script><script>
const fieldExtractor={getCurrentValue:el=>el.value,refreshField:el=>({id:el.id,label:el.previousElementSibling.textContent})};const sessionCache={get:()=>null};inlineUI.init();inlineUI.showPageStatus('29 fields detected · 8 filled from profile · 3 saved skills / 3 selected',()=>{inlineUI.updatePageStatus('Your saved answers are ready. Review before continuing.');});
for(const id of ['name','email','description','skills']){const el=document.getElementById(id);inlineUI.addFieldIndicators(el,{fieldId:id,label:el.previousElementSibling.textContent,type:el.tagName==='TEXTAREA'?'textarea':'text',isLongForm:id==='description',confidence:id==='description'?0:1,source:'deterministic',reason:'Saved profile match'});if(id!=='description')inlineUI.highlightField(el,'exact');}
</script></body></html>'''
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT),**kwargs)
    def do_GET(self):
        if self.path in ['/','/popup-preview','/adapter-preview']:
            html = PAGE if self.path=='/' else (ROOT/'src/popup/popup.html').read_text().replace('href="popup.css"','href="/src/popup/popup.css"').replace('src="popup.js"','src="/src/popup/popup.js"').replace('src="../utils/resume-profile.js"','src="/src/utils/resume-profile.js"').replace('src="../utils/field-policy.js"','src="/src/utils/field-policy.js"').replace('<body>','<body>'+MOCK)
            if self.path=='/adapter-preview': html=(ROOT/'test/fixtures/generic-application.html').read_text().replace('<body>','<body>'+MOCK)
            if self.path=='/popup-preview': html=re.sub(r'src="([^"]+)"',lambda m: 'src="'+posixpath.normpath('/src/popup/'+m[1])+'"' if not m[1].startswith('/') else m[0],html)
            self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(html.encode())
        else:super().do_GET()
ThreadingHTTPServer(('127.0.0.1',int(sys.argv[1]) if len(sys.argv)>1 else 8765),Handler).serve_forever()
