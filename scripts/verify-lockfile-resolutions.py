#!/usr/bin/env python3
"""Fail if package-lock.json's resolved tree disagrees with what package.json declares.

npm ci only checks that the lockfile's top-level manifest mirror matches package.json;
it does not check that the hoisted node_modules tree it produces actually satisfies
every workspace's declared ranges. A Dependabot rebase-on-conflict once left 15 of 17
workspaces resolving vitest to a stale version while every package.json already said
otherwise, and npm ci passed silently. Run after `npm ci` to catch that class of drift.

Root package.json `overrides` intentionally pin some transitive deps below what their
parents request; those show up as permanent, expected "invalid" entries and are excluded.
An override key may carry the range of requests it applies to (`minimatch@>=7.0.0 <11.0.1`);
only the package name matters here.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


# Pre-existing transitive skew that isn't a root `overrides` pin: a dev-only tool pulls in
# an old sub-dependency wanting a version below what the rest of the tree hoists to. Real,
# but unrelated to workspace package.json vs. lockfile drift, which is what this check guards.
KNOWN_TRANSITIVE_MISMATCHES = {
    "chokidar",  # svgtofont -> nunjucks wants ^3.3.0; tree hoists 4.x
    # playwright (pulled in by @playwright/test, apps/admin) declares an exact optional
    # dependency on fsevents@2.3.2; the rest of the tree already hoists a newer 2.3.x. macOS-only
    # (fsevents' own package.json restricts it to darwin), so this is invisible on Linux CI.
    "fsevents",
}


def override_pins(overrides: dict) -> dict[str, list[str]]:
    """Group the string-valued root overrides by package name.

    A key is a bare name (`uuid`) or a name plus the range of requests it applies to
    (`minimatch@>=7.0.0 <11.0.1`, `@scope/pkg@^1`); the `@` that starts a scoped name is not a
    separator. Object values pin a child of one parent and are not matched by name here.
    """
    pins: dict[str, list[str]] = {}
    for key, value in overrides.items():
        if isinstance(value, str):
            name = key[: key.find("@", 1)] if "@" in key[1:] else key
            pins.setdefault(name, []).append(value)
    return pins


def main() -> int:
    pins = override_pins(json.loads((ROOT / "package.json").read_text()).get("overrides", {}))

    npm = shutil.which("npm")
    node_bin = shutil.which("node")
    if npm is None or node_bin is None:
        print("npm and/or node executable not found on PATH.", file=sys.stderr)
        return 2

    result = subprocess.run(
        [npm, "ls", "--all", "--json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    tree = json.loads(result.stdout)

    problems: set[tuple[str, str]] = set()

    def satisfies(version: str, spec: str) -> bool:
        check = subprocess.run(
            [node_bin, "-e", "process.exit(require('semver').satisfies(process.argv[1], process.argv[2]) ? 0 : 1)",
             version, spec],
            cwd=ROOT,
        )
        return check.returncode == 0

    def is_explained_by_override(name: str, child: dict) -> bool:
        # An override pin only explains an "invalid" entry when the resolved version actually
        # satisfies it - i.e. the override is doing its job overriding some other consumer's
        # older want. A resolved version that doesn't even satisfy its own override is still a
        # bug (the override not being honored), not the expected override skew.
        version = child.get("version")
        if not version:
            return False
        return any(satisfies(version, spec) for spec in pins.get(name, []))

    def walk(node: dict) -> None:
        for name, child in node.get("dependencies", {}).items():
            invalid = child.get("invalid")
            if invalid and name not in KNOWN_TRANSITIVE_MISMATCHES and not is_explained_by_override(name, child):
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
