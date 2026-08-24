#!/usr/bin/env python3
"""Fail if package-lock.json's resolved tree disagrees with what package.json declares.

npm ci only checks that the lockfile's top-level manifest mirror matches package.json;
it does not check that the hoisted node_modules tree it produces actually satisfies
every workspace's declared ranges. A Dependabot rebase-on-conflict once left 15 of 17
workspaces resolving vitest to a stale version while every package.json already said
otherwise, and npm ci passed silently. Run after `npm ci` to catch that class of drift.

Root package.json `overrides` intentionally pin some transitive deps below what their
parents request; those show up as permanent, expected "invalid" entries and are excluded.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


# Pre-existing transitive skew that isn't a root `overrides` pin: a dev-only tool pulls in
# an old sub-dependency wanting a version below what the rest of the tree hoists to. Real,
# but unrelated to workspace package.json vs. lockfile drift, which is what this check guards.
KNOWN_TRANSITIVE_MISMATCHES = {
    "chokidar",  # svgtofont -> nunjucks wants ^3.3.0; tree hoists 4.x
}


def main() -> int:
    overrides = json.loads((ROOT / "package.json").read_text()).get("overrides", {})
    ignored_names = set(overrides) | KNOWN_TRANSITIVE_MISMATCHES

    result = subprocess.run(
        ["npm", "ls", "--all", "--json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    tree = json.loads(result.stdout)

    problems: set[tuple[str, str]] = set()

    def walk(node: dict) -> None:
        for name, child in node.get("dependencies", {}).items():
            if child.get("invalid") and name not in ignored_names:
                problems.add((name, child.get("version")))
            walk(child)

    walk(tree)

    if problems:
        print("Lockfile resolves packages that don't satisfy what package.json declares:", file=sys.stderr)
        for name, version in sorted(problems):
            print(f"  - {name}@{version}", file=sys.stderr)
        print(
            "\nRegenerate the lockfile with a fresh `rm package-lock.json && npm install` "
            "and commit the result.",
            file=sys.stderr,
        )
        return 1

    print("Lockfile resolutions match package.json declarations.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
