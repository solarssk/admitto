import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * One look for every time in the admin (standards/admin-spa/time-display.md, "How a time looks"): the body font of the row with tabular digits, from one
 * stylesheet (components/time-stack.css). The logs, the attendee timeline, the notes, Reports and the check-in feed used to show a time in monospace while the
 * sessions did not, so the same moment looked different from one screen to the next. These tests are CSS, which jsdom does not see, so they read the files.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const strip = (css: string) => css.replaceAll(/\/\*[\s\S]*?\*\//g, "");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

const FILES = [...cssFiles(join(ROOT, "apps/admin/src")), ...cssFiles(join(ROOT, "packages/ui/src"))];

interface Rule {
  file: string;
  selector: string;
  body: string;
}

/** Every `selector { body }` of the stylesheets, with the selector on one line (a rule inside an `@media` is found too, as its own selector and body). */
const RULES: Rule[] = FILES.flatMap((path) =>
  [...strip(readFileSync(path, "utf8")).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    file: relative(ROOT, path),
    selector: m[1]!.replaceAll(/\s+/g, " ").trim(),
    body: m[2]!,
  })),
);

const timeStack = readFileSync(join(ROOT, "apps/admin/src/components/time-stack.css"), "utf8");

describe("the look of a time", () => {
  it("is never monospace: no rule for a selector about a time, a date, a clock or a stamp sets a monospace font", () => {
    const offenders = RULES.filter((r) => /time|date|clock|stamp/i.test(r.selector) && /font-family\s*:[^;]*mono/i.test(r.body)).map((r) => `${r.file}: ${r.selector}`);
    expect(offenders, "A time is in the body font of its row. Put the class `time-text` on it, or draw it with TimeStack (components/TimeStack.tsx).").toEqual([]);
  });

  it("is in one stylesheet: the stack, its lines and the plain time text have tabular digits and choose no font of their own", () => {
    const digits = RULES.find((r) => r.file.endsWith("components/time-stack.css") && r.selector === ".time-text, .time-stack__utc, .time-stack__local");
    expect(digits, "no rule that gives the three classes their digits").toBeDefined();
    expect(digits!.body).toMatch(/font-variant-numeric\s*:\s*tabular-nums/);
    expect(/font-family/.test(strip(timeStack))).toBe(false);
  });

  it("keeps the zone of a time quiet: smaller and grey, where the digits are dark", () => {
    const zone = RULES.find((r) => r.file.endsWith("components/time-stack.css") && r.selector === ".time-stack__zone");
    expect(zone, "no rule for the quiet zone").toBeDefined();
    expect(zone!.body).toMatch(/font-size\s*:\s*var\(--fs-xs\)/);
    expect(zone!.body).toMatch(/color\s*:\s*var\(--text-muted\)/);
  });

  it("has no private copy of the log time look left in the stylesheets of the screens", () => {
    const leftovers = RULES.filter((r) => /audit-log-time/.test(r.selector)).map((r) => `${r.file}: ${r.selector}`);
    expect(leftovers).toEqual([]);
  });
});
