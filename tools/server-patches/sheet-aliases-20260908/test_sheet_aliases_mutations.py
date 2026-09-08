"""Five in-memory mutations; never rewrite the production parser.

Run: python -B -X utf8 -W ignore::DeprecationWarning test_sheet_aliases_mutations.py
Only assertion failures kill a mutant. Bad anchors, syntax errors or unrelated
exceptions fail this runner and are not reported as successful detections.
"""
from pathlib import Path
import json
from types import ModuleType
from unittest.mock import patch

import test_sheet_aliases as checks


MUTATIONS = [
    (
        "English spell database is routed back to the Chinese title",
        '    layout["sheets"] = {**base["sheets"], **{role: name for role, name in resolved.items() if name is not None}}',
        '    layout["sheets"] = {**base["sheets"], **{role: name for role, name in resolved.items() if name is not None}}\n    layout["sheets"]["spell_db"] = "法术大全"',
        "test_every_reviewed_english_sheet_name_preserves_full_result_and_spell_database",
    ),
    (
        "Duplicate semantic aliases select the first worksheet",
        "    if len(found) > 1:",
        "    if False:",
        "test_same_role_bilingual_duplicates_are_rejected",
    ),
    (
        "Missing published inventory sheet silently loses its contents",
        '        required.update(("equipment", "data", "areas", "export", "inventory", "background_db"))',
        '        required.update(("equipment", "data", "areas", "export", "background_db"))',
        "test_published_card_missing_critical_sheet_is_rejected",
    ),
    (
        "Conflicting header and AV1 rulesets select an arbitrary version",
        "    if len(evidence) > 1:",
        "    if False:",
        "test_conflicting_or_unsupported_ruleset_markers_are_rejected",
    ),
    (
        "Per-import aliases mutate the shared layout template",
        "    layout = dict(base)",
        "    layout = base",
        "test_no_shared_layout_mutation_or_cross_import_alias_leak",
    ),
]


def main():
    path = Path(__file__).with_name("parser.py")
    source = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    records = []
    checks.SheetAliasTests.setUpClass()
    try:
        for label, before, after, test in MUTATIONS:
            case = checks.SheetAliasTests(test)
            getattr(case, test)()  # Require the real implementation to pass first.
            if source.count(before) != 1:
                raise AssertionError(f"Mutation anchor is not unique: {label}")
            module = ModuleType("alias_mutant")
            module.__file__ = str(path)
            exec(compile(source.replace(before, after, 1), str(path), "exec"), module.__dict__)
            try:
                with patch.object(checks, "parser", module):
                    getattr(checks.SheetAliasTests(test), test)()
            except AssertionError as error:
                records.append({"mutant": label, "test": test, "detected": True, "assertion": str(error)[:240]})
            else:
                raise AssertionError(f"Mutation survived: {label}")
    finally:
        checks.SheetAliasTests.tearDownClass()
    print(json.dumps({"mutations": records, "detected": len(records), "total": len(MUTATIONS)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
