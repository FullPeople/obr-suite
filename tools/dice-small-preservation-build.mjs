// Diagnostic builds only: expose existing renderer/preview objects without changing their policy.
import {build} from 'vite';
import {resolve} from 'node:path';
await import('./dice-latency-build.mjs');
const root=resolve('extensions/workbench-dice3d'),out=resolve(process.env.DND_DICE_LATENCY_BUILD||'.local-evidence/dice-latency/runtime','dice3d');
await build({root,configFile:false,base:'/suite-dev/dice3d/',plugins:[{name:'skin-preview-observation',enforce:'pre',transform(code,id){
 if(!id.replaceAll('\\','/').endsWith('/src/skin-preview.ts'))return;
 if(!code.includes('function draw(time:number)')||!code.includes('void init().catch(report);'))throw Error('Preview probe boundaries changed');
 return code+`\n(globalThis as any).__diceSkinProbe={gl,scene,camera,bases,meshes,drawFixed:(theme:ThemeID,at:number)=>{style=theme;color='#28b1fa';rebuild();active=true;draw(at);active=false;cancelAnimationFrame(frame);frame=0;}};\n`;
}}],build:{outDir:out,emptyOutDir:false,rollupOptions:{input:{'skin-preview':resolve(root,'skin-preview.html')}}}});
