"""Bounded English toggle increment; writes audit copies, never source cards."""
from pathlib import Path
import json,hashlib,xml.etree.ElementTree as E
from xml.sax.saxutils import escape
import spell_bodies_package as p
R=p.REPO
if not __debug__:raise RuntimeError('Verification requires assertions')
PINS={'2014':'726a999ebc6d0bc4b75071029a58a0d45b2f9a84d47934f879e25090cac74ae7','2024':'98f4bdeaeebe3b8df0d90659e75cf6189e10d79e68bc1f4a33731757ce100cd7'}
ORIGINALS={'2014':('DND5E人物卡_悲灵_弗人_枭熊适配版.xlsx','94444fda4206d579125418b0007b89c414b86c27d6b98655f81f3f1ce65e8fe6'),'2024':('DND5R人物卡_悲灵_弗人_枭熊适配版.xlsx','264fc65569e3e80932544af548830ca70f10ee308493c8b0234608fcd01c9b04')}
PART='xl/worksheets/sheet2.xml';SKILLS=(41,43,44,45,47,48,49,50,51,53,54,55,56,57,59,60,61,62)
sha=lambda b:hashlib.sha256(b).hexdigest()


def inputs(version):
    return {'BQ1':('是','Yes'),'X20':('否','No'),**({'H39':('否','No')} if version=='2014' else {})}


def plan(seeds):
    assert set(seeds)==set(PINS) and all(sha(raw)==PINS[v] for v,raw in seeds.items()), "Input is not the reviewed main-export card"
    reviews=[json.loads(line) for line in (R/'tools/xlsx-localization/reviews/main-display-labels-001.jsonl').read_text(encoding='utf8').splitlines()]
    entries=[]
    for version in PINS:
        parts,_,_=p.read_zip(seeds[version]);main=parts[PART];cells=p.indexed_cells(main)
        original=(R/'public'/ORIGINALS[version][0]).read_bytes();assert sha(original)==ORIGINALS[version][1]
        oparts,_,_=p.read_zip(original);ocells=p.indexed_cells(oparts[PART]);strings=E.fromstring(oparts[p.SST])
        for ref,(before,after) in inputs(version).items():
            assert cells[ref]==ocells[ref]
            cell=p.fragment(cells[ref]);assert cell.get('t')=='s' and p.visible_text(strings[int(cell.findtext(p.q('v')))])==before
            bound=[r for r in reviews if r['version']==version and r['source']==before and r['locations']==[ref] and r['sheet']=='主要']
            assert len(bound)==1 and bound[0]['target']==after and bound[0]['workbook_sha256']==ORIGINALS[version][1]
            entries.append({'id':version+'-value-'+ref,'version':version,'sheet':'主要','cell':ref,'kind':'value','source':before,'target':after,'review_id':bound[0]['id']})
        formula_refs=['BF7']+(['I'+str(r) for r in SKILLS] if version=='2014' else [])
        for ref in formula_refs:
            cell=p.fragment(cells[ref]);f=cell.find(p.q('f'));assert f is not None and not f.attrib and cell.find(p.q('v')) is None
            before=f.text;assert p.fragment(ocells[ref]).findtext(p.q('f'))==before
            old,new=('BQ1="否"','OR(BQ1="否",BQ1="No")') if ref=='BF7' else ('$H$39="是"','OR($H$39="是",$H$39="Yes")')
            assert before.count(old)==1
            entries.append({'id':version+'-formula-'+ref,'version':version,'sheet':'主要','cell':ref,'kind':'formula','source':'='+before,'target':'='+before.replace(old,new)})
        sqref='BQ1:BR1 X20 H39' if version=='2014' else 'BQ1 X20'
        dvs=[(attrs,raw) for attrs,raw,*_ in p.spans(main,'dataValidation') if attrs.get('sqref')==sqref]
        assert len(dvs)==1 and p.fragment(dvs[0][1]).findtext(p.q('formula1'))=='"是,否"'
        entries.append({'id':version+'-validation','version':version,'sheet':'主要','cell':'validation:'+sqref,'kind':'validation','sqref':sqref,'source':'"是,否"','target':'"Yes,No"'})
        cfs=[(attrs,raw) for attrs,raw,*_ in p.spans(main,'conditionalFormatting') if attrs.get('sqref')=='AX3:BQ3 AX5:BQ5']
        assert len(cfs)==1 and len(p.spans(cfs[0][1],'formula'))==1
        assert p.fragment(p.spans(cfs[0][1],'formula')[0][1]).text=='$BQ$1="是"'
        entries.append({'id':version+'-conditional','version':version,'sheet':'主要','cell':'conditional:AX3:BQ3 AX5:BQ5','kind':'conditional','sqref':'AX3:BQ3 AX5:BQ5','source':'=$BQ$1="是"','target':'=OR($BQ$1="是",$BQ$1="Yes")'})
    assert len(entries)==29
    return {'schema':'obr-main-toggle-plan/v1','entries':entries,'inputs':PINS,'release_ready':False}


def replace_element(raw,local,value):
    hits=p.spans(raw,local);assert len(hits)==1
    _,_,a,b=hits[0]
    return raw[:a]+('<'+local+'>'+escape(value)+'</'+local+'>').encode('utf8')+raw[b:]


def apply(seeds,planned,author):
    assert planned==plan(seeds), "Plan differs from pinned source and review"
    p.authored_values(author,planned['entries'])
    return {v:_apply_one(v,raw,planned) for v,raw in seeds.items()}


def _apply_one(version,seed,planned):
    parts,_,_=p.read_zip(seed);main=parts[PART];cells=p.indexed_cells(main);changed=main
    selected=[e for e in planned['entries'] if e['version']==version]
    for e in selected:
        if e['kind'] in ('value','formula'):
            old=cells[e['cell']]
            if e['kind']=='value':
                node=p.fragment(old);assert node.get('t')=='s' and len(node)==1 and node[0].tag==p.q('v')
                new=old.replace(b't="s"',b't="inlineStr"',1)
                hits=p.spans(new,'v');assert len(hits)==1
                _,_,a,b=hits[0];new=new[:a]+('<is><t>'+e['target']+'</t></is>').encode()+new[b:]
            else:new=replace_element(old,'f',e['target'][1:])
        else:
            tag='dataValidation' if e['kind']=='validation' else 'conditionalFormatting'
            blocks=[raw for attrs,raw,*_ in p.spans(changed,tag) if attrs.get('sqref')==e['sqref']];assert len(blocks)==1
            old=blocks[0]
            new=replace_element(old,'formula1' if tag=='dataValidation' else 'formula',e['target'] if tag=='dataValidation' else e['target'][1:])
        assert changed.count(old)==1
        changed=changed.replace(old,new,1)
    aftercells=p.indexed_cells(changed);refs={e['cell'] for e in selected if e['kind'] in ('value','formula')}
    assert aftercells.keys()==cells.keys() and all(aftercells[r]==raw for r,raw in cells.items() if r not in refs)
    # Removing only the changed cells/rules proves that the rest of the main
    # worksheet keeps exactly the same bytes, including all objects and ranges.
    def rest(raw):
        targets=[]
        for tag in ('c','dataValidation','conditionalFormatting'):
            for attrs,_,a,b in p.spans(raw,tag):
                hit=attrs.get('r') in refs if tag=='c' else any(e['sqref']==attrs.get('sqref') for e in selected if e['kind']==('validation' if tag=='dataValidation' else 'conditional'))
                if hit:targets.append((a,b))
        for a,b in sorted(targets,reverse=True):raw=raw[:a]+raw[b:]
        return raw
    assert rest(main)==rest(changed)
    product=p.write_zip(seed,{PART:changed});aparts,_,_=p.read_zip(product)
    assert list(parts)==list(aparts) and {k for k in parts if parts[k]!=aparts[k]}=={PART}
    for e in selected:
        if e['kind']=='formula':assert p.fragment(aftercells[e['cell']]).findtext(p.q('f'))==e['target'][1:]
        if e['kind']=='value':assert p.visible_text(p.fragment(aftercells[e['cell']]).find(p.q('is')))==e['target']
    return product,{'version':version,'sha256':sha(product),'bytes':len(product),'changed_main_cells':len(refs),'changed_formulas':sum(e['kind']=='formula' for e in selected),'other_parts_preserved':True,'native_verified':False,'release_ready':False}
