"""Source/structure/finite-model checks, not native Excel evaluation."""
from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
import re
import sys
import tempfile

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import spell_lookup_plan as p


def main():
    p.BASE.mkdir(parents=True, exist_ok=True)
    destination = Path(tempfile.mkdtemp(prefix="selftest-", dir=p.BASE))
    checks = []

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    def reject(name, callback, message):
        try:
            callback()
        except p.identity.Rejected as error:
            check(name, message in str(error))
        else:
            raise AssertionError(name + ": accepted")

    sample = 'IFERROR( VLOOKUP( A1,\'法术大全\'!$A$3:$X$574,13,FALSE ),"VLOOKUP(a,b,c,d), text")'
    calls = p.lookup_calls(sample)
    check("literal function text is not a call; exact spaced spans", len(calls) == 1 and sample[calls[0]["start"]:calls[0]["end"]] == calls[0]["original"] and calls[0]["args"] == [" A1", "'法术大全'!$A$3:$X$574", "13", "FALSE "])
    nested = p.lookup_calls('VLOOKUP(IF(A1="a,b",B1,C1),法术大全!A:Z,13,FALSE)')
    check("nested arguments and quoted comma", nested[0]["args"][0] == 'IF(A1="a,b",B1,C1)')
    check("preserve multiple spaces", p.token_spans('IF(  A1,  "x", "y")')[-1][2] == len('IF(  A1,  "x", "y")'))
    reject("unsupported tab tokenization fails explicitly", lambda: p.token_spans('IF(A1,\t"x","y")'), "Unsupported formula tokenization")
    check("whole-column and finite table coordinates", p.dictionary_table("法术大全!$A:$W") == {"firstRow": 1, "lastRow": 1048576, "width": 23} and p.dictionary_table("'法术大全'!$A$3:$E$864") == {"firstRow": 3, "lastRow": 864, "width": 5})
    reject("mixed table bounds rejected", lambda: p.dictionary_table("法术大全!A3:Z"), "Mixed table")
    dictionary = {"firstRow": 3, "lastRow": 574}

    def record(formula):
        return {"formula": formula, "sheet": "主要", "id": "主要!P77"}

    for formula, message in [
        ("VLOOKUP(Q77,法术大全!A:Z,2,TRUE)", "exact VLOOKUP"),
        ("VLOOKUP(Q77,法术大全!A:Z,A1,FALSE)", "Nonconstant"),
        ("VLOOKUP(Q77,OFFSET(法术大全!A:Z,0,0),2,FALSE)", "Unsupported dictionary"),
    ]:
        reject(message, lambda f=formula: p.edit_formula(record(f), dictionary, {}), message)
    check("foreign table left untouched", p.edit_formula(record("VLOOKUP(Q77,Other!A:Z,2,FALSE)"), dictionary, {}) is None)
    deferred = p.edit_formula(record('VLOOKUP(INDIRECT(CELL("address")),法术大全!A:Z,2,FALSE)'), dictionary, {})
    check("active-cell reference explicitly deferred", deferred["status"] == "deferred" and deferred["candidateFormula"] is None)

    plans = {}
    finite = []
    for version in ("2014", "2024"):
        plan = p.build_plan(version)
        plans[version] = plan
        source = p.REPO / "public" / p.identity.SOURCES[version][0]
        actual = p.identity.build_plan(version, source)
        lookup = {r["id"]: r for r in plan["consumers"]}
        counters = plan["counts"]
        check(version + " source and actual formula inventory", counters == {
            "formulaCells": 5538 if version == "2014" else 7160,
            "sharedFormulaCells": 1258 if version == "2014" else 954,
            "consumers": 1003, "planned": 1002, "deferred": 1, "helpers": 619,
            "lookupCalls": 1096 if version == "2014" else 1102})
        check(version + " consumers by actual sheet", Counter(c["sheet"] for c in plan["consumers"]) == {"主要": 66, "数据表": 725, "法术书": 212})
        check(version + " only C3 is deferred", [c["id"] for c in plan["consumers"] if c["status"] == "deferred"] == ["法术书!C3"])
        check(version + " formula metadata retained", all("rawFormula" in c and "formulaAttributes" in c and "sharedOrigin" in c for c in plan["consumers"]))
        cells = {c["cell"]: c for c in plan["helperSheet"]["cells"]}
        check(version + " all identities labels and field hashes mapped by original row", all(
            cells['A'+str(r['row'])]['value'] == r['identity'] and
            cells['B'+str(r['row'])]['value'] == r['display']['label'] and
            cells['C'+str(r['row'])]['value'] == r['original']['A'] and
            cells['D'+str(r['row'])]['value'] == r['row'] and
            cells['E'+str(r['row'])]['value'] == r['fieldsSha256']
            for r in actual['rows']))
        check(version + " custom slots remain unlabeled and row aligned", sum(r["kind"] == "custom-slot" and cells['B'+str(r['row'])]['value'] is None for r in actual['rows']) == 50)
        helpers = {h["cell"]: h for h in plan["helperSheet"]["helpers"]}
        check(version + " helper inputs stay in their original sheet", all(p.quote_sheet(h["inputSheet"]) + "!" + h["inputCell"] in h["formula"] for h in helpers.values()))
        check(version + " helpers escape literal wildcard input and exclude blanks", all('"~","~~"' in h["formula"] and '"*","~*"' in h["formula"] and '"?","~?"' in h["formula"] and "ISTEXT(" in h["formula"] and ")>0" in h["formula"] for h in helpers.values()))
        references = Counter()
        for consumer in plan["consumers"]:
            if consumer["status"] == "deferred":
                continue
            candidate = consumer["candidateFormula"]
            source_formula = consumer["formula"]
            cursor = 0
            reconstructed = []
            for edit in consumer["edits"]:
                assert source_formula[edit["start"]:edit["end"]] == edit["original"]
                replacement_calls = p.token_spans(edit["replacement"])
                assert replacement_calls[0][0].value == "IF("
                # Original call spelling must survive exactly once in the replacement.
                assert edit["replacement"].count(edit["original"]) == 1
                assert edit["helperCell"] in helpers
                references[edit["helperCell"]] += 1
                reconstructed.extend((source_formula[cursor:edit["start"]], edit["replacement"]))
                cursor = edit["end"]
            reconstructed.append(source_formula[cursor:])
            assert "".join(reconstructed) == candidate
        check(version + " every planned call preserves its fallback and outside syntax", True)
        check(version + " helper reference counts close without dangling helpers", references == Counter({k: len(h["consumers"]) for k, h in helpers.items()}))
        check(version + " P77 repeated level and ritual lookup shares one helper", len(lookup["主要!P77"]["edits"]) == 2 and len({e["helperCell"] for e in lookup["主要!P77"]["edits"]}) == 1)
        check(version + " finite tables subtract original starting row", all(("-2," in e["replacement"]) == (e["table"]["firstRow"] == 3) for c in plan["consumers"] for e in c["edits"] if e["status"] == "planned"))
        check(version + " existing invalid column retained", [(c["id"], e["resultColumn"], e["table"]["width"]) for c in plan["consumers"] for e in c["edits"] if e.get("retainedSourceColumnError")] == ([("法术书!O8", 26, 24)] if version == "2014" else []))
        labels = {c["value"].casefold(): int(ref[1:]) for ref, c in cells.items() if ref.startswith("B") and c["value"]}
        check(version + " explicit incomplete package status", not plan["workbookWritten"] and not plan["nativeCalculated"] and not plan["releaseReady"] and len(plan["remaining"]) == 8)
        # Finite row/column model only. Formula execution is an independent gate.
        cases = [("Air Bubble", 211 if version == "2014" else 290), ("", 0), ("unknown spell", 0), ("*", 0), ("Air Bubble ", 0)]
        if version == "2024":
            cases += [("Holy Word", 73), ("Divine Word", 719), ("Sanctum of the Flock (Level 3)", 452), ("Sanctum of the Flock (Level 5)", 646), ("Sanctum of the Flock", 0)]
        for name, expected in cases:
            number = labels.get(name.casefold(), 0) if name else 0
            assert number == expected
            finite.append({"version": version, "input": name, "row": number})
        check(version + " finite English-label row model", True)
        check(version + " original fingerprint unchanged", p.sha(source.read_bytes()) == p.identity.SOURCES[version][1])
    output = {"checks": checks, "passed": len(checks), "failed": 0, "finiteRowModelCases": finite,
              "counts": {v: plan["counts"] for v, plan in plans.items()},
              "nativeFormulaEvaluation": False, "workbookWritten": False,
              "sourceTools": {n: p.sha((Path(__file__).parent/n).read_bytes().replace(b"\r\n", b"\n")) for n in ("spell_lookup_plan.py", "spell_lookup_plan_selftest.py", "spell_identity.py")}}
    (destination / "result.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"output": str(destination), "passed": len(checks), "failed": 0, "finiteRowModelCases": len(finite)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
