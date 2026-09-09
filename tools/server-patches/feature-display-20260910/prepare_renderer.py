"""Prepare a new renderer directory from the exact reviewed template baseline."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent


def prepare(source: Path, destination: Path) -> dict:
    manifest = json.loads((HERE / "manifest.json").read_bytes())
    before = (source / "template.html").read_bytes()
    after = (HERE / "template.html").read_bytes()
    digest = lambda raw: hashlib.sha256(raw).hexdigest()
    if digest(before) != manifest["before_sha256"] or digest(after) != manifest["after_sha256"]:
        raise ValueError("Template differs from the reviewed source or replacement")
    source, destination = source.resolve(), destination.resolve()
    if destination == source or destination.is_relative_to(source) or source.is_relative_to(destination):
        raise ValueError("Output must be separate from the source renderer")
    if destination.exists():
        raise ValueError("Output directory already exists")
    files = [file for file in source.iterdir() if file.is_file()]
    if not {"render.py", "style.css", "tooltip.js", "weapon_properties.py"}.issubset({file.name for file in files}):
        raise ValueError("Source renderer is incomplete")
    destination.mkdir(parents=False)
    for file in files:
        if file.name == "template.html":
            (destination / file.name).write_bytes(after)
        else:
            shutil.copyfile(file, destination / file.name)
    return {"source": str(source), "output": str(destination), "template_sha256": digest(after), "deployed": False}


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--source", type=Path, required=True)
    cli.add_argument("--output", type=Path, required=True)
    args = cli.parse_args()
    try:
        print(json.dumps(prepare(args.source, args.output)))
    except (OSError, ValueError) as error:
        cli.exit(2, f"Renderer preparation rejected: {error}\n")
