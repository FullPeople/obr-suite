"""English companion controls and the five broken 2014 saving-throw references."""
import json,re,xml.etree.ElementTree as E
from xml.sax.saxutils import escape
import prepare
import spell_bodies_package as p
from main_ability_inputs import tabs
from main_toggle_fields import ORIGINALS,replace_element
from main_remaining_fields import layout_styles,sha
from main_display_apply import attrs,container
R=p.REPO
if not __debug__:raise RuntimeError('Verification requires assertions')
PINS={'2014':'4924af698212141d7053cc88db53b522c576ef3ab91be190780aca0a0666595c','2024':'0bd14c6986d1163df3ca305fd2f9e4af8f352c60db0458de0f140aa336285de6'}
SHEET='盟友与魔宠'
SHORT={'Strength':'STR','Dexterity':'DEX','Constitution':'CON','Intelligence':'INT','Wisdom':'WIS','Charisma':'CHA','Proficient':'Prof.','Proficiency Bonus':'Prof.','Modifier':'Mod.','Saving Throw':'Save','Save Bonus':'Bonus','Temporary HP':'Temp HP','Creature Type':'Type','Where We Met':'Met At','Relationship':'Relation','Resistances':'Resist.','Immunities':'Immune','Vulnerabilities':'Vuln.','Languages':'Lang.','Alignment':'Align.'}

def plan(seeds):
    assert set(seeds)==set(PINS) and all(sha(b)==PINS[v] for v,b in seeds.items()),'Input is not the reviewed feet-format card'
    reviews=[json.loads(s) for s in (R/'tools/xlsx-localization/reviews/companions-display-001.jsonl').read_text(encoding='utf8').splitlines()];assert len(reviews)==129 and len({r['id'] for r in reviews})==129
    glossary=json.loads((R/'tools/xlsx-localization/glossary.json').read_bytes());entries=[]
    for v,raw in seeds.items():
        original=R/'public'/ORIGINALS[v][0];assert sha(original.read_bytes())==ORIGINALS[v][1]
        _,records,_=prepare.inspect_xlsx(original,v,glossary);records={r['id']:r for r in records}
        parts,_,_=p.read_zip(raw);names=tabs(parts);main=parts[names[SHEET]];cells=p.indexed_cells(main);strings=E.fromstring(parts[p.SST]);refs=[]
        for r in [r for r in reviews if r['version']==v]:
            source=records[r['id']];assert all(r[k]==source[k] for k in ['source','kind','sheet','context']) and r['sheet']==SHEET
            assert r['locations']==[o['location'] for o in source['occurrences']] and len(r['locations'])==1
            assert r['source_sha256']==prepare.digest(r['source']) and r['workbook_sha256']==ORIGINALS[v][1]
            assert r['reviewed_by'] and r['note'] and r['dependency_review']=='pending' and r['application_approved'] is False
            assert r['target'] and not prepare.CJK.search(r['target'])
            if r['kind']=='cell_text':
                ref=r['locations'][0];c=p.fragment(cells[ref]);assert c.get('t')=='s' and len(c)==1 and c[0].tag==p.q('v') and p.visible_text(strings[int(c[0].text)])==r['source']
                entries.append({'id':v+'-value-'+ref,'version':v,'sheet':SHEET,'cell':ref,'kind':'value','source':r['source'],'target':SHORT.get(r['target'],r['target']),'full_target':r['target'],'review_id':r['id']});refs.append(ref)
            else:
                assert r['kind']=='validation_literal';index=int(r['locations'][0].split(':')[1]);a,b,*_=p.spans(main,'dataValidation')[index]
                before=p.fragment(b).findtext(p.q('formula1'));assert before=='"'+r['source']+'"' and len(r['target'])<=255
                entries.append({'id':v+'-list-'+str(index),'version':v,'sheet':SHEET,'cell':'validation:'+str(index),'kind':'validation','sqref':a['sqref'],'source':before,'target':'"'+r['target']+'"','review_id':r['id']})
        # Reuse the reviewed six English sizes after verifying the complete
        # original list equals the matching existing alias source column.
        data=p.indexed_cells(parts[names['数据表']]);helper=p.indexed_cells(parts[names['Export']])
        for index,row in enumerate(range(15,21) if v=='2014' else range(16,22)):
            c=p.fragment(data[('CI' if v=='2014' else 'CL')+str(row)]);h=p.fragment(helper['N'+str(index+7)])
            assert p.visible_text(strings[int(c.findtext(p.q('v')))])==p.visible_text(h.find(p.q('is')))
        sqref='BG4:BK4 N8:R8';a,b,*_=next(n for n in p.spans(main,'dataValidation') if n[0].get('sqref')==sqref)
        before=p.fragment(b).findtext(p.q('formula1'));assert before==('数据表!$CI$15:$CI$20' if v=='2014' else '数据表!$CL$16:$CL$21')
        entries.append({'id':v+'-size-list','version':v,'sheet':SHEET,'cell':'validation:size','kind':'validation','sqref':sqref,'source':before,'target':"'Export'!$M$7:$M$12"})
        if v=='2014':
            for row in [3,5,6,7,8]:
                ref='AM'+str(row);node=p.fragment(cells[ref]);f=node.find(p.q('f'));assert f is not None and not f.attrib and node.find(p.q('v')) is None
                before=f.text;assert before==f'INT(AH{row}/2-5)+IF(AE{row}="O",#REF!,0)+AP{row}'
                other,_,_=p.read_zip(seeds['2024']);modern=p.fragment(p.indexed_cells(other[tabs(other)[SHEET]])[ref]).findtext(p.q('f'));assert modern==before.replace('#REF!','AB3')
                entries.append({'id':v+'-save-'+ref,'version':v,'sheet':SHEET,'cell':ref,'kind':'formula','source':'='+before,'target':'='+modern})
        for e in [e for e in entries if e['version']==v and e['kind']=='value' and e['target']!=e['full_target']]:
            entries.append({'id':v+'-hint-'+e['cell'],'version':v,'sheet':SHEET,'cell':e['cell'],'kind':'hint','source':'Full reviewed caption','target':e['full_target']})
        # Native previews expose clipping in the two narrow trait headings and
        # both alignment inputs. Widen only their existing columns.
        entries.append({'id':v+'-layout','version':v,'sheet':SHEET,'cell':'Companion captions','kind':'layout','source':'Original caption typography','target':json.dumps({'refs':refs,'font':'Arial','size':8.5,'wrap_refs':[],'widths':{'5':6.5,'21':4.5,'50':6.5,'58':4.5}},separators=(',',':'))})
    assert sum(e['kind']=='value' for e in entries)==123 and sum(e['kind']=='formula' for e in entries)==5
    return {'schema':'obr-companion-plan/v1','entries':entries,'inputs':PINS,'release_ready':False}

def apply(seeds,planned,author):
    assert planned==plan(seeds),'Plan differs from pinned source and review';p.authored_values(author,planned['entries']);products={}
    for v,raw in seeds.items():
        parts,_,_=p.read_zip(raw);part=tabs(parts)[SHEET];content=parts[part];cells=p.indexed_cells(content);rows=[e for e in planned['entries'] if e['version']==v]
        for e in [e for e in rows if e['kind'] in ['value','formula','validation']]:
            if e['kind']=='validation':
                found=[b for a,b,*_ in p.spans(content,'dataValidation') if a.get('sqref')==e['sqref']];assert len(found)==1;old=found[0];new=replace_element(old,'formula1',e['target'])
            else:
                old=cells[e['cell']]
                if e['kind']=='formula':new=replace_element(old,'f',e['target'][1:])
                else:
                    new=old.replace(b't="s"',b't="inlineStr"',1);nodes=p.spans(new,'v');assert len(nodes)==1;_,_,a,b=nodes[0];new=new[:a]+('<is><t>'+escape(e['target'])+'</t></is>').encode('utf8')+new[b:]
            assert content.count(old)==1;content=content.replace(old,new,1)
        from openpyxl.worksheet.cell_range import MultiCellRange
        hints=[e for e in rows if e['kind']=='hint'];added=[]
        for e in hints:
            assert not any(e['cell'] in MultiCellRange(a['sqref']) for a,*_ in p.spans(content,'dataValidation')),'Caption hint overlaps input validation'
            added.append(b'<dataValidation '+attrs({'type':'none','allowBlank':'1','showInputMessage':'1','promptTitle':'Details','prompt':e['target'],'sqref':e['cell']})+b'/>')
        old=p.spans(content,'dataValidations')[0][1];content=content.replace(old,container(old,'dataValidations',added,len(p.spans(old,'dataValidation'))+len(added)),1)
        layout=json.loads(next(e['target'] for e in rows if e['kind']=='layout'));styles,content=layout_styles(parts['xl/styles.xml'],content,layout)
        product=p.write_zip(raw,{part:content,'xl/styles.xml':styles});after,_,_=p.read_zip(product)
        assert list(after)==list(parts) and {n for n in parts if parts[n]!=after[n]}=={part,'xl/styles.xml'}
        products[v]=(product,{'version':v,'sha256':sha(product),'bytes':len(product),'changed_parts':[part,'xl/styles.xml'],'release_ready':False})
    return products
