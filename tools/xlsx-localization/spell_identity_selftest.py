"""Focused real-source and isolated CLI checks. Never saves the source workbooks."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

sys.dont_write_bytecode = True
import spell_identity as s


def main():
    s.BASE.mkdir(parents=True, exist_ok=True)
    audit = Path(tempfile.mkdtemp(prefix="selftest-", dir=s.BASE))
    checks = []

    def check(name, predicate):
        assert predicate, name
        checks.append(name)

    def rejects(name, function, expected):
        try:
            function()
        except s.Rejected as error:
            check(name, expected in str(error))
        else:
            raise AssertionError(name + ": not rejected")

    # Independently decode original XML values; do not reuse the generator's
    # field-reading helper or trust its row hashes as value equality evidence.
    def original_fields(version):
        filename, fingerprint = s.SOURCES[version]
        path = s.REPO / "public" / filename
        raw = path.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == fingerprint
        ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
        with zipfile.ZipFile(path) as z:
            strings = ["".join(t.text or "" for t in n.iter(ns + "t")) for n in ET.fromstring(z.read("xl/sharedStrings.xml"))]
            rels = {n.attrib["Id"]: n.attrib["Target"] for n in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
            book = ET.fromstring(z.read("xl/workbook.xml"))
            sheet = next(n for n in book.find(ns + "sheets") if n.get("name") == "法术大全")
            target = rels[sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]]
            root = ET.fromstring(z.read(target.lstrip("/") if target.startswith("/") else "xl/" + target))
        result = {}
        for c in root.iter(ns + "c"):
            v = c.findtext(ns + "v")
            if c.get("t") == "s":
                v = strings[int(v)] if v is not None else None
            elif c.get("t") == "inlineStr":
                v = "".join(t.text or "" for t in c.iter(ns + "t"))
            f = c.find(ns + "f")
            result[c.get("r")] = {"value": v, "type": c.get("t", "n"), "formula": f.text if f is not None else None,
                                  "formulaAttributes": dict(f.attrib) if f is not None else None, "attributes": dict(c.attrib)}
        return result

    plans = {v: s.build_plan(v) for v in s.SOURCES}
    for version, plan in plans.items():
        originals = original_fields(version)
        expected_rows = 572 if version == "2014" else 862
        check(version + " deterministic complete row plan", len(plan["rows"]) == expected_rows and plan == s.build_plan(version))
        missing = {"value": None, "type": None, "formula": None, "formulaAttributes": None, "attributes": None}
        check(version + " all original fields/formulas/attributes equal independent XML", all(
            data == originals.get(column + str(row["row"]), missing)
            for row in plan["rows"] for column, data in row["fields"].items()))
        check(version + " fifty custom slots keep thirteen mirrors and no invented active text", sum(r["kind"] == "custom-slot" for r in plan["rows"]) == 50 and all(
            len(r["customMirrors"]) == 13 and not r["active"] and r["display"]["label"] is None
            for r in plan["rows"] if r["kind"] == "custom-slot"))
        check(version + " all English labels unique and separate from A keys", len({r["display"]["label"].casefold() for r in plan["rows"] if r["display"]["label"]}) == (521 if version == "2014" else 809)
              and not ({r["display"]["label"].casefold() for r in plan["rows"] if r["display"]["label"]} & {r["original"]["A"].casefold() for r in plan["rows"] if r["active"]}))
        acid = s.resolve_input(plan, "ACID SPLASH")
        check(version + " English and Chinese Acid Splash retain same full fields", acid["row"] == 3 and acid["fields"] == s.resolve_input(plan, "酸液飞溅")["fields"] == plan["rows"][0]["fields"])
        air = next(r for r in plan["rows"] if r["original"]["N"] == "Air Bubble ")
        check(version + " Air Bubble source space retained, readable input resolves", air["fields"]["N"]["value"] == "Air Bubble " and air["display"]["label"] == "Air Bubble" and s.resolve_input(plan, " Air Bubble ")["row"] == air["row"])
        check(version + " empty and unknown inputs do not pick a row", s.resolve_input(plan, " ") == {"status": "empty"} and s.resolve_input(plan, "Unknown author spell") == {"status": "unknown"})
        custom = next(r for r in plan["rows"] if r["kind"] == "custom-slot")
        check(version + " empty custom ID explicitly inactive with fields retained", s.resolve_id(plan, custom["identity"])["status"] == "inactive" and s.resolve_id(plan, custom["identity"])["fields"] == custom["fields"])
        check(version + " custom level mirror records both name gate and level input", len(next(m for m in custom["customMirrors"] if m["column"] == "B")["sources"]) == 2)
    newer = plans["2024"]
    malformed = plans["2014"]["rows"][337 - 3]
    check("2014 malformed source N retained without inventing corrected English", malformed["original"]["N"] == "术Summon Elemental" and malformed["display"]["label"] is None and malformed["display"]["status"] == "rejected" and s.resolve_id(plans["2014"], malformed["identity"])["original"]["N"] == "术Summon Elemental" and s.resolve_input(plans["2014"], "Summon Elemental") == {"status": "unknown"})
    holy, divine = [s.resolve_input(newer, name) for name in ("Holy Word", "Divine Word")]
    check("duplicate A, unique English names select distinct real M", holy["row"] == 73 and divine["row"] == 719 and holy["original"]["A"] == divine["original"]["A"] == "圣言术" and holy["fields"]["M"]["value"] != divine["fields"]["M"]["value"])
    legacy = s.resolve_input(newer, "圣言术")
    check("Chinese duplicate preserves original first row and reports ambiguity", legacy["row"] == 73 and legacy["ambiguous"] and legacy["matchingRows"] == [73, 719])
    flock3 = s.resolve_input(newer, "Sanctum of the Flock (Level 3)")
    flock5 = s.resolve_input(newer, "Sanctum of the Flock (Level 5)")
    check("duplicate N resolved by real levels without changing original N", flock3["row"] == 452 and flock5["row"] == 646 and flock3["original"]["N"] == flock5["original"]["N"] == "Sanctum of the Flock" and flock3["fields"]["M"]["value"] != flock5["fields"]["M"]["value"])
    check("bare duplicate English name asks for actual readable choices", s.resolve_input(newer, "Sanctum of the Flock") == {"status": "ambiguous", "labels": ["Sanctum of the Flock (Level 3)", "Sanctum of the Flock (Level 5)"]})
    check("same-version identity returns row; foreign ID never crosses rulesets", s.resolve_id(newer, divine["identity"])["row"] == 719 and s.resolve_id(plans["2014"], divine["identity"]) == {"status": "wrong-version-or-source"})
    check("unknown well-bound ID does not fall back", s.resolve_id(newer, divine["identity"].rsplit(":", 1)[0] + ":9999") == {"status": "unknown"})
    check("2024 empty gap and later custom source stay separate", [r["row"] for r in newer["rows"] if r["kind"] == "reserved-gap"] == [812, 813, 814] and newer["rows"][815 - 3]["customMirrors"][0]["sources"] == [{"sheet": "自定义调整栏", "cell": "H3"}])

    def sample(number, a, english, level):
        return {"row": number, "identity": "internal-must-not-be-a-label", "kind": "builtin", "active": True,
                "original": {"A": a, "N": english, "M": "fixture body"}, "fields": {"B": {"value": level}}}

    same_level = [sample(1, "甲", "One Name", "3"), sample(2, "乙", "One Name", "3")]
    d = s.assign_displays(same_level)
    check("same-name same-level refuses arbitrary row labels", all(r["display"]["status"] == "rejected" and r["display"]["label"] is None for r in same_level) and any(x["code"] == "DUPLICATE_DISPLAY_LABEL" for x in d))
    collision = [sample(1, "Existing English", "Elsewhere", "1"), sample(2, "乙", "Existing English", "2")]
    d = s.assign_displays(collision)
    check("English display cannot shadow original A input", collision[1]["display"]["label"] is None and any(x["code"] == "DISPLAY_COLLIDES_WITH_ORIGINAL_A" for x in d))
    suffix = [sample(1, "甲", "One Name", "3"), sample(2, "乙", "One Name", "5"), sample(3, "丙", "One Name (Level 3)", "1")]
    s.assign_displays(suffix)
    check("generated suffix collision with a real name rejected for both", suffix[0]["display"]["status"] == suffix[2]["display"]["status"] == "rejected")
    bad_level = [sample(1, "甲", "One Name", "unknown"), sample(2, "乙", "One Name", "5")]
    s.assign_displays(bad_level)
    check("unknown level cannot invent a disambiguator", bad_level[0]["display"]["label"] is None)
    altered = deepcopy(newer); altered["rows"][0]["fields"]["M"]["value"] = "changed body"
    rejects("resolver rejects changed fields fingerprint", lambda: s.resolve_input(altered, "Acid Splash"), "fingerprint")
    altered = deepcopy(newer); altered["rows"][0]["display"]["label"] = "Divine Word"
    rejects("resolver rejects a changed display-to-row mapping", lambda: s.resolve_input(altered, "Divine Word"), "Display plan")

    # Real isolated CLI: only this tool and the two original source copies.
    isolated = audit / "isolated"
    tool_dir = isolated / "repo/tools/xlsx-localization"
    public = isolated / "repo/public"
    tool_dir.mkdir(parents=True); public.mkdir(parents=True)
    copied_tool = tool_dir / "spell_identity.py"
    copied_tool.write_bytes(Path(s.__file__).read_bytes().replace(b"\r\n", b"\n"))
    for filename, fingerprint in s.SOURCES.values():
        shutil.copyfile(s.REPO / "public" / filename, public / filename)

    def cli(*args):
        return subprocess.run([sys.executable, "-B", "-X", "utf8", str(copied_tool), *map(str, args)], capture_output=True, text=True, encoding="utf8")

    fresh = cli()
    check("isolated default CLI completes without prior audit/tool dependencies", fresh.returncode == 0)
    output = json.loads(fresh.stdout)
    check("isolated CLI emits identical complete deterministic plans", all(json.loads(Path(output["plans"][v]["path"]).read_text("utf8")) == plans[v] for v in plans))
    existing = Path(output["plans"]["2014"]["path"]).parent
    before = {f.name: s.sha(f.read_bytes()) for f in existing.iterdir()}
    refused = cli("--output-dir", existing)
    check("existing output refused without changing a byte", refused.returncode == 2 and "already exists" in refused.stderr and before == {f.name: s.sha(f.read_bytes()) for f in existing.iterdir()})
    outside = audit / "spell-identity-outside"
    refused = cli("--output-dir", outside)
    check("CLI rejects path outside its sibling audit root", refused.returncode == 2 and "outside" in refused.stderr and not outside.exists())
    wrong = public / s.SOURCES["2024"][0]
    wrong.write_bytes(wrong.read_bytes() + b"untrusted drift")
    refused = cli()
    check("CLI checks fixed source before producing a partial plan", refused.returncode == 2 and "fingerprint" in refused.stderr and len(list(existing.parent.glob("spell-identity-*"))) == 1)
    for filename, fingerprint in s.SOURCES.values():
        check(filename + " original remains byte-identical", s.sha((s.REPO / "public" / filename).read_bytes()) == fingerprint)
    result = {"passed": len(checks), "checks": checks, "audit": str(audit), "isolatedManifest": output,
              "nativeRecalculation": False, "sourceWorkbooksWritten": False, "serverChanged": False,
              "toolSha256": s.sha(Path(s.__file__).read_bytes().replace(b"\r\n", b"\n")),
              "selftestSha256": s.sha(Path(__file__).read_bytes().replace(b"\r\n", b"\n"))}
    (audit / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
