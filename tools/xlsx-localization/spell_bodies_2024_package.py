"""Portable 2024 reviewed bodies applied to a freshly generated main-list seed.

Rich cloning and all-cell preservation functions are unchanged from the audited
2024 prototype. The new boundary regenerates source/review mappings, reads the
complete actual Artifact A:D export, and writes only a new audit candidate.
"""
from __future__ import annotations
import argparse
from copy import copy
from datetime import datetime,timezone
import hashlib,io,json,posixpath,re,sys,types,zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
from xml.parsers import expat
from xml.sax.saxutils import escape
sys.dont_write_bytecode=True
if not __debug__:raise RuntimeError("Optimization mode is unsupported; verification requires assertions")
sha=lambda b:hashlib.sha256(b).hexdigest()
digest=lambda value:sha(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode("utf8"))
def find_repo(explicit=None):
    selected=Path(explicit).resolve() if explicit else Path(__file__).resolve().parents[2]
    if not (selected/"tools/xlsx-localization/spell_identity.py").is_file():
        raise ValueError("Repository must contain the published localization tools")
    return selected

_bootstrap=argparse.ArgumentParser(add_help=False)
_bootstrap.add_argument("--repo")
REPO=find_repo(_bootstrap.parse_known_args()[0].repo)
TOOL_ROOT=REPO/"tools/xlsx-localization"
BASE=REPO.parent/"_audit/xlsx-spell-bodies-2024"

def allowed_output(directory,prefix):
    target=Path(directory).resolve();root=BASE.resolve()
    if target==root or root not in target.parents:
        raise ValueError("Output must be an exclusive child directory of "+str(root))
    if not target.name.startswith(prefix):
        raise ValueError("Output directory name must start with "+prefix)
    return target


def load(path,pin,name):
    # Hash the exact normalized bytes that will be compiled, also on CRLF checkouts.
    raw=path.read_bytes().replace(b"\r\n",b"\n")
    if sha(raw)!=pin:raise ValueError("Frozen dependency changed: "+path.name)
    module=types.ModuleType(name);module.__file__=str(path);sys.modules[name]=module
    exec(compile(raw,str(path),"exec"),module.__dict__)
    if hasattr(module,"REPO") and module.REPO.resolve()!=REPO:
        raise ValueError("Upstream repository differs; pass --repo explicitly")
    return module

PART="xl/worksheets/sheet14.xml"
SST="xl/sharedStrings.xml"
NS="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RNS="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
XML_SPACE="{http://www.w3.org/XML/1998/namespace}space"
q=lambda s:"{"+NS+"}"+s
PINS={"source":"264fc65569e3e80932544af548830ca70f10ee308493c8b0234608fcd01c9b04",
      "seed":"f2a1c3556220b0c5c31e36fbd419c34b9cf192f4896f512b2ba01bbc340a5453"}

PLAN_SHA="e9e0a9aafccc10344def8fa1ff268f4c882150c56661dbfb2dc3118877262a59"
planner=load(TOOL_ROOT/"spell_bodies_2024_plan.py",PLAN_SHA,"body2024_planner")
main_lists=load(TOOL_ROOT/"spell_main_lists_package.py","7b9366f3f0c7f5637def63091ee2fe35575d36fc6e656062063a0251b224ea21","body2024_main_lists")
SOURCE=planner.SOURCE
def require(ok, message):
    if not ok: raise ValueError(message)


def pinned(path, expected):
    raw = path.read_bytes()
    require(sha(raw) == expected, 'Frozen input changed: ' + str(path))
    return raw


def spans(raw, wanted):
    """Expat element bounds, independent of regex/text content/attribute order."""
    parser = expat.ParserCreate(namespace_separator='}')
    stack, result = [], []
    def start(name, attrs):
        begin = parser.CurrentByteIndex
        pos, quoted = begin, None
        while pos < len(raw):
            char = raw[pos]
            if quoted is not None:
                if char == quoted: quoted = None
            elif char in (34, 39): quoted = char
            elif char == 62: break
            pos += 1
        require(pos < len(raw), 'Unterminated XML header')
        stack.append((name, attrs, begin, pos + 1, raw[pos - 1:pos] == b'/'))
    def end(name):
        opened, attrs, begin, head, closed = stack.pop()
        require(opened == name, 'XML stack mismatch')
        finish = head if closed else raw.index(b'>', parser.CurrentByteIndex) + 1
        if name.rsplit('}', 1)[-1] == wanted:
            result.append((attrs, raw[begin:finish], begin, finish))
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.Parse(raw, True)
    return result


def strip_elements(raw, name):
    for _, _, begin, end in reversed(spans(raw, name)):
        raw = raw[:begin] + raw[end:]
    return raw


def fragment(raw):
    return ET.fromstring(b'<root xmlns="' + NS.encode() + b'">' + raw + b'</root>')[0]


def read_zip(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        infos = z.infolist()
        require(len(infos) == len({i.filename for i in infos}), 'Duplicate ZIP part')
        return {i.filename: z.read(i) for i in infos}, infos, z.comment


def write_zip(original, replacements):
    parts, infos, comment = read_zip(original)
    require(set(replacements) <= set(parts), 'Unexpected new ZIP part')
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as z:
        z.comment = comment
        for info in infos: z.writestr(copy(info), replacements.get(info.filename, parts[info.filename]))
    return out.getvalue()


def indexed_cells(raw):
    result = {}
    for attrs, cell, _, _ in spans(raw, 'c'):
        ref = attrs['r']
        require(ref not in result, 'Duplicate cell: ' + ref)
        result[ref] = cell
    return result


def visible_text(si):
    return ''.join(node.text or '' for node in si.iter(q('t')))


def validate_text(text):
    require(isinstance(text, str) and text.strip(), 'Missing target text')
    require(not re.search('[\u3400-\u9fff]', text), 'Untranslated target text')
    require(len(text.encode('utf-16-le')) // 2 <= 32767, 'Target exceeds Excel cell limit')
    require(all(c in '\t\n\r' or 32 <= ord(c) <= 0xD7FF or 0xE000 <= ord(c) <= 0xFFFD or 0x10000 <= ord(c) <= 0x10FFFF for c in text), 'XML-invalid control character')
    require(not re.search(r'_x[0-9A-Fa-f]{4}_', text), 'OOXML escape-like literal needs a separate reviewed encoding path')


def authored_values(raw, entries):
    parts, _, _ = read_zip(raw)
    workbook = ET.fromstring(parts['xl/workbook.xml'])
    sheets = workbook.findall(q('sheets') + '/' + q('sheet'))
    require(len(sheets) == 1 and sheets[0].get('name') == 'English text', 'Unexpected authored worksheet')
    rid = sheets[0].get('{' + RNS + '}id')
    rels = [r for r in ET.fromstring(parts['xl/_rels/workbook.xml.rels']) if r.get('Id') == rid]
    require(len(rels) == 1 and rels[0].get('Type') == RNS + '/worksheet' and rels[0].get('TargetMode') is None, 'Invalid authored worksheet relationship')
    target = rels[0].get('Target')
    part = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
    require(part.startswith('xl/worksheets/') and part in parts, 'Invalid authored worksheet part')
    root = ET.fromstring(parts[part])
    strings = ET.fromstring(parts[SST]) if SST in parts else []
    cells = {}
    for cell in root.findall('.//' + q('c')):
        ref = cell.get('r')
        require(ref not in cells and cell.find(q('f')) is None, 'Duplicate/formula authored cell')
        kind = cell.get('t')
        require(kind in ('s', 'inlineStr', 'str'), 'Nontext authored value')
        if kind == 's': value = visible_text(strings[int(cell.findtext(q('v')))])
        elif kind == 'inlineStr': value = visible_text(cell.find(q('is')))
        else: value = cell.findtext(q('v')) or ''
        cells[ref] = value
    require(set(cells) == {col + str(row) for row in range(1, len(entries) + 2) for col in 'ABCD'}, 'Authored row/cell coverage mismatch')
    expected = [['Record', 'Rules', 'Cell', 'English text']] + [[e['id'], e['version'], e['sheet'] + '!' + e['cell'], e['target']] for e in entries]
    for row, values in enumerate(expected, 1):
        require([cells[col + str(row)] for col in 'ABCD'] == values, 'Authored target row mismatch: ' + str(row))
    return [cells['D' + str(row)] for row in range(2, len(entries) + 2)]


def text_attributes(original,target):
    result=dict(original)
    if target[:1].isspace() or target[-1:].isspace():result[XML_SPACE]='preserve'
    return result


def validate_entry(raw_si,entry):
    require(sha(raw_si)==entry['sourceSharedStringSha256'],'Original SST receipt mismatch')
    si=fragment(raw_si);texts=spans(raw_si,'t')
    require(visible_text(si)==entry['source'] and digest(entry['source'])==entry['source_sha256'],'Original text fingerprint mismatch')
    validate_text(entry['target']);require(digest(entry['target'])==entry['target_sha256'],'Target fingerprint mismatch')
    attrs=[fragment(raw).attrib for _,raw,_,_ in texts]
    require(attrs==entry['sourceTAttributes'],'Source t attributes differ')
    targets=entry['runTargets'] or [entry['target']]
    require(len(targets)==len(texts) and ''.join(targets)==entry['target'],'Target run concatenation differs')
    require(entry['targetTAttributes']==[text_attributes(a,t) for a,t in zip(attrs,targets)],'Required whitespace attributes differ')
    if entry['runTargets'] is None:
        require(entry['richMapping'] is None and len(si)==1 and si[0].tag==q('t'),'Plain source structure differs')
    else:
        mapping=entry['richMapping'];runs=spans(raw_si,'r')
        require(mapping is not None and mapping['runTargets']==targets and mapping['target']==entry['target'],'Rich mapping boundary differs')
        require(len(runs)==len(mapping['runs'])==len(si),'Rich run count differs')
        for i,((_,raw,_,_),expected,target) in enumerate(zip(runs,mapping['runs'],targets),1):
            props=spans(raw,'rPr');require(len(props)==1,'Expected one rich property block')
            require(props[0][1].decode('utf8')==expected['rPr_raw_xml'] and sha(props[0][1])==expected['rPr_sha256'],'Rich rPr source differs')
            require(expected['run_index']==i and fragment(raw).findtext(q('t'))==expected['source_text'],'Rich run order differs')
            require(expected['target_text']==target and expected['target_t_attributes']==entry['targetTAttributes'][i-1],'Rich target mapping differs')


def text_node(original,target,expected_attrs):
    node=fragment(original);source_attrs=node.attrib
    require(expected_attrs==text_attributes(source_attrs,target),'Text attribute plan differs')
    head_end=original.index(b'>')+1;head=original[:head_end]
    require(head.startswith(b'<t') and original.endswith(b'</t>'),'Unsupported source t syntax')
    if expected_attrs!=source_attrs:
        require(XML_SPACE not in source_attrs and expected_attrs=={**source_attrs,XML_SPACE:'preserve'},'Non-whitespace text attribute edit')
        head=head[:-1]+b' xml:space="preserve">'
    result=head+escape(target).replace('\r','&#13;').encode('utf8')+b'</t>'
    after=fragment(result)
    require(after.attrib==expected_attrs and (after.text or '')==target,'Text encoding or whitespace changed')
    return result


def clone_string(original,entry,target):
    require(target==entry['target'],'Author target mismatch')
    validate_entry(original,entry)
    targets=entry['runTargets'] or [target]
    result=original
    for (_,raw,begin,end),text,attrs in reversed(list(zip(spans(original,'t'),targets,entry['targetTAttributes']))):
        result=result[:begin]+text_node(raw,text,attrs)+result[end:]
    require(visible_text(fragment(result))==target,'Clone full text changed')
    require(strip_elements(result,'t')==strip_elements(original,'t'),'Clone non-text structure changed')
    return result


def apply(seed,plan,targets):
    require(sha(seed)==PINS['seed'],'Main-list seed pin mismatch')
    require(plan['version']=='2024' and plan['workbook_hashes']=={'2024':PINS['source']},'Plan version/source mismatch')
    require([e['cell'] for e in plan['entries']]==['M'+str(r) for r in range(3,812)] and len(targets)==809,'Body coverage/order mismatch')
    parts,_,_=read_zip(seed);strings=spans(parts[SST],'si');cells=indexed_cells(parts[PART])
    additions=[];replacements={}
    for offset,(entry,target) in enumerate(zip(plan['entries'],targets)):
        require(entry['version']=='2024' and entry['part']==PART and entry['sheet']=='法术大全','Entry part/version mismatch')
        cell=cells[entry['cell']];require(sha(cell)==entry['sourceCellSha256'],'Seed target cell differs from original')
        index=entry['sourceSharedIndex'];require(0<=index<len(strings),'Seed SST index invalid')
        original=strings[index][1];additions.append(clone_string(original,entry,target))
        values=spans(cell,'v');require(len(values)==1,'Expected one target SST index')
        _,_,begin,end=values[0]
        replacements[entry['cell']]=cell[:begin]+f'<v>{len(strings)+offset}</v>'.encode()+cell[end:]
    sheet=parts[PART]
    for attrs,_,begin,end in reversed(spans(sheet,'c')):
        if attrs['r'] in replacements:sheet=sheet[:begin]+replacements[attrs['r']]+sheet[end:]
    sst=parts[SST];require(sst.count(b'</sst>')==1,'Unexpected SST closing syntax')
    sst=sst.replace(b'</sst>',b''.join(additions)+b'</sst>')
    require(len(re.findall(rb'\buniqueCount="[0-9]+"',sst[:sst.index(b'>',sst.index(b'<sst'))]))==1,'Unexpected SST uniqueCount header')
    sst=re.sub(rb'(<sst\b[^>]*\buniqueCount=")[0-9]+(")',lambda m:m[1]+str(len(strings)+809).encode()+m[2],sst,count=1)
    return write_zip(seed,{PART:sheet,SST:sst})


def verify(seed,output,plan):
    require(sha(seed)==PINS['seed'],'Verification seed pin mismatch')
    old,oi,oc=read_zip(seed);new,ni,nc=read_zip(output)
    require(list(old)==list(new) and oc==nc,'ZIP parts/order/comment changed')
    metadata=('date_time','compress_type','comment','extra','create_system','create_version','extract_version','flag_bits','volume','internal_attr','external_attr')
    require(all(all(getattr(a,k)==getattr(b,k) for k in metadata) for a,b in zip(oi,ni)),'ZIP entry metadata changed')
    require({name for name in old if old[name]!=new[name]}=={PART,SST},'Unexpected changed ZIP part')
    old_si,new_si=spans(old[SST],'si'),spans(new[SST],'si')
    require(len(new_si)==len(old_si)+809 and [s[1] for s in new_si[:len(old_si)]]==[s[1] for s in old_si],'Original SST or clone count differs')
    old_header,new_header=ET.fromstring(old[SST]).attrib,ET.fromstring(new[SST]).attrib
    require(new_header=={**old_header,'uniqueCount':str(len(new_si))},'SST attributes/count changed')
    scaffold=strip_elements(new[SST],'si')
    scaffold=re.sub(rb'(uniqueCount=")[0-9]+(")',lambda m:m[1]+old_header['uniqueCount'].encode()+m[2],scaffold,count=1)
    require(scaffold==strip_elements(old[SST],'si'),'SST non-node XML changed')
    allowed={e['cell']:(i,e) for i,e in enumerate(plan['entries'])}
    compared=formulas=refs=rich_runs=space_additions=0
    for part,raw in old.items():
        if not re.fullmatch(r'xl/worksheets/[^/]+\.xml',part):continue
        a,b=indexed_cells(raw),indexed_cells(new[part])
        require(a.keys()==b.keys(),'Worksheet cell set changed')
        for ref,prior in a.items():
            after=b[ref];node=fragment(after);compared+=1
            if node.get('t')=='s':refs+=1
            if node.find(q('f')) is not None:
                formulas+=1;require(node.find(q('v')) is None,'Formula cache introduced')
            if part!=PART or ref not in allowed:
                require(prior==after,'Unrelated cell changed: '+part+'!'+ref)
                continue
            offset,entry=allowed[ref]
            require(strip_elements(prior,'v')==strip_elements(after,'v'),'Target cell XML outside index changed')
            require(node.get('t')=='s' and node.find(q('f')) is None and len(node.findall(q('v')))==1,'Target type/formula changed')
            index=int(node.findtext(q('v')));require(index==len(old_si)+offset,'Target points at wrong clone')
            clone=new_si[index][1];original=old_si[entry['sourceSharedIndex']][1]
            require(visible_text(fragment(clone))==entry['target'],'Candidate target text differs')
            require(strip_elements(clone,'t')==strip_elements(original,'t'),'Rich properties or SST scaffold changed')
            old_t,new_t=spans(original,'t'),spans(clone,'t')
            expected=entry['runTargets'] or [entry['target']]
            require(len(old_t)==len(new_t)==len(expected),'Text run count changed')
            for (_,prior_t,_,_),(_,after_t,_,_),value,attrs in zip(old_t,new_t,expected,entry['targetTAttributes']):
                parsed=fragment(after_t)
                require((parsed.text or '')==value,'Rich target distribution differs')
                require(parsed.attrib==attrs,'Required text whitespace attribute differs')
                require(after_t==text_node(prior_t,value,attrs),'Unexpected text node syntax change')
                if fragment(prior_t).attrib!=attrs:space_additions+=1
            if entry['runTargets'] is not None:rich_runs+=len(expected)
        if part==PART:require(strip_elements(raw,'c')==strip_elements(new[part],'c'),'Worksheet non-cell XML changed')
    require(rich_runs==300,'Expected all 300 rich runs')
    return {'allCellsCompared':compared,'targetCells':len(allowed),'formulaCellsWithoutCache':formulas,
            'oldSSTNodesPreserved':len(old_si),'newSSTClones':809,'richCells':36,'richRunsPreserved':rich_runs,
            'textWhitespaceAttributeAdditions':space_additions,'declaredSSTReferenceCountPreserved':old_header.get('count'),
            'actualWorksheetSSTReferences':refs,'oldUniqueCount':old_header['uniqueCount'],'newUniqueCount':new_header['uniqueCount'],
            'changedParts':[PART,SST],'allOtherPartsByteExact':True,'allNonTargetCellsByteExact':True,
            'allOriginalRichPropertiesByteExact':True,'customAndGapCellsUnchanged':True,
            'externalLinkCachePartsPreserved':[p for p in old if p.startswith('xl/externalLinks/') and p.endswith('.xml')]}

def load_context(authored_path):
    source=pinned(SOURCE,PINS['source']);plan=planner.build_plan()
    authored_path=Path(authored_path).resolve();author_raw=authored_path.read_bytes()
    targets=authored_values(author_raw,plan['entries'])
    require(SOURCE.read_bytes()==source,'Original changed during read')
    return source,plan,authored_path,author_raw,targets


def run(authored_path,directory=None):
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output=allowed_output(directory or BASE/('spell-bodies-2024-candidate-'+stamp),'spell-bodies-2024-candidate-')
    if output.exists():raise FileExistsError(str(output))
    source,plan,author_path,author_raw,targets=load_context(authored_path)
    upstream=main_lists.run();incoming=Path(upstream['reports']['2024']['output'])
    seed=pinned(incoming,PINS['seed']);candidate=apply(seed,plan,targets);audit=verify(seed,candidate,plan)
    require(plan==planner.build_plan() and SOURCE.read_bytes()==source and incoming.read_bytes()==seed and author_path.read_bytes()==author_raw,'Bound inputs changed during application')
    output.mkdir(parents=True,exist_ok=False)
    target=output/'2024-SPELL-BODIES-NO-CACHE-NOT-FOR-UPLOAD.xlsx'
    with target.open('xb') as f:f.write(candidate)
    require(target.read_bytes()==candidate,'Written candidate differs')
    result={'output':str(output),'candidate':str(target),'outputSha256':sha(candidate),'input':str(incoming),'inputSha256':sha(seed),
            'mainListsOutput':upstream['output'],'phase20Output':upstream['phase20Output'],'sourceSha256':sha(source),
            'planSha256':digest(plan),'reviewHashes':plan['review_hashes'],'glossarySha256':plan['glossarySha256'],
            'authoredTargets':str(author_path),'authoredTargetsSha256':sha(author_raw),'authoredRowsReadBack':len(targets),'authoredCellsReadBack':4*(len(targets)+1),
            'preservation':audit,'nativeCalculated':False,'uploadReady':False,
            'scope':'2024 M3:M811 only; remaining card text, native layout/calculation and upload remain unverified'}
    with (output/'2024-body-plan.json').open('x',encoding='utf8',newline='\n') as f:f.write(json.dumps(plan,ensure_ascii=False,indent=2)+'\n')
    with (output/'report.json').open('x',encoding='utf8',newline='\n') as f:f.write(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo');parser.add_argument('--output',type=Path)
    parser.add_argument('--authored-targets',type=Path,required=True)
    args=parser.parse_args();print(json.dumps(run(args.authored_targets,args.output),ensure_ascii=False))


if __name__=='__main__':main()
