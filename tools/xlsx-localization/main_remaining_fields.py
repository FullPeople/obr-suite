"""Finish main-card defaults and output literals, preserving original lookup data."""
import json,re,hashlib,xml.etree.ElementTree as E
from xml.sax.saxutils import escape
import prepare
import spell_bodies_package as p
from main_toggle_fields import ORIGINALS,replace_element
from main_ability_inputs import tabs
from main_display_apply import attribute,container,attrs
R=p.REPO
if not __debug__:raise RuntimeError('Verification requires assertions')
PINS={'2014':'3018996300dd3b701c1c4bdd9c1e8a44e358d9291d40940b400a0981b1eba697','2024':'2ee05231df8435e67bc5715d66d1f621935e2db5d38e47ccf6d0c89ec2307d2b'}
sha=lambda raw:hashlib.sha256(raw).hexdigest()
CAPTIONS={'Armor Proficiencies':'Armor Prof.','Weapon Proficiencies':'Weapon Prof.','Tool Proficiencies':'Tool Prof.','Saving Throw Proficiencies':'Save Prof.','Skill Proficiencies':'Skill Prof.','Starting Equipment':'Starting Eq.','Global Check Modifier':'Global Check Mod.'}

def key(ref,start,end):
    return f'_xlfn.IFNA(VLOOKUP({ref},\'Export\'!$M${start}:$N${end},2,FALSE),{ref})'

def plan(seeds):
    assert set(seeds)==set(PINS) and all(sha(raw)==PINS[v] for v,raw in seeds.items()),'Input is not the reviewed lookup-label card'
    reviews=[json.loads(s) for f in [R/'tools/xlsx-localization/reviewed.jsonl',*sorted((R/'tools/xlsx-localization/reviews').glob('*.jsonl'))] for s in f.read_text(encoding='utf8').splitlines()]
    assert len({r['id'] for r in reviews})==len(reviews)
    glossary=json.loads((R/'tools/xlsx-localization/glossary.json').read_bytes());entries=[]
    for version,raw in seeds.items():
        original=R/'public'/ORIGINALS[version][0];assert sha(original.read_bytes())==ORIGINALS[version][1]
        _,records,_=prepare.inspect_xlsx(original,version,glossary);records={r['id']:r for r in records}
        def reviewed(sheet,kind,location):
            found=[r for r in reviews if r['version']==version and r['sheet']==sheet and r['kind']==kind and location in r['locations']];assert len(found)==1,(version,sheet,kind,location)
            r=found[0];source=records[r['id']]
            assert all(r[k]==source[k] for k in ['source','kind','sheet','context']) and r['locations']==[o['location'] for o in source['occurrences']]
            assert r['source_sha256']==prepare.digest(r['source']) and r['workbook_sha256']==ORIGINALS[version][1]
            assert r['reviewed_by'] and r['note'] and r['dependency_review']=='pending' and r['application_approved'] is False
            assert r['target'] and not prepare.CJK.search(r['target']);return r
        parts,_,_=p.read_zip(raw);names=tabs(parts);cells={s:p.indexed_cells(parts[part]) for s,part in names.items()};strings=E.fromstring(parts[p.SST])
        refs=['BT3','BT4','BT5','R11',*['AX'+str(i) for i in range(11,14 if version=='2014' else 17)],'AO22','AR23',*[col+str(row) for row in range(26,29) for col in ['B','Q','AF']],'AK30','BT31' if version=='2014' else 'BT38','B39','V61' if version=='2014' else 'Y61','BL79']
        for ref in refs:
            r=reviewed('主要','cell_text',ref);node=p.fragment(cells['主要'][ref]);assert node.get('t')=='s' and len(node)==1 and node[0].tag==p.q('v')
            assert p.visible_text(strings[int(node[0].text)])==r['source']
            entries.append({'id':version+'-value-'+ref,'version':version,'sheet':'主要','cell':ref,'kind':'value','source':r['source'],'target':CAPTIONS.get(r['target'],r['target']),'full_target':r['target'],'review_id':r['id']})
        options=[('装备',('A' if version=='2014' else 'V')+str(i)) for i in (range(27,32) if version=='2014' else range(34,39))]
        options += [('数据表' if version=='2014' else '装备',('CI' if version=='2014' else 'S')+str(i)) for i in (range(15,21) if version=='2014' else range(39,45))]
        selected=[reviewed(sheet,'cell_text',ref) for sheet,ref in options]
        helpers=[('English lookup name','Original lookup name')]+[(r['target'],r['source']) for r in selected]
        for row,values in enumerate(helpers,1):
            for col,text in zip(['M','N'],values):
                ref=col+str(row);assert ref not in cells['Export']
                entries.append({'id':version+'-helper-'+ref,'version':version,'sheet':'Export','cell':ref,'kind':'helper','source':'Reserved empty helper cell','target':text,'review_id':selected[row-2]['id'] if row>1 else None})
        formulas=[]
        for ref in ['G88','B92']+(['V62'] if version=='2014' else []):
            node=p.fragment(cells['主要'][ref]);f=node.find(p.q('f'));assert f is not None and not f.attrib and node.find(p.q('v')) is None
            before=f.text;after=before;bindings=[]
            for i,literal in enumerate(prepare.literal_tokens(before)):
                if not prepare.CJK.search(literal):continue
                r=reviewed('主要','formula_literal',ref+':literal:'+str(i));assert r['source']==literal
                if ref=='V62' and literal=='最大载重':
                    old='V61="最大载重"';new='OR('+old+',V61="'+r['target']+'")'
                else:old='"'+literal+'"';new='"'+r['target']+'"'
                assert after.count(old)==1;after=after.replace(old,new,1);bindings.append(r['id'])
            formulas.append(('主要',ref,before,after,bindings))
        if version=='2024':
            ref='Y62';before=p.fragment(cells['主要'][ref]).findtext(p.q('f'));assert before=='F13*VLOOKUP(AR23,装备!S39:T44,2,FALSE)'
            formulas.append(('主要',ref,before,before.replace('VLOOKUP(AR23,','VLOOKUP('+key('AR23',7,12)+','),[]))
        producer='F27' if version=='2014' else 'AA34'
        for ref in (['G27','H27'] if version=='2014' else ['AB34','AC34']):
            node=p.fragment(cells['装备'][ref]);f=node.find(p.q('f'));assert f is not None and not f.attrib and node.find(p.q('v')) is None
            before=f.text;old='VLOOKUP('+producer+',';assert before.count(old)==(2 if ref in ['H27','AC34'] else 1)
            formulas.append(('装备',ref,before,before.replace(old,'VLOOKUP('+key(producer,2,6)+','),[]))
        for sheet,ref,before,after,bindings in formulas:
            entries.append({'id':version+'-formula-'+ref,'version':version,'sheet':sheet,'cell':ref,'kind':'formula','source':'='+before,'target':'='+after,'review_ids':bindings})
        rules=[('AK30:AO30','装备!$A$27:$A$31' if version=='2014' else '装备!$V$34:$V$38',"'Export'!$M$2:$M$6"),('AR23:AT23' if version=='2014' else 'AR23','数据表!$CI$15:$CI$20' if version=='2014' else '装备!$S$39:$S$44',"'Export'!$M$7:$M$12")]
        if version=='2014':
            r=reviewed('主要','validation_literal','validation:30:literal:0');assert r['source']=='最大载重,负重状态'
            rules.append(('V61','"'+r['source']+'"','"'+r['target']+'"'))
        for sqref,before,after in rules:
            found=[b for a,b,*_ in p.spans(parts[names['主要']],'dataValidation') if a.get('sqref')==sqref];assert len(found)==1 and p.fragment(found[0]).findtext(p.q('formula1'))==before
            entries.append({'id':version+'-validation-'+sqref,'version':version,'sheet':'主要','cell':'validation:'+sqref,'kind':'validation','sqref':sqref,'source':before,'target':after})
        # The full reviewed names are available on focus for compact captions.
        for e in [x for x in entries if x['version']==version and x['kind']=='value' and x['target']!=x['full_target']]:
            entries.append({'id':version+'-hint-'+e['cell'],'version':version,'sheet':'主要','cell':e['cell'],'kind':'hint','source':'Full reviewed caption','target':e['full_target']})
        layout={'refs':refs+['G88','B92']+(['V62'] if version=='2014' else []),'font':'Arial','size':8.5,'wrap_refs':['B92'],'widths':{'20':4.5,'35':4.5,'41':4.5,'46':4.5}}
        entries.append({'id':version+'-layout','version':version,'sheet':'主要','cell':'Remaining main typography','kind':'layout','source':'Original remaining label typography','target':json.dumps(layout,separators=(',',':'))})
    assert sum(e['kind']=='value' for e in entries)==49
    return {'schema':'obr-main-remaining-plan/v1','entries':entries,'inputs':PINS,'release_ready':False}

def layout_styles(styles,main,layout):
    fr=p.spans(styles,'fonts')[0][1];fonts=p.spans(fr,'font');xr=p.spans(styles,'cellXfs')[0][1];xfs=p.spans(xr,'xf');extra_fonts=[];extra_xfs=[];fontids={};xfids={};cells=p.indexed_cells(main)
    for ref in layout['refs']:
        cell=cells[ref];xf=xfs[int(p.fragment(cell).get('s','0'))][1];font=fonts[int(p.fragment(xf).get('fontId'))][1]
        for tag,value in [('name',layout['font']),('sz',str(layout['size']))]:
            old=p.spans(font,tag);assert len(old)==1;font=font.replace(old[0][1],attribute(old[0][1],'val',value),1)
        font=p.strip_elements(p.strip_elements(font,'scheme'),'charset')
        if font not in fontids:fontids[font]=len(fonts)+len(extra_fonts);extra_fonts.append(font)
        nx=attribute(attribute(attribute(xf,'fontId',fontids[font]),'applyFont','1'),'applyAlignment','1');align=p.spans(nx,'alignment');assert len(align)==1
        nx=nx.replace(align[0][1],attribute(attribute(align[0][1],'wrapText','1' if ref in layout['wrap_refs'] else '0'),'shrinkToFit','0'),1)
        if nx not in xfids:xfids[nx]=len(xfs)+len(extra_xfs);extra_xfs.append(nx)
        main=main.replace(cell,attribute(cell,'s',xfids[nx]),1)
    if layout['widths']:
        old=p.spans(main,'cols')[0][1];segments=[];widths={int(k):v for k,v in layout['widths'].items()}
        for node in E.fromstring(old):
            lo,hi=int(node.get('min')),int(node.get('max'));cuts=sorted({lo,hi+1}|{n for c in widths if lo<=c<=hi for n in [c,c+1]})
            for start,end in zip(cuts,cuts[1:]):
                a={**node.attrib,'min':str(start),'max':str(end-1)}
                if start in widths:a.update(width=str(widths[start]),customWidth='1')
                segments.append(b'<col '+attrs(a)+b'/>')
        main=main.replace(old,b'<cols>'+b''.join(segments)+b'</cols>',1)
    styles=styles.replace(fr,container(fr,'fonts',extra_fonts,len(fonts)+len(extra_fonts)),1)
    styles=styles.replace(xr,container(xr,'cellXfs',extra_xfs,len(xfs)+len(extra_xfs)),1)
    return styles,main

def apply(seeds,planned,author):
    assert planned==plan(seeds),'Plan differs from pinned source and review';p.authored_values(author,planned['entries']);products={}
    for version,raw in seeds.items():
        parts,_,_=p.read_zip(raw);names=tabs(parts);changed={};entries=[e for e in planned['entries'] if e['version']==version]
        for name in ['主要','装备','Export']:
            content=parts[names[name]];cells=p.indexed_cells(content);selected=[e for e in entries if e['sheet']==name]
            for e in [x for x in selected if x['kind'] in ['value','formula','validation']]:
                if e['kind']=='validation':
                    found=[b for a,b,*_ in p.spans(content,'dataValidation') if a.get('sqref')==e['sqref']];assert len(found)==1
                    old=found[0];new=replace_element(old,'formula1',e['target'])
                else:
                    old=cells[e['cell']]
                    if e['kind']=='formula':new=replace_element(old,'f',e['target'][1:])
                    else:
                        new=old.replace(b't="s"',b't="inlineStr"',1);v=p.spans(new,'v');assert len(v)==1
                        _,_,a,b=v[0];new=new[:a]+('<is><t>'+escape(e['target'])+'</t></is>').encode('utf8')+new[b:]
                assert content.count(old)==1;content=content.replace(old,new,1)
            helpers=[e for e in selected if e['kind']=='helper']
            if helpers:
                for ar,row,*_ in reversed(p.spans(content,'row')):
                    chosen=[e for e in helpers if re.search(r'\d+$',e['cell'])[0]==ar['r']]
                    if not chosen:continue
                    added=b''.join(('<c r="'+e['cell']+'" t="inlineStr"><is><t>'+escape(e['target'])+'</t></is></c>').encode('utf8') for e in chosen)
                    assert row.endswith(b'</row>');new=row[:-6]+added+b'</row>'
                    if 'spans' in ar:new=attribute(new,'spans','1:14')
                    content=content.replace(row,new,1)
                assert all(e['cell'] in p.indexed_cells(content) for e in helpers)
                d=p.spans(content,'dimension');assert len(d)==1;oldref=p.fragment(d[0][1]).get('ref');assert re.fullmatch(r'A1:L\d+',oldref)
                content=content.replace(d[0][1],attribute(d[0][1],'ref',oldref.replace(':L',':N')),1)
            hints=[e for e in selected if e['kind']=='hint']
            if hints:
                from openpyxl.worksheet.cell_range import MultiCellRange
                added=[];metadata=[]
                for e in hints:
                    conflicts=[(a,b) for a,b,*_ in p.spans(content,'dataValidation') if e['cell'] in MultiCellRange(a['sqref'])]
                    if conflicts:
                        assert len(conflicts)==1 and conflicts[0][0]['sqref']=='AX11:BB77' and e['cell'].startswith('AX')
                        metadata.append(e)
                    else:added.append(b'<dataValidation '+attrs({'type':'none','allowBlank':'1','showInputMessage':'1','promptTitle':'Details','prompt':e['target'],'sqref':e['cell']})+b'/>')
                if metadata:
                    # The original class list includes its metadata headings.
                    # Partition it without removing validation from any cell.
                    old=[b for a,b,*_ in p.spans(content,'dataValidation') if a.get('sqref')=='AX11:BB77'][0]
                    rows={int(e['cell'][2:]) for e in metadata};remaining=[];start=11
                    for row in sorted(rows):
                        if start<row:remaining.append(f'AX{start}:BB{row-1}')
                        start=row+1
                    if start<=77:remaining.append(f'AX{start}:BB77')
                    content=content.replace(old,attribute(old,'sqref',' '.join(remaining)),1)
                    for e in metadata:
                        row=int(e['cell'][2:]);clone=attribute(old,'sqref',f'AX{row}:BB{row}')
                        clone=attribute(attribute(clone,'promptTitle','Details'),'prompt',e['target']);added.append(clone)
                old=p.spans(content,'dataValidations')[0][1];content=content.replace(old,container(old,'dataValidations',added,len(p.spans(old,'dataValidation'))+len(added)),1)
            changed[names[name]]=content
        layout=json.loads(next(e['target'] for e in entries if e['kind']=='layout'))
        changed['xl/styles.xml'],changed[names['主要']]=layout_styles(parts['xl/styles.xml'],changed[names['主要']],layout)
        product=p.write_zip(raw,changed);out,_,_=p.read_zip(product)
        assert list(out)==list(parts) and {n for n in parts if parts[n]!=out[n]}==set(changed)
        products[version]=(product,{'version':version,'sha256':sha(product),'bytes':len(product),'changed_parts':list(changed),'release_ready':False})
    return products
