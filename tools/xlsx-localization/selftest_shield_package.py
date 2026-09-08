"""Self-contained, fresh-source audit tests. No historical audit file dependency."""
from copy import copy, deepcopy
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from unittest.mock import patch
import zipfile

import shield_package as s

p, g = s.p, s.g
p.BASE.mkdir(parents=True, exist_ok=True)
RUN = Path(tempfile.mkdtemp(prefix="shield-selftest-", dir=p.BASE))
RESULTS = []
FROZEN_OUTPUTS = {"2014": "9e0acea5dfc9566ccc07f25fdad0e80b3d985069a1dbd8fe1062134fbad9f9b7",
                  "2024": "5b119fbdf295225b7c9207858f3eea5076d3c6180c7a43b8f9e83f82eb652255"}


def check(ok, label):
    assert ok, label
    RESULTS.append({"check": label, "pass": True}); print("PASS " + label, flush=True)


def reject(label, operation, message):
    try: operation()
    except (ValueError, FileExistsError, p.Rejected) as error:
        assert re.search(message, type(error).__name__ + ": " + str(error), re.I), (label, str(error))
        RESULTS.append({"check": label, "pass": True, "rejection": str(error)}); print("PASS " + label, flush=True)
    else: raise AssertionError(label + " accepted")


def repack(raw, updates):
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw)) as source, zipfile.ZipFile(out, "w") as target:
        target.comment = source.comment
        for info in source.infolist(): target.writestr(copy(info), updates.get(info.filename, source.read(info)))
    return out.getvalue()


def independent_package(version, seed_raw, candidate_raw):
    # Whole ZIP hash was independently reviewed with a different model and an
    # Artifact preview; equality carries that result without reading those files.
    check(s.sha(candidate_raw) == FROZEN_OUTPUTS[version], version + " exact reviewed logic+style bytes")
    old, new = p.read_package(seed_raw), p.read_package(candidate_raw)
    worksheet_parts = {x["part"] for x in old.sheets}
    check(all(old.parts[k] == new.parts[k] for k in old.parts if k not in worksheet_parts | {"xl/styles.xml"}), version + " nonworksheet parts exact including external caches")
    checks = cells = old_style_other = 0
    allowed_f = s.formula_changes(version)
    for sheet in old.sheets:
        name, part = sheet["name"], sheet["part"]
        a, b = ET.fromstring(old.parts[part]), ET.fromstring(new.parts[part])
        old_cells = {c.get("r"): c for c in a.iter(p.q("c"))}
        new_cells = {c.get("r"): c for c in b.iter(p.q("c"))}
        assert old_cells.keys() == new_cells.keys()
        for ref, c in old_cells.items():
            nc = new_cells[ref]; f = c.find(p.q("f")); nf = nc.find(p.q("f"))
            if (name, ref) == ("主要", "AS40"):
                assert nc.findtext(p.q("is") + "/" + p.q("t")) == "No"
            elif f is not None:
                assert nf is not None and f.attrib == nf.attrib and nc.find(p.q("v")) is None
                assert (f.text, nf.text) == allowed_f[name, ref] if (name, ref) in allowed_f else f.text == nf.text
                expected = deepcopy(c)
                for v in list(expected.findall(p.q("v"))): expected.remove(v)
                expected.find(p.q("f")).text = nf.text
                assert ET.tostring(expected) == ET.tostring(nc)
                checks += 1
            else: assert ET.tostring(c) == ET.tostring(nc)
            cells += 1
    check(cells == (64040 if version == "2014" else 76166) and checks == (6463 if version == "2014" else 8188), version + " independent all-cell/formula tree comparison")
    check(all(new.parts[k] == old.parts[k] for k in old.parts if "externalLink" in k), version + " external link caches explicitly preserved")


# Independent finite parser/evaluator for the two small changed formulas.
TOKEN = re.compile(r'\s*("(?:[^"]|"")*"|[\w\u3400-\u9fff]+!\$?[A-Z]+\$?[1-9][0-9]*|\$?[A-Z]+\$?[1-9][0-9]*|[0-9]+|[A-Za-z_][A-Za-z0-9_.]*|[(),=+])')
class Formula:
    def __init__(self, text):
        self.tokens = []; self.i = 0; pos = 0
        while pos < len(text):
            match = TOKEN.match(text, pos); assert match, text[pos:]
            self.tokens.append(match[1]); pos = match.end()
        self.node = self.expr(); assert self.i == len(self.tokens)
    def pop(self):
        result = self.tokens[self.i]; self.i += 1; return result
    def atom(self):
        token = self.pop()
        if token == "+": return ("plus", self.atom())
        if token.startswith('"'): return ("literal", token[1:-1].replace('""', '"'))
        if token.isdigit(): return ("literal", int(token))
        if self.i < len(self.tokens) and self.tokens[self.i] == "(":
            self.pop(); args = [self.expr()]
            while self.tokens[self.i] == ",": self.pop(); args.append(self.expr())
            assert self.pop() == ")"; return ("call", token, args)
        return ("ref", token)
    def expr(self):
        node = self.atom()
        if self.i < len(self.tokens) and self.tokens[self.i] == "=": self.pop(); node = ("eq", node, self.atom())
        return node


def finite(node, local, values):
    kind = node[0]
    if kind == "literal": return node[1]
    if kind == "ref":
        ref = node[1].replace("$", ""); sheet, cell = ref.split("!") if "!" in ref else (local, ref)
        return values.get((sheet, cell))
    ev = lambda n: finite(n, local, values)
    if kind == "plus":
        value = ev(node[1]); assert type(value) in (int, float) or value in (None, "")
        return value
    if kind == "eq":
        a, b = ev(node[1]), ev(node[2]); a = "" if a is None else a; b = "" if b is None else b
        return a.casefold() == b.casefold() if type(a) == type(b) == str else a == b
    fn, args = node[1:]
    if fn == "IF": return ev(args[1] if ev(args[0]) else args[2])
    if fn == "OR": return any(ev(n) for n in args)
    if fn == "SUM": return sum(v for arg in args if type(v := ev(arg)) in (int, float))
    raise AssertionError(fn)


def finite_cases(version, seed_raw, output_raw):
    before, after = p.read_package(seed_raw), p.read_package(output_raw)
    data_part = next(s["part"] for s in before.sheets if s["name"] == "数据表")
    weight = "AN56" if version == "2014" else "AO58"
    def formula(package, part, ref): return ET.fromstring(p.cells_of(package.parts[part])[ref]).findtext("f")
    old_ac, new_ac = [Formula(formula(pack, pack.main_part, "D23")).node for pack in (before, after)]
    old_weight, new_weight = [Formula(formula(pack, data_part, weight)).node for pack in (before, after)]
    count = 0
    for flag in ("是", "否", "Yes", "No", "YES", "yes", "nO", None, "", " ", "Maybe"):
        for bonus in (2, 0, None, ""):
            values = {("主要", "AS40"): flag, ("主要", "AQ40"): bonus, ("主要", "AF40"): 3, ("主要", "AI40"): 2, ("主要", "G23"): 7}
            folded = flag.casefold() if type(flag) == str else flag; number = bonus if type(bonus) in (int, float) else 0
            assert [finite(n, "主要", values) for n in (old_ac, new_ac)] == [12 + (number if flag == "是" else 0), 12 + (number if flag == "是" or folded == "yes" else 0)]
            assert [finite(n, "数据表", values) for n in (old_weight, new_weight)] == ["" if flag == "否" else 6, "" if flag == "否" or folded == "no" else 6]
            count += 1
    check(count == 44, version + " 44 independent finite numeric/blank/case scenarios")
    return count


def loader_tests():
    directory = RUN / "loader"; directory.mkdir()
    source = (s.HERE / "export_package.py").read_bytes().replace(b"\r\n", b"\n")
    path = directory / "export_package.py"; path.write_bytes(source.replace(b"\n", b"\r\n"))
    (directory / "export_formula.py").write_bytes((s.HERE / "export_formula.py").read_bytes())
    check(s.exporter_bytes(path) == source, "exporter LF/CRLF hash normalization")
    real = Path.read_bytes; reads = 0
    def read_once(value):
        nonlocal reads
        if value == path:
            reads += 1
            return source if reads == 1 else b'raise RuntimeError("second unchecked read")'
        return real(value)
    with patch.object(Path, "read_bytes", read_once):
        loaded = s.load_exporter(path)
    check(reads == 1 and loaded.g is not None, "exec uses same exporter bytes verified once")
    path.write_bytes(source + b'\nraise RuntimeError("must not execute")\n')
    reject("changed exporter rejected before execution", lambda: s.load_exporter(path), "source changed")


def mutation_tests(version, seed_raw, output_raw):
    package = p.read_package(output_raw); main = package.main_part
    def broken(label, part, body, expected):
        reject(version + " " + label, lambda: s.verify(version, seed_raw, repack(output_raw, {part: body})), expected)
    raw = package.parts[main]
    av = p.cells_of(raw)["AV1"]
    broken("fabricated AV1 cache rejected", main, raw.replace(av, av.replace(b'</c>', b'<v>{}</v></c>'), 1), "cache|representation")
    broken("DV choice change rejected", main, raw.replace(b'"Yes,No"', b'"Yes,Maybe"', 1), "DV")
    aq = p.cells_of(raw)["AQ40"]
    broken("neighbor input change rejected", main, raw.replace(aq, aq.replace(b'<v>2</v>', b'<v>3</v>'), 1), "Unrelated input")
    styles = package.parts["xl/styles.xml"]
    table = s.elements(styles, "cellXfs")[0][1]; last = s.elements(table, "xf")[-1][1]
    broken("dedicated style wrong alignment rejected", "xl/styles.xml", styles.replace(last, last.replace(b'wrapText="0"', b'wrapText="1"'), 1), "dedicated style")
    old = s.elements(table, "xf")[0][1]
    broken("existing shared style change rejected", "xl/styles.xml", styles.replace(old, old.replace(b'fontId="0"', b'fontId="1"'), 1), "Original xf")
    external = next(k for k in package.parts if k.startswith("xl/externalLinks/externalLink") and k.endswith(".xml"))
    broken("external cache rewrite rejected", external, package.parts[external] + b' ', "Unrelated part")
    reject(version + " seed pin enforced", lambda: s.verify(version, seed_raw + b' ', output_raw), "seed bytes")


def main():
    loader_tests()
    shared = b'<c r="A2"><f t="shared" si="1"/></c>'
    check(s.elements(b'<root>' + shared + b'</root>', "c")[0][1] == shared, "self-closing shared formula retains parent span")
    array = b'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f t="array" ref="A1:A2">0</f><v>0</v></c></row><row r="2"><c r="A2"><v>0</v></c></row></sheetData></worksheet>'
    reject("cached array follower requires separate policy", lambda: s.check_array_followers(array), "follower cache")
    reject("out of bounds array range rejected", lambda: s.check_array_followers(array.replace(b'A1:A2', b'A1:XFE2')), "reference|limit")
    reject("outside audit output refused", lambda: s.allocate(p.BASE.parent / "shield-candidate-outside"), "outside")
    reject("prefix lookalike outside refused", lambda: s.allocate(p.BASE.with_name(p.BASE.name + "-other") / "shield-candidate-outside"), "outside")
    reject("noncandidate directory refused", lambda: s.allocate(RUN / "plain"), "shield-candidate")
    source = p.REPO / "public" / p.SOURCES["2014"][0]
    changed = RUN / "bad-source.xlsx"; changed.write_bytes(source.read_bytes() + b' ')
    reject("original source hash enforced", lambda: p.prepare(changed, p.SOURCES["2014"][1], RUN / "bad-plan"), "Source workbook changed")
    directory = RUN / "shield-candidate-fresh"
    reports = s.run(directory)
    finite_count = 0
    for version, report in reports.items():
        seed_raw, output_raw = Path(report["seed_output"]).read_bytes(), Path(report["output"]).read_bytes()
        check(s.sha(seed_raw) == s.SEED_SHA[version], version + " fresh real seed matches reviewed hash")
        independent_package(version, seed_raw, output_raw)
        finite_count += finite_cases(version, seed_raw, output_raw)
        mutation_tests(version, seed_raw, output_raw)
        check(report["native_recalculated"] is False and report["upload_ready"] is False, version + " native/upload limits explicit")
        check(s.sha((p.REPO / "public" / p.SOURCES[version][0]).read_bytes()) == p.SOURCES[version][1], version + " original unchanged")
    frozen = {str(p): s.sha(p.read_bytes()) for p in directory.rglob("*") if p.is_file()}
    reject("repeat output directory refused", lambda: s.run(directory), "exists|file")
    check(frozen == {str(p): s.sha(p.read_bytes()) for p in directory.rglob("*") if p.is_file()}, "refusal preserves every existing artifact")
    completed = subprocess.run([sys.executable, "-B", "-X", "utf8", str(s.HERE / "shield_package.py"), "--output-dir", str(directory)], capture_output=True, text=True, encoding="utf8")
    (RUN / "cli-existing.log").write_text(completed.stdout + completed.stderr, encoding="utf8")
    check(completed.returncode != 0 and "FileExistsError" in completed.stderr, "actual CLI refuses existing directory")
    check(frozen == {str(p): s.sha(p.read_bytes()) for p in directory.rglob("*") if p.is_file()}, "CLI refusal leaves outputs unchanged")
    result = {"passed": len(RESULTS), "checks": RESULTS, "finite_scenarios": finite_count, "outputs": reports,
              "run_directory": str(RUN), "native_recalculated": False, "files": {str(path): s.sha(path.read_bytes()) for path in (s.HERE / "shield_package.py", Path(__file__), s.HERE / "export_package.py", s.HERE / "export_formula.py")}}
    p.json_new(RUN / "result.json", result)
    print(json.dumps({"passed": len(RESULTS), "finite_scenarios": finite_count, "report": str(RUN / "result.json")}))


if __name__ == "__main__": main()
