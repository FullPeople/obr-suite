"""Complete background text with gated English names and legacy-name lookup."""
import json,re,xml.etree.ElementTree as E
from xml.sax.saxutils import escape
import prepare
import spell_bodies_package as p
from main_ability_inputs import tabs
from main_toggle_fields import ORIGINALS
from main_remaining_fields import sha
from main_display_apply import attribute
from spell_display_fields import clone_text
from spell_display_labels import set_element_text
import background_reader
if not __debug__:raise RuntimeError('Verification requires assertions')
R=p.REPO
PINS={'2014':'1c341452a3d48f9616e14a7b8e02928c9a4b7837da2c119ed8dd9a76e514898c','2024':'d2c97ed34fe20a45b6fa2b2c0b5d88366c4a1715d1b15db3e448576ab1db7ac1'}
DATA={'2014':'背景数据','2024':'背景'}

def text_expression(text):
    """Keep paragraph breaks through XLSX references without long string literals."""
    pieces=[]
    for token in re.split(r'([\n\r\t])',text):
        if token in ['\n','\r','\t']:pieces.append('CHAR('+str(ord(token))+')')
        else:
            # Keep formula constants below 255 characters, including escaped quotes.
            pieces += ['"'+token[i:i+100].replace('"','""')+'"' for i in range(0,len(token),100)]
    result='&'.join(pieces) or '""'
    assert len(result)<8192 and not any(c in result for c in '\n\r\t')
    return result


def plan(seeds):
    assert set(seeds)==set(PINS) and all(sha(raw)==PINS[v] for v,raw in seeds.items())
    reviews=[json.loads(s) for f in [R/'tools/xlsx-localization/reviewed.jsonl',*sorted((R/'tools/xlsx-localization/reviews').glob('*.jsonl'))] for s in f.read_text(encoding='utf8').splitlines()]
    assert len({r['id'] for r in reviews})==len(reviews);reviewed={r['id']:r for r in reviews}
    glossary=json.loads((R/'tools/xlsx-localization/glossary.json').read_bytes());entries=[];aliases={};already=[]
    for v,raw in seeds.items():
        original=R/'public'/ORIGINALS[v][0];assert sha(original.read_bytes())==ORIGINALS[v][1]
        _,records,_=prepare.inspect_xlsx(original,v,glossary)
        parts,_,_=p.read_zip(raw);names=tabs(parts);cells={s:p.indexed_cells(parts[part]) for s,part in names.items()};strings=E.fromstring(parts[p.SST])
        selected=[r for r in records if r['sheet']==DATA[v] and r['kind'] in ['cell_text','formula_literal']]
        if v=='2024':selected += [r for r in records if r['sheet']=='自定义调整栏' and r['kind']=='cell_text' and any(o['location'] in ['U36','U43'] for o in r['occurrences'])]
        labels={}
        for source in selected:
            r=reviewed[source['id']]
            assert all(r[k]==source[k] for k in ['source','kind','sheet','context'])
            assert r['locations']==[o['location'] for o in source['occurrences']]
            assert r['source_sha256']==prepare.digest(r['source']) and r['workbook_sha256']==ORIGINALS[v][1]
            assert r['reviewed_by'] and r['note'] and r['target'] and not prepare.CJK.search(r['target']);p.validate_text(r['target'])
            for o in source['occurrences']:
                ref=o['location'].split(':')[0];sheet=r['sheet'];node=p.fragment(cells[sheet][ref])
                if r['kind']=='cell_text':
                    assert node.get('t')=='s' and node.find(p.q('f')) is None
                    current=p.visible_text(strings[int(node.findtext(p.q('v')))])
                    assert current in [r['source'],r['target']],(v,sheet,ref,current)
                    labels[sheet+'!'+ref]=(r['source'],r['target'],r['id'])
                    if current==r['target']:already.append({'version':v,'sheet':sheet,'cell':ref,'target':current});continue
                    entry={'id':v+'-'+sheet+'-'+ref,'version':v,'sheet':sheet,'cell':ref,'kind':'value','source':current,'target':r['target'],'review_id':r['id']}
                    runs=strings[int(node.findtext(p.q('v')))].findall(p.q('r'))
                    if sheet==DATA[v] and ref.rstrip('0123456789') in (['H','N'] if v=='2014' else ['H']) and '\n' in r['target']:
                        assert not runs,'Do not flatten rich text into a formula'
                        entry['text_expression']=text_expression(r['target'])
                    if runs:
                        assert v=='2014' and sheet==DATA[v] and ref=='E23' and len(runs)==2
                        assert runs[0].findtext(p.q('t')).endswith('有关') and runs[1].findtext(p.q('t')).startswith('──也许')
                        assert r['target'].count('truth: perhaps')==1
                        first,last=r['target'].split(': perhaps',1);entry['run_targets']=[first,': perhaps'+last]
                    entries.append(entry)
                else:
                    assert v=='2024' and re.fullmatch(r'B(?:1[0-3][0-9]|[2-9][0-9]|19)',ref)
                    before=node.findtext(p.q('f'));assert re.fullmatch(r'IF\(自定义调整栏!\$E\$[0-9]+="O","[^"]+",""\)',before)
                    assert '"'+r['source']+'"' in before
                    after=before.replace('"'+r['source']+'"','"'+r['target'].replace('"','""')+'"')
                    labels[sheet+'!'+ref]=(r['source'],r['target'],r['id'])
                    entries.append({'id':v+'-'+sheet+'-'+ref,'version':v,'sheet':sheet,'cell':ref,'kind':'formula','source':'='+before,'target':'='+after,'review_id':r['id']})
        name_refs=[DATA[v]+'!'+('G' if v=='2014' else 'B')+str(n) for n in (range(3,80) if v=='2014' else range(2,139))]
        if v=='2024':name_refs += ['自定义调整栏!U36','自定义调整栏!U43']
        maps=[labels[ref] for ref in name_refs]
        assert len({a for a,_,_ in maps})==len(maps),'Original background keys must be unique'
        assert len({b.casefold() for _,b,_ in maps})==len(maps),'English background keys collide'
        aliases[v]=[{'source':a,'target':b,'review_id':rid} for a,b,rid in maps]
        for row,(a,b,rid) in enumerate([('Original background name','English background name',None)]+maps,1):
            for col,text in [('P',a),('Q',b)]:
                ref=col+str(row);assert ref not in cells['Export']
                entries.append({'id':v+'-Export-'+ref,'version':v,'sheet':'Export','cell':ref,'kind':'helper','source':'Reserved empty alias cell','target':text,'review_id':rid})
        last=len(maps)+1;input_ref='背景!E6' if v=='2014' else '起源!E6'
        lookup=f'IFERROR(VLOOKUP({input_ref},\'Export\'!$P$2:$Q${last},2,FALSE),{input_ref})'
        ref='O2' if v=='2014' else 'I2';before=p.fragment(cells[DATA[v]][ref]).findtext(p.q('f'))
        expected='IF(背景!E6="","-",背景!E6)' if v=='2014' else 'IF(起源!E6="Custom Background","自定义背景",起源!E6)'
        assert before==expected
        after='IF(背景!E6="","-",'+lookup+')' if v=='2014' else 'IF(起源!E6="","",'+lookup+')'
        entries.append({'id':v+'-lookup-'+ref,'version':v,'sheet':DATA[v],'cell':ref,'kind':'formula','source':'='+before,'target':'='+after})
        if v=='2024':
            op,_,_=p.read_zip(original.read_bytes());before=p.fragment(cells[DATA[v]]['A2']).findtext(p.q('f'));original_f=p.fragment(p.indexed_cells(op[tabs(op)[DATA[v]]])['A2']).findtext(p.q('f'))
            assert before=='IF(('+original_f+')="自定义背景","Custom Background",('+original_f+'))'
            entries.append({'id':v+'-dropdown-A2','version':v,'sheet':DATA[v],'cell':'A2','kind':'formula','source':'='+before,'target':'='+original_f})
        page='背景' if v=='2014' else '起源';before=p.visible_text(strings[int(p.fragment(cells[page]['AP3']).findtext(p.q('v')))])
        entries.append({'id':v+'-reader-link','version':v,'sheet':page,'cell':'AP3','kind':'value','source':before,'target':'Background Feature - Read full text below' if v=='2014' else 'Background Description - Read full text below'})
        entries.append({'id':v+'-reader','version':v,'sheet':page,'cell':'Full background reader','kind':'reader','source':'Unused rows below the character form','target':json.dumps(background_reader.spec(v),ensure_ascii=False,separators=(',',':'))})
    assert len({e['id'] for e in entries})==len(entries)
    return {'schema':'obr-background-data-plan/v1','entries':entries,'inputs':PINS,'aliases':aliases,'already_applied':already,'release_ready':False}

def apply(seeds,planned,author):
    assert planned==plan(seeds);p.authored_values(author,planned['entries']);products={}
    for v,raw in seeds.items():
        parts,_,_=p.read_zip(raw);names=tabs(parts);strings=p.spans(parts[p.SST],'si');clones=[];clone_ids={};changed={};styles=parts['xl/styles.xml'];selected=[e for e in planned['entries'] if e['version']==v]
        for sheet in dict.fromkeys(e['sheet'] for e in selected):
            part=names[sheet];content=parts[part];cells=p.indexed_cells(content);rows=[e for e in selected if e['sheet']==sheet]
            for e in [e for e in rows if e['kind'] not in ['helper','reader']]:
                old=cells[e['cell']]
                if e['kind']=='formula':
                    assert p.fragment(old).findtext(p.q('f'))==e['source'][1:]
                    new=set_element_text(old,'f',e['target'][1:]);assert p.fragment(new).find(p.q('f')).attrib==p.fragment(old).find(p.q('f')).attrib
                elif 'text_expression' in e:
                    # Fixed reference-book paragraphs only; player inputs stay editable.
                    # Calc 26.8 removes LF from referenced strings, but not formula results.
                    assert p.fragment(old).get('t')=='s' and p.fragment(old).find(p.q('f')) is None
                    new=attribute(old,'t','str')
                    value=p.spans(new,'v');assert len(value)==1
                    new=new.replace(value[0][1],('<f>'+escape(e['text_expression'])+'</f>').encode('utf8'),1)
                else:
                    si=strings[int(p.fragment(old).findtext(p.q('v')))][1]
                    if 'run_targets' in e:
                        assert ''.join(e['run_targets'])==e['target'];texts=p.spans(si,'t');assert len(texts)==len(e['run_targets'])==2;clone=si
                        for (_,_,a,b),text in reversed(list(zip(texts,e['run_targets']))):clone=clone[:a]+('<t xml:space="preserve">'+escape(text)+'</t>').encode('utf8')+clone[b:]
                        assert p.visible_text(p.fragment(clone))==e['target'] and p.strip_elements(si,'t')==p.strip_elements(clone,'t')
                    else:clone=clone_text(si,e['target'])
                    if clone not in clone_ids:clone_ids[clone]=len(strings)+len(clones);clones.append(clone)
                    new=set_element_text(old,'v',str(clone_ids[clone]))
                assert content.count(old)==1;content=content.replace(old,new,1)
            helpers=[e for e in rows if e['kind']=='helper']
            if helpers:
                assert sheet=='Export'
                for row_number in sorted({int(e['cell'][1:]) for e in helpers}):
                    found=[b for a,b,*_ in p.spans(content,'row') if int(a['r'])==row_number];assert len(found)==1;old=found[0]
                    values=[e for e in helpers if int(e['cell'][1:])==row_number]
                    added=''.join('<c r="'+e['cell']+'" t="inlineStr"><is><t xml:space="preserve">'+escape(e['target'])+'</t></is></c>' for e in values).encode('utf8')
                    new=old.replace(b'</row>',added+b'</row>');assert new!=old
                    if 'spans' in p.fragment(old).attrib:new=attribute(new,'spans','1:17')
                    content=content.replace(old,new,1)
                dim=p.spans(content,'dimension')[0][1];ref=p.fragment(dim).get('ref');assert re.fullmatch('A1:N[0-9]+',ref)
                content=content.replace(dim,attribute(dim,'ref',ref.replace(':N',':Q')),1)
            after_cells=p.indexed_cells(content);assert set(after_cells)==set(cells)|{e['cell'] for e in helpers}
            allowed={e['cell'] for e in rows}
            for ref in cells:
                if ref not in allowed:assert after_cells[ref]==cells[ref]
            if not helpers:assert p.strip_elements(content,'c')==p.strip_elements(parts[part],'c')
            readers=[e for e in rows if e['kind']=='reader']
            if readers:
                assert len(readers)==1;styles,content=background_reader.apply(styles,content,json.loads(readers[0]['target']))
            changed[part]=content
        changed['xl/styles.xml']=styles
        sst=parts[p.SST].replace(b'</sst>',b''.join(clones)+b'</sst>')
        sst,n=re.subn(rb'(<sst\b[^>]*\buniqueCount=")[0-9]+(")',lambda m:m[1]+str(len(strings)+len(clones)).encode()+m[2],sst,count=1);assert n==1
        # Fixed text formulas no longer reference SST entries. Count actual uses;
        # earlier engineering increments also left this optional attribute stale.
        references=sum(a.get('t')=='s' for part in names.values() for a,*_ in p.spans(changed.get(part,parts[part]),'c'))
        sst,n=re.subn(rb'(<sst\b[^>]*\bcount=")[0-9]+(")',lambda m:m[1]+str(references).encode()+m[2],sst,count=1);assert n==1
        changed[p.SST]=sst;out=p.write_zip(raw,changed);after,_,_=p.read_zip(out)
        assert list(after)==list(parts) and {k for k in parts if parts[k]!=after[k]}==set(changed)
        assert [s[1] for s in strings]==[s[1] for s in p.spans(sst,'si')[:len(strings)]]
        products[v]=(out,{'version':v,'sha256':sha(out),'bytes':len(out),'changed_parts':list(changed),'counts':{k:sum(e['kind']==k for e in selected) for k in ['value','formula','helper']},'paragraph_expressions':sum('text_expression' in e for e in selected),'aliases':len(planned['aliases'][v]),'original_styles_objects_and_unrelated_parts_preserved':True,'release_ready':False})
    return products
