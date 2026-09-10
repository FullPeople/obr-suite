"""Fresh 2024 reviewed body plan, including original rich-run boundaries.

Only real selected source/review records are bound; no catalog or historical
audit artifact is required. This writes JSON only, not a workbook.
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

p=load(TOOL_ROOT/"prepare.py","9c21aca1bc86e4124ee435118d51d797a42d3c5f1b2016ce7902ea4f586cc748","body2024_prepare")
SOURCE=REPO/"public"/p.TEMPLATES["2024"]
SPECIAL_PINS = {
    'M3': ('d0611279e4616f6a77ad63c2', '349084572b87941058c44166897c2f875005cd1b1c8978c7509aa00623ad1289', '3b940fa8644fdfb3a8a4a41ea88629045ef27ec429c1158401017d17ca830479'),
    'M30': ('c6fe3c36c4465fa5b0adbb53', '1d984f55ef600ecd9f12d90455201054995146f7c9bd7fb9dc2c20b62e8ec731', 'c73f9a91604b1dbc5fded5a1f29eae185d792da1889d0e92b3bd964e05ed27ad'),
}

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


def fragment(raw):
    return ET.fromstring(b'<root xmlns="' + NS.encode() + b'">' + raw + b'</root>')[0]


def read_zip(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        infos = z.infolist()
        require(len(infos) == len({i.filename for i in infos}), 'Duplicate ZIP part')
        return {i.filename: z.read(i) for i in infos}, infos, z.comment


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

def split_bullets(target):
    parts = re.split('(•)', target)
    if parts[0] == '':
        parts = parts[1:]
    return parts


def map_runs(source, target):
    ref = source['cell']
    if ref in SPECIAL_PINS:
        require((source['id'], source['source_sha256'], digest(target)) == SPECIAL_PINS[ref], 'SPECIAL_SOURCE_TARGET_PIN')
    if ref == 'M3':
        heading = 'Cantrip Upgrade.'
        require(target.count(heading) == 1, 'M3_HEADING_UNIQUE')
        at = target.index(heading)
        require(target[:at].endswith('\n') and target[at + len(heading):].startswith(' '), 'M3_HEADING_BOUNDARY')
        require([r['source_text'] for r in source['runs']][1] == '戏法强化：', 'M3_SOURCE_HEADING')
        return [target[:at], heading, target[at + len(heading):]], 'reviewed-M3-bold-heading'
    parts = split_bullets(target)
    if ref == 'M30':
        require(len(parts) == 13 and all(parts[i] == '•' for i in [1, 3, 5, 7, 9, 11]), 'M30_SIX_BULLETS')
        require(parts[4].endswith('\n') and parts[6].startswith(' Fire Play.'), 'M30_FIRE_PLAY_BOUNDARY')
        require([r['source_text'] for r in source['runs']][5:8] == ['\u3000\u3000', '•', ' '], 'M30_SOURCE_WHITESPACE')
        return [*parts[:4], parts[4][:-1], '\n', parts[5], ' ', parts[6][1:], *parts[7:]], 'reviewed-M30-bold-bullet-and-whitespace'
    require(len(parts) == len(source['runs']), 'BULLET_RUN_COUNT')
    return parts, 'whole-section-between-original-bullet-runs'


def text_attributes(original, target):
    result = dict(original)
    if target[:1].isspace() or target[-1:].isspace():
        result[XML_SPACE] = 'preserve'
    return result


def build(originals, bindings):
    entries = []
    for ref, e in originals.items():
        binding = bindings[ref]
        target = binding['target']
        parts, policy = map_runs(e, target)
        require(len(parts) == len(e['runs']) and ''.join(parts) == target, 'FULL_TARGET_RECONSTRUCTION')
        run_mappings = []
        offset = 0
        for r, value in zip(e['runs'], parts):
            require(value != '', 'NONEMPTY_TARGET_RUN')
            if r['classification'] == 'bullet-only':
                require(value == '•', 'PRESERVED_BULLET')
            elif r['classification'] == 'whitespace-only':
                require(not value.strip(), 'PRESERVED_WHITESPACE_KIND')
            else:
                require(value.strip(), 'PRESERVED_BODY_KIND')
            run_mappings.append({
                'run_index': r['run_index'],
                'source_start': r['source_start'], 'source_end': r['source_end'],
                'source_text': r['source_text'], 'source_text_sha256': r['source_text_sha256'],
                'target_start': offset, 'target_end': offset + len(value),
                'target_text': value, 'target_text_sha256': digest(value),
                'classification': r['classification'],
                'rPr_sha256': r['rPr_sha256'], 'rPr_raw_xml': r['rPr_raw_xml'],
                'source_t_attributes': r['t_attributes'],
                'target_t_attributes': text_attributes(r['t_attributes'], value),
                'alignment_evidence': {
                    'method': policy,
                    'source_section_start': r['source_text'].strip()[:100],
                    'target_section_start': value.strip()[:160],
                    'source_newlines': r['source_text'].count('\n'),
                    'target_newlines': value.count('\n'),
                    'boundary_review': 'Source and target section order/headings checked; this is formatting alignment, not a new full translation review.'
                }
            })
            offset += len(value)
        entries.append({
            'id': e['id'], 'version': '2024', 'sheet': '法术大全', 'part': PART, 'cell': ref,
            'context': e['context'], 'source': e['source'], 'target': target,
            'source_sha256': e['source_sha256'], 'target_sha256': binding['target_sha256'],
            'sourceCellSha256': e['source_cell_sha256'],
            'sourceSharedStringSha256': e['source_shared_string_sha256'],
            'sourceSharedIndex': e['source_shared_index'],
            'sourceStyle': e['source_style'], 'review_binding': binding,
            'mapping_policy': policy, 'runTargets': parts, 'runs': run_mappings,
            'rPr_preservation': 'Every original run property subtree is retained byte-for-byte in the same position.',
            'dependency_review': 'proposed-audit-mapping; not workbook-application approval',
        })
    return entries


def validate(entries, originals, bindings):
    require(len(entries) == len(originals) and {e['cell'] for e in entries} == set(originals), 'PLAN_CELL_SET')
    for entry in entries:
        ref = entry['cell']
        original = originals[ref]
        binding = bindings[ref]
        require(entry['id'] == original['id'] and entry['context'] == original['context'], 'PLAN_IDENTITY')
        require(entry['source'] == original['source'] and entry['source_sha256'] == original['source_sha256'], 'PLAN_SOURCE')
        require(entry['target'] == binding['target'] and entry['target_sha256'] == binding['target_sha256'], 'REVIEWED_TARGET_PIN')
        require(entry['sourceCellSha256'] == original['source_cell_sha256'] and entry['sourceSharedStringSha256'] == original['source_shared_string_sha256'], 'PLAN_RAW_SOURCE_PINS')
        require(len(entry['runs']) == len(original['runs']) and len(entry['runTargets']) == len(original['runs']), 'PLAN_RUN_COUNT')
        require(''.join(entry['runTargets']) == binding['target'], 'PLAN_TARGET_CONCAT')
        expected, policy = map_runs(original, binding['target'])
        require(entry['runTargets'] == expected and entry['mapping_policy'] == policy, 'EXACT_SEMANTIC_RUN_BOUNDARIES')
        offset = 0
        for i, (r, old, value) in enumerate(zip(entry['runs'], original['runs'], entry['runTargets']), 1):
            require(r['run_index'] == i and r['source_text'] == old['source_text'], 'RUN_SOURCE_ORDER')
            require(r['rPr_sha256'] == old['rPr_sha256'] and r['rPr_raw_xml'] == old['rPr_raw_xml'], 'RPR_BYTES_CHANGED')
            require(r['target_text'] == value and r['target_text_sha256'] == digest(value), 'RUN_TARGET_PIN')
            require(r['target_start'] == offset and r['target_end'] == offset + len(value), 'TARGET_OFFSETS')
            require(r['source_t_attributes'] == old['t_attributes'], 'SOURCE_T_ATTRIBUTES_CHANGED')
            require(r['target_t_attributes'] == text_attributes(old['t_attributes'], value), 'REQUIRED_XML_SPACE')
            require(value != '', 'EMPTY_TARGET_RUN')
            if old['classification'] == 'bullet-only':
                require(value == '•', 'BULLET_REPLACED')
            if old['classification'] == 'whitespace-only':
                require(not value.strip(), 'WHITESPACE_TO_BODY')
            offset += len(value)
        require(offset == len(binding['target']), 'TARGET_FINAL_OFFSET')
    return True

def build_plan():
    source=pinned(SOURCE,PINS['source'])
    glossary_path=TOOL_ROOT/'glossary.json';glossary_raw=glossary_path.read_bytes()
    _,records,_=p.inspect_xlsx(SOURCE,'2024',json.loads(glossary_raw))
    records={r['id']:r for r in records}
    paths=[TOOL_ROOT/'reviewed.jsonl',*sorted((TOOL_ROOT/'reviews').glob('2024-*.jsonl'))]
    selected={};used_files={}
    for path in paths:
        raw=path.read_bytes();relative=path.relative_to(REPO).as_posix()
        for line in raw.decode('utf8').splitlines():
            if not line.strip():continue
            review=json.loads(line)
            if review['version']!='2024' or review['sheet']!='法术大全' or review['kind']!='cell_text':continue
            refs=[ref for ref in review['locations'] if re.fullmatch(r'M[0-9]+',ref) and 3<=int(ref[1:])<=811]
            if not refs:continue
            current=records.get(review['id']);require(current is not None,'Actual source identity absent')
            require(all(review[k]==current[k] for k in ('source','kind','sheet','context')),'Review source/context mismatch')
            require(review['locations']==[o['location'] for o in current['occurrences']] and all(o['part']==PART for o in current['occurrences']),'Review occurrence mismatch')
            require(review['source_sha256']==digest(current['source']) and review['workbook_sha256']==PINS['source'],'Review source fingerprint mismatch')
            require(review.get('reviewed_by') and review.get('note') and review['dependency_review']=='pending' and review['application_approved'] is False,'Review status mismatch')
            validate_text(review['target'])
            for ref in refs:
                require(ref not in selected,'Duplicate selected body')
                selected[ref]=(review,current,relative)
            used_files[relative]=sha(raw)
    require(set(selected)=={'M'+str(r) for r in range(3,812)},'All 809 builtin body rows must be reviewed')
    parts,_,_=read_zip(source);strings=spans(parts[SST],'si');cells=indexed_cells(parts[PART])
    originals={};bindings={};base_entries=[]
    for row in range(3,812):
        ref='M'+str(row);review,current,relative=selected[ref];cell=cells[ref];node=fragment(cell)
        require(node.get('t')=='s' and node.find(q('f')) is None and len(node.findall(q('v')))==1,'Expected static shared body')
        index=int(node.findtext(q('v')));require(0<=index<len(strings),'Source SST index invalid')
        raw_si=strings[index][1];si=fragment(raw_si)
        require(visible_text(si)==review['source'],'Source M text differs from review')
        runs=spans(raw_si,'r');source_attrs=[fragment(raw).attrib for _,raw,_,_ in spans(raw_si,'t')]
        if runs:
            require(len(runs)==len(si) and len(runs)==len(source_attrs),'Unexpected source rich structure')
            run_records=[];offset=0
            for i,(_,raw_run,_,_) in enumerate(runs,1):
                run=fragment(raw_run);texts=run.findall(q('t'));props=spans(raw_run,'rPr')
                require(len(texts)==1 and len(props)==1 and len(run)==2,'Unexpected rich run children')
                value=texts[0].text or '';require(value!='','Empty original rich run')
                classification='bullet-only' if value=='•' else 'whitespace-only' if not value.strip() else 'body-text'
                run_records.append({'run_index':i,'source_start':offset,'source_end':offset+len(value),'source_text':value,
                                    'source_text_sha256':digest(value),'rPr_sha256':sha(props[0][1]),'rPr_raw_xml':props[0][1].decode('utf8'),
                                    't_attributes':texts[0].attrib,'classification':classification})
                offset+=len(value)
            require(offset==len(review['source']),'Original rich offset coverage differs')
            originals[ref]={'id':review['id'],'cell':ref,'context':review['context'],'source':review['source'],'source_sha256':review['source_sha256'],
                            'source_cell_sha256':sha(cell),'source_shared_string_sha256':sha(raw_si),'source_shared_index':index,
                            'source_style':node.get('s'),'runs':run_records}
            bindings[ref]={'target':review['target'],'target_sha256':digest(review['target']),'batch':review['batch'],'path':relative,'review_record_sha256':digest(review)}
        else:require(len(si)==1 and si[0].tag==q('t'),'Unexpected plain body structure')
        base_entries.append({'id':review['id'],'version':'2024','sheet':'法术大全','part':PART,'cell':ref,'context':review['context'],
                             'source':review['source'],'target':review['target'],'source_sha256':review['source_sha256'],'target_sha256':digest(review['target']),
                             'sourceCellSha256':sha(cell),'sourceSharedStringSha256':sha(raw_si),'sourceSharedIndex':index,
                             'sourceTAttributes':source_attrs,'reviewBatch':review['batch'],'reviewRecordSha256':digest(review)})
    require(len(originals)==36 and sum(len(e['runs']) for e in originals.values())==300,'Fixed rich counts differ')
    # These source/target-pinned mapping functions are mechanically unchanged
    # from the reviewed rich-plan implementation, including both manual cases.
    rich_entries=build(originals,bindings);validate(rich_entries,originals,bindings)
    rich={e['cell']:e for e in rich_entries}
    for e in base_entries:
        mapping=rich.get(e['cell']);e['richMapping']=mapping;e['runTargets']=mapping['runTargets'] if mapping else None
        targets=e['runTargets'] or [e['target']]
        e['targetTAttributes']=[text_attributes(a,t) for a,t in zip(e['sourceTAttributes'],targets)]
        if mapping:require(e['targetTAttributes']==[r['target_t_attributes'] for r in mapping['runs']],'Rich required whitespace differs')
    require(SOURCE.read_bytes()==source and glossary_path.read_bytes()==glossary_raw,'Original/glossary changed during planning')
    require(all(sha((REPO/path).read_bytes())==pin for path,pin in used_files.items()),'Selected reviews changed during planning')
    return {'schema':'obr-xlsx-partial-text-candidate/v1','increment':'2024-all-builtin-spell-bodies/v2','version':'2024',
            'workbook_hashes':{'2024':PINS['source']},'review_hashes':used_files,'glossarySha256':sha(glossary_raw),
            'sourceFilename':SOURCE.name,'sourcePartSha256':sha(parts[PART]),'entries':base_entries,
            'mappingOrigin':'Original run inventory rebuilt from pinned workbook; reviewed rich mapping functions retained, including fixed M3/M30 source-target boundaries.',
            'release_ready':False,'nativeCalculated':False,'scope':'Only 809 static M3:M811 bodies; original keys, other fields, custom slots, source gaps, formulas and existing SST nodes remain unchanged.'}


def run(directory=None):
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output=allowed_output(directory or BASE/('spell-bodies-2024-plan-'+stamp),'spell-bodies-2024-plan-')
    if output.exists():raise FileExistsError(str(output))
    plan=build_plan();output.mkdir(parents=True,exist_ok=False)
    target=output/'2024-body-plan.json'
    with target.open('x',encoding='utf8',newline='\n') as f:f.write(json.dumps(plan,ensure_ascii=False,indent=2)+'\n')
    return {'output':str(output),'plan':str(target),'planFileSha256':sha(target.read_bytes()),'entries':809,'richCells':36,'workbookWritten':False,'nativeCalculated':False,'uploadReady':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo');parser.add_argument('--output',type=Path)
    args=parser.parse_args();print(json.dumps(run(args.output),ensure_ascii=False))


if __name__=='__main__':main()
