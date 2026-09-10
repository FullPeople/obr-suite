"""Reviewed English ability inputs; preserve the original lookup dictionary keys."""
from pathlib import Path
import json,hashlib,xml.etree.ElementTree as E
import spell_bodies_package as p
R=p.REPO
from main_toggle_fields import replace_element,ORIGINALS
from main_display_apply import attribute,container,attrs
if not __debug__:raise RuntimeError('Verification requires assertions')
PINS={'2014':'1c21afede202a70b521bd19b2f0ff0088771ca6b7c6338b4d8afd051e7e2ca78','2024':'133a58fe3373ff13528b510d7dcb532c385e1071833024065462babb793a7f28'}
ABILITIES=(('力量','Strength'),('敏捷','Dexterity'),('体质','Constitution'),('智力','Intelligence'),('感知','Wisdom'),('魅力','Charisma'))
sha=lambda b:hashlib.sha256(b).hexdigest()

def tabs(parts):
    import posixpath
    rels={r.get('Id'):r.get('Target') for r in E.fromstring(parts['xl/_rels/workbook.xml.rels'])}
    return {n.get('name'):posixpath.normpath('xl/'+rels[n.get('{'+p.RNS+'}id')]) for n in E.fromstring(parts['xl/workbook.xml']).find(p.q('sheets'))}

def original_key(ref):
    expression=ref
    for zh,en in reversed(ABILITIES):expression=f'IF({ref}="{en}","{zh}",{expression})'
    return expression

def plan(seeds):
    assert set(seeds)==set(PINS) and all(sha(raw)==PINS[v] for v,raw in seeds.items()), "Input is not the reviewed main-toggle card"
    entries=[]
    reviews=[json.loads(s) for s in (R/'tools/xlsx-localization/reviews/main-display-labels-001.jsonl').read_text(encoding='utf8').splitlines()]
    for version in PINS:
        parts,_,_=p.read_zip(seeds[version]);names=tabs(parts);cells={name:p.indexed_cells(parts[names[name]]) for name in ['主要','装备']}
        raw=(R/'public'/ORIGINALS[version][0]).read_bytes();assert sha(raw)==ORIGINALS[version][1]
        originals,_,_=p.read_zip(raw);onames=tabs(originals);ocells={name:p.indexed_cells(originals[onames[name]]) for name in cells}
        strings=E.fromstring(originals[p.SST])
        for ref,before,after in [('L24','魅力','Charisma'),('AA30','默认','Default')]:
            assert cells['主要'][ref]==ocells['主要'][ref]
            node=p.fragment(cells['主要'][ref]);assert node.get('t')=='s' and p.visible_text(strings[int(node.findtext(p.q('v')))])==before
            found=[r for r in reviews if r['version']==version and r['sheet']=='主要' and r['locations']==[ref] and r['source']==before]
            assert len(found)==1 and found[0]['target']==after and found[0]['workbook_sha256']==ORIGINALS[version][1]
            entries.append({'id':version+'-value-'+ref,'version':version,'sheet':'主要','cell':ref,'kind':'value','source':before,'target':after,'review_id':found[0]['id']})
        f=p.fragment(cells['主要']['D24']).find(p.q('f'));assert f is not None and not f.attrib
        before=f.text;assert before==p.fragment(ocells['主要']['D24']).findtext(p.q('f'))
        if version=='2014':
            after=before
            for zh,en in ABILITIES:
                old=f'L24="{zh}"';assert after.count(old)==1;after=after.replace(old,f'OR({old},L24="{en}")')
        else:
            assert before=='SUM(8+S3+G24+VLOOKUP(L24,C13:S18,16,FALSE))'
            after=before.replace('VLOOKUP(L24,','VLOOKUP('+original_key('L24')+',')
        entries.append({'id':version+'-formula-D24','version':version,'sheet':'主要','cell':'D24','kind':'formula','source':'='+before,'target':'='+after})
        column='Z' if version=='2014' else 'AV';ref='主要!AA30' if version=='2014' else '主要!$AA$30'
        for row in range(2,5):
            cell=column+str(row);node=p.fragment(cells['装备'][cell]);f=node.find(p.q('f'))
            assert f is not None and not f.attrib and node.find(p.q('v')) is None
            before=f.text;assert before==p.fragment(ocells['装备'][cell]).findtext(p.q('f'))
            condition=ref+'="默认"';tail=','+ref+')'
            assert before.count(condition)==1 and before.endswith(tail)
            after=before[:-len(tail)]+','+original_key(ref)+')'
            after=after.replace(condition,'OR('+condition+','+ref+'="Default")',1)
            entries.append({'id':version+'-formula-'+cell,'version':version,'sheet':'装备','cell':cell,'kind':'formula','source':'='+before,'target':'='+after})
        for sqref,defaults in [('L24 N24',False),('AA30:AB30',True)]:
            before='"'+','.join((['默认'] if defaults else [])+[x[0] for x in ABILITIES])+'"'
            after='"'+','.join((['Default'] if defaults else [])+[x[1] for x in ABILITIES])+'"'
            dvs=[raw for attrs,raw,*_ in p.spans(parts[names['主要']],'dataValidation') if attrs.get('sqref')==sqref]
            assert len(dvs)==1 and p.fragment(dvs[0]).findtext(p.q('formula1'))==before
            entries.append({'id':version+'-validation-'+('weapon' if defaults else 'spell'),'version':version,'sheet':'主要','cell':'validation:'+sqref,'kind':'validation','sqref':sqref,'source':before,'target':after})
        for ref,col in [('L24','N'),('AA30','AC')]:
            entries.append({'id':version+'-layout-'+ref,'version':version,'sheet':'主要','cell':ref,'kind':'layout','column':col,
                'source':'Original input typography and column width',
                'target':json.dumps({'font':'Arial','size':8.5,'wrap':False,'column':col,'width':4.5},separators=(',',':'))})
    assert len(entries)==20
    return {'schema':'obr-main-ability-plan/v2','entries':entries,'inputs':PINS,'release_ready':False}


def layout_input_styles(raw,main,entries):
    fonts_raw=p.spans(raw,'fonts')[0][1];fonts=p.spans(fonts_raw,'font')
    xfs_raw=p.spans(raw,'cellXfs')[0][1];xfs=p.spans(xfs_raw,'xf')
    newfonts=[];newxfs=[];cells=p.indexed_cells(main)
    for entry in entries:
        cell=cells[entry['cell']];xf=xfs[int(p.fragment(cell).get('s','0'))][1]
        font=fonts[int(p.fragment(xf).get('fontId'))][1]
        for tag,value in [('name','Arial'),('sz','8.5')]:
            old=p.spans(font,tag);assert len(old)==1
            font=font.replace(old[0][1],attribute(old[0][1],'val',value),1)
        font=p.strip_elements(p.strip_elements(font,'scheme'),'charset')
        newfonts.append(font);nx=attribute(xf,'fontId',len(fonts)+len(newfonts)-1)
        nx=attribute(attribute(nx,'applyFont','1'),'applyAlignment','1')
        alignment=p.spans(nx,'alignment');assert len(alignment)==1
        align=attribute(attribute(alignment[0][1],'wrapText','0'),'shrinkToFit','0')
        nx=nx.replace(alignment[0][1],align,1);newxfs.append(nx)
        main=main.replace(cell,attribute(cell,'s',len(xfs)+len(newxfs)-1),1)
    cols=p.spans(main,'cols');assert len(cols)==1;old=cols[0][1];segments=[]
    for node in E.fromstring(old):
        lo,hi=int(node.get('min')),int(node.get('max'))
        cuts=sorted({lo,hi+1}|{n for col in [14,29] if lo<=col<=hi for n in [col,col+1]})
        for start,end in zip(cuts,cuts[1:]):
            values={**node.attrib,'min':str(start),'max':str(end-1)}
            if start in [14,29]:assert end==start+1;values.update(width='4.5',customWidth='1')
            segments.append(b'<col '+attrs(values)+b'/>')
    main=main.replace(old,b'<cols>'+b''.join(segments)+b'</cols>',1)
    raw=raw.replace(fonts_raw,container(fonts_raw,'fonts',newfonts,len(fonts)+len(newfonts)),1)
    raw=raw.replace(xfs_raw,container(xfs_raw,'cellXfs',newxfs,len(xfs)+len(newxfs)),1)
    return raw,main

def apply(seeds,planned,author):
    assert planned==plan(seeds), 'Plan differs from pinned source and review'
    p.authored_values(author,planned['entries'])
    return {v:_apply_one(v,raw,planned) for v,raw in seeds.items()}


def _apply_one(version,raw,planned):
    parts,_,_=p.read_zip(raw);names=tabs(parts);changed={};rows=[e for e in planned['entries'] if e['version']==version]
    for name in ['主要','装备']:
        part=names[name];original=parts[part];content=original;cells=p.indexed_cells(original)
        for e in [r for r in rows if r['sheet']==name and r['kind']!='layout']:
            if e['kind']=='validation':
                hits=[fragment for attrs,fragment,*_ in p.spans(content,'dataValidation') if attrs.get('sqref')==e['sqref']];assert len(hits)==1
                old=hits[0];new=replace_element(old,'formula1',e['target'])
            else:
                old=cells[e['cell']]
                if e['kind']=='formula':new=replace_element(old,'f',e['target'][1:])
                else:
                    node=p.fragment(old);assert node.get('t')=='s' and len(node)==1 and node[0].tag==p.q('v')
                    new=old.replace(b't="s"',b't="inlineStr"',1);hits=p.spans(new,'v');assert len(hits)==1
                    _,_,a,b=hits[0];new=new[:a]+('<is><t>'+e['target']+'</t></is>').encode()+new[b:]
            assert content.count(old)==1;content=content.replace(old,new,1)
        actual=p.indexed_cells(content);allowed={e['cell'] for e in rows if e['sheet']==name and e['kind']!='validation'}
        assert actual.keys()==cells.keys() and {r for r in cells if cells[r]!=actual[r]}==allowed
        # Every mutation is an exact replacement of one pinned cell or rule.
        # Preserve the rest of each worksheet, including all input geometry.
        def without_targets(data):
            spans=[]
            for local in ['c','dataValidation']:
                for attrs,_,a,b in p.spans(data,local):
                    if (local=='c' and attrs.get('r') in allowed) or (local=='dataValidation' and any(e.get('sqref')==attrs.get('sqref') for e in rows if e['sheet']==name and e['kind']=='validation')):spans.append((a,b))
            for a,b in sorted(spans,reverse=True):data=data[:a]+data[b:]
            return data
        assert without_targets(original)==without_targets(content);changed[part]=content
    changed['xl/styles.xml'],changed[names['主要']]=layout_input_styles(parts['xl/styles.xml'],changed[names['主要']],[e for e in rows if e['kind']=='layout'])
    product=p.write_zip(raw,changed);out,_,_=p.read_zip(product)
    assert list(out)==list(parts) and {name for name in parts if parts[name]!=out[name]}==set(changed)
    return product,{'version':version,'sha256':sha(product),'bytes':len(product),'changed_parts':list(changed),'source_cells_preserved_outside_scope':True,'release_ready':False}
