import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
/** Where staff UI code lives: the admin app and the shared kit it renders. */
const SCAN_ROOTS = ["apps/admin/src", "packages/ui/src"];

export const RULES = ["overlay-lifecycle-outside-hook", "inline-fixed-position", "viewport-math-in-component"] as const;
export type Rule = (typeof RULES)[number];
export type Counts = Record<string, number>;

/** Where each rule sends the author instead. Shown in the failure message. */
export const RULE_HINTS: Record<Rule, string> = {
  "overlay-lifecycle-outside-hook":
    "attachFixedOverlayLifecycle and getFixedOverlayViewport belong to useFloatingPlacement. A panel that floats next to an element calls that hook (or useDropdownMenu, which is built on it) and spreads its `panelStyle`.",
  "inline-fixed-position":
    'Do not write `position: "fixed"` in a style object. A floating panel gets its position from useFloatingPlacement (`panelStyle`), which places it with a transform and keeps it inside the visual viewport.',
  "viewport-math-in-component":
    "Do not measure an element with getBoundingClientRect() and compare it with the window's size to place a panel. That is what useFloatingPlacement (Floating UI) is for: it flips, shifts and clamps against the visual viewport, and the copies of this math each had to be fixed again for narrow screens, zoom and the phone keyboard.",
};

/** Files that implement placement themselves, per rule. */
const IMPLEMENTS_PLACEMENT: Record<Rule, ReadonlySet<string>> = {
  "overlay-lifecycle-outside-hook": new Set([
    "apps/admin/src/components/useFloatingPlacement.ts",
    "apps/admin/src/utils/fixed-overlay-lifecycle.ts",
  ]),
  "inline-fixed-position": new Set(["apps/admin/src/components/useFloatingPlacement.ts"]),
  "viewport-math-in-component": new Set([
    "apps/admin/src/components/useFloatingPlacement.ts",
    "apps/admin/src/utils/fixed-overlay-lifecycle.ts",
  ]),
};

const LIFECYCLE_HELPERS = /\b(?:attachFixedOverlayLifecycle|getFixedOverlayViewport)\b/g;
const INLINE_FIXED = /position:\s*["']fixed["']/g;
const MEASURES_AN_ELEMENT = /\.getBoundingClientRect\(/;
const READS_THE_VIEWPORT = /\bwindow\.(?:innerWidth|innerHeight|visualViewport)\b|\bdocument\.documentElement\.client(?:Width|Height)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(?:ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");
}

/** Findings per rule and file (repo-relative, `/`-separated) for the given sources. */
export function scanPlacement(files: Record<string, string>): Record<Rule, Counts> {
  const found: Record<Rule, Counts> = {
    "overlay-lifecycle-outside-hook": {},
    "inline-fixed-position": {},
    "viewport-math-in-component": {},
  };
  for (const [file, raw] of Object.entries(files)) {
    const source = stripComments(raw);
    const count = (rule: Rule, n: number) => {
      if (n > 0 && !IMPLEMENTS_PLACEMENT[rule].has(file)) found[rule][file] = n;
    };
    count("overlay-lifecycle-outside-hook", source.match(LIFECYCLE_HELPERS)?.length ?? 0);
    count("inline-fixed-position", source.match(INLINE_FIXED)?.length ?? 0);
    count("viewport-math-in-component", MEASURES_AN_ELEMENT.test(source) && READS_THE_VIEWPORT.test(source) ? 1 : 0);
  }
  return found;
}

export function scanPlacementViolations(): Record<Rule, Counts> {
  const files: Record<string, string> = {};
  for (const root of SCAN_ROOTS) {
    for (const full of walk(join(REPO_ROOT, root))) {
      files[relative(REPO_ROOT, full).split(sep).join("/")] = readFileSync(full, "utf8");
    }
  }
  return scanPlacement(files);
}
