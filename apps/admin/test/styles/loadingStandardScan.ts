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

// A ternary is a hand-made busy label when EITHER branch is a busy literal: "Saving…", "Checking in…", or a
// bare "…". A prompt such as "Select organization…" is not one, so a busy label must start with an -ing verb.
// Both patterns run on text whose string literals are masked (see `maskStringLiterals`): a busy literal
// is `"…"`, any other `"_"`. `?` counts only as the ternary operator (not `?.`, `??` or an optional `x?:`),
// and the branch between `?` and `:` is bounded and holds no `?`, `:`, `;`, `{` or `}`, so it cannot run
// into other code.
const BUSY_IF_TRUE = /\?\s*"…"\s*:/g;
const BUSY_IF_FALSE = /(?<!\?)\?(?![.?])[^?:;{}]{1,200}:\s*"…"/g;
const BUSY_LABEL = /^["'`](?:[A-Za-z]+ing\b.*)?(?:…|\.\.\.)["'`]$/;

/**
 * Replace each one-line string literal by `"…"` (a busy label) or `"_"`, so a `:` or `?` inside a string
 * can neither end nor start a ternary. A template literal that is not itself a busy label but holds a `?`
 * inside `${}` keeps its shape and only its inner strings are masked, so a ternary in it is still seen. Single-quoted
 * strings that contain `<`, `>`, `{` or `}` are left alone: that is JSX text with apostrophes.
 */
function maskStringLiterals(text: string): string {
  return text.replaceAll(/"[^"\n]*"|'[^'\n<>{}]*'|`[^`\n]*`/g, (literal) => {
    if (BUSY_LABEL.test(literal)) return '"…"';
    return literal.startsWith("`") && literal.includes("${") && literal.includes("?") ? `\`${maskStringLiterals(literal.slice(1, -1))}\`` : '"_"';
  });
}

/** How many ternaries put a busy label ("Saving…") in either branch. A ternary with two of them counts once. */
function countBusyTernaries(text: string): number {
  const masked = maskStringLiterals(text);
  const questionMarks = new Set<number>();
  for (const pattern of [BUSY_IF_TRUE, BUSY_IF_FALSE]) {
    for (const match of masked.matchAll(pattern)) questionMarks.add(match.index);
  }
  return questionMarks.size;
}

/** Index just past the value of a JSX prop that starts at `start` (a quoted string or a `{...}` expression). */
function propValueEnd(source: string, start: number): number {
  const open = source[start];
  if (open === '"' || open === "'") {
    const close = source.indexOf(open, start + 1);
    return close === -1 ? start : close + 1;
  }
  if (open === "{") {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) return i + 1;
    }
  }
  return start;
}

/** Remove every `prop=...` JSX attribute (string or balanced `{}` value) from the source. */
function stripJsxProp(source: string, prop: string): string {
  const needle = `${prop}=`;
  let out = "";
  let cursor = 0;
  let at = source.indexOf(needle);
  while (at !== -1) {
    const before = source[at - 1];
    if (before !== undefined && /[\w-]/.test(before)) {
      at = source.indexOf(needle, at + 1); // a longer attribute name that merely ends the same way
      continue;
    }
    const end = propValueEnd(source, at + needle.length);
    out += source.slice(cursor, at);
    cursor = end;
    at = source.indexOf(needle, end);
  }
  return out + source.slice(cursor);
}

/**
 * Attributes that are allowed to say "Loading..." or a busy verb, because they are the standard's own
 * way of doing it: `aria-label` is the text for assistive tech, and `loadingLabel` is what a
 * `<Button loading>` shows (its ternaries choose a verb, they do not swap the button by hand).
 */
const COMPLIANT_PROPS = ["aria-label", "loadingLabel"];

/** Violations of each rule in one source file. `kind` picks the CSS rule or the TS/TSX rules. */
export function countLoadingViolations(source: string, kind: "css" | "code"): Partial<Record<Rule, number>> {
  const text = stripBlockAndLineComments(source);
  if (kind === "css") {
    return { "hand-rolled-spinner-css": (text.match(SPIN_KEYFRAMES) ?? []).length + (text.match(SPIN_ANIMATION) ?? []).length };
  }
  const visible = COMPLIANT_PROPS.reduce(stripJsxProp, text);
  return {
    "bare-loading-text": (visible.match(LOADING_TEXT) ?? []).length,
    "busy-label-swap": countBusyTernaries(visible),
  };
}

/** Violation counts per rule and per file (path relative to the repo root), over apps/admin/src. */
export function scanLoadingViolations(): Record<Rule, Counts> {
  const result: Record<Rule, Counts> = {
    "hand-rolled-spinner-css": {},
    "bare-loading-text": {},
    "busy-label-swap": {},
  };
  for (const file of walk(ADMIN_SRC, /\.(css|tsx?)$/)) {
    const rel = relative(REPO_ROOT, file).split(sep).join("/");
    const counts = countLoadingViolations(readFileSync(file, "utf8"), file.endsWith(".css") ? "css" : "code");
    for (const rule of RULES) bump(result[rule], rel, counts[rule] ?? 0);
  }
  return result;
}
