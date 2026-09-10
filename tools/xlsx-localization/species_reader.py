"""Add a same-sheet trait reader and two documented missing species records.

Artifact Tool authors the exact plan values. The native OOXML adapter preserves
all existing character inputs, formulas, print areas and other workbook parts.
Outputs are engineering candidates without calculation caches.
"""
from pathlib import Path
import argparse, hashlib, json, re
from xml.sax.saxutils import escape, quoteattr
import xml.etree.ElementTree as E
import spell_bodies_package as p
from main_ability_inputs import tabs
from main_display_apply import attribute, container
from main_remaining_fields import layout_styles

PINS = {
    '2014': '2ea36487007c282d002b23f16bc65ac8180aa040ad661eea1cafcca0b5f84c53',
    '2024': '735c37443b5f41e32a1f50254faf9db9f2d8fd74fe3de66983090e5c703911d3',
}
ADAPTATION = 'https://www.dndbeyond.com/forums/d-d-beyond-general/release-issues-support/232520-lorwyn-first-light-issues-and-support-thread'
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def read_sources(directory):
    result = {}
    for version, pin in PINS.items():
        path = Path(directory) / (version + '-SPECIES-DATA-NO-CACHE-NOT-FOR-UPLOAD.xlsx')
        raw = path.read_bytes()
        assert sha(raw) == pin, ('Unreviewed input', path)
        result[version] = raw
    return result


def text(parts, sheet, ref):
    raw = p.indexed_cells(parts[tabs(parts)[sheet]])[ref]
    cell = p.fragment(raw)
    assert cell.find(p.q('f')) is None, ('Expected text cell', sheet, ref)
    if cell.get('t') == 's':
        return p.visible_text(E.fromstring(parts[p.SST])[int(cell.findtext(p.q('v')))])
    if cell.get('t') == 'inlineStr':
        return p.visible_text(cell.find(p.q('is')))
    return cell.findtext(p.q('v')) or ''


def reader(version):
    first = 152 if version == '2014' else 104
    selector = 'B' + str(first + 6)
    row = 'MATCH(' + selector + ',$BT$3:$BT$15,0)'
    saved = 'INDEX($BZ$3:$BZ$15,' + row + ')'
    source_range = '$AN$2:$AN$14' if version == '2014' else '$CA$2:$CA$14'
    reference = "INDEX('种族'!" + source_range + ',' + row + ')'
    missing = 'No description found. Check the species, subrace and selected trait on your character card.'
    body = 'IF(' + selector + '="","Choose a trait from the list above.",IFERROR(IF(' + saved + '<>"",' + saved + ',IF(' + reference + '<>"",' + reference + ',"' + missing + '")),"Choose a trait currently listed on your character card."))'
    status = 'IFERROR(IF(' + saved + '<>"","Description saved on your character card","Species reference"),"")'
    cells = {
        'B' + str(first): {'text': 'Back to character traits', 'style_from': 'BZ3', 'size': 10},
        'B' + str(first + 2): {'text': 'Full Trait Description', 'style_from': 'BT1', 'size': 14},
        'B' + str(first + 3): {'text': 'Choose a trait below. The description saved on your card takes priority. If it is empty, the species reference is shown.', 'style_from': 'BZ3', 'size': 11},
        selector: {'text': 'Creature Type', 'style_from': 'BT3', 'size': 12},
        'N' + str(first + 6): {'formula': 'IF($T$6="","Select a species on your character card",$T$6&IF($T$7="",""," / "&$T$7))', 'style_from': 'BZ3', 'size': 11},
        'B' + str(first + 8): {'formula': status, 'style_from': 'BZ3', 'size': 10},
        'B' + str(first + 9): {'formula': body, 'style_from': 'BZ3', 'size': 11},
    }
    return {
        'first_row': first, 'last_row': first + 43, 'height': 15,
        'selector': selector, 'body': 'B' + str(first + 9), 'cells': cells,
        'merges': [f'B{first}:AU{first}', f'B{first+2}:AU{first+2}',
                   f'B{first+3}:AU{first+4}', f'B{first+6}:L{first+7}',
                   f'N{first+6}:AU{first+7}', f'B{first+8}:AU{first+8}',
                   f'B{first+9}:AU{first+43}'],
        'links': {'BZ2': 'B' + str(first), 'B' + str(first): 'BT1'},
        'validation': '$BT$3:$BT$15',
    }


def plan(seeds):
    assert {v: sha(raw) for v, raw in seeds.items()} == PINS
    parts = {v: p.read_zip(raw)[0] for v, raw in seeds.items()}
    # Official Lorwyn adaptation plus rules already supplied in these cards.
    # Genasi's generic 2024 row has the Air Genasi speed; do not reuse it.
    assert text(parts['2014'], '种族', 'J84') == 'You are a Humanoid.'
    assert text(parts['2014'], '种族', 'H84') == 'Your base walking speed is 30 feet.'
    small_or_medium = text(parts['2014'], '种族', 'G82')
    assert p.fragment(p.indexed_cells(parts['2014'][tabs(parts['2014'])['种族']])['G84']).findtext(p.q('f')) == 'G82'
    assert text(parts['2024'], '种族', 'E8') == 'Halfling'
    records = {
        105: ['Flamekin', 'Humanoid', small_or_medium, '30 ft.', 'Fire Genasi (Monsters of the Multiverse); Lorwyn adaptation: ' + ADAPTATION],
        106: ['Kithkin', *[text(parts['2024'], '种族', col + '8') for col in 'FGH'], 'Halfling (2024 Player\'s Handbook); Lorwyn adaptation: ' + ADAPTATION],
    }
    entries = []
    cells = p.indexed_cells(parts['2024'][tabs(parts['2024'])['种族']])
    for row, values in records.items():
        for col, value in zip('EFGHI', values):
            ref = col + str(row)
            if ref in cells:
                original = p.fragment(cells[ref])
                assert col == 'I' and len(original) == 0 and set(original.attrib) <= {'r', 's'}, ('Reserved field occupied', ref)
            entries.append({'id': '2024-species-' + ref, 'version': '2024', 'sheet': '种族', 'cell': ref, 'kind': 'species', 'source': 'Missing generic species record', 'target': value})
    for version in PINS:
        entries.append({'id': version + '-reader', 'version': version, 'sheet': '主要', 'cell': 'Full Trait Description', 'kind': 'reader', 'source': 'Append after existing rows', 'target': json.dumps(reader(version), ensure_ascii=False, separators=(',', ':'))})
    return {'schema': 'obr-species-reader-plan/v1', 'inputs': PINS, 'entries': entries, 'release_ready': False, 'mandrake_fields_pending': True}


def make_cell(ref, value, style):
    formula = value.get('formula')
    payload = '<f>' + escape(formula) + '</f>' if formula is not None else '<is><t>' + escape(value['text']) + '</t></is>'
    return ('<c r=' + quoteattr(ref) + ' s=' + quoteattr(style) + ' t=' + quoteattr('str' if formula is not None else 'inlineStr') + '>' + payload + '</c>').encode('utf8')


def append_reader(styles, content, spec):
    cells = p.indexed_cells(content)
    assert max(int(a['r']) for a, *_ in p.spans(content, 'row')) < spec['first_row']
    assert not p.spans(content, 'hyperlinks')
    rows = []
    for row in range(spec['first_row'], spec['last_row'] + 1):
        added = b''.join(make_cell(ref, value, p.fragment(cells[value['style_from']]).get('s')) for ref, value in spec['cells'].items() if int(re.search(r'\d+$', ref)[0]) == row)
        rows.append(('<row r="' + str(row) + '" ht="15" customHeight="1">').encode() + added + b'</row>')
    content = content.replace(b'</sheetData>', b''.join(rows) + b'</sheetData>', 1)
    for size in sorted({v['size'] for v in spec['cells'].values()}):
        refs = [ref for ref, value in spec['cells'].items() if value['size'] == size]
        styles, content = layout_styles(styles, content, {'refs': refs, 'font': 'Arial', 'size': size, 'wrap_refs': refs, 'widths': {}})
    # Only newly appended styles are adjusted: avoid altering existing input cells.
    xfs = p.spans(styles, 'cellXfs')[0][1]
    old_count = len(p.spans(xfs, 'xf'))
    extra = []
    for ref in spec['cells']:
        cell = p.indexed_cells(content)[ref]
        xf = p.spans(xfs, 'xf')[int(p.fragment(cell).get('s'))][1]
        alignment = p.spans(xf, 'alignment')[0][1]
        replacement = attribute(attribute(alignment, 'horizontal', 'left'), 'vertical', 'top')
        extra.append(xf.replace(alignment, replacement, 1))
        content = content.replace(cell, attribute(cell, 's', old_count + len(extra) - 1), 1)
    styles = styles.replace(xfs, container(xfs, 'cellXfs', extra, old_count + len(extra)), 1)
    merges = p.spans(content, 'mergeCells')[0][1]
    added = [('<mergeCell ref=' + quoteattr(ref) + '/>').encode() for ref in spec['merges']]
    content = content.replace(merges, container(merges, 'mergeCells', added, len(p.spans(merges, 'mergeCell')) + len(added)), 1)
    validations = p.spans(content, 'dataValidations')[0][1]
    rule = ('<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="stop" errorTitle="Choose a listed trait" error="Choose a trait currently listed on your character card." promptTitle="Selected character traits" prompt="Choose one of the traits in the Name column on your card." sqref=' + quoteattr(spec['selector']) + '><formula1>' + escape(spec['validation']) + '</formula1></dataValidation>').encode()
    content = content.replace(validations, container(validations, 'dataValidations', [rule], len(p.spans(validations, 'dataValidation')) + 1), 1)
    links = ('<hyperlinks>' + ''.join('<hyperlink ref=' + quoteattr(ref) + ' location=' + quoteattr(target) + '/>' for ref, target in spec['links'].items()) + '</hyperlinks>').encode()
    margins = p.spans(content, 'pageMargins')[0][1]
    content = content.replace(margins, links + margins, 1)
    dim = p.spans(content, 'dimension')[0][1]
    content = content.replace(dim, attribute(dim, 'ref', re.sub(r'\d+$', str(spec['last_row']), p.fragment(dim).get('ref'))), 1)
    return styles, content


def apply(seeds, planned, author):
    assert planned == plan(seeds), 'Plan differs from reviewed source and reader'
    p.authored_values(author, planned['entries'])
    products = {}
    for version, raw in seeds.items():
        parts, _, _ = p.read_zip(raw)
        names = tabs(parts)
        styles, main = append_reader(parts['xl/styles.xml'], parts[names['主要']], reader(version))
        changed = {'xl/styles.xml': styles, names['主要']: main}
        if version == '2024':
            content = parts[names['种族']]
            entries = [e for e in planned['entries'] if e['kind'] == 'species']
            for row_number in [105, 106]:
                old = next(raw for a, raw, *_ in p.spans(content, 'row') if int(a['r']) == row_number)
                raw_cells = p.spans(old, 'c')
                new_cells = [(e['cell'], make_cell(e['cell'], {'text': e['target']}, '485')) for e in entries if int(re.search(r'\d+$', e['cell'])[0]) == row_number]
                def colnum(ref):
                    n = 0
                    for c in re.match(r'[A-Z]+', ref)[0]: n = n * 26 + ord(c) - 64
                    return n
                replacing = {ref for ref, _ in new_cells}
                combined = sorted([(a['r'], raw) for a, raw, *_ in raw_cells if a['r'] not in replacing] + new_cells, key=lambda pair: colnum(pair[0]))
                new = p.strip_elements(old, 'c').replace(b'</row>', b''.join(raw for _, raw in combined) + b'</row>', 1)
                content = content.replace(old, new, 1)
            changed[names['种族']] = content
        output = p.write_zip(raw, changed)
        products[version] = (output, {'version': version, 'sha256': sha(output), 'bytes': len(output), 'changed_parts': list(changed), 'release_ready': False})
    return products


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['plan', 'apply'])
    parser.add_argument('--source', required=True)
    parser.add_argument('--plan', required=True)
    parser.add_argument('--author')
    parser.add_argument('--output')
    args = parser.parse_args()
    seeds = read_sources(args.source)
    planned = plan(seeds)
    if args.command == 'plan':
        target = Path(args.plan)
        assert not target.exists()
        target.write_text(json.dumps(planned, ensure_ascii=False, indent=2), encoding='utf8')
        print(json.dumps({'plan': str(target), 'entries': len(planned['entries'])}))
        return
    assert json.loads(Path(args.plan).read_bytes()) == planned
    target = Path(args.output)
    assert not target.exists()
    products = apply(seeds, planned, Path(args.author).read_bytes())
    target.mkdir(parents=True)
    report = {'plan_sha256': sha(Path(args.plan).read_bytes()), 'author_sha256': sha(Path(args.author).read_bytes()), 'outputs': {}}
    for version, (raw, info) in products.items():
        path = target / (version + '-SPECIES-READER-NO-CACHE-NOT-FOR-UPLOAD.xlsx')
        path.write_bytes(raw)
        report['outputs'][version] = {**info, 'path': str(path)}
    (target / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
