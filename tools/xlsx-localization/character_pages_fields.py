"""Bounded support-page translations and Bag of Holding dependency repairs.

Artifact Tool authors every target. This adapter retains existing OOXML objects,
arrays, protection, and styles instead of round-tripping the native card.
"""
import json,re,xml.etree.ElementTree as E
import prepare
import spell_bodies_package as p
from main_ability_inputs import tabs
from main_toggle_fields import ORIGINALS,replace_element
from main_remaining_fields import layout_styles,sha
from main_display_apply import attrs,attribute
from spell_display_fields import clone_text
from spell_display_labels import set_element_text
if not __debug__:raise RuntimeError('Verification requires assertions')
R=p.REPO
PINS={'2014':'59313e07baf22cdaea26d8df79a5ffddb1021de3975e2b67b23673754d11a324','2024':'58b1fb5cac29a971e4fbba4c6d8e00e35ff9fb8264a6d7a5f68800cec0c00ab6'}
SHEETS={'2014':['背景','背包','圆形效应范围','网页导入','据点'],'2024':['起源','背包','圆形效应范围','网页导入']}
SHORT={'Quantity':'Qty.','Currency':'Coin','Character Name':'Name','Background':'Origin','Skill Proficiencies':'Skills','Tool Proficiencies':'Tools','Proficient Tools':'Tools','Character Artwork':'Artwork'}

def plan(seeds):
    assert set(seeds)==set(PINS) and all(sha(raw)==PINS[v] for v,raw in seeds.items()),'Expected the pinned companion cards'
    reviews=[json.loads(s) for f in [R/'tools/xlsx-localization/reviewed.jsonl',*sorted((R/'tools/xlsx-localization/reviews').glob('*.jsonl'))] for s in f.read_text(encoding='utf8').splitlines()]
    assert len({r['id'] for r in reviews})==len(reviews)
    reviewed={r['id']:r for r in reviews};glossary=json.loads((R/'tools/xlsx-localization/glossary.json').read_bytes());entries=[]
    for v,raw in seeds.items():
        original=R/'public'/ORIGINALS[v][0];assert sha(original.read_bytes())==ORIGINALS[v][1]
        _,records,_=prepare.inspect_xlsx(original,v,glossary)
        parts,_,_=p.read_zip(raw);names=tabs(parts);strings=E.fromstring(parts[p.SST]);cells={s:p.indexed_cells(parts[part]) for s,part in names.items()}
        selected=[r for r in records if r['sheet'] in SHEETS[v] and r['kind'] in ['cell_text','validation_message','validation_literal']]
        if v=='2024':selected += [r for r in records if r['sheet']=='背景' and r['kind']=='cell_text' and any(o['location'] in ['C2','D2','E2','F2','G2','H2'] for o in r['occurrences'])]
        for source in selected:
            r=reviewed[source['id']]
            assert all(r[k]==source[k] for k in ['source','kind','sheet','context']) and r['locations']==[o['location'] for o in source['occurrences']]
            assert r['source_sha256']==prepare.digest(r['source']) and r['workbook_sha256']==ORIGINALS[v][1],(v,r['id'],r['source_sha256'],prepare.digest(r['source']),r['workbook_sha256'])
            assert r['reviewed_by'] and r['note'] and r['target'] and not prepare.CJK.search(r['target'])
            for o in source['occurrences']:
                ref=o['location'];sheet=r['sheet']
                if sheet=='背景' and v=='2024' and ref not in ['C2','D2','E2','F2','G2','H2']:continue
                e={'id':v+'-'+sheet+'-'+ref,'version':v,'sheet':sheet,'cell':ref,'source':r['source'],'target':r['target'],'review_id':r['id']}
                if r['kind']=='cell_text':
                    node=p.fragment(cells[sheet][ref]);assert node.get('t')=='s' and node.find(p.q('f')) is None
                    assert p.visible_text(strings[int(node.findtext(p.q('v')))])==r['source']
                    e.update(kind='value',full_target=r['target'],target=SHORT.get(r['target'],r['target']))
                else:
                    index=int(ref.split(':')[1]);a,b,*_=p.spans(parts[names[sheet]],'dataValidation')[index]
                    e.update(index=index,sqref=a['sqref'])
                    if r['kind']=='validation_literal':
                        before=p.fragment(b).findtext(p.q('formula1'));assert before=='"'+r['source']+'"'
                        e.update(kind='validation',source=before,target='"'+r['target']+'"')
                    else:
                        key=ref.split(':')[2];assert a[key]==r['source'] and len(r['target'].encode('utf-16-le'))//2<=255
                        e.update(kind='message',attribute=key)
                entries.append(e)
        def formula(sheet,ref,before,after,**more):
            node=p.fragment(cells[sheet][ref]);f=node.find(p.q('f'));assert f is not None and f.text==before and node.find(p.q('v')) is None
            entries.append({'id':v+'-'+sheet+'-formula-'+ref,'version':v,'sheet':sheet,'cell':ref,'kind':'formula','source':'='+before,'target':'='+after,**more})
        if v=='2014':
            before='IF(背包!V27="无效",0,15)+IF(背包!AS27="无效",0,15)'
            after='IF(OR(背包!V27="无效",背包!V27="Inactive"),0,15)+IF(OR(背包!AS27="无效",背包!AS27="Inactive"),0,15)'
            formula('主要','AC62',before,after)
            for ref in ['B7','Y7','AH7','AV7','BS7','CB7','Y15','BS15']:
                before=p.fragment(cells['据点'][ref]).findtext(p.q('f'));after=before;bindings=[]
                for i,literal in enumerate(prepare.literal_tokens(before)):
                    if not prepare.CJK.search(literal):continue
                    source=next(r for r in records if r['sheet']=='据点' and r['kind']=='formula_literal' and any(o['location']==ref+':literal:'+str(i) for o in r['occurrences']))
                    review=reviewed[source['id']];assert review['source']==literal and review['source_sha256']==prepare.digest(literal)
                    assert review['workbook_sha256']==ORIGINALS[v][1]
                    after=after.replace('"'+literal+'"','"'+review['target']+'"');bindings.append(review['id'])
                assert after!=before;formula('据点',ref,before,after,review_ids=bindings)
        else:
            # The original AV27/BG48 references point into blank ledger cells.
            # The visible switch is AS27; BD47/BD48 are bag/content weights.
            formula('主要','P62','IF(背包!AV27="有",15,背包!BG48)','IF(OR(背包!AS27="有",背包!AS27="Yes"),背包!BD47,背包!BD48)')
            formula('背景','I2','起源!E6','IF(起源!E6="Custom Background","自定义背景",起源!E6)')
            before=p.fragment(cells['背景']['A2']).findtext(p.q('f'))
            assert before=='IFERROR(INDEX($B$1:$B$141,SMALL(IF($B$1:$B$141<>"",ROW($B$1:$B$141),4^8),ROW(2:2)))&"","")'
            formula('背景','A2',before,'IF(('+before+')="自定义背景","Custom Background",('+before+'))')
        # Preserve area-diagram geometry and existing fields. Two origin rows
        # need height for the longer live English lookup results.
        for sheet in SHEETS[v]:
            refs=[e['cell'] for e in entries if e['version']==v and e['sheet']==sheet and e['kind']=='value']
            size=8 if sheet in ['圆形效应范围','据点','背包'] else 9
            wrap=refs if sheet in ['背景','起源','圆形效应范围','网页导入'] else []
            if sheet=='网页导入':refs=refs+['B8']
            if v=='2024' and sheet=='起源':refs=refs+['S4','AF4','S5','S6','S7','AP4'];wrap=refs
            entries.append({'id':v+'-'+sheet+'-layout','version':v,'sheet':sheet,'cell':'Translated captions','kind':'layout','source':'Existing typography and geometry','target':json.dumps({'refs':refs,'font':'Arial','size':size,'wrap_refs':wrap,'widths':{},'row_heights':{'4':28,'6':28} if v=='2024' and sheet=='起源' else {}},separators=(',',':'))})
    assert len({e['id'] for e in entries})==len(entries)
    return {'schema':'obr-character-pages-plan/v1','entries':entries,'inputs':PINS,'release_ready':False}

def apply(seeds,planned,author):
    assert planned==plan(seeds),'Plan differs from source and review';p.authored_values(author,planned['entries']);products={}
    for v,raw in seeds.items():
        parts,_,_=p.read_zip(raw);names=tabs(parts);strings=p.spans(parts[p.SST],'si');clones=[];clone_ids={};changed={};styles=parts['xl/styles.xml']
        rows=[e for e in planned['entries'] if e['version']==v]
        for sheet in dict.fromkeys(e['sheet'] for e in rows):
            part=names[sheet];content=parts[part];selected=[e for e in rows if e['sheet']==sheet]
            cells=p.indexed_cells(content)
            for e in [e for e in selected if e['kind']!='layout']:
                if e['kind'] in ['message','validation']:
                    old=p.spans(content,'dataValidation')[e['index']][1];assert p.fragment(old).get('sqref')==e['sqref']
                    if e['kind']=='validation':new=replace_element(old,'formula1',e['target'])
                    else:
                        key=e['attribute'];assert p.fragment(old).get(key)==e['source']
                        new,n=re.subn(rb'\b'+key.encode()+rb'="[^"]*"',lambda _:attrs({key:e['target']}),old,count=1);assert n==1
                        assert p.fragment(new).get(key)==e['target']
                else:
                    old=cells[e['cell']]
                    if e['kind']=='formula':
                        new=set_element_text(old,'f',e['target'][1:])
                        assert p.fragment(new).find(p.q('f')).attrib==p.fragment(old).find(p.q('f')).attrib
                    else:
                        si=strings[int(p.fragment(old).findtext(p.q('v')))][1];clone=clone_text(si,e['target'])
                        if clone not in clone_ids:clone_ids[clone]=len(strings)+len(clones);clones.append(clone)
                        new=set_element_text(old,'v',str(clone_ids[clone]))
                assert content.count(old)==1;content=content.replace(old,new,1)
            layouts=[json.loads(e['target']) for e in selected if e['kind']=='layout']
            geometry_reference=parts[part]
            for layout in layouts:
                styles,content=layout_styles(styles,content,layout)
                for ref,height in layout['row_heights'].items():
                    for which in ['content','reference']:
                        current=content if which=='content' else geometry_reference
                        old=next(b for a,b,*_ in p.spans(current,'row') if a['r']==ref)
                        new=attribute(attribute(old,'ht',height),'customHeight','1');current=current.replace(old,new,1)
                        if which=='content':content=current
                        else:geometry_reference=current
            # All unselected cells, geometry, objects and non-message rules
            # remain byte-identical, including player-authored blank inputs.
            now=p.indexed_cells(content);assert cells.keys()==now.keys()
            allowed={e['cell'] for e in selected if e['kind'] in ['formula','value']}|{ref for layout in layouts for ref in layout['refs']}
            for ref in cells:
                if ref not in allowed:assert cells[ref]==now[ref],(v,sheet,ref)
            strip=lambda b:p.strip_elements(p.strip_elements(b,'c'),'dataValidation')
            assert strip(content)==strip(geometry_reference)
            before_dv=p.spans(parts[part],'dataValidation');after_dv=p.spans(content,'dataValidation');assert len(before_dv)==len(after_dv)
            indexes={e['index'] for e in selected if e['kind'] in ['message','validation']}
            for i,(a,b) in enumerate(zip(before_dv,after_dv)):
                if i not in indexes:assert a[1]==b[1]
            changed[part]=content
        changed['xl/styles.xml']=styles
        sst=parts[p.SST].replace(b'</sst>',b''.join(clones)+b'</sst>')
        sst,n=re.subn(rb'(<sst\b[^>]*\buniqueCount=")[0-9]+(")',lambda m:m[1]+str(len(strings)+len(clones)).encode()+m[2],sst,count=1);assert n==1
        changed[p.SST]=sst;product=p.write_zip(raw,changed);after,_,_=p.read_zip(product)
        assert list(after)==list(parts)
        assert {k for k in parts if parts[k]!=after[k]}==set(changed)
        for tag,child in [('fonts','font'),('cellXfs','xf')]:
            old=p.spans(p.spans(parts['xl/styles.xml'],tag)[0][1],child);new=p.spans(p.spans(styles,tag)[0][1],child)
            assert [r[1] for r in old]==[r[1] for r in new[:len(old)]]
        assert [s[1] for s in strings]==[s[1] for s in p.spans(sst,'si')[:len(strings)]]
        products[v]=(product,{'version':v,'sha256':sha(product),'bytes':len(product),'changed_parts':list(changed),'counts':{k:sum(e['kind']==k for e in rows) for k in ['value','message','validation','formula']},'unselected_cells_area_geometry_original_styles_objects_and_strings_preserved':True,'origin_row_heights_changed':[4,6] if v=='2024' else [],'release_ready':False})
    return products
