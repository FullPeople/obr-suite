"""Reviewed label/CF application; configured by the integrated package entry point."""
from pathlib import Path
import hashlib,json,re,sys
import xml.etree.ElementTree as ET
import spell_bodies_package as p
if not __debug__:raise RuntimeError("Verification requires assertions; do not use -O")
sys.dont_write_bytecode=True
REPO=p.REPO
sha=lambda b:hashlib.sha256(b).hexdigest()

REVIEW=REPO/'tools/xlsx-localization/reviews/spellbook-display-001.jsonl'
REVIEW_SHA='f8407a18b8c7f85966b676da1258b10b3d96a7afbff3638c154482060d0019b5'
literal=re.compile(r'"(?:[^"]|"")*"')
decode=lambda s:s[1:-1].replace('""','"')
quote=lambda s:'"'+s.replace('"','""')+'"'
CFG={}
def configure(seeds):
    global CFG
    CFG={v:{'source':REPO/'public'/p.planner.p.TEMPLATES[v],
        'source_sha':source,'seed':Path(seeds[v]).resolve(),'seed_sha':seed,'part':part}
        for v,source,seed,part in [
        ('2014','94444fda4206d579125418b0007b89c414b86c27d6b98655f81f3f1ce65e8fe6','3393c0fc8b0aa5898dd8ec7242995a71c22989b59741014a72c3152010d6e4cc','xl/worksheets/sheet12.xml'),
        ('2024','264fc65569e3e80932544af548830ca70f10ee308493c8b0234608fcd01c9b04','121cd7e2bd78efa8e185e8d2bb253073262b4df9ae8aa757b45219d74255eb3a','xl/worksheets/sheet13.xml')]}

def set_element_text(raw,name,value):
    matches=p.spans(raw,name);assert len(matches)==1
    _,node,a,b=matches[0];start=node.index(b'>')+1;end=node.rindex(('</'+name+'>').encode())
    return raw[:a]+node[:start]+p.escape(value).encode('utf8')+node[end:]+raw[b:]

def level_prefix(formula):
    marker='CONCATENATE(';assert formula.count(marker)==1
    start=formula.index(marker);pos=start+len(marker);depth=0;quoted=False;comma=None
    while pos<len(formula):
        char=formula[pos]
        if char=='"':
            if quoted and formula[pos:pos+2]=='""':pos+=2;continue
            quoted=not quoted
        elif not quoted:
            if char=='(':depth+=1
            elif char==')':
                if depth==0:break
                depth-=1
            elif char==',' and depth==0:
                assert comma is None;comma=pos
        pos+=1
    assert not quoted and comma is not None and formula[comma+1:pos]=='"Level"'
    value=formula[start+len(marker):comma]
    return formula[:start]+'CONCATENATE("Level ",'+value+')'+formula[pos+1:]

def build_plan():
    raw=REVIEW.read_bytes();assert sha(raw)==REVIEW_SHA
    rows=[json.loads(line) for line in raw.decode('utf8').splitlines()];assert len(rows)==42
    entries=[{**r,'cell':r['locations'][0]} for r in rows]
    versions={}
    for version,cfg in CFG.items():
        original=cfg['source'].read_bytes();seed=cfg['seed'].read_bytes()
        assert sha(original)==cfg['source_sha'] and sha(seed)==cfg['seed_sha']
        op,_,_=p.read_zip(original);parts,_,_=p.read_zip(seed);part=cfg['part']
        original_cells=p.indexed_cells(op[part]);cells=p.indexed_cells(parts[part]);old_strings=p.spans(op[p.SST],'si')
        records=[r for r in rows if r['version']==version];formulas={};statics=[]
        for r in records:
            assert r['sheet']=='法术书' and r['workbook_sha256']==cfg['source_sha'] and p.digest(r['source'])==r['source_sha256']
            if r['kind']=='cell_text':
                ref=r['locations'][0];assert r['locations']==[ref] and ref in ('AQ2','C22')
                c=p.fragment(original_cells[ref]);si=old_strings[int(c.findtext(p.q('v')))][1]
                assert p.visible_text(p.fragment(si))==r['source'] and len(p.fragment(si))==1 and p.fragment(si)[0].tag==p.q('t')
                assert original_cells[ref]==cells[ref]
                statics.append({'id':r['id'],'cell':ref,'source':r['source'],'target':r['target'],'original_si_sha256':sha(si)})
            elif r['kind']=='formula_literal':
                ref=r['context'].removeprefix('cell:');assert r['locations']==[ref+':literal:'+r['locations'][0].split(':')[-1]]
                original_formula=p.fragment(original_cells[ref]).findtext(p.q('f'));current=p.fragment(cells[ref]).findtext(p.q('f'))
                old_tokens=list(literal.finditer(original_formula));new_tokens=list(literal.finditer(current))
                assert [m[0] for m in old_tokens]==[m[0] for m in new_tokens]
                index=int(r['locations'][0].split(':')[-1]);assert decode(old_tokens[index][0])==r['source']
                item=formulas.setdefault(ref,{'before':current,'replacements':{}})
                assert index not in item['replacements'];item['replacements'][index]=r['target']
        for ref,item in formulas.items():
            tokens=list(literal.finditer(item['before']));after=item['before']
            for index,target in sorted(item['replacements'].items(),reverse=True):
                m=tokens[index];after=after[:m.start()]+quote(target)+after[m.end():]
            if ref=='M9':after=level_prefix(after)
            if ref in ('E9','E13'):after='TRIM('+after+')'
            item['after']=after
        assert set(formulas)=={'E9','M9','E13','H13'} and {s['cell'] for s in statics}=={'AQ2','C22'}
        cf_changes=[];validation_changes=[];existing_messages=[]
        if version=='2024':
            # These are semantic match rules, so preserve each old predicate and
            # OR its English equivalent. Use expression type instead of an editor
            # containsText shortcut that can regenerate a single-language rule.
            original_cf=p.spans(op[part],'conditionalFormatting')[1][1]
            current_cf=p.spans(parts[part],'conditionalFormatting')[1][1];assert current_cf==original_cf
            cf=p.fragment(current_cf);assert cf.get('sqref')=='X3:X52 AC3:AC52 AH3:AH52 AM3:AM52'
            translations={r['source']:r['target'] for r in records if r['kind']=='conditional_literal'}
            assert translations=={'火球术':'Fireball','隐形术':'Invisibility','识破隐形':'See Invisibility','繁彩球':'Chromatic Orb'}
            mapping=p.indexed_cells(parts['xl/worksheets/sheet20.xml'])
            for ref,label in {'B89':'Chromatic Orb','B367':'Fireball','B257':'See Invisibility','B236':'Invisibility'}.items():
                assert p.visible_text(p.fragment(mapping[ref]))==label
            for index,rule in enumerate(cf):
                before=rule.findtext(p.q('formula'));values=[decode(m[0]) for m in literal.finditer(before)]
                assert values and len(set(values))==1 and values[0] in translations
                english=literal.sub(lambda m:quote(translations[decode(m[0])]),before)
                attrs={k:v for k,v in rule.attrib.items() if k not in ('operator','text')};attrs['type']='expression'
                cf_changes.append({'index':index,'before':before,'after':'OR('+before+','+english+')','before_attrs':rule.attrib,'after_attrs':attrs})
            original_dv=p.fragment(p.spans(op[part],'dataValidation')[0][1]);current_dv=p.fragment(p.spans(parts[part],'dataValidation')[0][1])
            for r in records:
                if r['kind']!='validation_message':continue
                attr=r['locations'][0].split(':')[-1];assert r['locations']==['validation:0:'+attr]
                assert original_dv.get(attr)==r['source']
                # The published selector increment already localized these UI
                # messages. Preserve its clearer wording and existing behavior.
                expected={'errorTitle':'Spell not found','error':'The name may have changed, or this source may not be included.'}
                assert current_dv.get(attr)==expected[attr]
                existing_messages.append({'index':0,'attribute':attr,'value':expected[attr],'review_id':r['id'],'reason':'Already English in the published selector increment; preserve its current wording.'})
            assert len(cf_changes)==4 and len(existing_messages)==2 and not validation_changes
        versions[version]={'source_sha256':sha(original),'seed_sha256':sha(seed),'part':part,'statics':statics,'formulas':formulas,'conditional_rules':cf_changes,'validation_messages':validation_changes,'existing_english_messages':existing_messages}
        assert cfg['source'].read_bytes()==original and cfg['seed'].read_bytes()==seed
    assert REVIEW.read_bytes()==raw
    result={'schema':'obr-xlsx-partial-text-candidate/v1','entries':entries,'review_sha256':REVIEW_SHA,'versions':versions,'release_ready':False,'native_calculated':False}
    # Literal-position receipts are JSON object keys; compare the same serialized
    # representation when rebuilding a saved plan (JSON keys are always strings).
    return json.loads(json.dumps(result,ensure_ascii=False))

def apply(version,seed,plan):
    cfg=CFG[version];v=plan['versions'][version];assert sha(seed)==v['seed_sha256']
    parts,_,_=p.read_zip(seed);part=cfg['part'];sheet=parts[part];cells=p.indexed_cells(sheet);strings=p.spans(parts[p.SST],'si');changes={};clones=[]
    for item in v['statics']:
        ref=item['cell'];cell=cells[ref];si=strings[int(p.fragment(cell).findtext(p.q('v')))][1]
        assert sha(si)==item['original_si_sha256']
        text_nodes=p.spans(si,'t');assert len(text_nodes)==1
        attrs,old,a,b=text_nodes[0];head=old[:old.index(b'>')+1]
        if (item['target'][:1].isspace() or item['target'][-1:].isspace()) and 'xml:space' not in head.decode('utf8'):head=head[:-1]+b' xml:space="preserve">'
        clone=si[:a]+head+p.escape(item['target']).encode('utf8')+b'</t>'+si[b:]
        assert p.visible_text(p.fragment(clone))==item['target'] and p.strip_elements(si,'t')==p.strip_elements(clone,'t')
        changes[ref]=set_element_text(cell,'v',str(len(strings)+len(clones)));clones.append(clone)
    for ref,item in v['formulas'].items():
        assert p.fragment(cells[ref]).findtext(p.q('f'))==item['before']
        changes[ref]=set_element_text(cells[ref],'f',item['after'])
        assert p.strip_elements(changes[ref],'f')==p.strip_elements(cells[ref],'f')
    for ref,changed in changes.items():assert sheet.count(cells[ref])==1;sheet=sheet.replace(cells[ref],changed,1)
    if v['conditional_rules']:
        block=p.spans(sheet,'conditionalFormatting')[1][1];updated=block
        rules=p.spans(block,'cfRule')
        for rule in reversed(v['conditional_rules']):
            _,raw,a,b=rules[rule['index']];head_end=raw.index(b'>')+1;head=raw[:head_end]
            assert p.fragment(raw).attrib==rule['before_attrs']
            head=re.sub(rb'\s(?:operator|text)="[^"]*"',b'',head)
            head=re.sub(rb'\btype="[^"]*"',b'type="expression"',head)
            changed=set_element_text(head+raw[head_end:],'formula',rule['after'])
            assert p.fragment(changed).attrib==rule['after_attrs']
            updated=updated[:a]+changed+updated[b:]
        assert sheet.count(block)==1;sheet=sheet.replace(block,updated,1)
    for item in v['validation_messages']:
        raw=p.spans(sheet,'dataValidation')[item['index']][1]
        attr=item['attribute'];assert p.fragment(raw).get(attr)==item['before']
        changed,count=re.subn(rb'\b'+attr.encode()+rb'="[^"]*"',lambda _:attr.encode()+b'="'+p.escape(item['after'],{'"':'&quot;'}).encode('utf8')+b'"',raw,count=1)
        assert count==1 and p.fragment(changed).attrib=={**p.fragment(raw).attrib,attr:item['after']}
        assert sheet.count(raw)==1;sheet=sheet.replace(raw,changed,1)
    sst=parts[p.SST].replace(b'</sst>',b''.join(clones)+b'</sst>')
    sst=re.sub(rb'(<sst\b[^>]*\buniqueCount=")[0-9]+(")',lambda m:m[1]+str(len(strings)+len(clones)).encode()+m[2],sst,count=1)
    output=p.write_zip(seed,{part:sheet,p.SST:sst});after,_,_=p.read_zip(output)
    assert {k for k in parts if parts[k]!=after[k]}=={part,p.SST}
    new_cells=p.indexed_cells(after[part]);assert cells.keys()==new_cells.keys()
    assert {ref for ref in cells if cells[ref]!=new_cells[ref]}==set(changes)
    for ref in changes:assert new_cells[ref]==changes[ref]
    assert [s[1] for s in p.spans(after[p.SST],'si')[:len(strings)]]==[s[1] for s in strings]
    strip=lambda raw:p.strip_elements(p.strip_elements(p.strip_elements(raw,'c'),'conditionalFormatting'),'dataValidation')
    assert strip(parts[part])==strip(after[part])
    old_cf=p.spans(parts[part],'conditionalFormatting');new_cf=p.spans(after[part],'conditionalFormatting')
    assert len(old_cf)==len(new_cf)
    for i,(a,b) in enumerate(zip(old_cf,new_cf)):
        if version!='2024' or i!=1:assert a[1]==b[1]
    old_dv=p.spans(parts[part],'dataValidation');new_dv=p.spans(after[part],'dataValidation');assert len(old_dv)==len(new_dv)
    for i,(a,b) in enumerate(zip(old_dv,new_dv)):
        if version!='2024' or i!=0:assert a[1]==b[1]
        else:
            expected=dict(p.fragment(a[1]).attrib)
            for item in v['validation_messages']:expected[item['attribute']]=item['after']
            assert p.fragment(b[1]).attrib==expected and p.strip_elements(a[1],'formula1').split(b'>',1)[1]==p.strip_elements(b[1],'formula1').split(b'>',1)[1]
            assert p.fragment(a[1]).findtext(p.q('formula1'))==p.fragment(b[1]).findtext(p.q('formula1'))
    return output,{'changed_cells':list(changes),'unchanged_same_sheet_cells':len(cells)-len(changes),'new_sst_clones':len(clones),'conditional_rules':len(v['conditional_rules']),'validation_messages':len(v['validation_messages']),'all_other_parts_byte_exact':True,'source_keys_helpers_body_unchanged':True}
