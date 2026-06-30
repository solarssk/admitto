#!/usr/bin/env python3
"""Generate .github/release-notes/vX.Y.Z.md from CHANGELOG.md (Keep a Changelog format)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHANGELOG = ROOT / "CHANGELOG.md"
OUT_DIR = ROOT / ".github" / "release-notes"


def parse_sections(text: str) -> dict[str, tuple[str, str]]:
    link_footer = re.search(r"\n\[(?:Unreleased|\d)", text)
    if link_footer:
        text = text[: link_footer.start()]

    header_re = re.compile(r"^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\s*$", re.M)
    matches = list(header_re.finditer(text))
    sections: dict[str, tuple[str, str]] = {}

    for i, match in enumerate(matches):
        version, date = match.group(1), match.group(2)
        if version == "Unreleased":
            continue
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        sections[version] = (date, text[start:end].strip())

    return sections


def deploy_footer(version: str) -> str:
    major_minor = ".".join(version.split(".")[:2])
    parts = tuple(int(x) for x in version.split("."))
    lines = ["---", "", "### Deploy"]

    if parts >= (0, 3, 6):
        lines.append(
            f"- Container image: `ghcr.io/solarssk/admitto:{version}` (rolling `:{major_minor}`)"
        )
        if parts >= (0, 4, 2):
            lines.append(
                "- Migrations apply **automatically on container start** "
                "(with pre-migration backup when pending). **No manual `migrate deploy`.**"
            )
        else:
            lines.append("- Container entrypoint runs `prisma migrate deploy` on start.")
    else:
        lines.append("- Run `npm run build` and `npm run db:migrate` on deploy.")

    lines.append("")
    lines.append(
        f"[Full changelog](https://github.com/solarssk/admitto/blob/v{version}/CHANGELOG.md)"
    )
    return "\n".join(lines)


def write_release_note(version: str, date: str, body: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"v{version}.md"
    path.write_text(f"## [{version}] - {date}\n\n{body}\n\n{deploy_footer(version)}\n")
    return path


def write_release_title(version: str, tagline: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"v{version}.title"
    path.write_text(f"{tagline.strip()}\n")
    return path


def main() -> int:
    if len(sys.argv) not in (1, 2, 3):
        print(
            f"Usage: {sys.argv[0]} [0.x.y] [\"tagline for GitHub Release title\"]",
            file=sys.stderr,
        )
        return 1

    sections = parse_sections(CHANGELOG.read_text())
    targets = [sys.argv[1].lstrip("v")] if len(sys.argv) >= 2 else sorted(
        sections.keys(), key=lambda v: tuple(int(x) for x in v.split("."))
    )
    tagline = sys.argv[2].strip() if len(sys.argv) == 3 else ""

    missing = [v for v in targets if v not in sections]
    if missing:
        print(f"Version(s) not found in CHANGELOG.md: {', '.join(missing)}", file=sys.stderr)
        return 1

    for version in targets:
        date, body = sections[version]
        path = write_release_note(version, date, body)
        print(path)
        if tagline:
            title_path = write_release_title(version, tagline)
            print(title_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
