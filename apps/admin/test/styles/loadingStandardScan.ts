import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ADMIN_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const REPO_ROOT = join(ADMIN_SRC, "../../..");

export const RULES = ["hand-rolled-spinner-css", "bare-loading-text", "busy-label-swap"] as const;
export type Rule = (typeof RULES)[number];
export type Counts = Record<string, number>;

/** Where each rule sends the author instead. Shown in the failure message. */
export const RULE_HINTS: Record<Rule, string> = {
  "hand-rolled-spinner-css":
    "Use <Spinner> (or <Button loading> inside a button) from @admitto/ui. Do not define a *spin*/*shimmer* @keyframes or animate `at-spin` in admin CSS.",
  "bare-loading-text":
    'Do not render "Loading…" text. Use PageLoader / SectionLoader for an unknown shape, Skeleton for a known one, all behind useLoadingGate. See AGENTS.md "Loading and busy states".',
  "busy-label-swap":
    'Do not swap a button label for "Saving…" by hand. Use <Button loading loadingLabel="Saving…">, which keeps the width and disables the button.',
};

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.test(name)) out.push(full);
  }
  return out;
}

function stripBlockAndLineComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");
}

function bump(counts: Counts, file: string, n: number): void {
  if (n === 0) return;
  counts[file] = (counts[file] ?? 0) + n;
}

const SPIN_KEYFRAMES = /@keyframes\s+[\w-]*(?:spin|shimmer)[\w-]*/g;
const SPIN_ANIMATION = /animation(?:-name)?\s*:[^;{}]*\bat-spin\b/g;
const LOADING_TEXT = /Loading(?: [A-Za-z][\w -]*)?(?:…|\.\.\.)/g;
const BUSY_TERNARY = /\?\s*(?:"[^"\n]*…"|'[^'\n]*…'|`[^`\n]*…`)\s*:/g;

/** Violation counts per rule and per file (path relative to the repo root), over apps/admin/src. */
export function scanLoadingViolations(): Record<Rule, Counts> {
  const result: Record<Rule, Counts> = {
    "hand-rolled-spinner-css": {},
    "bare-loading-text": {},
    "busy-label-swap": {},
  };
  for (const file of walk(ADMIN_SRC, /\.(css|tsx?)$/)) {
    const rel = relative(REPO_ROOT, file).split(sep).join("/");
    const source = stripBlockAndLineComments(readFileSync(file, "utf8"));
    if (file.endsWith(".css")) {
      bump(result["hand-rolled-spinner-css"], rel, (source.match(SPIN_KEYFRAMES) ?? []).length);
      bump(result["hand-rolled-spinner-css"], rel, (source.match(SPIN_ANIMATION) ?? []).length);
    } else {
      bump(result["bare-loading-text"], rel, (source.match(LOADING_TEXT) ?? []).length);
      bump(result["busy-label-swap"], rel, (source.match(BUSY_TERNARY) ?? []).length);
    }
  }
  return result;
}
