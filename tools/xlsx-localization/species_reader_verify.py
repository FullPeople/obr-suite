"""Independent native-package checks; does not import the reader writer."""
from pathlib import Path
import argparse, hashlib, json, re
import xml.etree.ElementTree as E
import spell_bodies_package as p
from main_ability_inputs import tabs

PINS = {'2014': '2ea36487007c282d002b23f16bc65ac8180aa040ad661eea1cafcca0b5f84c53',
        '2024': '735c37443b5f41e32a1f50254faf9db9f2d8fd74fe3de66983090e5c703911d3'}
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def verify(source, product, planned, version):
    assert sha(source) == PINS[version] and planned['inputs'] == PINS
    before, infos, comment = p.read_zip(source)
    after, new_infos, new_comment = p.read_zip(product)
    assert list(before) == list(after) and comment == new_comment
    assert [(i.filename, i.date_time, i.compress_type, i.external_attr) for i in infos] == [(i.filename, i.date_time, i.compress_type, i.external_attr) for i in new_infos]
    names = tabs(before)
    changed = {'xl/styles.xml', names['主要']}
    if version == '2024': changed.add(names['种族'])
    assert {n for n in before if before[n] != after[n]} == changed
    for name in before:
        if name.endswith('.xml'): E.fromstring(after[name])
    main = names['主要']
    old_cells, new_cells = p.indexed_cells(before[main]), p.indexed_cells(after[main])
    assert all(new_cells[ref] == raw for ref, raw in old_cells.items()), 'Existing main-card input/formula changed'
    spec = json.loads(next(e['target'] for e in planned['entries'] if e['version'] == version and e['kind'] == 'reader'))
    first = 152 if version == '2014' else 104
    assert spec['first_row'] == first and spec['last_row'] == first + 43
    assert set(new_cells) - set(old_cells) == set(spec['cells'])
    assert len(spec['cells']) == 7
    old_rows = {a['r']: raw for a, raw, *_ in p.spans(before[main], 'row')}
    new_rows = {a['r']: raw for a, raw, *_ in p.spans(after[main], 'row')}
    assert all(new_rows[ref] == raw for ref, raw in old_rows.items()), 'Original row or height changed'
    assert set(new_rows) - set(old_rows) == {str(i) for i in range(first, first + 44)}
    for ref in set(new_rows) - set(old_rows):
        node = p.fragment(new_rows[ref])
        assert node.get('ht') == '15' and node.get('customHeight') == '1'
    for ref, wanted in spec['cells'].items():
        cell = p.fragment(new_cells[ref])
        assert cell.find(p.q('v')) is None, 'Uncalculated formula cache unexpectedly added'
        if 'formula' in wanted:
            assert cell.findtext(p.q('f')) == wanted['formula'] and not cell.find(p.q('f')).attrib
        else:
            assert p.visible_text(cell.find(p.q('is'))) == wanted['text']
    old_styles, new_styles = E.fromstring(before['xl/styles.xml']), E.fromstring(after['xl/styles.xml'])
    for tag in ['fonts', 'cellXfs']:
        a, b = old_styles.find(p.q(tag)), new_styles.find(p.q(tag))
        assert len(b) == int(b.get('count'))
        assert [E.tostring(n) for n in a] == [E.tostring(n) for n in b[:len(a)]], 'Existing style changed'
    for node in old_styles:
        if node.tag not in {p.q('fonts'), p.q('cellXfs')}:
            assert E.tostring(node) == E.tostring(new_styles.find(node.tag))
    for ref, wanted in spec['cells'].items():
        xf = new_styles.find(p.q('cellXfs'))[int(p.fragment(new_cells[ref]).get('s'))]
        font = new_styles.find(p.q('fonts'))[int(xf.get('fontId'))]
        alignment = xf.find(p.q('alignment'))
        assert font.find(p.q('name')).get('val') == 'Arial' and float(font.find(p.q('sz')).get('val')) == wanted['size']
        assert all(alignment.get(k) == v for k, v in {'wrapText':'1', 'shrinkToFit':'0', 'horizontal':'left', 'vertical':'top'}.items())
    a, b = E.fromstring(before[main]), E.fromstring(after[main])
    expected_tags = [n.tag for n in a]
    expected_tags.insert(expected_tags.index(p.q('pageMargins')), p.q('hyperlinks'))
    assert [n.tag for n in b] == expected_tags
    for tag in ['mergeCells', 'dataValidations']:
        old, new = a.find(p.q(tag)), b.find(p.q(tag))
        assert int(new.get('count')) == len(new)
        assert [E.tostring(n) for n in old] == [E.tostring(n) for n in new[:len(old)]]
        added = new[len(old):]
        if tag == 'mergeCells': assert [n.get('ref') for n in added] == spec['merges']
        else:
            assert len(added) == 1 and added[0].get('sqref') == spec['selector']
            assert added[0].get('type') == 'list' and added[0].get('showErrorMessage') == '1'
            assert added[0].findtext(p.q('formula1')) == '$BT$3:$BT$15'
    assert {n.get('ref'): n.get('location') for n in b.find(p.q('hyperlinks'))} == {'BZ2': 'B' + str(first), 'B' + str(first): 'BT1'}
    assert b.find(p.q('dimension')).get('ref') == re.sub(r'\d+$', str(first + 43), a.find(p.q('dimension')).get('ref'))
    editable_tags = {p.q(n) for n in ['sheetData', 'dimension', 'mergeCells', 'dataValidations', 'hyperlinks']}
    assert [E.tostring(n) for n in a if n.tag not in editable_tags] == [E.tostring(n) for n in b if n.tag not in editable_tags], 'Main metadata changed'
    species_added = 0
    if version == '2024':
        part = names['种族']
        a, b = p.indexed_cells(before[part]), p.indexed_cells(after[part])
        entries = {e['cell']: e['target'] for e in planned['entries'] if e['kind'] == 'species'}
        assert set(entries) == {col + str(row) for col in 'EFGHI' for row in [105, 106]}
        assert set(b) - set(a) == {col + str(row) for col in 'EFGH' for row in [105, 106]}
        for ref, cell in a.items():
            if ref not in entries: assert b[ref] == cell, ('Species source changed', ref)
            else: assert len(p.fragment(cell)) == 0
        for ref, value in entries.items():
            cell = p.fragment(b[ref])
            assert cell.get('s') == '485' and cell.get('t') == 'inlineStr'
            assert p.visible_text(cell.find(p.q('is'))) == value
        assert entries['E105'] == 'Flamekin' and entries['E106'] == 'Kithkin'
        assert entries['F105'] == entries['F106'] == 'Humanoid'
        assert entries['G105'] == 'Medium or Small; choose your size when you select this species.'
        assert entries['G106'] == 'Small (about 2-3 feet tall)'
        assert entries['H105'] == entries['H106'] == '30 ft.'
        for col in ['I105', 'I106']: assert 'https://www.dndbeyond.com/forums/' in entries[col]
        # The record is completed without changing any existing lookup formula.
        aa, bb = E.fromstring(before[part]), E.fromstring(after[part])
        assert [E.tostring(n) for n in aa if n.tag != p.q('sheetData')] == [E.tostring(n) for n in bb if n.tag != p.q('sheetData')]
        old_rows = {n.get('r'): n for n in aa.find(p.q('sheetData'))}
        new_rows = {n.get('r'): n for n in bb.find(p.q('sheetData'))}
        assert set(old_rows) == set(new_rows)
        for ref, row in old_rows.items():
            if ref in ['105', '106']:
                assert row.attrib == new_rows[ref].attrib
            else: assert E.tostring(row) == E.tostring(new_rows[ref])
        species_added = 2
    return {'version': version, 'sha256': sha(product), 'existing_main_cells_unchanged': len(old_cells), 'existing_main_rows_unchanged': len(old_rows) if version == '2014' else len(p.spans(before[main], 'row')), 'reader_cells': 7, 'species_records_added': species_added, 'print_areas_unchanged': before['xl/workbook.xml'] == after['xl/workbook.xml'], 'passed': True, 'release_ready': False}


def main():
    parser = argparse.ArgumentParser()
    for name in ['source', 'candidate', 'plan', 'output']: parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    planned = json.loads(Path(args.plan).read_bytes())
    results = {}
    for version in PINS:
        source = (Path(args.source) / (version + '-SPECIES-DATA-NO-CACHE-NOT-FOR-UPLOAD.xlsx')).read_bytes()
        product = (Path(args.candidate) / (version + '-SPECIES-READER-NO-CACHE-NOT-FOR-UPLOAD.xlsx')).read_bytes()
        results[version] = verify(source, product, planned, version)
    target = Path(args.output)
    assert not target.exists()
    target.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(results, ensure_ascii=False))


if __name__ == '__main__': main()
