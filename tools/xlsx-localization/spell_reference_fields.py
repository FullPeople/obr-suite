"""Apply reviewed spell materials, school labels and sourcebook display fields.

Plans are rebuilt from pinned original cards and selected formal reviews. Static
keys, original provenance helpers, custom rows and all unrelated parts stay intact.
"""
from pathlib import Path
import hashlib,json,re,sys
import spell_bodies_package as p
from spell_display_fields import clone_text
from spell_display_labels import set_element_text

if not __debug__:raise RuntimeError('Verification requires assertions; do not use -O')
sys.dont_write_bytecode=True
REPO=p.REPO
sha=lambda b:hashlib.sha256(b).hexdigest()
REVIEWS={
 'spell-materials-books-schools-001.jsonl':('42e8d38e589a630f64f4eb8d85567ed0dd9f22a876179b2152e70ede8131cc86',2939),
 'spell-materials-002.jsonl':('9d9713f150f2084c604ea5ca4fd38dc3257a5524d5e44de287a601b08ae63344',453)}
CFG={
 '2014':{'source_sha':'94444fda4206d579125418b0007b89c414b86c27d6b98655f81f3f1ce65e8fe6','seed_sha':'2d309ace76918f998609d81f61db14209884bbd138d5cee4ad6f591bd45944bb','part':'xl/worksheets/sheet13.xml','last':524,'book':'X'},
 '2024':{'source_sha':'264fc65569e3e80932544af548830ca70f10ee308493c8b0234608fcd01c9b04','seed_sha':'de413faabdcf615cf9d33504bfd2dedc9ebd020de7369e3b4df4cd38c06d9e7f','part':'xl/worksheets/sheet14.xml','last':811,'book':'Z'}}

def plan():
    reviews=[];review_raw={}
    for name,(pin,count) in REVIEWS.items():
        raw=(REPO/'tools/xlsx-localization/reviews'/name).read_bytes()
        assert sha(raw.replace(b'\r\n',b'\n'))==pin
        selected=[json.loads(line) for line in raw.decode('utf8').splitlines()]
        assert len(selected)==count
        reviews.extend(selected);review_raw[name]=raw
    assert len(reviews)==len({r['id'] for r in reviews})==3392
    glossary_path=REPO/'tools/xlsx-localization/glossary.json';glossary=glossary_path.read_bytes()
    entries=[];versions={}
    for version,cfg in CFG.items():
        path=REPO/'public'/p.planner.p.TEMPLATES[version];source=path.read_bytes();assert sha(source)==cfg['source_sha']
        _,located,_=p.planner.p.inspect_xlsx(path,version,json.loads(glossary));actual={r['id']:r for r in located}
        parts,_,_=p.read_zip(source);part=cfg['part'];cells=p.indexed_cells(parts[part]);strings=p.spans(parts[p.SST],'si')
        selected=[r for r in reviews if r['version']==version]
        by_cell={r['locations'][0]:r for r in selected if r['kind']=='cell_text'}
        expected=[]
        for row in range(3,cfg['last']+1):
            for column in ('C','K',cfg['book']):
                ref=column+str(row)
                if ref not in cells:
                    assert column=='K'  # Some original blank material cells are absent.
                    continue
                node=p.fragment(cells[ref])
                assert node.find(p.q('f')) is None
                value=p.visible_text(p.fragment(strings[int(node.findtext(p.q('v')))][1])) if node.get('t')=='s' else node.findtext(p.q('v')) or ''
                if p.planner.p.CJK.search(value):expected.append(ref)
        assert set(by_cell)==set(expected) and len(by_cell)==len(expected)
        # Each role maps to the original row; never regroup by an English name.
        clones=[];clone_ids={};version_entries=[];rules=[]
        for review in selected:
            record=actual[review['id']];ref=review['locations'][0]
            assert all(review[k]==record[k] for k in ('source','kind','sheet','context'))
            assert record['occurrences']==[{'part':part,'location':ref}] and review['locations']==[ref]
            assert review['source_sha256']==p.digest(review['source']) and review['workbook_sha256']==cfg['source_sha']
            assert review['dependency_review']=='pending' and review['application_approved'] is False and review['reviewed_by'] and review['note']
            base={'id':review['id'],'version':version,'kind':review['kind'],'sheet':'法术大全','part':part,'cell':ref,'source':review['source'],'target':review['target'],'source_sha256':review['source_sha256'],'target_sha256':p.digest(review['target']),'review_record_sha256':p.digest(review)}
            if review['kind']=='cell_text':
                node=p.fragment(cells[ref]);assert node.get('t')=='s' and node.find(p.q('f')) is None
                index=int(node.findtext(p.q('v')));si=strings[index][1];assert p.visible_text(p.fragment(si))==review['source']
                clone=clone_text(si,review['target'])
                if clone not in clone_ids:clone_ids[clone]=len(clones);clones.append(clone)
                base.update(source_cell_sha256=sha(cells[ref]),source_si_sha256=sha(si),source_shared_index=index,clone_offset=clone_ids[clone],clone_sha256=sha(clone))
            else:
                assert version=='2024' and review['kind']=='conditional_literal'
                match=re.fullmatch(r'conditional:0:([0-7]):literal:0',ref);assert match
                i=int(match[1]);blocks=p.spans(parts[part],'conditionalFormatting');assert len(blocks)==1
                block=blocks[0][1];assert p.fragment(block).get('sqref')=='A$1:Y$1048576'
                old_rules=p.spans(block,'cfRule');assert len(old_rules)==8
                raw=old_rules[i][1];node=p.fragment(raw)
                assert node.attrib=={'type':'expression','dxfId':str(23+i),'priority':str(1+i)}
                before='$C1="'+review['source']+'"';after='OR('+before+',$C1="'+review['target']+'")'
                assert node.findtext(p.q('formula'))==before
                base.update(rule_index=i,source_rule_sha256=sha(raw),before=before,after=after)
                rules.append(base)
            version_entries.append(base)
        version_entries.sort(key=lambda e:(0,int(e['cell'][1:]),e['cell'][0]) if e['kind']=='cell_text' else (1,e['rule_index'],''))
        # Clone order follows formal review order, and is explicit in every entry.
        assert len(rules)==(8 if version=='2024' else 0)
        entries.extend(version_entries)
        versions[version]={'source_sha256':sha(source),'seed_sha256':cfg['seed_sha'],'part':part,'static_cells':len(expected),'new_unique_clones':len(clones),'clone_sha256':[sha(c) for c in clones],'conditional_rules':len(rules)}
        assert path.read_bytes()==source
    assert sum(v['static_cells'] for v in versions.values())==3384
    assert glossary_path.read_bytes()==glossary
    for name,raw in review_raw.items():assert (REPO/'tools/xlsx-localization/reviews'/name).read_bytes()==raw
    return {'schema':'obr-xlsx-partial-text-candidate/v1','entries':entries,'versions':versions,'review_hashes':{name:pin for name,(pin,_) in REVIEWS.items()},'scope':'Builtin C/K/sourcebook static fields and eight bilingual school comparisons; preserve all original provenance helpers and custom input formulas.','release_ready':False}

def apply(version,seed,planned):
    cfg=CFG[version];v=planned['versions'][version];assert sha(seed)==cfg['seed_sha']==v['seed_sha256']
    parts,infos,comment=p.read_zip(seed);part=cfg['part'];cells=p.indexed_cells(parts[part]);strings=p.spans(parts[p.SST],'si')
    entries=[e for e in planned['entries'] if e['version']==version and e['kind']=='cell_text']
    rules=[e for e in planned['entries'] if e['version']==version and e['kind']=='conditional_literal']
    assert len(entries)==v['static_cells'] and len(rules)==v['conditional_rules']
    changes={};clones={}
    for e in entries:
        cell=cells[e['cell']];assert sha(cell)==e['source_cell_sha256']
        raw=strings[e['source_shared_index']][1];assert sha(raw)==e['source_si_sha256']
        clone=clone_text(raw,e['target']);assert sha(clone)==e['clone_sha256']
        if e['clone_offset'] in clones:assert clones[e['clone_offset']]==clone
        else:clones[e['clone_offset']]=clone
        matches=p.spans(cell,'v');assert len(matches)==1
        _,old,a,b=matches[0];changes[e['cell']]=cell[:a]+b'<v>'+str(len(strings)+e['clone_offset']).encode()+b'</v>'+cell[b:]
    assert sorted(clones)==list(range(v['new_unique_clones'])) and [sha(clones[i]) for i in range(len(clones))]==v['clone_sha256']
    sheet=parts[part]
    for attrs,_,a,b in reversed(p.spans(sheet,'c')):
        if attrs['r'] in changes:sheet=sheet[:a]+changes[attrs['r']]+sheet[b:]
    if rules:
        block=p.spans(sheet,'conditionalFormatting')[0][1];old_rules=p.spans(block,'cfRule');updated=block
        for e in reversed(rules):
            _,old,a,b=old_rules[e['rule_index']];assert sha(old)==e['source_rule_sha256']
            new=set_element_text(old,'formula',e['after'])
            assert p.strip_elements(old,'formula')==p.strip_elements(new,'formula')
            updated=updated[:a]+new+updated[b:]
        assert sheet.count(block)==1;sheet=sheet.replace(block,updated,1)
    sst=parts[p.SST].replace(b'</sst>',b''.join(clones[i] for i in range(len(clones)))+b'</sst>')
    sst,n=re.subn(rb'(<sst\b[^>]*\buniqueCount=")[0-9]+(")',lambda m:m[1]+str(len(strings)+len(clones)).encode()+m[2],sst,count=1);assert n==1
    output=p.write_zip(seed,{part:sheet,p.SST:sst});after,new_infos,new_comment=p.read_zip(output)
    assert list(parts)==list(after) and comment==new_comment and {k for k in parts if parts[k]!=after[k]}=={part,p.SST}
    properties=('date_time','compress_type','comment','extra','create_system','create_version','extract_version','flag_bits','volume','internal_attr','external_attr')
    assert all(getattr(a,k)==getattr(b,k) for a,b in zip(infos,new_infos) for k in properties)
    new_cells=p.indexed_cells(after[part]);assert cells.keys()==new_cells.keys()
    assert {ref for ref in cells if cells[ref]!=new_cells[ref]}==set(changes)
    new_strings=p.spans(after[p.SST],'si');assert len(new_strings)==len(strings)+len(clones)
    assert [r[1] for r in new_strings[:len(strings)]]==[r[1] for r in strings]
    strip=lambda b:p.strip_elements(p.strip_elements(b,'c'),'conditionalFormatting')
    assert strip(parts[part])==strip(after[part])
    old_cf=p.spans(parts[part],'conditionalFormatting');new_cf=p.spans(after[part],'conditionalFormatting');assert len(old_cf)==len(new_cf)
    if not rules:assert [r[1] for r in old_cf]==[r[1] for r in new_cf]
    else:
        assert p.strip_elements(old_cf[0][1],'cfRule')==p.strip_elements(new_cf[0][1],'cfRule')
        before_rules=p.spans(old_cf[0][1],'cfRule');after_rules=p.spans(new_cf[0][1],'cfRule');assert len(before_rules)==len(after_rules)==8
        for e in rules:
            a=before_rules[e['rule_index']][1];b=after_rules[e['rule_index']][1]
            assert p.strip_elements(a,'formula')==p.strip_elements(b,'formula')
            assert p.fragment(b).findtext(p.q('formula'))==e['after']
    for e in entries:
        cell=new_cells[e['cell']];assert p.strip_elements(cell,'v')==p.strip_elements(cells[e['cell']],'v')
        index=int(p.fragment(cell).findtext(p.q('v')));assert index==len(strings)+e['clone_offset']
        assert p.visible_text(p.fragment(new_strings[index][1]))==e['target']
    return output,{'static_cells':len(entries),'conditional_rules':len(rules),'new_sst_clones':len(clones),'old_sst_nodes_preserved':len(strings),'same_sheet_non_target_cells':len(cells)-len(entries),'all_other_parts_byte_exact':True,'zip_metadata_preserved':True,'original_keys_body_flags_custom_formulas_and_provenance_helpers_preserved':True,'native_calculated':False,'upload_ready':False}
