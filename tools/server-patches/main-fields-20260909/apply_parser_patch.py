"""Apply/reverse this exact parser patch to a NEW output file, never in place.

Uses only Python's standard library. The source, patch and result must match
their manifest hashes before any output is opened. Unknown input is rejected.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re


HERE = Path(__file__).resolve().parent


class IntegrityError(ValueError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_manifest() -> dict:
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    if (manifest.get("format") != "obr-server-parser-patch/v1"
            or manifest.get("file") != "parser.py" or manifest.get("line_endings") != "LF"):
        raise IntegrityError("Unsupported patch manifest")
    for field in ("before_sha256", "after_sha256", "patch_sha256"):
        if not re.fullmatch(r"[0-9a-f]{64}", str(manifest.get(field, ""))):
            raise IntegrityError(f"Invalid manifest hash: {field}")
    return manifest


def apply_unified(source: bytes, patch: bytes, *, reverse: bool) -> bytes:
    """Strict single-file LF unified diff; no fuzzy/context-offset application."""
    if b"\r" in source or b"\r" in patch:
        raise IntegrityError("Expected exact LF input and patch; no implicit EOL conversion")
    original = source.decode("utf-8").splitlines(keepends=True)
    lines = patch.decode("utf-8").splitlines(keepends=True)
    if lines[:2] != ["--- a/parser.py\n", "+++ b/parser.py\n"]:
        raise IntegrityError("Patch must address only parser.py")
    cursor, at, count_hunks = 0, 2, 0
    output: list[str] = []
    while at < len(lines):
        match = re.fullmatch(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\n", lines[at])
        if not match:
            raise IntegrityError("Invalid unified hunk header")
        old_start, old_count, new_start, new_count = (
            int(match[1]), int(match[2] or 1), int(match[3]), int(match[4] or 1)
        )
        if reverse:
            old_start, old_count, new_start, new_count = new_start, new_count, old_start, old_count
        old_index = old_start - 1 if old_count else old_start
        new_index = new_start - 1 if new_count else new_start
        if not cursor <= old_index <= len(original):
            raise IntegrityError("Overlapping or out-of-range source hunk")
        output.extend(original[cursor:old_index])
        if len(output) != new_index:
            raise IntegrityError("Unexpected target hunk position")
        cursor, consumed, produced = old_index, 0, 0
        at += 1
        while at < len(lines) and not lines[at].startswith("@@ "):
            line = lines[at]
            if not line or line[0] not in " +-" or not line.endswith("\n"):
                raise IntegrityError("Unexpected unified diff content")
            operation, value = line[0], line[1:]
            if reverse:
                operation = {"+": "-", "-": "+", " ": " "}[operation]
            if operation in " -":
                if cursor >= len(original) or original[cursor] != value:
                    raise IntegrityError("Source hunk/context does not match exactly")
                cursor += 1
                consumed += 1
            if operation in " +":
                output.append(value)
                produced += 1
            at += 1
        if (consumed, produced) != (old_count, new_count):
            raise IntegrityError("Unified hunk line counts do not match")
        count_hunks += 1
    if not count_hunks:
        raise IntegrityError("Empty patch")
    output.extend(original[cursor:])
    return "".join(output).encode("utf-8")


def transform(source: bytes, direction: str, *, patch_bytes: bytes | None = None) -> bytes:
    if direction not in ("apply", "reverse"):
        raise IntegrityError("Unknown patch direction")
    manifest = load_manifest()
    patch_bytes = (HERE / "parser.patch").read_bytes() if patch_bytes is None else patch_bytes
    if sha256(patch_bytes) != manifest["patch_sha256"] or len(patch_bytes) != manifest["patch_bytes"]:
        raise IntegrityError("Patch SHA-256/size does not match manifest")
    before, after = ("before", "after") if direction == "apply" else ("after", "before")
    if sha256(source) != manifest[f"{before}_sha256"] or len(source) != manifest[f"{before}_bytes"]:
        raise IntegrityError(f"Source SHA-256/size does not match {direction} input; nothing written")
    result = apply_unified(source, patch_bytes, reverse=direction == "reverse")
    if sha256(result) != manifest[f"{after}_sha256"] or len(result) != manifest[f"{after}_bytes"]:
        raise IntegrityError("Result SHA-256/size does not match manifest; nothing written")
    return result


def main() -> None:
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("direction", choices=("apply", "reverse"))
    cli.add_argument("--source", type=Path, required=True)
    destination = cli.add_mutually_exclusive_group(required=True)
    destination.add_argument("--output", type=Path, help="New file; existing destinations are rejected")
    destination.add_argument("--check", action="store_true", help="Validate without writing output")
    args = cli.parse_args()
    try:
        source = args.source.read_bytes()
        result = transform(source, args.direction)
        if args.output is not None:
            if args.source.resolve() == args.output.resolve():
                raise IntegrityError("In-place patching is disabled")
            with args.output.open("xb") as stream:
                stream.write(result)
        print(json.dumps({"direction": args.direction, "source_sha256": sha256(source),
                          "result_sha256": sha256(result), "bytes": len(result),
                          "written": str(args.output) if args.output else None}))
    except (OSError, ValueError, UnicodeError) as error:
        cli.exit(2, f"Patch rejected: {error}\n")


if __name__ == "__main__":
    main()
