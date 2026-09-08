"""Preservation checks for real source cells next to self-closing blank cells."""
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from candidate import CELL, patch_package, translated_string
from prepare import ROOT, TEMPLATES, digest, q, rich_text, value_of


class CandidateTests(unittest.TestCase):
    def test_self_closing_cells_do_not_swallow_the_next_text_cell(self):
        xml = b'<row><c r="A1" s="1"/><c r="B1" t="s"><v>0</v></c><c r="C1"/></row>'
        self.assertEqual([m[1] for m in CELL.finditer(xml)], [b'A1', b'B1', b'C1'])

    def test_real_card_labels_and_shared_string_isolation(self):
        for version, filename in TEMPLATES.items():
            with self.subTest(version=version), tempfile.TemporaryDirectory(prefix="obr-xlsx-candidate-test-") as work:
                source = ROOT / "public" / filename
                source_hash = digest(source.read_bytes())
                with zipfile.ZipFile(source) as z:
                    before = {p: z.read(p) for p in z.namelist()}
                strings = [rich_text(s) for s in ET.fromstring(before['xl/sharedStrings.xml']).findall(q('si'))]
                part = 'xl/worksheets/sheet1.xml'
                original_cells = {c.get('r'): c for c in ET.fromstring(before[part]).iter(q('c'))}
                self.assertEqual(value_of(original_cells['B3'], strings), '角色名')
                selected = [{"id": "real-label-regression", "version": version, "part": part,
                             "sheet": '背景' if version == '2014' else '起源', "cell": 'B3',
                             "source": '角色名', "target": 'Character name'}]
                output = Path(work) / 'partial.xlsx'
                report = patch_package(source, output, selected, source_hash)
                self.assertEqual(len(report['changes']), 1)
                self.assertFalse(report['release_ready'])
                with zipfile.ZipFile(output) as z:
                    after = {p: z.read(p) for p in z.namelist()}
                self.assertEqual(set(before), set(after))
                self.assertEqual([p for p in before if before[p] != after[p]],
                                 [p for p in before if p in {part, 'xl/sharedStrings.xml'}])
                new_strings = [rich_text(s) for s in ET.fromstring(after['xl/sharedStrings.xml']).findall(q('si'))]
                self.assertEqual(new_strings[:-1], strings)
                candidate_cells = {c.get('r'): c for c in ET.fromstring(after[part]).iter(q('c'))}
                for ref, cell in original_cells.items():
                    if ref != 'B3':
                        self.assertEqual(ET.tostring(cell), ET.tostring(candidate_cells[ref]), ref)
                self.assertEqual(value_of(candidate_cells['B3'], new_strings), 'Character name')
                self.assertEqual(digest(source.read_bytes()), source_hash)
                with self.assertRaisesRegex(ValueError, 'changed after planning'):
                    patch_package(source, Path(work) / 'bad-hash.xlsx', selected, 'wrong')
                changed_source = [{**selected[0], 'source': 'incorrect source'}]
                with self.assertRaisesRegex(ValueError, 'matches its review'):
                    patch_package(source, Path(work) / 'bad-source.xlsx', changed_source, source_hash)
                self.assertFalse((Path(work) / 'bad-source.xlsx').exists())

    def test_rich_emphasis_is_not_silently_flattened(self):
        rich = '<si><r><rPr><b/></rPr><t>名称</t></r><r><t>正文</t></r></si>'.encode('utf-8')
        with self.assertRaisesRegex(ValueError, 'run-level translation'):
            translated_string(rich, '名称正文', 'Name and full description')


if __name__ == '__main__':
    unittest.main(verbosity=2)
