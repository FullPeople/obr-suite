import {defineConfig,loadConfigFromFile} from 'vite';
import {createReadStream,existsSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
const web=resolve(process.env.DND_CARD_WEB_ROOT||'../DND-card-web'),suite=resolve(import.meta.dirname,'..');
const panels=resolve(process.env.TEXT_EFFECT_PANEL_OUT||'.local-evidence/text-effects/panels');
export default defineConfig(async environment=>{const loaded=await loadConfigFromFile(environment,join(web,'vite.config.ts'));
// The fixture renders navigation and the editor only. Its unused progress import
// gets an explicit empty stub; the normal production build keeps the audit gate.
const fixturePlugins=(loaded?.config.plugins||[]).filter(plugin=>(plugin as {name?:string})?.name!=='public-automation-progress');
return {...loaded?.config,root:web,base:'/',plugins:[...fixturePlugins,{name:'text-effects-fixture-progress',resolveId(id){if(id==='virtual:automation-progress')return '\0text-effects-empty-progress';},load(id){if(id==='\0text-effects-empty-progress')return 'export const identity={}; export const manifestUrl="/unused-text-effects-fixture-progress";';}},{name:'text-effects-local-artifacts',configureServer(server){server.middlewares.use((req,res,next)=>{
 const pathname=(req.url||'').split('?')[0];let base='',relative='';
 if(pathname.startsWith('/tests/fixtures/workbench-panels/')){base=panels;relative=pathname.slice('/tests/fixtures/workbench-panels/'.length);}
 else if(pathname.startsWith('/suite-dev/')){base=join(suite,'dist-workbench-dev');relative=pathname.slice('/suite-dev/'.length);}
 else return next();
 const file=resolve(base,relative);if(!file.startsWith(resolve(base)+sep)||!existsSync(file)){res.statusCode=404;res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'application/octet-stream');createReadStream(file).pipe(res);
 });}}],server:{host:'127.0.0.1',port:5197,strictPort:true,watch:{ignored:['**/.local-evidence/**','**/test-results*/**']}},build:{outDir:'.local-evidence/text-effects/web-unused'}};});
