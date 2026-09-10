"""Meaningful read-only original-workbook checks plus negative/mutation cases."""
import copy
import json
import unittest

from prepare import HERE, ROOT, TEMPLATES, apply_reviewed, create_outputs, digest, literal_tokens, validate_catalog
from verify_candidate import compare


class LocalizationPreparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.glossary = json.loads((HERE / "glossary.json").read_text(encoding="utf-8"))
        cls.before_hashes = {v: digest((ROOT / "public" / f).read_bytes()) for v, f in TEMPLATES.items()}
        outputs = create_outputs()
        cls.structures = json.loads(outputs["structure.json"])
        cls.rows = [json.loads(r) for r in outputs["catalog.jsonl"].splitlines()]
        cls.coverage = json.loads(outputs["coverage.json"])
        for name, text in outputs.items():
            assert (HERE / name).read_bytes() == text.encode("utf-8"), "Inventory drift: " + name

    def test_original_workbooks_byte_unchanged(self):
        self.assertEqual(self.before_hashes, {v: digest((ROOT / "public" / f).read_bytes()) for v, f in TEMPLATES.items()})

    def test_independent_cell_inventory_reconciles(self):
        self.assertEqual(self.coverage["cell_only_combined_unique_texts"], 12632)
        self.assertEqual(self.coverage["cell_only_combined_unique_characters"], 1096926)
        self.assertEqual([(len(s["sheets"]), s["formula_count"], len(s["validations"])) for s in self.structures], [(17, 5538, 122), (18, 7160, 197)])

    def test_real_same_name_different_rules_do_not_merge(self):
        acids = [r for r in self.rows if r["sheet"] == "法术大全" and r["source"] == "酸液飞溅" and r["method"] == "existing_english_column"]
        self.assertEqual({r["version"] for r in acids}, {"2014", "2024"})
        self.assertEqual(len({r["id"] for r in acids}), len(acids))
        self.assertTrue(all(r["target"] == "Acid Splash" and r["evidence"]["cell"] == "N3" for r in acids))
        self.assertTrue(all("book:" in r["context"] for r in acids))
        # Same spell name does not cause the genuinely different 2014 and 2024
        # Acid Splash effect texts to be replaced by its English name.
        bodies = [r for r in self.rows if r["sheet"] == "法术大全" and r["context"].startswith("column:M;spell:Acid Splash;")]
        self.assertEqual(len(bodies), 2)
        self.assertNotEqual(bodies[0]["source"], bodies[1]["source"])
        self.assertTrue(all(r["target"] is None or (r["status"] == "reviewed" and r["target"] != "Acid Splash") for r in bodies))

    def test_versions_have_distinct_race_species_and_sheet_seeds(self):
        sheets = [r for r in self.rows if r["kind"] == "sheet_name" and r["source"] == "种族"]
        self.assertEqual({r["version"]: r["target"] for r in sheets}, {"2014": "Races", "2024": "Species"})
        backgrounds = [r for r in self.rows if r["kind"] == "sheet_name" and r["source"] == "背景"]
        self.assertEqual({r["version"]: r["target"] for r in backgrounds}, {"2014": "Background", "2024": "Background Data"})

    def test_hidden_and_noncell_content_not_omitted(self):
        self.assertTrue(any(r["sheet"] == "职业" and len(r["source"]) > 100 and r["status"] == "missing" for r in self.rows))
        self.assertTrue({"comment", "formula_literal", "validation_literal", "validation_message", "conditional_literal", "defined_name", "format_literal"}.issubset({r["kind"] for r in self.rows}))
        long_rows = [r for r in self.rows if len(r["source"]) > 100]
        self.assertTrue(all(r["target"] is None or r["status"] == "reviewed" for r in long_rows))

    def test_escaped_excel_literals_not_split_into_machine_keys(self):
        self.assertEqual(literal_tokens('IF(A1="是","{""schema"":""obr-suite-card/v1""}","否")'), ["是", '{"schema":"obr-suite-card/v1"}', "否"])

    def test_2014_static_baseline_passes_without_release_claim(self):
        result = compare(self.structures[0], self.structures[0])
        self.assertEqual(result["errors"], [])
        self.assertFalse(result["release_ready"])

    def test_2024_original_av1_limit_is_reported_not_hidden(self):
        result = compare(self.structures[1], self.structures[1])
        self.assertFalse(result["static_checks_pass"])
        self.assertEqual(len(result["errors"]), 1)
        self.assertIn("8663", result["errors"][0])

    def test_chinese_original_cannot_pass_full_english_gate(self):
        result = compare(self.structures[0], self.structures[0], require_english=True, candidate_records=[r for r in self.rows if r["version"] == "2014"])
        self.assertTrue(any("Chinese text remains" in e for e in result["errors"]))

    def test_catalog_identity_and_prose_mutations_are_rejected(self):
        seeded = next(r for r in self.rows if r["method"] == "existing_english_column")
        mutations = {
            "version erased": lambda r: r.update(version="other"),
            "fake completed missing text": lambda r: r.update(target=None),
            "Chinese target disguised as English": lambda r: r.update(target="还是中文"),
            "wrong column reuse": lambda r: r["occurrences"][0].update(location="M3"),
            "same name replaces long prose": lambda r: r.update(source="长段正文。" * 40),
        }
        for defect, mutate in mutations.items():
            with self.subTest(defect=defect):
                candidate = copy.deepcopy(seeded)
                mutate(candidate)
                with self.assertRaises(AssertionError):
                    validate_catalog([candidate])

    def test_candidate_lost_formulas_dropdowns_and_schema_mutations_are_rejected(self):
        mutations = {
            "formula removed": lambda s: s["formulas"].pop(),
            "formula quietly altered": lambda s: s["formulas"][0].update(formula="0"),
            "dropdown removed": lambda s: s["validations"].pop(),
            "rule version changed": lambda s: s["av1"].update(ruleset="5E2024"),
            "machine schema translated": lambda s: s["av1"].update(schema="English Character Card"),
            "cache discarded": lambda s: s["av1"].update(cache_characters=0),
            "layout changed": lambda s: s["sheets"][0].update(geometry_sha256="different"),
            "author workbook reconnected": lambda s: s["external_relationships"][0].update(target="https://unapproved.invalid/book.xlsx"),
        }
        for defect, mutate in mutations.items():
            with self.subTest(defect=defect):
                candidate = copy.deepcopy(self.structures[0])
                mutate(candidate)
                self.assertFalse(compare(self.structures[0], candidate)["static_checks_pass"])

    def test_approvals_bind_exact_before_and_after_not_blanket_cell_permission(self):
        candidate = copy.deepcopy(self.structures[0])
        formula = candidate["formulas"][0]
        old = formula["formula"]
        formula["formula"] = '"English label"'
        key = f"formula:{formula['sheet']}!{formula['cell']}"
        approval = {"changes": {key: {"before": digest(old), "after": digest(formula["formula"])}}}
        self.assertTrue(compare(self.structures[0], candidate, approval)["static_checks_pass"])
        formula["formula"] = "0"
        self.assertFalse(compare(self.structures[0], candidate, approval)["static_checks_pass"])

    def test_review_merge_keeps_version_and_source_fingerprint(self):
        row = copy.deepcopy(next(r for r in self.rows if r["status"] == "missing" and len(r["source"]) > 100))
        review = {"id": row["id"], "version": row["version"], "source_sha256": digest(row["source"]), "target": "Test-only reviewed translation.", "reviewed_by": "fixture", "note": "Synthetic merge contract; never written to catalog.", "dependency_review": "pending", "application_approved": False}
        apply_reviewed([row], [review])
        validate_catalog([row])
        self.assertEqual(row["status"], "reviewed")
        for key, bad in [("version", "other"), ("source_sha256", "stale")]:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                apply_reviewed([row], [{**review, key: bad}])

    def test_real_reviews_keep_dependencies_pending_on_ui_and_tabs(self):
        reviewed = [r for r in self.rows if r["status"] == "reviewed"]
        self.assertTrue(reviewed)
        self.assertTrue({"sheet_name", "cell_text"}.issubset({r["kind"] for r in reviewed}))
        for row in reviewed:
            self.assertTrue(row["requires_dependency_review"])
            self.assertEqual(row["dependency_review"], "pending")
            self.assertFalse(row["application_approved"])
            self.assertEqual(row["review"]["dependency_review"], "pending")
            self.assertEqual(row["review"]["source_sha256"], digest(row["source"]))
            self.assertEqual(row["review"]["context"], row["context"])
            self.assertEqual(row["review"]["locations"], [o["location"] for o in row["occurrences"]])
            self.assertEqual(row["review"]["workbook_sha256"], next(s["sha256"] for s in self.structures if s["version"] == row["version"]))

    def test_review_cannot_be_repurposed_as_a_template_write_approval(self):
        row = copy.deepcopy(next(r for r in self.rows if r["status"] == "reviewed" and r["kind"] == "cell_text"))
        for key, bad in [("dependency_review", "complete"), ("application_approved", True), ("sheet", "different-sheet")]:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                apply_reviewed([row], [{**row["review"], key: bad}])
        for change in [{"requires_dependency_review": False}, {"dependency_review": "complete"}, {"application_approved": True}]:
            with self.subTest(change=change), self.assertRaises(AssertionError):
                validate_catalog([{**row, **change}])

    def test_ambiguous_feat_is_withheld_while_located_ui_stays_translated(self):
        feat = next(r for r in self.rows if r["version"] == "2014" and r["sheet"] == "职业" and r["source"] == "熟练" and r["kind"] == "cell_text")
        self.assertEqual([o["location"] for o in feat["occurrences"]], ["A257"])
        self.assertTrue(feat["target"] is None or (feat["status"] == "reviewed" and feat["target"] != "Proficiency"))
        for version in ("2014", "2024"):
            label = next(r for r in self.rows if r["version"] == version and r["sheet"] == "主要" and r["source"] == "熟练" and r["context"] == "column:B")
            self.assertEqual(label["target"], "Proficiency")
            self.assertEqual(label["status"], "reviewed")
        # The original labels batch must not silently approve unrelated names
        # or prose. Explicit, separate translation batches may now fill them.
        basic = [r for r in self.rows if r.get("review", {}).get("batch") == "basic-labels-20260908"]
        self.assertTrue(all(len(r["source"]) <= 100 for r in basic))

    def test_main_skill_alias_reviews_match_exact_skill_rows(self):
        for version, expected in [("2014", {"C43": "Acrobatics", "C55": "Animal Handling", "C56": "Medicine", "C57": "Survival"}), ("2024", {"C43": "Acrobatics", "C56": "Medicine"})]:
            for cell, target in expected.items():
                row = next(r for r in self.rows if r["version"] == version and r["sheet"] == "主要" and r["kind"] == "cell_text" and any(o["location"] == cell for o in r["occurrences"]))
                self.assertEqual(row["target"], target)
                self.assertEqual(row["status"], "reviewed")
                self.assertTrue(row["requires_dependency_review"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
