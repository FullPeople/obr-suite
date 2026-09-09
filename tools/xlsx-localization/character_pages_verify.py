"""Independent read-only verification of a support-page output against its plan."""
from pathlib import Path
import argparse,copy,hashlib,json,zipfile,xml.etree.ElementTree as E
if not __debug__:raise RuntimeError('Verification requires assertions; do not use -O')
N={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
q=lambda n:'{'+N['m']+'}'+n
sha=lambda b:hashlib.sha256(b).hexdigest()
def parts(path):
    with zipfile.ZipFile(path) as z:return {n:z.read(n) for n in z.namelist()}
def canon(node):return E.tostring(node)
def verify(source,output,plan,version):
    assert sha(Path(source).read_bytes())==plan['inputs'][version]
    before=parts(source);after=parts(output);assert list(before)==list(after)
    rels={r.get('Id'):r.get('Target') for r in E.fromstring(before['xl/_rels/workbook.xml.rels'])}
    names={n.get('name'):'xl/'+rels[n.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')] for n in E.fromstring(before['xl/workbook.xml']).find(q('sheets'))}
    entries=[e for e in plan['entries'] if e['version']==version];allowed={names[e['sheet']] for e in entries}|{'xl/styles.xml','xl/sharedStrings.xml'}
    assert {n for n in before if before[n]!=after[n]}==allowed
    oldstrings=E.fromstring(before['xl/sharedStrings.xml']);newstrings=E.fromstring(after['xl/sharedStrings.xml'])
    assert [canon(n) for n in oldstrings]==[canon(n) for n in list(newstrings)[:len(oldstrings)]]
    count=0
    for sheet in dict.fromkeys(e['sheet'] for e in entries):
        selected=[e for e in entries if e['sheet']==sheet];old=E.fromstring(before[names[sheet]]);new=E.fromstring(after[names[sheet]])
        oc={n.get('r'):n for n in old.findall('.//m:c',N)};nc={n.get('r'):n for n in new.findall('.//m:c',N)};assert oc.keys()==nc.keys()
        values={e['cell']:e for e in selected if e['kind']=='value'};formulas={e['cell']:e for e in selected if e['kind']=='formula'}
        layouts=[json.loads(e['target']) for e in selected if e['kind']=='layout'];styled={ref for layout in layouts for ref in layout['refs']}
        for ref,c in nc.items():
            expected=copy.deepcopy(oc[ref]);actual=copy.deepcopy(c)
            if ref in values:
                text=''.join(newstrings[int(c.findtext(q('v')))].itertext());assert text==values[ref]['target']
                expected.find(q('v')).text=c.findtext(q('v'))
            if ref in formulas:
                assert c.findtext(q('f'))==formulas[ref]['target'][1:]
                expected.find(q('f')).text=c.findtext(q('f'))
            if ref in styled:expected.set('s',actual.get('s'))
            assert canon(expected)==canon(actual),(version,sheet,ref)
            count+=1
        # Replace only the planned changes in an independent tree, then
        # compare the whole sheet, including merges and non-cell structures.
        for ref,node in oc.items():
            node.clear();other=nc[ref];node.tag=other.tag;node.attrib.update(other.attrib);node.text=other.text;node.extend(copy.deepcopy(list(other)))
        odv=old.findall('.//m:dataValidation',N);ndv=new.findall('.//m:dataValidation',N);assert len(odv)==len(ndv)
        for e in selected:
            if e['kind']=='message':odv[e['index']].set(e['attribute'],e['target'])
            if e['kind']=='validation':odv[e['index']].find(q('formula1')).text=e['target']
        for layout in layouts:
            for ref,height in layout['row_heights'].items():
                row=next(r for r in old.findall('.//m:row',N) if r.get('r')==ref);row.set('ht',str(height));row.set('customHeight','1')
        assert canon(old)==canon(new),(version,sheet,'unplanned sheet difference')
    for tag in ['fonts','cellXfs']:
        a=E.fromstring(before['xl/styles.xml']).find(q(tag));b=E.fromstring(after['xl/styles.xml']).find(q(tag))
        assert [canon(n) for n in a]==[canon(n) for n in list(b)[:len(a)]]
    return {'version':version,'cells_checked':count,'parts_checked':len(before),'sha256':sha(Path(output).read_bytes())}
if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__);cli.add_argument('--source',required=True);cli.add_argument('--output',required=True);cli.add_argument('--plan',required=True);cli.add_argument('--version',choices=['2014','2024'],required=True);a=cli.parse_args()
    print(json.dumps(verify(a.source,a.output,json.loads(Path(a.plan).read_bytes()),a.version),ensure_ascii=False))
