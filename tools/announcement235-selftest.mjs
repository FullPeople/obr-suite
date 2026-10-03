import {rolldown} from 'rolldown';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const load=async root=>{
 const entry=`export {releaseHistoryFor} from ${JSON.stringify(resolve(root,'src/platform/releaseNotes.ts').replaceAll('\\','/'))};export {announcementVersionFor} from ${JSON.stringify(resolve(root,'src/platform/announcement.ts').replaceAll('\\','/'))};`;
 const bundle=await rolldown({input:'notice',plugins:[{name:'notice',resolveId:id=>id==='notice'?'\0notice':undefined,load:id=>id==='\0notice'?entry:undefined}]});
 try{const {output}=await bundle.generate({format:'esm'});return await import('data:text/javascript;base64,'+Buffer.from(output[0].code).toString('base64'));}finally{await bundle.close();}
};
const current=await load(process.env.DND_CARD_WEB_ROOT),before=await load('F:/CodexWork/2026-10-02/paired-final/web');
assert.deepEqual(current.releaseHistoryFor('standalone'),before.releaseHistoryFor('standalone'));
assert.deepEqual(current.releaseHistoryFor('suite').slice(1),before.releaseHistoryFor('suite'));
assert.equal(current.announcementVersionFor('suite'),'1.0.235-dev');assert.equal(current.announcementVersionFor('standalone'),before.announcementVersionFor('standalone'));
console.log(JSON.stringify({checks:4,success:true,standaloneUnchanged:true,previousSuiteHistoryPreserved:true}));
