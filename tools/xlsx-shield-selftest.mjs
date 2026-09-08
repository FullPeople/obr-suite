import { build } from 'rolldown';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { originals, unpack, pack, english, moved, textCell, cell, change, SHEET, WORKBOOK, RELS } from './xlsx-shield-fixtures.mjs';
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out=mkdtempSync(join(tmpdir(),'xlsx-shield-')); let browser,assertions=0;
const check=(ok,label)=>{if(!ok)throw Error(`ASSERTION: ${label}`);assertions++;};
try {
  const mutant=process.env.XLSX_SHIELD_MUTANT;
  const targets={
    'fixed-sheet':['await read(path), "worksheet"','await read("xl/worksheets/sheet2.xml"), "worksheet"'],
    'ambiguous-main':['if (main.length !== 1) return null;','if (!main.length) return null;'],
    'ignore-template':['!templateRuleset(value("AV1"), formula)','false'],
    'zero-ac':['shieldAc === "0"','false'],
    'wrong-worn':['return readBooleanFlag(worn);','return !!worn;'],
    'invalid-cells-become-blank':['if (result === INVALID_CELL) return null;','if (result === INVALID_CELL) { values.set(ref, null); continue; }'],
    'bad-index-becomes-blank':['shared[Number(text)] ?? INVALID_CELL','shared[Number(text)] ?? null'],
    'illegal-type-accepted':['!["", "n", "b", "s", "str", "inlineStr", "d"].includes(type)','false'],
  };
  let applied=false;
  const file=join(out,'shield.js');await build({input:resolve('src/modules/characterCards/xlsx-shield-state.ts'),plugins:mutant?[{name:'shield-mutation',transform(code,id){if(!id.endsWith('xlsx-shield-state.ts'))return;const target=targets[mutant];if(!target||!code.includes(target[0]))throw Error('Missing mutation target');applied=true;return code.replace(target[0],target[1]);}}]:[],output:{file,format:'iife',name:'shield'}});
  if(mutant&&!applied)throw Error('Mutation did not apply');
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const page=await browser.newPage();await page.addScriptTag({path:file});
  const read=async(bytes,form='bytes')=>page.evaluate(async({base64,form})=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));let source=bytes;if(form==='blob')source=new Blob([bytes]);if(form==='buffer')source=bytes.buffer;if(form==='offset'){const padded=new Uint8Array(bytes.length+9);padded.set(bytes,3);source=padded.subarray(3,bytes.length+3);}try{return {value:await shield.readShieldEquippedFromXlsx(source)};}catch(error){return {error:String(error)};}},{base64:bytes.toString('base64'),form});
  // Mock only the upload reconciliation endpoint; never contact the live service.
  const reconcile=async(fixture,initial)=>page.evaluate(async({base64,initial})=>{const calls=[];window.fetch=async(url,options={})=>{calls.push({url,...options});return {ok:true,json:async()=>initial};};const result=await shield.reconcileUploadedCardShieldState({apiBase:'https://api.invalid/cards',roomId:'room /一',cardId:'card /二',xlsx:Uint8Array.from(atob(base64),c=>c.charCodeAt(0))});return {result,calls};},{base64:fixture.toString('base64'),initial});
  const hashes=['94444fda4206d579125418b0007b89c414b86c27d6b98655f81f3f1ce65e8fe6','264fc65569e3e80932544af548830ca70f10ee308493c8b0234608fcd01c9b04'];
  for(const [index,bytes] of originals().entries()) {
    const original=unpack(bytes);
    check(createHash('sha256').update(bytes).digest('hex')===hashes[index],`${index} unchanged authoritative public workbook hash`);
    check((await read(bytes)).value===false,`${index?'2024':'2014'} original workbook shield is not equipped`);
    check((await read(bytes,'blob')).value===false,'Blob input');
    check((await read(bytes,'buffer')).value===false,'ArrayBuffer input');
    check((await read(bytes,'offset')).value===false,'subarray respects byte offset');
    const en=new Map(original);english(en);textCell(en,'AS40','Yes');const enResult=await read(pack(en));
    const relocated=new Map(original);moved(relocated);const movedResult=await read(pack(relocated));
    check(enResult.value===true,'English Main/Shield with inline Yes');check(movedResult.value===false,'relationship locates reordered and relocated Main');
    const test=async(label,edit,want=null)=>{const entries=new Map(original);edit(entries);const result=await read(pack(entries));check(result.value===want,`${index}: ${label}: ${JSON.stringify(result)}`);return entries;};
    for(const [label,worn,want] of [['CN yes','是',true],['CN no','否',false],['English yes',' YeS ',true],['English no','No',false],['true','true',true],['false','false',false],['empty','',false]])await test(label,m=>textCell(m,'AS40',worn),want);
    await test('native boolean true',m=>cell(m,'AS40','<v>1</v>','t="b"'),true);
    await test('native boolean false',m=>cell(m,'AS40','<v>0</v>','t="b"'),false);
    await test('unknown nonempty flag keeps legacy false',m=>textCell(m,'AS40','Maybe'),false);
    await test('explicit empty shared value keeps legacy false',m=>cell(m,'AS40','<v/>','t="s"'),false);
    await test('missing worn value keeps legacy false',m=>change(m,SHEET,xml=>xml.replace(/<c\b[^>]*r="AS40"[^>]*>[\s\S]*?<\/c>/,'')),false);
    await test('zero AC forces unequipped',m=>{textCell(m,'AS40','Yes');cell(m,'AQ40','<v>0</v>','');},false);
    await test('empty AC forces unequipped',m=>{textCell(m,'AS40','Yes');cell(m,'AQ40','<v></v>','');},false);
    await test('missing AC retains legacy gate',m=>{textCell(m,'AS40','Yes');change(m,SHEET,xml=>xml.replace(/<c\b[^>]*r="AQ40"[^>]*>[\s\S]*?<\/c>/,''));},false);
    for(const [label,edit] of [
      ['AC #REF! error',m=>cell(m,'AQ40','<v>#REF!</v>','t="e"')],
      ['worn #VALUE! error',m=>cell(m,'AS40','<v>#VALUE!</v>','t="e"')],
      ['worn error takes precedence over zero AC',m=>{cell(m,'AS40','<v>#VALUE!</v>','t="e"');cell(m,'AQ40','<v>0</v>','t="n"');}],
      ['AC bad shared index',m=>cell(m,'AQ40','<v>99999999</v>','t="s"')],
      ['worn bad shared index',m=>cell(m,'AS40','<v>99999999</v>','t="s"')],
      ['worn negative shared index',m=>cell(m,'AS40','<v>-1</v>','t="s"')],
      ['worn noninteger shared index',m=>cell(m,'AS40','<v>0.5</v>','t="s"')],
      ['AC illegal type',m=>cell(m,'AQ40','<v>2</v>','t="bad-type"')],
      ['worn illegal type',m=>cell(m,'AS40','<v>Yes</v>','t="bad-type"')],
      ['numeric cell with nonnumeric content',m=>cell(m,'AQ40','<v>#REF!</v>','t="n"')],
      ['boolean cell with nonboolean content',m=>cell(m,'AS40','<v>Maybe</v>','t="b"')],
      ['worn mixed inline and cached content',m=>cell(m,'AS40','<is><t>Yes</t></is><v>No</v>','t="inlineStr"')],
      ['worn invalid inline structure',m=>cell(m,'AS40','<is><bogus>Yes</bogus></is>')],
      ['worn unexpected direct cell text',m=>cell(m,'AS40','garbage<v>Yes</v>','t="str"')],
      ['worn unexpected direct rich-run text',m=>cell(m,'AS40','<is><r>garbage<t>Yes</t></r></is>')],
      ['worn nested cache structure',m=>cell(m,'AS40','<v><t>Yes</t></v>','t="str"')],
      ['AC invalid foreign namespace value',m=>cell(m,'AQ40','<v xmlns="urn:bad">2</v>','t="n"')],
      ['AV1 explicit error blocks formula identity fallback',m=>change(m,SHEET,xml=>xml.replace(/<c\b[^>]*r="AV1"[^>]*>/,tag=>tag.replace('t="str"','t="e"')))],
      ['AV1 bad shared reference blocks formula identity fallback',m=>change(m,SHEET,xml=>xml.replace(/<c\b[^>]*r="AV1"[^>]*>/,tag=>tag.replace('t="str"','t="s"')))],
      ['header explicit error',m=>cell(m,'AL39','<v>Shield</v>','t="e"')],
    ]) {
      const invalid=new Map(original);textCell(invalid,'AS40','Yes');edit(invalid);const fixture=pack(invalid);
      check((await read(fixture)).value===null,`${index}: ${label} returns unknown`);
      const synced=await reconcile(fixture,{combat:{ac:17,shield:{equipped:true,ac:2}}});
      check(!synced.result&&synced.calls.length===0,`${index}: ${label} performs zero network operations`);
    }
    await test('rich inline Shield / numeric entity Yes',m=>{english(m);cell(m,'AL39','<is><r><t>Shi</t></r><r><t>eld</t></r></is>');cell(m,'AS40','<is><t>&#x59;es</t></is>');},true);
    await test('all relevant text inline without shared strings part',m=>{english(m);textCell(m,'AS40','Yes');textCell(m,'AQ39','AC');m.delete('xl/sharedStrings.xml');change(m,RELS,xml=>xml.replace(/<Relationship\b[^>]*Type="[^"]*\/sharedStrings"[^>]*\/>/,''));},true);
    await test('shared strings located through its renamed relationship',m=>{m.set('xl/renamed-strings.xml',m.get('xl/sharedStrings.xml'));m.delete('xl/sharedStrings.xml');change(m,RELS,xml=>xml.replace('Target="sharedStrings.xml"','Target="renamed-strings.xml"'));},false);
    await test('broken shared-string relationship refuses correction',m=>m.delete('xl/sharedStrings.xml'));
    await test('cached formula boolean is read without recalculation',m=>cell(m,'AS40','<f>IF(1=1,"Yes","No")</f><v>Yes</v>','t="str"'),true);
    await test('shared-string attribute before address',m=>{change(m,SHEET,xml=>xml.replace(/<c r="AL39"([^>]*?)t="s"/,'<c t="s" r="AL39"$1'));},false);
    await test('Main moved with a tempting opposite sheet2 decoy',m=>{textCell(m,'AS40','Yes');moved(m);m.set(SHEET,original.get(SHEET));},true);
    await test('absolute OPC worksheet target',m=>change(m,RELS,xml=>xml.replace('Target="worksheets/sheet2.xml"','Target="/xl/worksheets/sheet2.xml"')),false);
    await test('normalized relative worksheet target',m=>change(m,RELS,xml=>xml.replace('Target="worksheets/sheet2.xml"','Target="./worksheets/../worksheets/sheet2.xml"')),false);
    await test('single-quoted XML attributes',m=>change(m,WORKBOOK,xml=>xml.replace('name="主要"',"name='主要'")),false);
    await test('Main display name misleading but unsupported',m=>change(m,WORKBOOK,xml=>xml.replace('name="主要"','name="Main Copy"')));
    await test('both Main aliases ambiguous',m=>change(m,WORKBOOK,xml=>xml.replace('name="主要"','name="Main"').replace('</sheets>','<sheet name="主要" sheetId="99" r:id="rId99"/></sheets>')));
    await test('missing workbook',m=>m.delete(WORKBOOK));
    await test('missing workbook relationships',m=>m.delete(RELS));
    await test('missing actual worksheet',m=>m.delete(SHEET));
    await test('missing r:id',m=>change(m,WORKBOOK,xml=>xml.replace(/(<sheet\b[^>]*name="主要"[^>]*?)r:id="[^"]*"/,'$1')));
    await test('conflicting strict and transitional r:id is ambiguous',m=>change(m,WORKBOOK,xml=>xml.replace('name="主要"','name="主要" xmlns:srel="http://purl.oclc.org/ooxml/officeDocument/relationships" srel:id="other"')));
    await test('missing matching relation',m=>change(m,RELS,xml=>xml.replace(/<Relationship\b[^>]*Target="worksheets\/sheet2.xml"[^>]*\/>/,'')));
    await test('external target is not read',m=>change(m,RELS,xml=>xml.replace('Target="worksheets/sheet2.xml"','Target="worksheets/sheet2.xml" TargetMode="External"')));
    await test('wrong relation type',m=>change(m,RELS,xml=>xml.replace(/<Relationship\b[^>]*Target="worksheets\/sheet2.xml"[^>]*\/>/,tag=>tag.replace('/worksheet"','/chartsheet"'))));
    await test('duplicate relationship ID',m=>change(m,RELS,xml=>xml.replace('</Relationships>',`${xml.match(/<Relationship\b[^>]*Target="worksheets\/sheet2.xml"[^>]*\/>/)[0]}</Relationships>`)));
    await test('aliased worksheet target is ambiguous',m=>change(m,RELS,xml=>xml.replace('</Relationships>','<Relationship Id="extra" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="./worksheets/sheet2.xml"/></Relationships>')));
    await test('relationship escapes archive',m=>change(m,RELS,xml=>xml.replace('Target="worksheets/sheet2.xml"','Target="../../worksheets/sheet2.xml"')));
    await test('relationship URL is refused',m=>change(m,RELS,xml=>xml.replace('Target="worksheets/sheet2.xml"','Target="https://example.invalid/main.xml"')));
    await test('wrong XML namespace',m=>change(m,WORKBOOK,xml=>xml.replace('http://schemas.openxmlformats.org/spreadsheetml/2006/main','urn:fake')));
    await test('malformed XML',m=>m.set(SHEET,Buffer.from('<worksheet>')));
    await test('no DTD/entity interpretation',m=>change(m,SHEET,xml=>xml.replace(/<\?xml[^>]*\?>/,'<!DOCTYPE worksheet [<!ENTITY test "Yes">]>')));
    await test('duplicate shield cell is ambiguous',m=>change(m,SHEET,xml=>xml.replace('</row>','<c r="AS40" t="b"><v>1</v></c></row>')));
    await test('duplicate cached shield AC values cannot imply unequipped',m=>cell(m,'AQ40','<v>2</v><v>0</v>',''));
    await test('duplicate worn values are ambiguous',m=>cell(m,'AS40','<v>1</v><v>0</v>','t="b"'));
    await test('plain Main/Shield table without adapter identity',m=>{english(m);textCell(m,'AV1','');textCell(m,'AS40','Yes');});
    await test('unknown shield label',m=>textCell(m,'AL39','Shield spell'));
    await test('wrong shield column headers',m=>textCell(m,'AS39','Armor'));
    await test('unsupported export ruleset',m=>{textCell(m,'AV1','{"schema":"obr-suite-card/v1","meta":{"ruleset":"5E2099"}}');});
    await test('explicit cached schema conflict does not use old formula',m=>change(m,SHEET,xml=>xml.replace(/(<c\b[^>]*r="AV1"[^>]*>[\s\S]*?<v>)([\s\S]*?)(<\/v>)/,(_,a,v,b)=>a+v.replace('obr-suite-card/v1','another-card/v1')+b)));
    await test('uncached export formula still identifies original adapter',m=>{change(m,SHEET,xml=>xml.replace(/(<c\b[^>]*r="AV1"[^>]*>[\s\S]*?<v>)[\s\S]*?(<\/v>)/,'$1$2'));textCell(m,'AS40','是');},true);
    await test('author quote corrupts cache without invalidating original formula',m=>{change(m,SHEET,xml=>xml.replace(/(<c\b[^>]*r="AV1"[^>]*>[\s\S]*?<v>)[\s\S]*?(<\/v>)/,'$1{broken author quote$2'));},false);
    await test('cache and formula conflicting editions refuse correction',m=>change(m,SHEET,xml=>xml.replace(/(<c\b[^>]*r="AV1"[^>]*>[\s\S]*?<v>)([\s\S]*?)(<\/v>)/,(_,a,v,b)=>a+v.replace(/(ruleset&quot;:&quot;)5E20(?:14|24)/,`$1${index?'5E2014':'5E2024'}`)+b)));
    await test('strict OOXML namespace aliases',m=>{for(const p of [WORKBOOK,SHEET,'xl/sharedStrings.xml',RELS])change(m,p,xml=>xml.replaceAll('http://schemas.openxmlformats.org/spreadsheetml/2006/main','http://purl.oclc.org/ooxml/spreadsheetml/main').replaceAll('http://schemas.openxmlformats.org/officeDocument/2006/relationships','http://purl.oclc.org/ooxml/officeDocument/relationships'));},false);
    const initial={identity:{character_name:'Unchanged player text'},combat:{ac:17,ac_base:15,shield:{equipped:'No',ac:2,custom:'kept'}},ruleset:index?'5E2024':'5E2014'};
    const corrected=await reconcile(pack(en),initial);check(corrected.result&&corrected.calls.length===2,'identified English shield needs one GET and one PUT');
    const expected=structuredClone(initial);expected.combat.shield.equipped=true;check(JSON.stringify(JSON.parse(corrected.calls[1].body))===JSON.stringify(expected),'AC and all author data preserved; only equipped changes');
    check(corrected.calls[1].url==='https://api.invalid/cards/room%20%2F%E4%B8%80/card%20%2F%E4%BA%8C/data','reconciliation preserves URL path encoding');
    const same=await reconcile(pack(en),expected);check(!same.result&&same.calls.length===1,'already matching flag does not write');
    // Panel lifecycle cancellation must reach the real XLSX adapter, including
    // after ZIP parsing or a slow response body. An already dispatched PUT is
    // not treated as remotely undone; this only blocks later work/acknowledgement.
    for (const stage of ['before-parse','during-parse','after-get','after-json','after-put','signal-before-parse']) {
      const stopped=await page.evaluate(async({base64,initial,stage})=>{
        const controller=new AbortController(),calls=[];let current=true,readCount=0;
        if(stage==='before-parse')current=false;
        if(stage==='signal-before-parse')controller.abort();
        window.fetch=async(url,options={})=>{
          const method=options.method||'GET';calls.push({method,hasSignal:options.signal===controller.signal});
          if(stage==='after-get'&&method==='GET')current=false;
          if(stage==='after-put'&&method==='PUT')current=false;
          return {ok:true,json:async()=>{if(stage==='after-json')current=false;return initial;}};
        };
        // A Blob read is genuinely asynchronous: invalidate while the adapter
        // awaits its bytes, instead of swapping the reconciliation function.
        let bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
        if(stage==='during-parse') {
          const blob=new Blob([bytes]);const original=blob.arrayBuffer.bind(blob);
          blob.arrayBuffer=async()=>{readCount++;const data=await original();current=false;return data;};bytes=blob;
        }
        try {
          await shield.reconcileUploadedCardShieldState({apiBase:'https://api.invalid/cards',roomId:'r',cardId:'c',xlsx:bytes,
            signal:controller.signal,isCurrent:()=>current});
          return {error:null,calls,readCount};
        } catch(error) {return {error:error.name,calls,readCount};}
      },{base64:pack(en).toString('base64'),initial,stage});
      const wanted=stage==='after-put'?2:['after-get','after-json'].includes(stage)?1:0;
      check(stopped.error==='AbortError'&&stopped.calls.length===wanted,`${index}: ${stage} stops at the lifecycle boundary`);
      check(stopped.calls.every(call=>call.hasSignal)&&(!stage.includes('during')||stopped.readCount===1),`${index}: ${stage} uses caller signal and real parse`);
    }
    const legacyUnknown=new Map(en);textCell(legacyUnknown,'AS40','Maybe');const legacySync=await reconcile(pack(legacyUnknown),expected);
    check(legacySync.result&&legacySync.calls.length===2&&JSON.parse(legacySync.calls[1].body).combat.shield.equipped===false,'unknown ordinary text still follows legacy false correction, distinct from invalid cells');
    const unknown=new Map(original);textCell(unknown,'AL39','Other');const skipped=await reconcile(pack(unknown),initial);check(!skipped.result&&skipped.calls.length===0,'unknown layout never fetches or modifies uploaded card');
    console.log(`${index?'2024':'2014'} original/derived workbook matrix passed`);
  }
  check(!!(await read(Buffer.from('not a workbook'))).error,'non-ZIP input rejects before reconciliation');
  check(!!(await read(originals()[0].subarray(0,100))).error,'truncated ZIP rejects');
  const bad=Buffer.from(originals()[0]);bad.writeUInt32LE(0xffffffff,bad.length-22+16);check(!!(await read(bad)).error,'out-of-bounds central directory rejects');
  for(const [i,bytes]of originals().entries())check(createHash('sha256').update(bytes).digest('hex')===hashes[i],'public original unchanged after every fixture');
  console.log(`xlsx shield: ${assertions} assertions passed`);
} finally {await browser?.close();rmSync(out,{recursive:true,force:true});}
