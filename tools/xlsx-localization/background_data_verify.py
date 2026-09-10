"""Read-only, independent package verification for the background increment."""
from pathlib import Path
import argparse,copy,hashlib,json,re,zipfile,xml.etree.ElementTree as E
if not __debug__:raise RuntimeError('Verification requires assertions')
NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';N={'m':NS};q=lambda s:'{'+NS+'}'+s
sha=lambda b:hashlib.sha256(b).hexdigest()
def parts(path):
    with zipfile.ZipFile(path) as z:return {n:z.read(n) for n in z.namelist()}
def canon(node):return E.tostring(node)
def text(node):return ''.join(n.text or '' for n in node.iter(q('t')))

def reader_style(oc,actual,old_styles,new_styles,source,font_name,font_size):
    ox=old_styles.find(q('cellXfs'))[int(oc[source].get('s'))];nx=new_styles.find(q('cellXfs'))[int(actual.get('s'))]
    font=copy.deepcopy(old_styles.find(q('fonts'))[int(ox.get('fontId'))]);new_font=new_styles.find(q('fonts'))[int(nx.get('fontId'))]
    for tag in ['scheme','charset']:
        for n in list(font.findall(q(tag))):font.remove(n)
    font.find(q('name')).set('val',font_name);font.find(q('sz')).set('val',str(font_size));assert canon(font)==canon(new_font)
    expected=copy.deepcopy(ox);expected.set('fontId',nx.get('fontId'));expected.set('applyFont','1');expected.set('applyAlignment','1')
    alignment=expected.find(q('alignment'));alignment.set('wrapText','1');alignment.set('shrinkToFit','0');assert canon(expected)==canon(nx)
def verify(source,output,plan,version):
    assert sha(Path(source).read_bytes())==plan['inputs'][version]
    before=parts(source);after=parts(output);assert list(before)==list(after)
    rels={n.get('Id'):n.get('Target') for n in E.fromstring(before['xl/_rels/workbook.xml.rels'])}
    names={n.get('name'):'xl/'+rels[n.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')] for n in E.fromstring(before['xl/workbook.xml']).find(q('sheets'))}
    selected=[e for e in plan['entries'] if e['version']==version];allowed={names[e['sheet']] for e in selected}|{'xl/sharedStrings.xml','xl/styles.xml'}
    assert {n for n in before if before[n]!=after[n]}==allowed
    os=E.fromstring(before['xl/sharedStrings.xml']);ns=E.fromstring(after['xl/sharedStrings.xml'])
    assert int(ns.get('uniqueCount'))==len(ns)
    assert int(ns.get('count'))==sum(c.get('t')=='s' for part in names.values() for c in E.fromstring(after[part]).findall('.//m:c',N))
    assert [canon(n) for n in os]==[canon(n) for n in list(ns)[:len(os)]]
    old_styles=E.fromstring(before['xl/styles.xml']);new_styles=E.fromstring(after['xl/styles.xml'])
    assert len(old_styles)==len(new_styles)
    for old_group,new_group in zip(old_styles,new_styles):
        assert old_group.tag==new_group.tag
        if old_group.tag in [q('fonts'),q('cellXfs')]:
            assert [canon(n) for n in old_group]==[canon(n) for n in list(new_group)[:len(old_group)]]
            assert int(new_group.get('count'))==len(new_group)
        else:assert canon(old_group)==canon(new_group)
    count=0;rich=0;reader_count=0
    for sheet in dict.fromkeys(e['sheet'] for e in selected):
        entries=[e for e in selected if e['sheet']==sheet];planned={e['cell']:e for e in entries};assert len(planned)==len(entries)
        old=E.fromstring(before[names[sheet]]);new=E.fromstring(after[names[sheet]])
        oc={n.get('r'):n for n in old.findall('.//m:c',N)};nc={n.get('r'):n for n in new.findall('.//m:c',N)}
        helpers={e['cell']:e for e in entries if e['kind']=='helper'}
        readers=[e for e in entries if e['kind']=='reader'];assert len(readers)<=1
        reader=json.loads(readers[0]['target']) if readers else None
        reader_cells=reader['cells'] if reader else {}
        assert set(nc)==set(oc)|set(helpers)|set(reader_cells)
        for ref,actual in nc.items():
            if ref in reader_cells:
                spec=reader_cells[ref];assert set(actual.attrib)=={'r','s','t'} and actual.get('t')==('str' if 'formula' in spec else 'inlineStr') and len(actual)==1
                if 'formula' in spec:assert actual[0].tag==q('f') and actual[0].text==spec['formula'] and actual[0].attrib=={}
                else:assert actual[0].tag==q('is') and text(actual)==spec['text'] and len(actual[0])==1
                reader_style(oc,actual,old_styles,new_styles,spec['style_from'],reader['font'],reader['font_size'])
                reader_count+=1;continue
            if ref in helpers:
                e=helpers[ref];assert actual.attrib=={'r':ref,'t':'inlineStr'} and len(actual)==1 and actual[0].tag==q('is')
                assert len(actual[0])==1 and actual[0][0].tag==q('t') and text(actual)==e['target']
                continue
            expected=copy.deepcopy(oc[ref]);e=planned.get(ref)
            if e and 'text_expression' in e:
                original_si=os[int(expected.findtext(q('v')))];assert text(original_si)==e['source'] and original_si.find(q('r')) is None
                expression=actual.findtext(q('f'));assert expression==e['text_expression'] and len(expression)<8192
                tokens=re.findall(r'"(?:[^"\r\n]|"")*"|CHAR\((?:9|10|13)\)',expression)
                assert '&'.join(tokens)==expression
                assert ''.join(t[1:-1].replace('""','"') if t.startswith('"') else chr(int(t[5:-1])) for t in tokens)==e['target']
                assert all(len(t[1:-1])<=255 for t in tokens if t.startswith('"'))
                expected.set('t','str');expected.remove(expected.find(q('v')));f=E.Element(q('f'));f.text=expression;expected.append(f)
                assert actual.find(q('v')) is None and actual.find(q('f')).attrib=={}
            elif e and e['kind']=='value':
                si=ns[int(actual.findtext(q('v')))];original_si=os[int(expected.findtext(q('v')))];assert text(si)==e['target'] and text(original_si)==e['source']
                original_runs=original_si.findall(q('r'));runs=si.findall(q('r'))
                if original_runs:
                    assert len(original_runs)==len(runs)==len(e['run_targets'])
                    assert [canon(n.find(q('rPr'))) for n in original_runs]==[canon(n.find(q('rPr'))) for n in runs]
                    assert [n.findtext(q('t')) for n in runs]==e['run_targets'];rich+=1
                else:assert len(si)==1 and si[0].tag==q('t')
                expected.find(q('v')).text=actual.findtext(q('v'))
            elif e and e['kind']=='formula':
                assert expected.findtext(q('f'))==e['source'][1:] and actual.findtext(q('f'))==e['target'][1:]
                expected.find(q('f')).text=actual.findtext(q('f'))
            if reader and ref=='AP3':
                reader_style(oc,actual,old_styles,new_styles,reader['link_style_from'],reader['font'],reader['link_font_size'])
                expected.set('s',actual.get('s'))
            assert canon(expected)==canon(actual),(version,sheet,ref)
            count+=1
        for ref,node in oc.items():
            other=nc[ref];node.clear();node.tag=other.tag;node.attrib.update(other.attrib);node.text=other.text;node.extend(copy.deepcopy(list(other)))
        if helpers:
            assert sheet=='Export'
            for row_number in sorted({int(ref[1:]) for ref in helpers}):
                row=next(n for n in old.findall('.//m:row',N) if n.get('r')==str(row_number))
                for col in ['P','Q']:row.append(copy.deepcopy(nc[col+str(row_number)]))
                if 'spans' in row.attrib:row.set('spans','1:17')
            dim=old.find(q('dimension'));dim.set('ref',dim.get('ref').replace(':N',':Q'))
        if reader:
            assert max(int(n.get('r')) for n in old.find(q('sheetData')))<reader['first_row']
            appended=[n for n in new.find(q('sheetData')) if int(n.get('r'))>=reader['first_row']]
            assert [int(n.get('r')) for n in appended]==list(range(reader['first_row'],reader['last_row']+1))
            for row in appended:
                assert row.attrib=={'r':row.get('r'),'ht':str(reader['height']),'customHeight':'1'}
                assert [n.get('r') for n in row]==[r for r in reader_cells if int(r[1:])==int(row.get('r'))]
                old.find(q('sheetData')).append(copy.deepcopy(row))
            merges=old.find(q('mergeCells'))
            for ref in reader['merges']:E.SubElement(merges,q('mergeCell'),{'ref':ref})
            merges.set('count',str(len(merges)))
            assert old.find(q('hyperlinks')) is None
            links=E.Element(q('hyperlinks'))
            for ref,target in reader['links'].items():E.SubElement(links,q('hyperlink'),{'ref':ref,'location':target})
            old.insert(list(old).index(old.find(q('pageMargins'))),links)
            dim=old.find(q('dimension'));dim.set('ref',re.sub(r'[0-9]+$',str(reader['last_row']),dim.get('ref')))
        assert canon(old)==canon(new),(version,sheet,'unplanned sheet change')
    return {'version':version,'existing_cells_checked':count,'parts_checked':len(before),'rich_run_mappings':rich,'reader_cells_checked':reader_count,'sha256':sha(Path(output).read_bytes())}
if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__)
    for key in ['source','output','plan','version']:cli.add_argument('--'+key,required=True)
    a=cli.parse_args();print(json.dumps(verify(a.source,a.output,json.loads(Path(a.plan).read_bytes()),a.version),ensure_ascii=False))
