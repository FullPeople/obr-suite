"""Apply authored species targets while preserving the native workbook package."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from xml.sax.saxutils import escape

import spell_bodies_package as p
from main_ability_inputs import tabs
from main_display_apply import attribute
from species_data_plan import plan
from spell_display_fields import clone_text
from spell_display_labels import set_element_text

if not __debug__:
    raise RuntimeError('Verification requires assertions')


def apply(inputs, planned, authored):
    assert planned == plan(inputs), 'Plan differs from reviewed inputs'
    p.authored_values(authored, planned['entries'])
    products = {}
    for version, path in inputs.items():
        raw = path.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == planned['inputs'][version]
        parts, _, _ = p.read_zip(raw)
        names = tabs(parts)
        strings = p.spans(parts[p.SST], 'si')
        clones, clone_ids, changed = [], {}, {}
        selected = [e for e in planned['entries'] if e['version'] == version]
        for sheet in ['种族', 'Export']:
            part = names[sheet]
            content = parts[part]
            cells = p.indexed_cells(content)
            entries = [e for e in selected if e['sheet'] == sheet]
            for entry in [e for e in entries if e['kind'] != 'helper']:
                old = cells[entry['cell']]
                node = p.fragment(old)
                if entry['kind'] == 'formula':
                    assert node.findtext(p.q('f')) == entry['source'][1:]
                    assert node.find(p.q('f')).attrib == entry['formula_attributes']
                    new = set_element_text(old, 'f', entry['target'][1:])
                    assert p.fragment(new).find(p.q('f')).attrib == node.find(p.q('f')).attrib
                elif entry['kind'] == 'value':
                    assert node.get('t') == 's' and node.find(p.q('f')) is None
                    si = strings[int(node.findtext(p.q('v')))][1]
                    assert p.visible_text(p.fragment(si)) == entry['source']
                    assert not p.spans(si, 'r')
                    if 'text_expression' in entry:
                        new = attribute(old, 't', 'str')
                        values = p.spans(new, 'v')
                        assert len(values) == 1
                        new = new.replace(values[0][1], ('<f>' + escape(entry['text_expression']) + '</f>').encode('utf8'), 1)
                    else:
                        clone = clone_text(si, entry['target'])
                        if clone not in clone_ids:
                            clone_ids[clone] = len(strings) + len(clones)
                            clones.append(clone)
                        new = set_element_text(old, 'v', str(clone_ids[clone]))
                else:
                    raise AssertionError('Unknown entry kind')
                assert content.count(old) == 1
                content = content.replace(old, new, 1)
            helpers = [e for e in entries if e['kind'] == 'helper']
            if helpers:
                assert sheet == 'Export'
                rows = defaultdict(list)
                for entry in helpers:
                    assert entry['cell'] not in cells
                    rows[int(re.search(r'[0-9]+$', entry['cell']).group())].append(entry)
                original_rows = {int(a['r']): b for a, b, *_ in p.spans(content, 'row')}
                last_column = planned['versions'][version]['export_last_column']
                for number, values in sorted(rows.items()):
                    assert number in original_rows, 'Reserved helper row missing'
                    old = original_rows[number]
                    added = ''.join('<c r="' + e['cell'] + '" t="inlineStr"><is><t xml:space="preserve">'
                                    + escape(e['target']) + '</t></is></c>' for e in values).encode('utf8')
                    new = old.replace(b'</row>', added + b'</row>')
                    assert new != old
                    if 'spans' in p.fragment(old).attrib:
                        new = attribute(new, 'spans', '1:' + str(ord(last_column) - 64))
                    content = content.replace(old, new, 1)
                dimension = p.spans(content, 'dimension')[0][1]
                previous = p.fragment(dimension).get('ref')
                assert re.fullmatch(r'A1:Q[0-9]+', previous)
                content = content.replace(dimension, attribute(dimension, 'ref', previous.replace(':Q', ':' + last_column)), 1)
            after_cells = p.indexed_cells(content)
            assert set(after_cells) == set(cells) | {e['cell'] for e in helpers}
            allowed = {e['cell'] for e in entries}
            assert all(after_cells[ref] == before for ref, before in cells.items() if ref not in allowed)
            if not helpers:
                assert p.strip_elements(content, 'c') == p.strip_elements(parts[part], 'c')
            changed[part] = content
        sst = parts[p.SST].replace(b'</sst>', b''.join(clones) + b'</sst>')
        sst, count = re.subn(rb'(<sst\b[^>]*\buniqueCount=")[0-9]+(")',
                            lambda m: m[1] + str(len(strings) + len(clones)).encode() + m[2], sst, count=1)
        assert count == 1
        references = sum(a.get('t') == 's' for part in names.values()
                         for a, *_ in p.spans(changed.get(part, parts[part]), 'c'))
        sst, count = re.subn(rb'(<sst\b[^>]*\bcount=")[0-9]+(")',
                            lambda m: m[1] + str(references).encode() + m[2], sst, count=1)
        assert count == 1
        changed[p.SST] = sst
        output = p.write_zip(raw, changed)
        after, _, _ = p.read_zip(output)
        assert list(after) == list(parts)
        assert {name for name in parts if after[name] != parts[name]} == set(changed)
        assert [s[1] for s in strings] == [s[1] for s in p.spans(sst, 'si')[:len(strings)]]
        assert path.read_bytes() == raw
        products[version] = (output, {'version': version, 'sha256': hashlib.sha256(output).hexdigest(),
                                      'bytes': len(output), 'changed_parts': list(changed),
                                      'paragraph_expressions': sum('text_expression' in e for e in selected),
                                      'counts': {kind: sum(e['kind'] == kind for e in selected)
                                                 for kind in ['value', 'formula', 'helper']},
                                      'native_calculation_verified': False, 'release_ready': False})
    return products


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ['input-2014', 'input-2024', 'plan', 'authored-targets', 'output']:
        cli.add_argument('--' + name, type=Path, required=True)
    args = cli.parse_args()
    destination = args.output.resolve()
    assert not destination.exists() and destination.name.startswith('species_data-candidate-')
    assert not destination.is_relative_to(p.REPO.resolve())
    planned = json.loads(args.plan.read_text(encoding='utf8'))
    authored = args.authored_targets.read_bytes()
    products = apply({'2014': args.input_2014, '2024': args.input_2024}, planned, authored)
    assert args.authored_targets.read_bytes() == authored
    destination.mkdir(parents=True)
    reports = []
    for version, (raw, report) in products.items():
        path = destination / (version + '-SPECIES-DATA-NO-CACHE-NOT-FOR-UPLOAD.xlsx')
        with path.open('xb') as stream:
            stream.write(raw)
        assert path.read_bytes() == raw
        reports.append({**report, 'path': str(path)})
    report = {'utc': datetime.now(timezone.utc).isoformat(), 'versions': reports,
              'author_sha256': hashlib.sha256(authored).hexdigest(), 'release_ready': False}
    (destination / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
