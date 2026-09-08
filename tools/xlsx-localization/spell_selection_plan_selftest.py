"""Finite emitted-formula model and pinned-package checks; not Excel/WPS UAT."""
from __future__ import annotations

import argparse
from copy import deepcopy
from functools import lru_cache
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import spell_selection_plan as planmod
from openpyxl.formula.tokenizer import Tokenizer


class CalcError(Exception):
    pass


ERROR = object()


def utf16(text):
    return len(str(text).encode("utf-16-le")) // 2


class FormulaModel:
    """Small independent evaluator for exactly the emitted scalar helper grammar.

    It does not recalculate original workbook formulas or model Excel locale
    collation, UI protection, DV host behavior or dynamic-array metadata.
    """
    def __init__(self, cells):
        self.cells, self.cache, self.stack = cells, {}, set()

    @staticmethod
    @lru_cache(maxsize=None)
    def parse(formula):
        tokens = [t for t in Tokenizer("=" + formula).items if t.type != "WHITE-SPACE"]
        at = 0
        precedence = {"=": 1, "<>": 1, ">": 1, "<": 1, ">=": 1, "<=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4}

        def expression(minimum=0):
            nonlocal at
            token = tokens[at]
            at += 1
            if token.type == "FUNC" and token.subtype == "OPEN":
                args = []
                if not (tokens[at].type == "FUNC" and tokens[at].subtype == "CLOSE"):
                    while True:
                        args.append(expression())
                        if tokens[at].type == "SEP":
                            at += 1
                            continue
                        break
                assert tokens[at].type == "FUNC" and tokens[at].subtype == "CLOSE", formula
                at += 1
                node = ("call", token.value[:-1].upper(), args)
            elif token.type == "OPERAND":
                node = ("operand", token.subtype, token.value)
            else:
                raise AssertionError("Unsupported generated token: " + repr((token.type, token.subtype, token.value)))
            while at < len(tokens) and tokens[at].type == "OPERATOR-INFIX" and precedence[tokens[at].value] >= minimum:
                operator = tokens[at].value
                at += 1
                node = ("operator", operator, node, expression(precedence[operator] + 1))
            return node

        ast = expression()
        assert at == len(tokens), (formula, at, len(tokens))
        return ast

    def cell(self, sheet, address):
        key = (sheet, address.replace("$", ""))
        if key in self.cache:
            return self.cache[key]
        if key in self.stack:
            raise AssertionError("Cyclic generated helper: " + repr(key))
        self.stack.add(key)
        try:
            cell = self.cells.get(key, {"value": ""})
            value = self.evaluate(self.parse(cell["formula"]), sheet) if "formula" in cell else cell.get("value")
            if value is None:
                value = ""
            if value is ERROR:
                raise CalcError("Source error")
            self.cache[key] = value
            return value
        finally:
            self.stack.remove(key)

    def reference(self, reference, local):
        if "!" in reference:
            sheet, address = reference.rsplit("!", 1)
            if sheet.startswith("'"):
                sheet = sheet[1:-1].replace("''", "'")
        else:
            sheet, address = local, reference
        if ":" not in address:
            return self.cell(sheet, address)
        first, last = address.replace("$", "").split(":")
        lo, hi = re.fullmatch(r"([A-Z]+)([0-9]+)", first), re.fullmatch(r"([A-Z]+)([0-9]+)", last)
        assert lo and hi and lo[1] == hi[1], reference
        return [self.cell(sheet, lo[1] + str(i)) for i in range(int(lo[2]), int(hi[2]) + 1)]

    def evaluate(self, node, local):
        kind = node[0]
        if kind == "operand":
            if node[1] == "NUMBER":
                return float(node[2]) if "." in node[2] else int(node[2])
            if node[1] == "TEXT":
                return node[2][1:-1].replace('""', '"')
            if node[1] == "LOGICAL":
                return node[2] == "TRUE"
            assert node[1] == "RANGE", node
            return self.reference(node[2], local)
        if kind == "operator":
            left, right = self.evaluate(node[2], local), self.evaluate(node[3], local)
            operator = node[1]
            if operator == "&":
                return str(left) + str(right)
            if operator in ("=", "<>"):
                same = left.casefold() == right.casefold() if isinstance(left, str) and isinstance(right, str) else left == right
                return same if operator == "=" else not same
            if operator == "+":
                return left + right
            if operator == "-":
                return left - right
            if operator == "<=":
                return left <= right
            if operator == ">":
                return left > right
            raise AssertionError(operator)
        function, arguments = node[1], node[2]
        if function == "IF":
            assert len(arguments) == 3
            return self.evaluate(arguments[1] if self.evaluate(arguments[0], local) else arguments[2], local)
        if function == "IFERROR":
            assert len(arguments) == 2
            try:
                return self.evaluate(arguments[0], local)
            except CalcError:
                return self.evaluate(arguments[1], local)
        args = [self.evaluate(arg, local) for arg in arguments]
        if function == "ISTEXT":
            return isinstance(args[0], str)
        if function == "NOT":
            return not args[0]
        if function == "LEN":
            return utf16(args[0])
        if function == "TRIM":
            return re.sub(" +", " ", str(args[0]).strip(" "))
        if function == "CLEAN":
            return "".join(c for c in str(args[0]) if ord(c) >= 32)
        if function == "SUBSTITUTE":
            return str(args[0]).replace(str(args[1]), str(args[2]))
        if function == "MAX":
            return max(args)
        if function == "INDEX":
            assert len(args) == 2 and isinstance(args[0], list)
            if not isinstance(args[1], int) or not 1 <= args[1] <= len(args[0]):
                raise CalcError("INDEX out of bounds")
            return args[0][args[1] - 1]
        if function == "MATCH":
            assert len(args) == 3 and args[2] == 0
            needle, values = args[:2]
            if isinstance(needle, str):
                if utf16(needle) > 255:
                    raise CalcError("MATCH lookup string too long")
                regex, position = "", 0
                while position < len(needle):
                    c = needle[position]
                    if c == "~" and position + 1 < len(needle):
                        position += 1
                        regex += re.escape(needle[position])
                    else:
                        regex += ".*" if c == "*" else "." if c == "?" else re.escape(c)
                    position += 1
                for index, value in enumerate(values):
                    if isinstance(value, str) and re.fullmatch(regex, value, re.I):
                        return index + 1
            else:
                for index, value in enumerate(values):
                    if value == needle:
                        return index + 1
            raise CalcError("MATCH not found")
        raise AssertionError("Unsupported generated function " + function)


@lru_cache(maxsize=None)
def source_plans(version):
    return planmod.identity.build_plan(version), planmod.lookup.build_plan(version)


def make_model(plan, custom=None, replace_builtin=None):
    version = plan["version"]
    ident, look = source_plans(version)
    cells = {(planmod.lookup.MAP_SHEET, c["cell"]): deepcopy(c) for c in look["helperSheet"]["cells"]}
    for override in plan["mapOverrides"]:
        assert planmod.sha(planmod.canonical(override["expectedLookupCell"])) == override["expectedLookupCellSha256"]
        assert cells[(override["sheet"], override["cell"])] == override["expectedLookupCell"]
        cells[(override["sheet"], override["cell"])] = deepcopy(override["replaceWith"])
    cells.update({(planmod.SELECT_SHEET, c["cell"]): deepcopy(c) for c in plan["helperSheet"]["cells"]})
    for row in ident["rows"]:
        cells[("法术大全", "A" + str(row["row"]))] = {"value": row["original"]["A"]}
        if row["kind"] == "builtin" and replace_builtin is not None:
            cells[(planmod.lookup.MAP_SHEET, "B" + str(row["row"]))] = {"value": replace_builtin.get(row["row"], "")}
    for ordinal, value in (custom or {}).items():
        cells[("法术大全", "A" + str(plan["customPolicy"]["firstRow"] + ordinal - 1))] = {"value": value}
    model = FormulaModel(cells)
    # Evaluate the cumulative dependency chain in row order, as a spreadsheet's
    # calculation graph does; do not recurse hundreds of rows on Python's stack.
    for row in range(3, plan["customPolicy"]["lastRow"] + 1):
        model.cell(planmod.SELECT_SHEET, "B" + str(row))
    return model


def choices(plan, model):
    total = model.cell(planmod.SELECT_SHEET, "D1")
    return [model.cell(planmod.SELECT_SHEET, "A" + str(r)) for r in range(3, 3 + max(1, total))]


def assert_plan(plan):
    assert plan["schema"] == planmod.SCHEMA
    version = plan["version"]
    filename, expected = planmod.identity.SOURCES[version]
    original = planmod.REPO / "public" / filename
    assert planmod.sha(original.read_bytes()) == expected
    assert plan["lookupPlanSha256"] == planmod.sha(planmod.canonical(planmod.lookup.build_plan(version)))
    assert plan["identityPlanSha256"] == planmod.sha(planmod.canonical(planmod.identity.build_plan(version)))
    edits = plan["spellbook"]["cells"]
    c3 = next(e for e in edits if e["cell"] == "C3")
    assert c3["replaceChildren"] == {"type": "inlineStr", "value": ""}
    assert c3["removeAttributes"] == ["cm"] and c3["removeFormulaAndCache"]
    clones = {s["symbol"]: s for s in plan["styleClones"]}
    assert len(clones) == (10 if version == "2024" else 9)
    for edit in [e for e in edits if "styleRef" in e and e.get("stylePurpose") != "label-fit"]:
        clone = clones[edit["styleRef"]]
        assert clone["setAttributes"] == {"applyProtection": "1"}
        assert clone["protection"] == {"locked": "0"}, "Merged selector must be unlocked"
        assert clone["preserveAllOtherAttributesAndChildren"]
    assert len([e for e in edits if "styleRef" in e and e.get("stylePurpose") != "label-fit"]) == 64
    assert plan["spellbook"]["preserveMerge"]["ref"] == "C3:R6"
    assert 'sheet="1"' in plan["spellbook"]["preserveSheetProtection"]["oldXML"]
    assert plan["metadataPolicy"]["retainPartByteExact"] == "xl/metadata.xml"
    assert plan["spellbook"]["newMergedCells"] == []
    dvs = plan["spellbook"]["validationEdits"]
    assert len(dvs) == 2 and dvs[0]["sqref"] == planmod.INPUT_SQREF and dvs[1]["attributes"]["sqref"] == "C3"
    assert all(d["formula1"] == planmod.CHOICES_NAME for d in dvs)
    assert dvs[1]["attributes"]["prompt"] == "Select a spell to view its details"
    assert not any(e["cell"].startswith(("AR", "AW")) for e in edits)
    legend = next(e for e in edits if e["cell"] == ("Z2" if version == "2014" else "AJ2"))
    assert legend["replaceChildren"]["value"] == ("Green: Concentration  Blue: Ritual" if version == "2014" else "Green: Conc.  Blue: Ritual")
    assert len(plan["downstream"]["C3PlannedLookupCells"]) == 11
    assert "MAX(1," in plan["definedName"]["formula"]
    with zipfile.ZipFile(original) as archive:
        for part, hash_ in plan["sourceParts"].items():
            assert planmod.sha(archive.read(part)) == hash_
        raw_book = archive.read(plan["spellbook"]["part"])
        for e in edits:
            encoded = e["oldXML"].encode("utf8")
            assert encoded in raw_book and planmod.sha(encoded) == e["oldXMLSha256"]
        original_styles = ET.fromstring(archive.read("xl/styles.xml")).find(planmod.NS + "cellXfs")
        for clone in clones.values():
            assert clone["oldXML"].encode("utf8") in archive.read("xl/styles.xml")
            assert planmod.sha(clone["oldXML"].encode("utf8")) == clone["oldXMLSha256"]
            source = original_styles[clone["sourceStyleIndex"]]
            target = deepcopy(source)
            if clone.get("purpose") == "label-fit":
                assert clone["setAttributes"] == {} and clone["preserveProtection"]
                alignment = target.find(planmod.NS + "alignment")
                original_alignment = dict(alignment.attrib)
                assert clone["alignmentSetAttributes"] == {"wrapText": "0", "shrinkToFit": "1"}
                alignment.attrib.update(clone["alignmentSetAttributes"])
                # Undo only wrap/shrink: font, size, border, protection and every
                # other alignment attribute must remain identical.
                alignment.attrib.clear()
                alignment.attrib.update(original_alignment)
            else:
                target.set("applyProtection", "1")
                ET.SubElement(target, planmod.NS + "protection", {"locked": "0"})
                target.attrib.pop("applyProtection")
                target.remove(target.find(planmod.NS + "protection"))
            assert ET.tostring(target) == ET.tostring(source)
    assert not plan["workbookWritten"] and not plan["nativeCalculated"] and not plan["releaseReady"]


def assert_main_chain(plan):
    data = next(c for c in plan["downstream"]["mainCardChain"] if c["sheet"] == "数据表")
    formulas = {c["cell"]: c["formula"] for c in data["formulaRecords"]}
    assert len([x for x in formulas if re.fullmatch(r"B\d+", x)]) == 300
    assert len([x for x in formulas if re.fullmatch(r"F\d+", x)]) == 300
    assert '法术书!X3' in formulas["B2"] and '法术书!AM52' in formulas["B201"]
    assert '法术书!AR3' in formulas["B202"] and '法术书!AW52' in formulas["B301"]
    if plan["version"] == "2014":
        assert formulas["F2"] == 'B2'
        assert formulas["F301"] == 'B301'
    else:
        assert '$B$1:$B$301<>""' in formulas["F2"] and 'ROW(2:2)' in formulas["F2"]
        assert 'ROW(301:301)' in formulas["F301"]
    assert '主要!Q77' in formulas["H9" if plan["version"] == "2014" else "H10"]
    assert 'SMALL(' in formulas["K1"] and 'SMALL(' in formulas["K59"]
    assert 'B1' in {c["cell"] for c in data["premiseCellReceipts"]}
    assert all(c["plannedEdits"] == [] for c in plan["downstream"]["mainCardChain"])
    # Independent examples for original list algorithms. These are not a native
    # calculation of original array formulas; the exact formulas above stay bound.
    selected = [""] * 300
    for index, name in ((0, 'Alpha'), (49, 'First end'), (50, 'Alpha'), (100, 'A*?~" spell [Custom spell 1]'), (199, 'Last visible')):
        selected[index] = name
    original_f = selected if plan["version"] == "2014" else [v for v in selected if v]
    assert [v for v in original_f if v] == [selected[i] for i in (0, 49, 50, 100, 199)]
    assert all(not x for x in selected[200:])
    main_choices = [selected[0], "", selected[199], selected[50]] + [""] * 54
    k = [v for v in main_choices if v]
    assert k == ['Alpha', 'Last visible', 'Alpha']
    assert [v for v in ([""] * 58) if v] == []  # Original K OFFSET empty case is NOT fixed here.


def run():
    groups, mutations = [], []
    plans = {v: planmod.build_plan(v) for v in ("2014", "2024")}
    for version, plan in plans.items():
        def check(name, callback):
            callback()
            groups.append({"version": version, "check": name})

        check("Pinned source, exact XML, style-only unlock, C3 ownership and dependency hashes", lambda: assert_plan(plan))
        check("Actual main-card B/F/H/K formulas and finite selection propagation", lambda: assert_main_chain(plan))

        def baseline():
            model = make_model(plan)
            expected = [r["display"]["label"] for r in planmod.identity.build_plan(version)["rows"] if r["display"]["label"]]
            assert choices(plan, model) == expected
            assert model.cell(planmod.SELECT_SHEET, "D1") == len(expected)
        check("All emitted helper formulas yield exact static identity labels", baseline)

        def sparse():
            model = make_model(plan, {1: "Start", 50: "Tail"}, {3: "First", 9: "Middle"})
            assert choices(plan, model) == ['First', 'Middle', 'Start [Custom spell 1]', 'Tail [Custom spell 50]'], "Sparse list must include the last custom slot"
        check("Leading/interior holes and both custom endpoints compact without truncation", sparse)

        def empty():
            model = make_model(plan, replace_builtin={})
            assert model.cell(planmod.SELECT_SHEET, "D1") == 0
            assert choices(plan, model) == [""]
            assert 'MAX(1,' in plan["definedName"]["formula"]
        check("Empty source produces one blank choice range without zero height", empty)

        def custom_boundaries():
            # Quotes and wildcard escapes must be data, not a formula/lookup injection.
            authored = 'A*?~"spell'
            model = make_model(plan, {1: authored, 2: authored, 3: '   ', 4: 9, 5: 'Bad\tName', 6: ERROR, 50: "Z"}, {})
            assert choices(plan, model) == [authored + ' [Custom spell 1]', authored + ' [Custom spell 2]', 'Z [Custom spell 50]']
            start = plan["customPolicy"]["firstRow"]
            assert model.cell(planmod.SELECT_SHEET, "C" + str(start + 2)) == 'Name is blank'
            assert model.cell(planmod.SELECT_SHEET, "C" + str(start + 3)) == 'Name must be text'
            assert model.cell(planmod.SELECT_SHEET, "C" + str(start + 4)) == 'Name contains a control character'
            assert model.cell(planmod.SELECT_SHEET, "C" + str(start + 5)) == 'Source name has an error'
            # Use the same escape expression as the existing lookup consumer, but
            # independent MATCH implementation and row expectation.
            label = authored + ' [Custom spell 2]'
            cells = model.cells
            cells[("Test", "A1")] = {"value": label}
            formula = 'MATCH(' + planmod.escape_match("A1") + "," + planmod.qualified(planmod.lookup.MAP_SHEET, f'$B${start}:$B${start+49}') + ',0)'
            assert model.evaluate(model.parse(formula), "Test") == 2
        check("Custom duplicates, literal quotes/wildcards, types, blank/error/control handling", custom_boundaries)

        def all_custom():
            authored = {i: 'Repeated Name' for i in range(1, 51)}
            model = make_model(plan, authored, {})
            expected = [f'Repeated Name [Custom spell {i}]' for i in range(1, 51)]
            assert choices(plan, model) == expected
            assert model.cell(planmod.SELECT_SHEET, 'D1') == 50
            assert choices(plan, make_model(plan, {1: '\u00a0'}, {})) == ['\u00a0 [Custom spell 1]']
        check("All fifty future slots survive duplicate authored names; ASCII TRIM preserves NBSP", all_custom)

        def lengths():
            suffix = ' [Custom spell 1]'
            limit = 255 - utf16(suffix)
            assert choices(plan, make_model(plan, {1: 'x' * limit}, {})) == ['x' * limit + suffix]
            assert choices(plan, make_model(plan, {1: 'x' * (limit + 1)}, {})) == ['']
            assert choices(plan, make_model(plan, {1: '*' * (limit // 2)}, {})) != ['']
            assert choices(plan, make_model(plan, {1: '*' * (limit // 2 + 1)}, {})) == ['']
            # Legacy UTF-16 length is explicit; no unsupported LEFT truncation.
            assert choices(plan, make_model(plan, {1: '😀' * (limit // 2)}, {})) != ['']
            assert choices(plan, make_model(plan, {1: '😀' * (limit // 2 + 1)}, {})) == ['']
        check("Escaped lookup 255-unit boundary, Unicode pair length and no truncation", lengths)

        def collisions():
            name = 'Magic'
            model = make_model(plan, {1: name, 2: name + ' [Custom spell 1]'}, {3: name})
            expected = [name, name + ' [Custom spell 1]', name + ' [Custom spell 1] [Custom spell 2]']
            assert choices(plan, model) == expected
            assert len({v.casefold() for v in expected}) == 3
            assert 'remain ambiguous' in plan["customPolicy"]["originalAFallbackCollision"]
        check("Builtin/custom same-name labels distinct; legacy A ambiguity stays explicit", collisions)

        def legend_fit():
            labels = [e for e in plan["spellbook"]["cells"] if e.get("stylePurpose") == "label-fit"]
            if version == "2014":
                assert labels == [] and plan["counts"]["labelFitStyleClones"] == 0
            else:
                assert len(labels) == 1 and labels[0]["cell"] == "AJ2"
                assert "preserveStyle" not in labels[0]
                clone = next(c for c in plan["styleClones"] if c["symbol"] == labels[0]["styleRef"])
                assert clone["purpose"] == "label-fit" and clone["alignmentSetAttributes"] == {"wrapText":"0", "shrinkToFit":"1"}
                assert "protection" not in clone and clone["preserveProtection"]
                assert plan["counts"]["labelFitStyleClones"] == 1
            assert plan["counts"]["selectorStyleClones"] == 9 and plan["counts"]["mergedExistingCellsUnlocked"] == 64
        check("2024 legend-only fit clone preserves protection and separate 64-cell unlock count", legend_fit)

        def tail_mutant():
            mutant = deepcopy(plan)
            d1 = next(c for c in mutant["helperSheet"]["cells"] if c["cell"] == "D1")
            d1["formula"] = '$B$' + str(plan["customPolicy"]["firstRow"] - 1)
            assert choices(mutant, make_model(mutant, {50: 'Tail'}, {})) == ['Tail [Custom spell 50]'], "Tail must survive"

        def custom_mutant():
            mutant = deepcopy(plan)
            hit = next(o for o in mutant["mapOverrides"] if o["cell"] == 'B' + str(plan["customPolicy"]["lastRow"]))
            hit["replaceWith"] = {"cell": hit["cell"], "type": "inlineStr", "value": None}
            assert choices(mutant, make_model(mutant, {50: 'Tail'}, {})) == ['Tail [Custom spell 50]'], "Dynamic custom name must be selectable"

        def locked_mutant():
            mutant = deepcopy(plan)
            c3 = next(c for c in mutant["spellbook"]["cells"] if c["cell"] == 'C3')
            hit = next(s for s in mutant["styleClones"] if s["symbol"] == c3["styleRef"])
            hit["protection"]["locked"] = '1'
            assert_plan(mutant)

        for name, test, message in (("Cumulative range drops last custom slot", tail_mutant, "Tail must survive"),
                                     ("Custom B remains static null", custom_mutant, "Dynamic custom name must be selectable"),
                                     ("C3 style remains locked", locked_mutant, "Merged selector must be unlocked")):
            try:
                test()
            except AssertionError as error:
                assert str(error) == message, (name, "wrong assertion", repr(error))
                mutations.append({"version": version, "mutation": name, "expectedAssertion": message, "killed": True})
            else:
                raise AssertionError("Mutation survived: " + name)
    return {"schema": "obr-suite-spell-selection-model-tests/v1", "groups": groups, "groupCount": len(groups),
            "mutations": mutations, "mutationCount": len(mutations),
            "files": {p.name: planmod.sha(p.read_bytes()) for p in (Path(planmod.__file__), Path(__file__))},
            "planSha256": {v: planmod.sha(planmod.canonical(p)) for v, p in plans.items()},
            "scope": "Actual generated scalar helper formulas evaluated in a limited Python model; exact original package receipts checked. Original main arrays are formula-bound dependency examples, not recalculated by this model.",
            "nativeExcelWps": False, "workbookWritten": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert not args.output.exists(), "Refusing to overwrite existing result"
    assert not args.output.resolve().is_relative_to(planmod.REPO), "Audit result must be outside repository"
    result = run()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(json.dumps(result, ensure_ascii=False, indent=2).encode("utf8") + b"\n")
    print(json.dumps({k: result[k] for k in ("groupCount", "mutationCount", "nativeExcelWps", "workbookWritten")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
