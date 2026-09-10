"""Independently verify species package changes; never import the writer."""
import argparse
from collections import defaultdict
import copy
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as E
import zipfile

if not __debug__:
    raise RuntimeError('Verification requires assertions')
N = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
XML = '{http://www.w3.org/XML/1998/namespace}'


def read(path):
    with zipfile.ZipFile(path) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def canon(node):
    return E.tostring(node)


def text(node):
    return ''.join(n.text or '' for n in node.iter(N + 't'))


def verify(source, output, plan, version):
    assert hashlib.sha256(Path(source).read_bytes()).hexdigest() == plan['inputs'][version]
    before, after = read(source), read(output)
    assert list(before) == list(after)
    rels = {n.get('Id'): n.get('Target') for n in E.fromstring(before['xl/_rels/workbook.xml.rels'])}
    names = {n.get('name'): 'xl/' + rels[n.get(R + 'id')]
             for n in E.fromstring(before['xl/workbook.xml']).find(N + 'sheets')}
    selected = [e for e in plan['entries'] if e['version'] == version]
    expected_parts = {names['种族'], names['Export'], 'xl/sharedStrings.xml'}
    assert {name for name in before if before[name] != after[name]} == expected_parts
    old_strings = E.fromstring(before['xl/sharedStrings.xml'])
    new_strings = E.fromstring(after['xl/sharedStrings.xml'])
    assert int(new_strings.get('uniqueCount')) == len(new_strings)
    assert [canon(n) for n in old_strings] == [canon(n) for n in list(new_strings)[:len(old_strings)]]
    assert int(new_strings.get('count')) == sum(c.get('t') == 's' for part in names.values()
                                               for c in E.fromstring(after[part]).iter(N + 'c'))
    checked, paragraphs, formulas, helpers_checked = 0, 0, 0, 0
    for sheet in ['种族', 'Export']:
        old = E.fromstring(before[names[sheet]])
        new = E.fromstring(after[names[sheet]])
        old_cells = {c.get('r'): c for c in old.iter(N + 'c')}
        new_cells = {c.get('r'): c for c in new.iter(N + 'c')}
        rows = [e for e in selected if e['sheet'] == sheet]
        planned = {e['cell']: e for e in rows}
        assert len(planned) == len(rows)
        helpers = {ref: e for ref, e in planned.items() if e['kind'] == 'helper'}
        assert set(new_cells) == set(old_cells) | set(helpers)
        for ref, actual in new_cells.items():
            entry = planned.get(ref)
            if ref in helpers:
                assert actual.attrib == {'r': ref, 't': 'inlineStr'}
                assert len(actual) == 1 and actual[0].tag == N + 'is' and len(actual[0]) == 1
                assert actual[0][0].tag == N + 't' and actual[0][0].attrib == {XML + 'space': 'preserve'}
                assert text(actual) == entry['target']
                helpers_checked += 1
                continue
            expected = copy.deepcopy(old_cells[ref])
            if entry and entry['kind'] == 'value':
                assert expected.get('t') == 's' and expected.find(N + 'f') is None
                si = old_strings[int(expected.findtext(N + 'v'))]
                assert text(si) == entry['source'] and si.find(N + 'r') is None
                if 'text_expression' in entry:
                    expression = actual.findtext(N + 'f')
                    assert expression == entry['text_expression'] and len(expression) < 8192
                    tokens = re.findall(r'"(?:[^"\r\n]|"")*"|CHAR\((?:9|10|13)\)', expression)
                    assert '&'.join(tokens) == expression
                    assert ''.join(token[1:-1].replace('""', '"') if token.startswith('"')
                                   else chr(int(token[5:-1])) for token in tokens) == entry['target']
                    assert all(len(token[1:-1]) <= 255 for token in tokens if token.startswith('"'))
                    expected.set('t', 'str')
                    expected.remove(expected.find(N + 'v'))
                    formula = E.SubElement(expected, N + 'f')
                    formula.text = expression
                    paragraphs += 1
                else:
                    target_si = new_strings[int(actual.findtext(N + 'v'))]
                    assert len(target_si) == 1 and target_si[0].tag == N + 't'
                    assert text(target_si) == entry['target']
                    expected.find(N + 'v').text = actual.findtext(N + 'v')
            elif entry and entry['kind'] == 'formula':
                assert expected.findtext(N + 'f') == entry['source'][1:]
                assert actual.findtext(N + 'f') == entry['target'][1:]
                assert expected.find(N + 'f').attrib == entry['formula_attributes']
                expected.find(N + 'f').text = entry['target'][1:]
                formulas += 1
            elif entry:
                raise AssertionError('Unknown kind')
            assert canon(expected) == canon(actual), (version, sheet, ref)
            # Substitute only the independently checked cell before comparing
            # the full sheet, including validations and all layout metadata.
            original = old_cells[ref]
            original.clear()
            original.attrib.update(expected.attrib)
            original.text = expected.text
            original.extend(copy.deepcopy(list(expected)))
            checked += 1
        if helpers:
            assert sheet == 'Export'
            last_column = plan['versions'][version]['export_last_column']
            assert last_column == ('Y' if version == '2024' else 'W')
            grouped = defaultdict(list)
            for ref in helpers:
                grouped[int(re.search(r'[0-9]+$', ref).group())].append(ref)
            original_rows = {int(n.get('r')): n for n in old.find(N + 'sheetData')}
            for number, refs in grouped.items():
                row = original_rows[number]
                for ref in refs:
                    row.append(copy.deepcopy(new_cells[ref]))
                if 'spans' in row.attrib:
                    row.set('spans', '1:' + str(ord(last_column) - 64))
            dimension = old.find(N + 'dimension')
            assert re.fullmatch(r'A1:Q[0-9]+', dimension.get('ref'))
            dimension.set('ref', dimension.get('ref').replace(':Q', ':' + last_column))
        assert canon(old) == canon(new), (version, sheet, 'Unplanned sheet modification')
    return {'version': version, 'sha256': hashlib.sha256(Path(output).read_bytes()).hexdigest(),
            'parts_checked': len(before), 'existing_cells_checked': checked,
            'paragraphs_checked': paragraphs, 'formulas_checked': formulas,
            'helpers_checked': helpers_checked, 'native_calculation_verified': False,
            'release_ready': False}


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ['source', 'output', 'plan', 'version']:
        cli.add_argument('--' + name, required=True)
    args = cli.parse_args()
    print(json.dumps(verify(args.source, args.output,
                            json.loads(Path(args.plan).read_text(encoding='utf8')), args.version), indent=2))
