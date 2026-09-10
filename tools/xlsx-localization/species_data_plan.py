"""Plan species text migration and bilingual inputs without writing an XLSX.

The plan is bound to located reviews and the completed background cards. It does
not approve a release: an authoring adapter and native calculation/layout checks
must still consume and verify it. Species-specific aliases prevent a shared
Chinese title such as '迅捷' from selecting a different species' ability.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as E

import prepare
import spell_bodies_package as p
from background_data_fields import text_expression
from main_ability_inputs import tabs
from main_toggle_fields import ORIGINALS
from species_reference_audit import PINS, audit

if not __debug__:
    raise RuntimeError('Verification requires assertions')


def colnum(col):
    result = 0
    for char in col:
        result = result * 26 + ord(char) - 64
    return result


def column(ref):
    return ref.rstrip('0123456789')


def quoted(value):
    return '"' + value.replace('"', '""') + '"'


def table_rows(grouped, *, ambiguous_ok=False):
    rows, ambiguous = [], []
    for source, items in sorted(grouped.items()):
        targets = {i['target'] for i in items}
        if len(targets) != 1:
            ambiguous.append({'source': source, 'targets': sorted(targets), 'bindings': items})
            continue
        rows.append({'source': source, 'target': next(iter(targets)), 'bindings': items})
    assert ambiguous_ok or not ambiguous, ambiguous
    assert len({r['source'].casefold() for r in rows}) == len(rows), 'Case-insensitive alias collision'
    return rows, ambiguous


def plan(inputs):
    assert set(inputs) == set(PINS)
    audit_result = audit(inputs)
    assert all(r['remaining_records'] == 0 for r in audit_result['versions'].values())
    files = [prepare.HERE / 'reviewed.jsonl', *sorted((prepare.HERE / 'reviews').glob('*.jsonl'))]
    reviews = [json.loads(line) for path in files for line in path.read_text(encoding='utf8').splitlines()]
    entries, version_plans = [], {}
    for version, path in inputs.items():
        raw = path.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == PINS[version]
        parts, _, _ = p.read_zip(raw)
        names = tabs(parts)
        cells = p.indexed_cells(parts[names['种族']])
        export_cells = p.indexed_cells(parts[names['Export']])
        strings = E.fromstring(parts[p.SST])
        selected = [r for r in reviews if r['version'] == version and r['sheet'] == '种族'
                    and r['kind'] in ['cell_text', 'formula_literal']]
        assert len(selected) == audit_result['versions'][version]['reviewed_records']
        labels, literals = {}, defaultdict(dict)
        for review in selected:
            assert review['workbook_sha256'] == ORIGINALS[version][1]
            p.validate_text(review['target'])
            for location in review['locations']:
                if review['kind'] == 'cell_text':
                    assert location not in labels
                    labels[location] = review
                else:
                    ref, suffix, index = location.split(':')
                    assert suffix == 'literal' and int(index) not in literals[ref]
                    literals[ref][int(index)] = review

        for ref, review in labels.items():
            node = p.fragment(cells[ref])
            assert node.get('t') == 's' and node.find(p.q('f')) is None
            si = strings[int(node.findtext(p.q('v')))]
            assert p.visible_text(si) == review['source'] and si.find(p.q('r')) is None
            entry = {'id': version + '-种族-' + ref, 'version': version, 'sheet': '种族',
                     'cell': ref, 'kind': 'value', 'source': review['source'],
                     'target': review['target'], 'review_id': review['id']}
            if any(c in review['target'] for c in '\r\n\t'):
                # Fixed reference text only; never replace editable main inputs.
                entry['text_expression'] = text_expression(review['target'])
            entries.append(entry)

        for ref, bindings in literals.items():
            node = p.fragment(cells[ref])
            before = node.findtext(p.q('f'))
            matches = list(prepare.LITERAL.finditer(before))
            assert set(bindings) == {i for i, m in enumerate(matches)
                                     if prepare.CJK.search(m.group(1))}
            after = before
            for i, match in reversed(list(enumerate(matches))):
                if i not in bindings:
                    continue
                review = bindings[i]
                assert match.group(1).replace('""', '"') == review['source']
                after = after[:match.start()] + quoted(review['target']) + after[match.end():]
            # The source condition, cell references, operators, and blank literals
            # stay unchanged. Shared/array formula attributes belong to the cell.
            assert prepare.LITERAL.sub('""', before) == prepare.LITERAL.sub('""', after)
            entries.append({'id': version + '-种族-' + ref, 'version': version, 'sheet': '种族',
                            'cell': ref, 'kind': 'formula', 'source': '=' + before,
                            'target': '=' + after, 'formula_attributes': node.find(p.q('f')).attrib,
                            'review_ids': sorted({r['id'] for r in bindings.values()})})

        name_groups, trait_groups, scoped_groups = (defaultdict(list) for _ in range(3))
        for ref, review in labels.items():
            if column(ref) in ['A', 'E'] and int(ref[len(column(ref)):]) > 1:
                name_groups[review['source']].append({'target': review['target'], 'cell': ref,
                                                    'review_id': review['id']})

        owner_col, first_row, first_col, last_col = ('L', 54, 'M', 'AW') if version == '2014' else ('K', 2, 'L', 'AV')
        title_refs = [ref for ref in cells if int(ref[len(column(ref)):]) >= first_row
                      and int(ref[len(column(ref)):]) % 2 == 0
                      and colnum(first_col) <= colnum(column(ref)) <= colnum(last_col)]
        for ref in title_refs:
            candidates = ([labels[ref]] if ref in labels else []) + list(literals.get(ref, {}).values())
            if not candidates:
                continue
            row = int(ref[len(column(ref)):])
            owner = labels.get(owner_col + str(row))
            assert owner is not None, ('Missing trait owner', version, ref)
            for review in candidates:
                binding = {'target': review['target'], 'cell': ref, 'review_id': review['id'],
                           'owner_source': owner['source'], 'owner_target': owner['target']}
                trait_groups[review['source']].append(binding)
                assert '|' not in review['source'] and '|' not in owner['target']
                scoped_groups[owner['target'] + '|' + review['source']].append(binding)
        # The active output includes generic traits (size, speed, language, etc.)
        # that do not belong to a species' dedicated header row.
        output_col = 'AH' if version == '2014' else 'BU'
        for row in range(6, 22):
            ref = output_col + str(row)
            if ref in labels:
                review = labels[ref]
                trait_groups[review['source']].append({'target': review['target'], 'cell': ref,
                                                      'review_id': review['id'], 'generic': True})
        name_aliases, _ = table_rows(name_groups)
        trait_aliases, ambiguous = table_rows(trait_groups, ambiguous_ok=True)
        scoped_aliases, _ = table_rows(scoped_groups)
        assert name_aliases and trait_aliases and scoped_aliases
        for item in ambiguous:
            assert all('owner_target' in b for b in item['bindings']), 'Ambiguous generic trait'
            assert all(any(r['source'] == b['owner_target'] + '|' + item['source']
                           and r['target'] == b['target'] for r in scoped_aliases)
                       for b in item['bindings']), 'Unresolved species-specific trait'

        tables = [(['R', 'S'], 'Species', name_aliases), (['T', 'U'], 'Trait', trait_aliases),
                  (['V', 'W'], 'Species and trait', scoped_aliases)]
        for cols, caption, aliases in tables:
            rows = [{'source': caption + ' original key', 'target': caption + ' English key'}, *aliases]
            for row, values in enumerate(rows, 1):
                for col, key in zip(cols, ['source', 'target']):
                    ref = col + str(row)
                    assert ref not in export_cells, ('Alias space already occupied', version, ref)
                    entries.append({'id': version + '-Export-' + ref, 'version': version, 'sheet': 'Export',
                                    'cell': ref, 'kind': 'helper', 'source': 'Reserved empty alias cell',
                                    'target': values[key]})
        subrace_rows = []
        if version == '2024':
            # The original BR2 reused the trait-table index for AZ:BO. Those
            # tables no longer have the same order (Cervan offered Gallus
            # subraces). Bind the subrace matrix to its own AY row, retaining
            # the original source-book gates and support for already-entered
            # species when their source book is later disabled.
            for row in range(2, 113):
                ref = 'AY' + str(row)
                bindings = ([labels[ref]] if ref in labels else []) + list(literals.get(ref, {}).values())
                if not bindings:
                    continue
                assert len(bindings) == 1, ('Ambiguous species menu row', ref)
                review = bindings[0]
                subrace_rows.append({'source': review['source'], 'target': review['target'],
                                     'relative_row': row - 1, 'cell': ref, 'review_id': review['id']})
            assert len({r['target'].casefold() for r in subrace_rows}) == len(subrace_rows)
            for row, record in enumerate([None, *subrace_rows], 1):
                values = ['Species English key', 'Subrace matrix row'] if record is None else [record['target'], str(record['relative_row'])]
                for col, value in zip(['X', 'Y'], values):
                    ref = col + str(row)
                    assert ref not in export_cells
                    entries.append({'id': version + '-Export-' + ref, 'version': version,
                                    'sheet': 'Export', 'cell': ref, 'kind': 'helper',
                                    'source': 'Reserved empty alias cell', 'target': value})
            before = p.fragment(cells['BR2']).findtext(p.q('f'))
            assert before == 'VLOOKUP(BT3,$A:$B,2,0)'
            after = 'VALUE(VLOOKUP(BT3,\'Export\'!$X$2:$Y$' + str(len(subrace_rows) + 1) + ',2,FALSE))'
            entries.append({'id': version + '-subrace-row', 'version': version, 'sheet': '种族',
                            'cell': 'BR2', 'kind': 'formula', 'source': '=' + before,
                            'target': '=' + after, 'formula_attributes': {},
                            'purpose': 'Select subraces from the matching species menu row instead of an unrelated trait-table row'})
        species_ref, subrace_ref, selected_col = ('AG3', 'AG4', 'AM') if version == '2014' else ('BT3', 'BT4', 'BZ')
        name_range = "'Export'!$R$2:$S$" + str(len(name_aliases) + 1)
        trait_range = "'Export'!$T$2:$U$" + str(len(trait_aliases) + 1)
        scoped_range = "'Export'!$V$2:$W$" + str(len(scoped_aliases) + 1)

        def lookup(expression, table, fallback):
            return 'IFERROR(VLOOKUP(' + expression + ',' + table + ',2,FALSE),' + fallback + ')'

        normalizers = []
        for dest, origin in [(species_ref, 'T6'), (subrace_ref, 'T7')]:
            source = '主要!' + origin
            normalizers.append((dest, source, lookup(source, name_range, source)))
        for row in range(2, 15):
            source = '主要!BT' + str(row + 1)
            normalized = lookup(source, trait_range, source)
            for owner in [species_ref, subrace_ref]:
                absolute = '$' + column(owner) + '$' + owner[len(column(owner)):]
                normalized = lookup(absolute + '&"|"&' + source, scoped_range, normalized)
            normalizers.append((selected_col + str(row), source, normalized))
        for ref, source, normalized in normalizers:
            node = p.fragment(cells[ref])
            before = node.findtext(p.q('f'))
            assert before == 'IF(' + source + '="",0,' + source + ')'
            assert not node.find(p.q('f')).attrib
            after = 'IF(' + source + '="",0,' + normalized + ')'
            entries.append({'id': version + '-normalize-' + ref, 'version': version, 'sheet': '种族',
                            'cell': ref, 'kind': 'formula', 'source': '=' + before, 'target': '=' + after,
                            'formula_attributes': {}, 'purpose': 'Preserve blank and unknown inputs; accept Chinese and English keys'})
        assert len(normalizers) == 15
        assert path.read_bytes() == raw, 'Input changed while planning'
        version_plans[version] = {'name_aliases': name_aliases, 'trait_aliases': trait_aliases,
                                 'scoped_trait_aliases': scoped_aliases, 'ambiguous_global_traits': ambiguous,
                                 'subrace_rows': subrace_rows, 'export_last_column': 'Y' if version == '2024' else 'W',
                                 'input_normalizers': [ref for ref, _, _ in normalizers],
                                 'reference_audit': {k: audit_result['versions'][version][k] for k in
                                     ['reviewed_records', 'reviewed_occurrences', 'species_formula_count', 'validations']}}
    assert len({e['id'] for e in entries}) == len(entries)
    assert len({(e['version'], e['sheet'], e['cell']) for e in entries}) == len(entries)
    return {'schema': 'obr-species-data-plan/v1', 'inputs': PINS, 'entries': entries,
            'versions': version_plans, 'workbooks_unchanged': True,
            'native_calculation_verified': False, 'application_approved': False, 'release_ready': False}


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--input-2014', type=Path, required=True)
    cli.add_argument('--input-2024', type=Path, required=True)
    cli.add_argument('--output', type=Path, required=True)
    args = cli.parse_args()
    assert not args.output.exists(), 'Use a fresh plan output'
    result = plan({'2014': args.input_2014, '2024': args.input_2024})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'output': str(args.output), 'entries': len(result['entries']),
                     'versions': {v: {key: len(row[key]) for key in
                         ['name_aliases', 'trait_aliases', 'scoped_trait_aliases', 'ambiguous_global_traits', 'input_normalizers']}
                                  for v, row in result['versions'].items()},
                     'workbooks_unchanged': True, 'release_ready': False}, ensure_ascii=False, indent=2))
