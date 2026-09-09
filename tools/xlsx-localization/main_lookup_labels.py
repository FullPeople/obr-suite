"""English main-card lookup names with bounded aliases in the existing Export sheet."""
from pathlib import Path
import json,hashlib,re,xml.etree.ElementTree as E
from xml.sax.saxutils import escape
import spell_bodies_package as p
import prepare
from main_toggle_fields import ORIGINALS,replace_element
from main_ability_inputs import tabs,original_key
from main_display_apply import attribute,container,attrs
R=p.REPO
if not __debug__:raise RuntimeError('Verification requires assertions')
PINS={'2014':'a8e797c28189ac6bd4a5c8733ff450a05479f366cd441d071288f67225559fbb','2024':'d4676e66b358ad0c84fa28cbe3c6a7567a6c4944c377e134c49468f56f82fd60'}
SKILLS=(41,43,44,45,47,48,49,50,51,53,54,55,56,57,59,60,61,62)
sha=lambda b:hashlib.sha256(b).hexdigest()

def lookup_key(version,expression):
    end=25 if version=='2014' else 7
    return f'_xlfn.IFNA(VLOOKUP({expression},\'Export\'!$K$2:$L${end},2,FALSE),{expression})'

def plan(seeds):
    assert set(seeds)==set(PINS) and all(sha(raw)==PINS[v] for v,raw in seeds.items()),'Input is not the reviewed ability-input card'
    reviews=[json.loads(s) for s in (R/'tools/xlsx-localization/reviewed.jsonl').read_text(encoding='utf8').splitlines()]
    assert len({r['id'] for r in reviews})==len(reviews)
    glossary=json.loads((R/'tools/xlsx-localization/glossary.json').read_bytes());entries=[]
    for version,raw in seeds.items():
        source=R/'public'/ORIGINALS[version][0];assert sha(source.read_bytes())==ORIGINALS[version][1]
        _,records,_=prepare.inspect_xlsx(source,version,glossary);records={r['id']:r for r in records}
        parts,_,_=p.read_zip(raw);names=tabs(parts);cells={name:p.indexed_cells(parts[part]) for name,part in names.items()};strings=E.fromstring(parts[p.SST])
        refs=['C'+str(i) for i in range(13,19)]+(['C'+str(i) for i in SKILLS] if version=='2014' else [])
        selected=[]
        for ref in refs:
            found=[r for r in reviews if r['version']==version and r['sheet']=='主要' and r['kind']=='cell_text' and r['locations']==[ref]];assert len(found)==1
            review=found[0];record=records[review['id']]
            assert all(review[k]==record[k] for k in ['source','kind','sheet','context']) and review['sheet']=='主要'
            assert review['locations']==[o['location'] for o in record['occurrences']]
            assert review['source_sha256']==prepare.digest(review['source']) and review['workbook_sha256']==ORIGINALS[version][1]
            assert review['reviewed_by'] and review['note'] and review['dependency_review']=='pending' and review['application_approved'] is False
            assert review['target'] and not prepare.CJK.search(review['target'])
            cell=p.fragment(cells['主要'][ref]);assert cell.get('t')=='s' and len(cell)==1 and cell[0].tag==p.q('v')
            assert p.visible_text(strings[int(cell[0].text)])==review['source']
            entries.append({'id':version+'-value-'+ref,'version':version,'sheet':'主要','cell':ref,'kind':'value','source':review['source'],'target':review['target'],'review_id':review['id']});selected.append(review)
        helpers=[('Original lookup name','English lookup name')]+[(r['source'],r['target']) for r in selected]
        assert len({row[0] for row in helpers})==len(helpers)
        for row,values in enumerate(helpers,1):
            for col,text in zip(['K','L'],values):
                ref=col+str(row);assert ref not in cells['Export']
                entries.append({'id':version+'-helper-'+ref,'version':version,'sheet':'Export','cell':ref,'kind':'helper','source':'Reserved empty helper cell','target':text})
        formulas=[]
        if version=='2014':
            for row in range(55,73):
                ref='CF'+str(row);formulas.append(('数据表','CG'+str(row),ref,lookup_key(version,ref),1))
            for row in range(2,7):
                ref='Z'+str(row);formulas.append(('装备','AA'+str(row),'VLOOKUP('+ref+',主要!','VLOOKUP('+lookup_key(version,ref)+',主要!',1))
            for row in range(12,17):
                inner=f'VLOOKUP(主要!B{row+20},装备!N1:T50,7,FALSE)'
                for col in ['U','V']:formulas.append(('装备',col+str(row),inner,lookup_key(version,inner),2))
        else:
            formulas.append(('主要','D24',original_key('L24'),lookup_key(version,'L24'),1))
            for row in range(2,7):
                ref='AV'+str(row);formulas.append(('装备','AW'+str(row),'VLOOKUP('+ref+',主要!','VLOOKUP('+lookup_key(version,ref)+',主要!',1))
        for sheet,ref,old,new,count in formulas:
            cell=p.fragment(cells[sheet][ref]);f=cell.find(p.q('f'));assert f is not None and not f.attrib and cell.find(p.q('v')) is None
            before=f.text;assert before.count(old)==count
            entries.append({'id':version+'-formula-'+ref,'version':version,'sheet':sheet,'cell':ref,'kind':'formula','source':'='+before,'target':'='+before.replace(old,new)})
        entries.append({'id':version+'-layout','version':version,'sheet':'主要','cell':'C labels / E width','kind':'layout','source':'Original lookup label typography and E column width','target':json.dumps({'refs':refs,'font':'Arial','size':8.5,'wrap':False,'column':'E','width':8 if version=='2014' else 4.5},separators=(',',':'))})
    assert len(entries)==135
    return {'schema':'obr-main-lookup-label-plan/v1','entries':entries,'inputs':PINS,'release_ready':False}

def apply_layout(styles,main,layout):
    fr=p.spans(styles,'fonts')[0][1];fonts=p.spans(fr,'font');xr=p.spans(styles,'cellXfs')[0][1];xfs=p.spans(xr,'xf')
    extra_fonts=[];extra_xfs=[];fontids={};xfids={};cells=p.indexed_cells(main)
    for ref in layout['refs']:
        cell=cells[ref];xf=xfs[int(p.fragment(cell).get('s','0'))][1];font=fonts[int(p.fragment(xf).get('fontId'))][1]
        for tag,value in [('name','Arial'),('sz','8.5')]:
            before=p.spans(font,tag);assert len(before)==1;font=font.replace(before[0][1],attribute(before[0][1],'val',value),1)
        font=p.strip_elements(p.strip_elements(font,'scheme'),'charset')
        if font not in fontids:fontids[font]=len(fonts)+len(extra_fonts);extra_fonts.append(font)
        nx=attribute(attribute(attribute(xf,'fontId',fontids[font]),'applyFont','1'),'applyAlignment','1')
        alignment=p.spans(nx,'alignment');assert len(alignment)==1
        nx=nx.replace(alignment[0][1],attribute(attribute(alignment[0][1],'wrapText','0'),'shrinkToFit','0'),1)
        if nx not in xfids:xfids[nx]=len(xfs)+len(extra_xfs);extra_xfs.append(nx)
        main=main.replace(cell,attribute(cell,'s',xfids[nx]),1)
    oldcols=p.spans(main,'cols')[0][1];segments=[]
    for node in E.fromstring(oldcols):
        lo,hi=int(node.get('min')),int(node.get('max'));cuts=sorted({lo,hi+1}|({5,6} if lo<=5<=hi else set()))
        for start,end in zip(cuts,cuts[1:]):
            values={**node.attrib,'min':str(start),'max':str(end-1)}
            if start==5:assert end==6;values.update(width=str(layout['width']),customWidth='1')
            segments.append(b'<col '+attrs(values)+b'/>')
    main=main.replace(oldcols,b'<cols>'+b''.join(segments)+b'</cols>',1)
    styles=styles.replace(fr,container(fr,'fonts',extra_fonts,len(fonts)+len(extra_fonts)),1)
    styles=styles.replace(xr,container(xr,'cellXfs',extra_xfs,len(xfs)+len(extra_xfs)),1)
    return styles,main

def apply(seeds,planned,author):
    assert planned==plan(seeds),'Plan differs from pinned source and review';p.authored_values(author,planned['entries'])
    products={}
    for version,raw in seeds.items():
        parts,_,_=p.read_zip(raw);names=tabs(parts);changed={};entries=[e for e in planned['entries'] if e['version']==version]
        for name in ['主要','装备','数据表','Export']:
            selected=[e for e in entries if e['sheet']==name and e['kind']!='layout']
            if not selected:continue
            part=names[name];content=parts[part];cells=p.indexed_cells(content)
            for e in [x for x in selected if x['kind']!='helper']:
                old=cells[e['cell']]
                if e['kind']=='formula':new=replace_element(old,'f',e['target'][1:])
                else:
                    new=old.replace(b't="s"',b't="inlineStr"',1);v=p.spans(new,'v');assert len(v)==1
                    _,_,a,b=v[0];new=new[:a]+('<is><t>'+escape(e['target'])+'</t></is>').encode('utf8')+new[b:]
                assert content.count(old)==1;content=content.replace(old,new,1)
            helpers=[x for x in selected if x['kind']=='helper']
            if helpers:
                for attrs_row,row,*_ in reversed(p.spans(content,'row')):
                    chosen=[x for x in helpers if re.search(r'\d+$',x['cell'])[0]==attrs_row['r']]
                    if not chosen:continue
                    added=b''.join(('<c r="'+e['cell']+'" t="inlineStr"><is><t>'+escape(e['target'])+'</t></is></c>').encode('utf8') for e in chosen)
                    assert row.endswith(b'</row>');new=row[:-6]+added+b'</row>'
                    if 'spans' in attrs_row:new=attribute(new,'spans','1:12')
                    content=content.replace(row,new,1)
                assert all(e['cell'] in p.indexed_cells(content) for e in helpers)
                d=p.spans(content,'dimension');assert len(d)==1
                oldref=p.fragment(d[0][1]).get('ref');assert re.fullmatch(r'A1:A\d+',oldref)
                content=content.replace(d[0][1],attribute(d[0][1],'ref',oldref.replace(':A',':L')),1)
            changed[part]=content
        layout=json.loads(next(e['target'] for e in entries if e['kind']=='layout'))
        changed['xl/styles.xml'],changed[names['主要']]=apply_layout(parts['xl/styles.xml'],changed[names['主要']],layout)
        product=p.write_zip(raw,changed);out,_,_=p.read_zip(product)
        assert list(out)==list(parts) and {n for n in parts if parts[n]!=out[n]}==set(changed)
        products[version]=(product,{'version':version,'sha256':sha(product),'bytes':len(product),'changed_parts':list(changed),'release_ready':False})
    return products
