"""Read-only verification of companion package preservation and formula changes."""
import argparse,copy,hashlib,json,posixpath,zipfile
from pathlib import Path
from xml.etree import ElementTree as E
Q=lambda name:'{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'+name
if not __debug__:raise RuntimeError('Verification requires assertions')

def package(path):
    with zipfile.ZipFile(path) as z:return {n:z.read(n) for n in z.namelist()}

def sheets(parts):
    links={r.get('Id'):r.get('Target') for r in E.fromstring(parts['xl/_rels/workbook.xml.rels'])}
    return {s.get('name'):posixpath.normpath('xl/'+links[s.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]) for s in E.fromstring(parts['xl/workbook.xml']).find(Q('sheets'))}

def text(cell,strings):
    return strings[int(cell.findtext(Q('v')))] if cell.get('t')=='s' else ''.join(t.text or '' for t in cell.iter(Q('t')))

def equal(a,b):
    return a.tag==b.tag and a.attrib==b.attrib and (a.text or '')==(b.text or '') and len(a)==len(b) and all(equal(x,y) for x,y in zip(a,b))

def verify(oldpath,newpath,entries,version):
    old=package(oldpath);new=package(newpath);assert list(old)==list(new)
    target=sheets(old)['盟友与魔宠'];assert sheets(old)==sheets(new)
    assert {n for n in old if old[n]!=new[n]}=={target,'xl/styles.xml'}
    a=E.fromstring(old[target]);b=E.fromstring(new[target]);ac={c.get('r'):c for c in a.iter(Q('c'))};bc={c.get('r'):c for c in b.iter(Q('c'))}
    assert set(ac)==set(bc)
    strings=[''.join(t.text or '' for t in si.iter(Q('t'))) for si in E.fromstring(old['xl/sharedStrings.xml'])]
    changed=[e for e in entries if e['version']==version];values={e['cell']:e for e in changed if e['kind']=='value'}
    formulas={e['cell']:e for e in changed if e['kind']=='formula'}
    assert set(formulas)==({'AM3','AM5','AM6','AM7','AM8'} if version=='2014' else set())
    styles_old=E.fromstring(old['xl/styles.xml']);styles_new=E.fromstring(new['xl/styles.xml']);oldxfs=list(styles_old.find(Q('cellXfs')));newxfs=list(styles_new.find(Q('cellXfs')))
    for ref,cell in bc.items():
        if ref in values:
            assert text(ac[ref],strings)==values[ref]['source'] and text(cell,strings)==values[ref]['target']
            assert int(cell.get('s'))>=len(oldxfs)
            previous=oldxfs[int(ac[ref].get('s','0'))];after=newxfs[int(cell.get('s'))]
            assert equal(previous.find(Q('protection')),after.find(Q('protection'))) if previous.find(Q('protection')) is not None else after.find(Q('protection')) is None
            cell.attrib.clear();cell.attrib.update(ac[ref].attrib);cell[:]=copy.deepcopy(list(ac[ref]))
        elif ref in formulas:
            actual=cell.find(Q('f'));previous=ac[ref].find(Q('f'))
            assert actual.text==previous.text.replace('#REF!','AB3') and previous.text.count('#REF!')==1
            actual.text=previous.text
    av=a.find(Q('dataValidations'));bv=b.find(Q('dataValidations'));original_validations=list(av)
    changed_validations={e['sqref']:e for e in changed if e['kind']=='validation'}
    for previous,current in zip(original_validations,list(bv)):
        assert previous.attrib==current.attrib
        ref=previous.get('sqref')
        if ref in changed_validations:
            entry=changed_validations[ref];assert previous.findtext(Q('formula1'))==entry['source'] and current.findtext(Q('formula1'))==entry['target']
            current.find(Q('formula1')).text=previous.findtext(Q('formula1'))
    expected_hints={e['cell']:e['target'] for e in changed if e['kind']=='hint'}
    added=list(bv)[len(original_validations):]
    assert len(added)==len(expected_hints) and {n.get('sqref'):n.get('prompt') for n in added}==expected_hints
    for node in added:assert node.get('type')=='none' and node.get('showInputMessage')=='1';bv.remove(node)
    bv.attrib.clear();bv.attrib.update(av.attrib)
    widths=json.loads(next(e['target'] for e in changed if e['kind']=='layout'))['widths']
    ca=a.find(Q('cols'));cb=b.find(Q('cols'))
    def expanded(cols):
        result={}
        for col in cols:
            value={k:v for k,v in col.attrib.items() if k not in ['min','max']}
            for index in range(int(col.get('min')),int(col.get('max'))+1):result[index]=value
        return result
    original_columns=expanded(ca);new_columns=expanded(cb);assert set(original_columns)==set(new_columns)
    for index,original in original_columns.items():
        current=new_columns[index];expected=dict(original)
        if str(index) in widths:expected.update(width=str(widths[str(index)]),customWidth='1')
        assert current==expected,(index,current,expected)
    cb.attrib.clear();cb.attrib.update(ca.attrib);cb[:]=copy.deepcopy(list(ca))
    assert equal(a,b),'Unintended worksheet changes'
    for previous,current in zip(styles_old,styles_new):
        if previous.tag in {Q('fonts'),Q('cellXfs')}:
            assert len(current)>len(previous) and all(equal(x,y) for x,y in zip(previous,current))
        else:assert equal(previous,current)
    assert len(styles_old)==len(styles_new)
    # Every explicit cross-sheet consumer is retained for review, including names.
    consumers=[]
    for sheet,part in sheets(old).items():
        if part==target:continue
        for cell in E.fromstring(old[part]).iter(Q('c')):
            formula=cell.findtext(Q('f')) or ''
            if '盟友与魔宠' in formula:consumers.append({'sheet':sheet,'cell':cell.get('r'),'formula':formula})
    assert not consumers,'Review a new companion consumer before applying translations'
    return {'version':version,'sha256':hashlib.sha256(Path(newpath).read_bytes()).hexdigest(),'changedCaptions':len(values),'fixedFormulas':len(formulas),'dropdowns':len(changed_validations),'hints':len(added),'unrelatedCellsAndPartsPreserved':True,'externalFormulaConsumers':consumers}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--baseline',required=True);parser.add_argument('--candidate',required=True);parser.add_argument('--plan',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    originals={r['version']:r for r in json.loads(Path(args.baseline).read_bytes())['versions']};candidates=json.loads(Path(args.candidate).read_bytes())['versions'];plan=json.loads(Path(args.plan).read_bytes())
    results=[]
    for row in candidates:
        for item in [row,originals[row['version']]]:assert hashlib.sha256(Path(item['path']).read_bytes()).hexdigest()==item['sha256']
        results.append(verify(originals[row['version']]['path'],row['path'],plan['entries'],row['version']))
    with Path(args.output).open('x',encoding='utf8') as file:json.dump({'passed':True,'versions':results},file,ensure_ascii=False,indent=2)
    print(json.dumps(results,ensure_ascii=False))
