"""2014 reviewed spell bodies, applied to a freshly built main-list candidate.

Only exact A:D content from the separately authored target workbook is accepted.
Its actual binary hash is recorded, never matched to a historical Artifact file.
Audited XML preservation functions below are unchanged; only loading and CLI
boundaries are portable. No native recalculation, server upload or release occurs.
"""
from __future__ import annotations
import argparse
from collections import Counter
from copy import copy
from datetime import datetime,timezone
import hashlib,io,json,posixpath,re,sys,types,zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
from xml.parsers import expat
from xml.sax.saxutils import escape

sys.dont_write_bytecode=True
if not __debug__:
    raise RuntimeError("Optimization mode is unsupported; verification requires assertions")
sha=lambda b:hashlib.sha256(b).hexdigest()

def find_repo(explicit=None):
    selected=Path(explicit).resolve() if explicit else Path(__file__).resolve().parents[2]
    if not (selected/"tools/xlsx-localization/spell_identity.py").is_file():
        raise ValueError("Repository must contain the published localization tools")
    return selected


_bootstrap=argparse.ArgumentParser(add_help=False)
_bootstrap.add_argument("--repo")
REPO=find_repo(_bootstrap.parse_known_args()[0].repo)
TOOL_ROOT=REPO/"tools/xlsx-localization"
BASE=REPO.parent/"_audit/xlsx-spell-bodies"


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

PLAN_SHA="c2b3c52cbb2ac38b148f56f35b6ab95c17c3469d6b1ac92eee5509c960ddeb9e"
MAIN_LISTS_SHA="7b9366f3f0c7f5637def63091ee2fe35575d36fc6e656062063a0251b224ea21"
planner=load(TOOL_ROOT/"spell_bodies_plan.py",PLAN_SHA,"spell_bodies_planner")
main_lists=load(TOOL_ROOT/"spell_main_lists_package.py",MAIN_LISTS_SHA,"spell_bodies_main_lists")
SOURCE=REPO/"public"/planner.p.TEMPLATES["2014"]
PINS={"source":"94444fda4206d579125418b0007b89c414b86c27d6b98655f81f3f1ce65e8fe6",
      "seed":"27103d8af79de8a3dfd0bf1af02d785e69f2f3848d158c3a156dbfc2d7d84ece"}
PART='xl/worksheets/sheet13.xml'
SST='xl/sharedStrings.xml'
NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
RNS='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
q=lambda s:'{'+NS+'}'+s
# Same canonical JSON fingerprint as prepare.py, not a raw UTF-8 text hash.
digest=lambda value:sha(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf8'))


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


def validate_bindings(source, plan, reviews, records):
    require(sha(source) == PINS['source'], 'Original workbook pin mismatch')
    require(plan['version'] == '2014' and plan['workbook_hashes'] == {'2014': PINS['source']}, 'Plan version/source mismatch')
    entries = plan['entries']
    require([e['cell'] for e in entries] == ['M' + str(r) for r in range(3, 525)], 'Body coverage/order mismatch')
    parts, _, _ = read_zip(source)
    require(sha(parts[PART]) == plan['sourcePartSha256'], 'Source sheet receipt mismatch')
    strings = spans(parts[SST], 'si'); cells = indexed_cells(parts[PART])
    by_id = {}
    for review in reviews:
        by_id.setdefault(review['id'], []).append(review)
    for e in entries:
        require(e['version'] == '2014' and e['sheet'] == '法术大全' and e['part'] == PART, 'Entry location/version mismatch')
        candidates = by_id.get(e['id'], [])
        require(len(candidates) == 1, 'Unreviewed or duplicate review identity')
        review = candidates[0]; record = records.get(e['id'])
        require(record is not None, 'Identity absent from actual source inventory')
        require(all(review[k] == record[k] for k in ('source', 'kind', 'sheet', 'context')), 'Review source inventory mismatch')
        require(review['kind'] == 'cell_text' and review['locations'] == [o['location'] for o in record['occurrences']] and e['cell'] in review['locations'], 'Review location mismatch')
        require(all(o['part'] == PART for o in record['occurrences']), 'Review part mismatch')
        require(review.get('reviewed_by') and review.get('note') and review['dependency_review'] == 'pending' and review['application_approved'] is False, 'Unexpected review status')
        require(review['workbook_sha256'] == PINS['source'] and review['source_sha256'] == digest(e['source']), 'Review fingerprint mismatch')
        require(e['reviewBatch'] == review['batch'] and e['source'] == review['source'] and e['target'] == review['target'], 'Plan differs from reviewed text')
        validate_text(e['target'])
        require(e['source_sha256'] == digest(e['source']) and e['target_sha256'] == digest(e['target']), 'Text fingerprint mismatch')
        raw = cells[e['cell']]; node = fragment(raw)
        require(node.get('t') == 's' and node.find(q('f')) is None and len(node.findall(q('v'))) == 1, 'Expected static shared-string body')
        index = int(node.findtext(q('v')))
        require(index == e['sourceSharedIndex'] and sha(raw) == e['sourceCellSha256'], 'Source cell receipt mismatch')
        original_si = strings[index][1]
        require(sha(original_si) == e['sourceSharedStringSha256'] and visible_text(fragment(original_si)) == e['source'], 'Source SST receipt mismatch')
        validate_runs(original_si, e)
    return {'sourceBindings': len(entries), 'reviewFiles': len(plan['review_hashes']), 'reviewStatus': 'reviewed translation; dependency pending; audit application only'}


def validate_runs(raw_si, entry):
    si = fragment(raw_si); runs = si.findall(q('r'))
    if not runs:
        require(entry['runTargets'] is None and len(si) == 1 and si[0].tag == q('t'), 'Unexpected plain SST structure')
        return
    require(entry['cell'] == 'M209' and entry['id'] == '75c55701c4d43f1e1e5e63be' and len(si) == len(runs) == 4, 'Unexpected rich-text source')
    require(entry['source_sha256'] == '12d3e281cdd381ed4a840cd88e70fed0901f8a242088ca4e75d69ee925199e6b' and entry['target_sha256'] == '6613d39370ec99840e7ba33e73af11f08b9dd6be01eb31594f2f883c5e4fd7f7', 'Rich-text reviewed fingerprint mismatch')
    require([r.findtext(q('t')) for r in runs][::2] == ['•', '•'], 'Original bullet runs changed')
    lines = entry['target'].splitlines(keepends=True)
    require(len(lines) == 2 and all(line.startswith('• ') for line in lines) and lines[0].endswith('\n'), 'Rich target paragraph mapping mismatch')
    expected = ['•', lines[0][1:], '•', lines[1][1:]]
    require(entry['runTargets'] == expected and ''.join(expected) == entry['target'], 'Rich run mapping mismatch')
    require([r.find(q('rPr')).find(q('rFont')).get('val') for r in runs] == ['Courier New', '仿宋', 'Courier New', '仿宋'], 'Rich run font source mismatch')


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


def clone_string(original, entry, target):
    require(target == entry['target'], 'Author target mismatch')
    validate_text(target); validate_runs(original, entry)
    texts = spans(original, 't')
    values = entry['runTargets'] or [target]
    require(len(texts) == len(values), 'Text/run count mismatch')
    result = original
    for (_, _, begin, end), text in reversed(list(zip(texts, values))):
        encoded = escape(text).replace('\r', '&#13;').encode('utf8')
        result = result[:begin] + b'<t xml:space="preserve">' + encoded + b'</t>' + result[end:]
    require(visible_text(fragment(result)) == target, 'Clone text changed during XML encoding')
    return result


def apply(seed, plan, targets):
    require(sha(seed) == PINS['seed'], 'Main-list seed pin mismatch')
    require(len(targets) == len(plan['entries']) == 522, 'Target count mismatch')
    parts, _, _ = read_zip(seed)
    strings = spans(parts[SST], 'si'); cells = indexed_cells(parts[PART])
    additions, replacements = [], {}
    for offset, (entry, target) in enumerate(zip(plan['entries'], targets)):
        raw_cell = cells[entry['cell']]
        require(sha(raw_cell) == entry['sourceCellSha256'], 'Seed target cell differs from original')
        raw_si = strings[entry['sourceSharedIndex']][1]
        require(sha(raw_si) == entry['sourceSharedStringSha256'], 'Seed SST differs from original')
        additions.append(clone_string(raw_si, entry, target))
        values = spans(raw_cell, 'v')
        require(len(values) == 1, 'Expected one target SST index')
        _, _, begin, end = values[0]
        replacements[entry['cell']] = raw_cell[:begin] + ('<v>' + str(len(strings) + offset) + '</v>').encode() + raw_cell[end:]
    sheet = parts[PART]
    for attrs, _, begin, end in reversed(spans(sheet, 'c')):
        if attrs['r'] in replacements: sheet = sheet[:begin] + replacements[attrs['r']] + sheet[end:]
    sst = parts[SST]
    require(sst.count(b'</sst>') == 1, 'Unexpected SST namespace/closing syntax')
    sst = sst.replace(b'</sst>', b''.join(additions) + b'</sst>')
    require(len(re.findall(rb'\buniqueCount="[0-9]+"', sst[:sst.index(b'>', sst.index(b'<sst'))])) == 1, 'Unexpected SST uniqueCount header')
    sst = re.sub(rb'(<sst\b[^>]*\buniqueCount=")[0-9]+(")', lambda m: m[1] + str(len(strings) + len(additions)).encode() + m[2], sst, count=1)
    return write_zip(seed, {PART: sheet, SST: sst})


def verify(seed, output, plan):
    old, oi, oc = read_zip(seed); new, ni, nc = read_zip(output)
    require(list(old) == list(new) and oc == nc, 'ZIP parts/order/comment changed')
    metadata = ('date_time', 'compress_type', 'comment', 'extra', 'create_system', 'create_version', 'extract_version', 'flag_bits', 'volume', 'internal_attr', 'external_attr')
    require(all(all(getattr(a, k) == getattr(b, k) for k in metadata) for a, b in zip(oi, ni)), 'ZIP entry metadata changed')
    changed = [n for n in old if old[n] != new[n]]
    require(set(changed) == {PART, SST}, 'Unexpected changed ZIP part')
    old_si, new_si = spans(old[SST], 'si'), spans(new[SST], 'si')
    require(len(new_si) == len(old_si) + 522, 'SST clone count mismatch')
    require([r[1] for r in new_si[:len(old_si)]] == [r[1] for r in old_si], 'An original SST node changed')
    old_header, new_header = ET.fromstring(old[SST]).attrib, ET.fromstring(new[SST]).attrib
    require(new_header == {**old_header, 'uniqueCount': str(len(new_si))}, 'SST attributes/count changed')
    old_scaffold, new_scaffold = strip_elements(old[SST], 'si'), strip_elements(new[SST], 'si')
    new_scaffold = re.sub(rb'(uniqueCount=")[0-9]+(")', lambda m: m[1] + old_header['uniqueCount'].encode() + m[2], new_scaffold, count=1)
    require(new_scaffold == old_scaffold, 'SST non-node XML changed')
    allowed = {e['cell']: (i, e) for i, e in enumerate(plan['entries'])}
    checked, formula_cells, shared_refs = 0, 0, 0
    for name, raw in old.items():
        if not re.fullmatch(r'xl/worksheets/[^/]+\.xml', name): continue
        original_cells = indexed_cells(raw); candidate_cells = indexed_cells(new[name])
        require(original_cells.keys() == candidate_cells.keys(), 'Worksheet cell set changed')
        for ref, prior in original_cells.items():
            after = candidate_cells[ref]; parsed = fragment(after)
            checked += 1
            if parsed.get('t') == 's': shared_refs += 1
            if parsed.find(q('f')) is not None:
                formula_cells += 1
                require(parsed.find(q('v')) is None, 'Formula cache introduced')
            if name != PART or ref not in allowed:
                require(prior == after, 'Unrelated cell changed: ' + name + '!' + ref)
                continue
            index, entry = allowed[ref]
            require(strip_elements(prior, 'v') == strip_elements(after, 'v'), 'Target cell XML outside index changed')
            require(parsed.get('t') == 's' and parsed.find(q('f')) is None and len(parsed.findall(q('v'))) == 1, 'Target cell type/formula changed')
            clone_index = int(parsed.findtext(q('v')))
            require(clone_index == len(old_si) + index, 'Target points at wrong clone')
            clone = new_si[clone_index][1]; original = old_si[entry['sourceSharedIndex']][1]
            require(visible_text(fragment(clone)) == entry['target'], 'Candidate target text mismatch')
            require(strip_elements(clone, 't') == strip_elements(original, 't'), 'SST structure or rich properties changed')
            if entry['runTargets'] is not None:
                require([n.text or '' for n in fragment(clone).iter(q('t'))] == entry['runTargets'], 'Rich run text distribution changed')
        if name == PART:
            require(strip_elements(raw, 'c') == strip_elements(new[name], 'c'), 'Worksheet non-cell XML changed')
    # External caches, names, DV, metadata, images, formulas, custom M525:M574,
    # and original map E all fall under the all-parts/all-cells byte comparison.
    return {'allCellsCompared': checked, 'formulaCellsWithoutCache': formula_cells,
            'targetCells': len(allowed), 'oldSSTNodesPreserved': len(old_si), 'newSSTClones': 522,
            'oldUniqueCount': old_header['uniqueCount'], 'newUniqueCount': new_header['uniqueCount'],
            'declaredSSTReferenceCountPreserved': old_header.get('count'), 'actualWorksheetSSTReferences': shared_refs,
            'changedParts': changed, 'allOtherPartsByteExact': True, 'richRunPropertiesByteExact': True,
            'externalLinkCachePartsPreserved': [n for n in old if n.startswith('xl/externalLinks/') and n.endswith('.xml')]}


def load_context(authored_path):
    source=pinned(SOURCE,PINS["source"])
    plan=planner.build()
    glossary_path=TOOL_ROOT/"glossary.json"
    glossary_raw=glossary_path.read_bytes()
    _,inventory,_=planner.p.inspect_xlsx(SOURCE,"2014",json.loads(glossary_raw))
    records={r["id"]:r for r in inventory}
    reviews=[]
    for name,expected in plan["review_hashes"].items():
        reviews.extend(json.loads(line) for line in pinned(REPO/name,expected).decode("utf8").splitlines() if line.strip())
    binding=validate_bindings(source,plan,reviews,records)
    authored_path=Path(authored_path).resolve()
    authored=authored_path.read_bytes()
    targets=authored_values(authored,plan["entries"])
    require(SOURCE.read_bytes()==source and glossary_path.read_bytes()==glossary_raw,"Source changed during read")
    return source,plan,targets,binding,authored_path,authored,glossary_raw


def run(authored_path,directory=None):
    stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output=allowed_output(directory or BASE/("spell-bodies-candidate-"+stamp),"spell-bodies-candidate-")
    if output.exists():raise FileExistsError(str(output))
    source,plan,targets,binding,author_path,author_raw,glossary_raw=load_context(authored_path)
    # Actual published CLI pipeline functions generate both required rule-set
    # seeds from the two originals. No historical seed path or plan is loaded.
    upstream=main_lists.run()
    incoming=Path(upstream["reports"]["2014"]["output"])
    seed=pinned(incoming,PINS["seed"])
    result=apply(seed,plan,targets)
    audit=verify(seed,result,plan)
    require(planner.build()==plan and SOURCE.read_bytes()==source and incoming.read_bytes()==seed,
            "Bound source or reviews changed during application")
    require(author_path.read_bytes()==author_raw and (TOOL_ROOT/"glossary.json").read_bytes()==glossary_raw,
            "Authored targets or glossary changed during application")
    output.mkdir(parents=True,exist_ok=False)
    target=output/"2014-SPELL-BODIES-NO-CACHE-NOT-FOR-UPLOAD.xlsx"
    with target.open("xb") as f:f.write(result)
    require(target.read_bytes()==result,"Candidate write differs from verified bytes")
    report={"output":str(output),"candidate":str(target),"outputSha256":sha(result),
            "input":str(incoming),"inputSha256":sha(seed),"mainListsOutput":upstream["output"],
            "phase20Output":upstream["phase20Output"],"sourceSha256":sha(source),
            "planSha256":digest(plan),"reviewHashes":plan["review_hashes"],"glossarySha256":sha(glossary_raw),
            "authoredTargets":str(author_path),"authoredTargetsSha256":sha(author_raw),
            "authoredRowsReadBack":len(targets),"authoredCellsReadBack":4*(len(targets)+1),
            "bindings":binding,"preservation":audit,"nativeCalculated":False,"uploadReady":False,
            "scope":"2014 M3:M524 only; other card text remains untranslated; dependency/native/upload validation remains pending"}
    with (output/"2014-body-plan.json").open("x",encoding="utf8",newline="\n") as f:f.write(json.dumps(plan,ensure_ascii=False,indent=2)+"\n")
    with (output/"report.json").open("x",encoding="utf8",newline="\n") as f:f.write(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo")
    parser.add_argument("--authored-targets",type=Path,required=True,
                        help="Exact A:D workbook exported from the fresh plan by author_targets.mjs")
    parser.add_argument("--output",type=Path)
    args=parser.parse_args()
    print(json.dumps(run(args.authored_targets,args.output),ensure_ascii=False))


if __name__=="__main__":main()
