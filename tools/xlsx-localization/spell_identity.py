"""Pinned spell-row identity/display plans; read-only XLSX input, JSON output only.

This is a static source snapshot, not an Excel recalculation or an import schema
migration. Author edits to custom slots require fresh identity/collision handling.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import posixpath
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
BASE = REPO.parent / "_audit" / "xlsx-spell-identity"
SCHEMA = "obr-suite-spell-identity/v1"
SOURCES = {
    "2014": ("DND5E人物卡_悲灵_弗人_枭熊适配版.xlsx", "94444fda4206d579125418b0007b89c414b86c27d6b98655f81f3f1ce65e8fe6"),
    "2024": ("DND5R人物卡_悲灵_弗人_枭熊适配版.xlsx", "264fc65569e3e80932544af548830ca70f10ee308493c8b0234608fcd01c9b04"),
}
LAYOUTS = {
    "2014": {"lastRow": 574, "customStart": 525, "columnCount": 24, "customSheet": "额外法术"},
    "2024": {"lastRow": 864, "customStart": 815, "columnCount": 26, "customSheet": "自定义调整栏"},
}
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


class Rejected(ValueError):
    pass


def require(ok, message):
    if not ok:
        raise Rejected(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf8")


def key(value):
    # A lookup keeps source spacing; display input additionally trims only its
    # outer whitespace. Python casefold is explicitly not native Excel collation.
    return value.casefold()


def field_value(row, column):
    return row["fields"][column]["value"]


def level_label(row):
    raw = field_value(row, "B")
    if not isinstance(raw, str) or not re.fullmatch(r"[0-9]", raw):
        return None
    return "Cantrip" if raw == "0" else "Level " + raw


def assign_displays(rows):
    """Generate unique literal labels without inventing a corrected spell name.

    This helper is also exercised with small collision fixtures. It never uses a
    technical ID, row number, hash, or body text as a user-facing disambiguator.
    """
    by_a = defaultdict(list)
    candidates = defaultdict(list)
    diagnostics = []
    for row in rows:
        original_a = row["original"]["A"]
        if row["active"] and isinstance(original_a, str):
            by_a[key(original_a)].append(row)
        row["display"] = {"label": None, "baseName": None, "status": "empty", "disambiguation": None}
        if not row["active"]:
            continue
        if row["kind"] == "custom-slot":
            # An active author slot is preserved as an original-input record,
            # not advertised as a translated English dictionary label.
            row["display"]["status"] = "original-custom"
            continue
        raw = row["original"]["N"]
        base = raw.strip() if isinstance(raw, str) else ""
        row["display"]["baseName"] = base or None
        if any("\u3400" <= c <= "\u9fff" for c in base):
            row["display"]["status"] = "rejected"
            diagnostics.append({"code": "SOURCE_NAME_NOT_ENGLISH", "rows": [row["row"]], "original": raw,
                                "policy": "requires a separately reviewed display-only override; source N remains unchanged"})
            continue
        if not base or len(base) > 255 or any(ord(c) < 32 or c in "*?~" for c in base):
            row["display"]["status"] = "rejected"
            diagnostics.append({"code": "UNSUPPORTED_DISPLAY_NAME", "rows": [row["row"]]})
            continue
        if raw != base:
            diagnostics.append({"code": "DISPLAY_OUTER_WHITESPACE_TRIMMED", "rows": [row["row"]], "original": raw, "displayBase": base})
        candidates[key(base)].append(row)
    for matching in by_a.values():
        if len(matching) > 1:
            diagnostics.append({"code": "DUPLICATE_ORIGINAL_A", "rows": [r["row"] for r in matching],
                                "legacyFirstRow": matching[0]["row"], "policy": "record original first-match behavior; English display resolves row identity directly"})
    for matching in candidates.values():
        duplicate = len(matching) > 1
        if duplicate:
            diagnostics.append({"code": "DUPLICATE_ENGLISH_NAME", "rows": [r["row"] for r in matching], "originalNamesPreserved": True})
        for row in matching:
            display = row["display"]
            level = level_label(row) if duplicate else None
            if duplicate and level is None:
                display["status"] = "rejected"
                diagnostics.append({"code": "NO_RELIABLE_LEVEL_DISAMBIGUATION", "rows": [row["row"]]})
                continue
            display.update(label=display["baseName"] + (" (" + level + ")" if level else ""),
                           status="disambiguated" if duplicate else "ready", disambiguation="level" if duplicate else None)
    labels = defaultdict(list)
    for row in rows:
        if row["display"]["label"] is not None:
            labels[key(row["display"]["label"])].append(row)
    for label_key, matching in labels.items():
        code = "DISPLAY_COLLIDES_WITH_ORIGINAL_A" if label_key in by_a else "DUPLICATE_DISPLAY_LABEL" if len(matching) > 1 else None
        if code:
            diagnostics.append({"code": code, "rows": [r["row"] for r in matching],
                                "label": matching[0]["display"]["label"], "originalRows": [r["row"] for r in by_a.get(label_key, [])]})
            for row in matching:
                row["display"].update(label=None, status="rejected")
    return diagnostics


def build_plan(version, source_path=None):
    require(version in SOURCES, "Unsupported rules version")
    filename, expected_sha = SOURCES[version]
    path = Path(source_path) if source_path is not None else REPO / "public" / filename
    raw = path.read_bytes()
    require(sha(raw) == expected_sha, "Original source fingerprint mismatch")
    # Read the same bytes which passed the fingerprint check.
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        require(len(set(archive.namelist())) == len(archive.namelist()), "Duplicate ZIP part")
        parts = {n: archive.read(n) for n in archive.namelist()}

    def xml(part):
        data = parts[part]
        require(b"<!DOCTYPE" not in data.upper() and b"<!ENTITY" not in data.upper(), "Unsupported XML declaration")
        return ET.fromstring(data)

    book = xml("xl/workbook.xml")
    rels = {r.get("Id"): r for r in xml("xl/_rels/workbook.xml.rels")}
    sheets = {}
    for sheet in book.find(NS + "sheets"):
        rel = rels[sheet.get(RNS + "id")]
        require(rel.get("TargetMode") != "External", "External worksheet")
        target = rel.get("Target")
        part = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
        require(part.startswith("xl/") and part in parts, "Invalid worksheet relationship")
        sheets[sheet.get("name")] = part
    require("法术大全" in sheets, "Expected spell dictionary missing")
    shared = ["".join(t.text or "" for t in row.iter(NS + "t")) for row in xml("xl/sharedStrings.xml")]
    root = xml(sheets["法术大全"])
    cells = {c.get("r"): c for c in root.iter(NS + "c")}
    layout = LAYOUTS[version]
    columns = [chr(ord("A") + c) for c in range(layout["columnCount"])]

    def field(address):
        cell = cells.get(address)
        if cell is None:
            return {"value": None, "type": None, "formula": None, "formulaAttributes": None, "attributes": None}
        value = cell.findtext(NS + "v")
        cell_type = cell.get("t", "n")
        if cell_type == "s":
            value = shared[int(value)] if value is not None else None
        elif cell_type == "inlineStr":
            value = "".join(t.text or "" for t in cell.iter(NS + "t"))
        f = cell.find(NS + "f")
        return {"value": value, "type": cell_type, "formula": f.text if f is not None else None,
                "formulaAttributes": dict(f.attrib) if f is not None else None, "attributes": dict(cell.attrib)}

    rows = []
    for number in range(3, layout["lastRow"] + 1):
        fields = {column: field(column + str(number)) for column in columns}
        a = fields["A"]["value"]
        active = isinstance(a, str) and bool(a)
        custom = number >= layout["customStart"]
        mirrors = []
        if custom:
            for column, data in fields.items():
                formula = data["formula"]
                if formula is None:
                    continue
                found = sorted(set(re.findall(r"(?:'([^']+)'|([^\s!(),=]+))!(\$?[A-Z]+\$?[0-9]+)", formula)))
                refs = [{"sheet": quoted or plain, "cell": address} for quoted, plain, address in found]
                require(refs and all(r["sheet"] == layout["customSheet"] for r in refs), "Unexpected custom mirror source")
                mirrors.append({"column": column, "formula": formula, "sources": refs})
            require(len(mirrors) == 13, "Expected thirteen custom field mirrors")
        rows.append({"identity": f"5E{version}:spell:{expected_sha}:{number}", "row": number,
                     "kind": "custom-slot" if custom else "builtin" if active else "reserved-gap", "active": active,
                     "original": {c: fields[c]["value"] for c in ("A", "N", "M")}, "fields": fields,
                     "fieldsSha256": sha(canonical(fields)), "customMirrors": mirrors})
    diagnostics = assign_displays(rows)
    require(sha(path.read_bytes()) == expected_sha, "Original changed during inspection")
    return {
        "schema": SCHEMA, "version": version, "source": {"filename": filename, "sha256": expected_sha},
        "dictionary": {"sheet": "法术大全", "part": sheets["法术大全"], "partSha256": sha(parts[sheets["法术大全"]]),
                       "columnOrder": columns, "firstRow": 3, "lastRow": layout["lastRow"],
                       "customStart": layout["customStart"], "customEnd": layout["lastRow"],
                       "headerFields": {str(r): {c: field(c + str(r)) for c in columns} for r in (1, 2)}},
        "rows": rows, "diagnostics": diagnostics,
        "policy": {
            "identityBinding": "rules version + full fixed source SHA-256 + original dictionary row; never use a display name as identity",
            "legacyInput": "original A first literal case-insensitive match in row order; duplicates retained and reported",
            "displayInput": "unique literal English label, outer whitespace trimmed; direct row identity, never N -> A -> row",
            "comparisonLimit": "Python casefold model only; no native Excel locale/collation/wildcard or recalculation claim",
            "dynamicCustom": "50 source mirror slots retained. Blank snapshot slots are inactive. Future edits need runtime identity and collision validation; this plan does not automatically track them.",
            "unmodifiedFields": "A/N/M and all dictionary fields retained, including cached numeric text, formula text, formula attributes and source cell attributes",
            "nativeRecalculated": False, "xlsxWritten": False, "serverImportMigrated": False,
        },
    }


def validate_plan(plan):
    require(isinstance(plan, dict) and plan.get("schema") == SCHEMA and plan.get("version") in SOURCES, "Invalid plan schema/version")
    version = plan["version"]
    require(plan.get("source") == {"filename": SOURCES[version][0], "sha256": SOURCES[version][1]}, "Plan source binding mismatch")
    rows = plan.get("rows")
    require(isinstance(rows, list) and [r.get("row") for r in rows] == list(range(3, LAYOUTS[version]["lastRow"] + 1)), "Incomplete or reordered identity rows")
    columns = [chr(ord("A") + c) for c in range(LAYOUTS[version]["columnCount"])]
    for row in rows:
        require(row.get("identity") == f"5E{version}:spell:{SOURCES[version][1]}:{row['row']}", "Invalid row identity binding")
        require(isinstance(row.get("fields"), dict) and list(row["fields"]) == columns, "Incomplete row fields")
        require(row.get("fieldsSha256") == sha(canonical(row.get("fields"))), "Row fields fingerprint mismatch")
        require(row.get("original") == {c: row["fields"][c]["value"] for c in ("A", "N", "M")}, "Original field mirror mismatch")
        active = isinstance(row["original"]["A"], str) and bool(row["original"]["A"])
        expected_kind = "custom-slot" if row["row"] >= LAYOUTS[version]["customStart"] else "builtin" if active else "reserved-gap"
        require(row.get("active") == active and row.get("kind") == expected_kind, "Incorrect row activity/kind")
    checked = [dict(row) for row in rows]
    assign_displays(checked)
    require(all(row.get("display") == expected["display"] for row, expected in zip(rows, checked)), "Display plan mismatch")
    # Plans are local generation output, not an authenticated interchange
    # document. Source pins are not signatures over a supplied JSON document.


def _result(row, via, **extra):
    return {"status": "matched" if row["active"] else "inactive", "via": via, "identity": row["identity"],
            "row": row["row"], "kind": row["kind"], "fields": row["fields"], "fieldsSha256": row["fieldsSha256"],
            "original": row["original"], "display": row["display"], **extra}


def resolve_id(plan, identity):
    validate_plan(plan)
    if not isinstance(identity, str) or not identity:
        return {"status": "empty"}
    prefix = f"5E{plan['version']}:spell:{plan['source']['sha256']}:"
    if not identity.startswith(prefix):
        return {"status": "wrong-version-or-source"}
    matching = [r for r in plan["rows"] if r["identity"] == identity]
    return _result(matching[0], "identity") if matching else {"status": "unknown"}


def resolve_input(plan, text):
    validate_plan(plan)
    if not isinstance(text, str) or not text.strip():
        return {"status": "empty"}
    original = [r for r in plan["rows"] if r["active"] and isinstance(r["original"]["A"], str) and key(r["original"]["A"]) == key(text)]
    if original:
        return _result(original[0], "legacy-original", ambiguous=len(original) > 1, matchingRows=[r["row"] for r in original])
    matching = [r for r in plan["rows"] if r["display"]["label"] is not None and key(r["display"]["label"]) == key(text.strip())]
    if len(matching) == 1:
        return _result(matching[0], "english-display")
    if len(matching) > 1:
        return {"status": "ambiguous", "labels": [r["display"]["label"] for r in matching]}
    bases = [r for r in plan["rows"] if r["display"]["baseName"] and key(r["display"]["baseName"]) == key(text.strip())]
    if bases:
        return {"status": "ambiguous" if len(bases) > 1 else "rejected", "labels": [r["display"]["label"] for r in bases if r["display"]["label"]]}
    return {"status": "unknown"}


def output_path(value):
    path = Path(value).resolve()
    base = BASE.resolve()
    require(path != base and path.is_relative_to(base), "Output is outside the exclusive audit root")
    require(path.name.startswith("spell-identity-"), "Output directory must start with spell-identity-")
    require(not path.exists(), "Output directory already exists")
    return path


def write_plan_directory(path, versions):
    path = output_path(path)
    plans = {version: build_plan(version) for version in versions}
    # All source reads finish before allocating the exclusive output directory.
    path.mkdir(parents=True, exist_ok=False)
    files = {}
    for version, plan in plans.items():
        raw = json.dumps(plan, ensure_ascii=False, indent=2).encode("utf8") + b"\n"
        filename = f"{version}-spell-identity-plan.json"
        with (path / filename).open("xb") as target:
            target.write(raw)
        files[version] = {"path": str(path / filename), "sha256": sha(raw), "rows": len(plan["rows"]),
                          "englishLabels": sum(r["display"]["label"] is not None for r in plan["rows"]),
                          "customSlots": sum(r["kind"] == "custom-slot" for r in plan["rows"])}
    manifest = {"schema": SCHEMA, "plans": files, "xlsxWritten": False, "nativeRecalculated": False,
                "serverImportMigrated": False, "toolSha256": sha(Path(__file__).read_bytes().replace(b"\r\n", b"\n"))}
    with (path / "manifest.json").open("x", encoding="utf8", newline="\n") as target:
        json.dump(manifest, target, ensure_ascii=False, indent=2)
        target.write("\n")
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", choices=tuple(SOURCES), action="append")
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args(argv)
    default = BASE / ("spell-identity-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    try:
        result = write_plan_directory(args.output_dir or default, list(dict.fromkeys(args.version or SOURCES)))
    except (Rejected, OSError, KeyError, ET.ParseError, zipfile.BadZipFile) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
