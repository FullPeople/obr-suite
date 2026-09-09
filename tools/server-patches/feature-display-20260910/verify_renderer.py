"""Render native imported cards, authored features, and older JSON in isolation."""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from prepare_renderer import prepare


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def verify(source, output):
    before_files = {p.name: p.read_bytes() for p in source.iterdir() if p.is_file()}
    output.mkdir(exist_ok=False)
    prepared = output / "renderer"
    report = prepare(source, prepared)
    for name, raw in before_files.items():
        if name != "template.html":
            assert (prepared / name).read_bytes() == raw
    old = module(source / "render.py", "original_renderer")
    new = module(prepared / "render.py", "changed_renderer")
    root = Path(__file__).resolve().parents[3]
    cases = []
    body = 'First "quoted" line \\ 中文\nSecond line\tTabbed\n<img src=x onerror="window.bad=true">'
    for version in ("2014", "2024"):
        native_file = root / f"tools/fixtures/cc-imported-{version}.json"
        native = json.loads(native_file.read_bytes())
        variants = {"native": native}
        seeded = copy.deepcopy(native)
        seeded["features"]["fighting_style_feats"] = [{"name": "Authored fighting style", "level": 2, "description": body}]
        seeded["features"]["special_abilities"] = [{"name": "Authored special ability", "description": body}]
        variants["seeded"] = seeded
        legacy = copy.deepcopy(native)
        legacy["identity"]["display_name"] = "Alias to preserve"
        legacy["features"].pop("special_abilities", None)
        legacy["features"]["fighting_style_feats"] = None
        variants["legacy"] = legacy
        for kind, data in variants.items():
            case_dir = output / f"{version}-{kind}"
            case_dir.mkdir()
            path = case_dir / "data.json"
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf8")
            old_path = old.render_html(path, case_dir / "before")
            new_path = new.render_html(path, case_dir / "after")
            before, after = old_path.read_text(encoding="utf8"), new_path.read_text(encoding="utf8")
            if kind == "seeded":
                assert "Authored fighting style" not in before and "Authored special ability" not in before
                assert "Authored fighting style" in after and "Authored special ability" in after
                assert '<img src=x' not in after and '&lt;img' in after
            if kind == "legacy":
                assert before == after, "Old JSON with an explicit alias must render byte-for-byte identically"
            for name in ("style.css", "tooltip.js"):
                assert (case_dir / "after" / name).read_bytes() == before_files[name]
            cases.append({"version": version, "kind": kind, "path": str(new_path), "beforePath": str(old_path), "nativeFixtureSha256": hashlib.sha256(native_file.read_bytes()).hexdigest()})
    try:
        prepare(source, prepared)
    except ValueError:
        pass
    else:
        raise AssertionError("Existing output must be rejected")
    assert {p.name: p.read_bytes() for p in source.iterdir() if p.is_file()} == before_files
    report.update(cases=cases, legacyIdentical=True, sourceAndAssetsUnchanged=True, existingOutputRejected=True, nativeOwlbearRoom=False)
    (output / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
    print(json.dumps({"cases": len(cases), "legacyIdentical": True, "sourceAndAssetsUnchanged": True, "output": str(output)}))


if __name__ == "__main__":
    if not __debug__:
        raise RuntimeError("Assertions are required")
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--source", type=Path, required=True)
    cli.add_argument("--output", type=Path, required=True)
    args = cli.parse_args()
    verify(args.source, args.output)
