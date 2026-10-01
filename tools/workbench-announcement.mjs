import {resolve,join,basename,dirname} from 'node:path';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

/** Use the exact paired Web source, never the legacy public/announcement.md. */
export async function workbenchAnnouncement(webRoot){
 if(!webRoot)throw Error('Set DND_CARD_WEB_ROOT to the paired Web checkout for the dev announcement');
 const web=resolve(webRoot),notes=join(web,'src/platform/releaseNotes.ts'),version=join(web,'src/platform/announcement.ts');
 if(!existsSync(notes)||!existsSync(version))throw Error('Paired Web announcement source is missing: '+web);
 // Config bundlers must not inline rolldown and its native dynamic chunks into
 // their single config file. Honor the isolated release builder's dependency root.
 const input=process.env.DND_SUITE_DEPS_ROOT,dep=input&&resolve(input),req=createRequire(dep?join(basename(dep)==='node_modules'?dirname(dep):dep,'package.json'):import.meta.url);
 const {rolldown}=await import(pathToFileURL(req.resolve('rolldown')).href);
 const entry=`import {releaseHistoryFor} from ${JSON.stringify(notes)};import {announcementVersionFor} from ${JSON.stringify(version)};export default {version:announcementVersionFor('suite'),history:releaseHistoryFor('suite')};`;
 const bundle=await rolldown({input:'announcement-source',plugins:[{name:'paired-announcement',resolveId:id=>id==='announcement-source'?'\0announcement-source':undefined,load:id=>id==='\0announcement-source'?entry:undefined}]});
 let output;try{output=await bundle.generate({format:'esm'});}finally{await bundle.close();}
 const code=output.output.find(file=>file.type==='chunk')?.code;
 const {default:data}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 if(!/^\d+\.\d+\.\d+-dev$/.test(data.version)||!Array.isArray(data.history)||!data.history.length)throw Error('Invalid paired Suite release notes');
 const lines=['# Full Suite 新版公告','## 版本 [changelog]',`- ${data.version} · Full Suite 新版工作台`,'## 支持与反馈 [info]','- 反馈邮箱：1763086701psw@gmail.com','- Owner 权限图文说明与完整用户指南请在工作台顶部打开「版本公告」。'];
 for(const [index,release] of data.history.entries()){
  lines.push(`## ${release.title} [${index?'history':'release'}]`);
  for(const section of release.sections){lines.push('### '+section.title);for(const item of section.items)lines.push('- '+item);}
 }
 return lines.join('\n')+'\n';
}

export function workbenchAnnouncementPlugin(enabled){
 return {name:'paired-workbench-announcement',
  configureServer(server){if(enabled)server.middlewares.use(async(req,res,next)=>{
   if(req.url?.split('?')[0]!=='/suite-dev/assets/announcement-dev.md')return next();
   try{res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(await workbenchAnnouncement(process.env.DND_CARD_WEB_ROOT));}
   catch(error){res.statusCode=500;res.end(String(error));}
  });},
  async generateBundle(){if(enabled)this.emitFile({type:'asset',fileName:'assets/announcement-dev.md',source:await workbenchAnnouncement(process.env.DND_CARD_WEB_ROOT)});}
 };
}
