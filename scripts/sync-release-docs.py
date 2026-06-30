#!/usr/bin/env python3
"""Sync product-version markers in docs from root package.json.

Markers use HTML comments so prose stays readable and CI can verify consistency:

  latest <!-- admitto:latest-patch -->`0.4.7`<!-- /admitto:latest-patch -->

Run after bumping package.json during a release cut. Use --check in CI.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_JSON = ROOT / "package.json"

# (path relative to repo root, start marker, end marker)
MARKERS: tuple[tuple[str, str, str], ...] = (
    ("SECURITY.md", "<!-- admitto:latest-patch -->", "<!-- /admitto:latest-patch -->"),
)


def read_product_version() -> str:
    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    version = data.get("version", "")
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"Invalid or missing version in {PACKAGE_JSON}: {version!r}")
    return version


def apply_markers(text: str, version: str, start: str, end: str) -> tuple[str, bool]:
    pattern = re.escape(start) + r".*?" + re.escape(end)
    if not re.search(pattern, text, flags=re.DOTALL):
        raise SystemExit(f"Markers not found: {start} ... {end}")
    replacement = f"{start}`{version}`{end}"
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.DOTALL)
    if count != 1:
        raise SystemExit(f"Expected exactly one marker pair to replace")
    return new_text, new_text != text


def main() -> int:
    check = "--check" in sys.argv
    version = read_product_version()
    stale: list[str] = []

    for rel, start, end in MARKERS:
        path = ROOT / rel
        text = path.read_text(encoding="utf-8")
        updated, changed = apply_markers(text, version, start, end)
        if changed:
            stale.append(rel)
            if not check:
                path.write_text(updated, encoding="utf-8")

    if check:
        if stale:
            print(
                f"Docs out of sync with package.json {version}: {', '.join(stale)}",
                file=sys.stderr,
            )
            print("Run: python3 scripts/sync-release-docs.py", file=sys.stderr)
            return 1
        return 0

    if stale:
        print(f"Updated: {', '.join(stale)} (version {version})")
    else:
        print(f"Already in sync (version {version})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
