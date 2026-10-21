/**
 * Builds the product part of the stylesheet of the public guest pages (the registration form).
 *
 * The admin app imports the product's CSS through its bundler. A page rendered on the server has no
 * bundler, so it needs a stylesheet of its own. A hand copy would drift without anybody noticing, so
 * this module derives it from the source files in `packages/ui/src/styles`:
 *
 * - the design tokens and the base element rules, whole;
 * - from `components.css`, only the rules whose every class is one the pages use
 *   ({@link GUEST_PAGE_COMPONENT_CLASSES}).
 *
 * The result is committed as `src/registration/guest-page-css.generated.ts`, which is what the server
 * imports (the production image has no `packages/ui/src`). `npm run guest-css -w @admitto/web`
 * rewrites that file, and `test/registration/guest-page-css.test.ts` fails when it is out of date, so a change
 * to a product rule cannot reach the form unseen.
 *
 * The parser reads the CSS this repository writes by hand: rules, `@media` and `@supports` blocks and
 * `@keyframes`, no nesting. It is not a general CSS parser.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The classes of `components.css` the guest pages use. A rule is copied when it names at least one
 * class and every class it names is on this list. Add a class here when a page starts to use it
 * (`test/registration/guest-page-css.test.ts` fails for a class a rendered page uses that is not here). */
export const GUEST_PAGE_COMPONENT_CLASSES: readonly string[] = [
  "at-field",
  "at-label",
  "at-hint",
  "at-hint--error",
  "at-control",
  "at-input",
  "at-input--invalid",
  "at-select",
  "at-select--invalid",
  "at-inputgroup",
  "at-inputgroup__icon",
  "at-check",
  "at-check__box",
  "at-btn",
  "at-btn--primary",
  "at-btn--secondary",
  "at-btn--lg",
  "at-btn--block",
  "at-notice",
  "at-notice--info",
  "at-notice--error",
  "at-notice__icon",
  "at-notice__body",
];

/** Copied whole, in this order: tokens first, then the element rules that use them. */
const WHOLE_FILES = [
  "tokens/colors.css",
  "tokens/typography.css",
  "tokens/spacing.css",
  "tokens/elevation.css",
  "tokens/base.css",
];

const COMPONENTS_FILE = "components.css";

/** Where the committed copy is written, relative to this file. */
const GENERATED_FILE = "../registration/guest-page-css.generated.ts";

type Statement =
  | { kind: "rule"; prelude: string; body: string }
  | { kind: "at"; prelude: string; body: string };

/** Removes `/* ... *\/` comments. The product CSS has no comment marker inside a string. */
function stripComments(css: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const start = css.indexOf("/*", pos);
    if (start === -1) return out + css.slice(pos);
    out += css.slice(pos, start);
    const end = css.indexOf("*/", start + 2);
    if (end === -1) return out;
    pos = end + 2;
  }
}

/** Index of the quote that ends the string that starts at `start`. */
function endOfString(css: string, start: number): number {
  const quote = css.charAt(start);
  for (let i = start + 1; i < css.length; i += 1) {
    const ch = css.charAt(i);
    if (ch === "\\") i += 1;
    else if (ch === quote) return i;
  }
  return css.length;
}

/** Index of the `}` that closes the block opened by the `{` at `open`. Strings are skipped, so a
 * brace inside `url("...")` does not count. */
function closingBrace(css: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const ch = css.charAt(i);
    if (ch === '"' || ch === "'") {
      i = endOfString(css, i);
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  throw new Error("Unbalanced braces in the product CSS");
}

/** The top-level statements of `css`. A statement without a block (`@import`, `@charset`) is dropped. */
function parseStatements(css: string): Statement[] {
  const out: Statement[] = [];
  let pos = 0;
  while (pos < css.length) {
    const open = css.indexOf("{", pos);
    const semicolon = css.indexOf(";", pos);
    if (semicolon !== -1 && (open === -1 || semicolon < open)) {
      pos = semicolon + 1;
      continue;
    }
    if (open === -1) break;
    const close = closingBrace(css, open);
    const prelude = css.slice(pos, open).trim();
    out.push({ kind: prelude.startsWith("@") ? "at" : "rule", prelude, body: css.slice(open + 1, close) });
    pos = close + 1;
  }
  return out;
}

/** The comma-separated selectors of a rule. Commas inside parentheses (`:is(a, b)`) do not split. */
function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const ch = list.charAt(i);
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter((part) => part !== "");
}

const CONDITION_PSEUDOS = [":not(", ":has(", ":is(", ":where("];

/** The selector without the arguments of `:not()`, `:has()`, `:is()` and `:where()`. A class in there
 * is a condition on the element, not what the rule styles, so `.at-inputgroup:not(:has(.x))` counts as
 * `.at-inputgroup`. */
function withoutConditions(selector: string): string {
  let out = "";
  let i = 0;
  while (i < selector.length) {
    const pseudo = CONDITION_PSEUDOS.find((candidate) => selector.startsWith(candidate, i));
    if (pseudo === undefined) {
      out += selector.charAt(i);
      i += 1;
      continue;
    }
    let depth = 1;
    i += pseudo.length;
    while (i < selector.length && depth > 0) {
      const ch = selector.charAt(i);
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      i += 1;
    }
  }
  return out;
}

function isClassCharacter(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === "-";
}

/** The class names a selector styles (see {@link withoutConditions}). */
function classesOf(selector: string): string[] {
  const text = withoutConditions(selector);
  const names: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.charAt(i) !== ".") {
      i += 1;
      continue;
    }
    let end = i + 1;
    while (end < text.length && isClassCharacter(text.charAt(end))) end += 1;
    if (end > i + 1) names.push(text.slice(i + 1, end));
    i = end;
  }
  return names;
}

function usesOnly(selector: string, allowed: ReadonlySet<string>): boolean {
  const classes = classesOf(selector);
  return classes.length > 0 && classes.every((name) => allowed.has(name));
}

/** Whitespace of a declaration block as single spaces, so each rule is one line. */
function oneLine(text: string): string {
  return text.split(/\s+/u).filter(Boolean).join(" ");
}

function serializeRule(selectors: readonly string[], body: string): string {
  return `${selectors.join(", ")} { ${oneLine(body)} }`;
}

function indent(lines: readonly string[]): string[] {
  return lines.map((line) => `  ${line}`);
}

/** Every word of an `animation` or `animation-name` declaration in `body`, to find the keyframes the
 * copied rules use. */
function animationWords(body: string): string[] {
  const words: string[] = [];
  for (const declaration of body.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim();
    if (property === "animation" || property === "animation-name") {
      words.push(...oneLine(declaration.slice(colon + 1)).split(" "));
    }
  }
  return words;
}

/** What a pass over a stylesheet collected. */
interface Collected {
  lines: string[];
  /** Words of the animation declarations of the rules that were copied. */
  animations: Set<string>;
  /** `@keyframes` blocks by name, copied only when a copied rule names them. */
  keyframes: Map<string, string[]>;
}

function collectRule(statement: Statement, allowed: ReadonlySet<string> | null, into: Collected): void {
  const selectors = allowed
    ? splitSelectors(statement.prelude).filter((s) => usesOnly(s, allowed))
    : [oneLine(statement.prelude)];
  if (selectors.length === 0 || oneLine(statement.body) === "") return;
  into.lines.push(serializeRule(selectors, statement.body));
  for (const word of animationWords(statement.body)) into.animations.add(word);
}

function collectAtRule(statement: Statement, allowed: ReadonlySet<string> | null, into: Collected): void {
  const [name = "", ...rest] = oneLine(statement.prelude).split(" ");
  if (name === "@keyframes") {
    const frames = parseStatements(statement.body).map((frame) => serializeRule([frame.prelude], frame.body));
    into.keyframes.set(rest.join(" "), [`@keyframes ${rest.join(" ")} {`, ...indent(frames), "}"]);
    return;
  }
  if (name !== "@media" && name !== "@supports") return;
  const inner: Collected = { lines: [], animations: into.animations, keyframes: into.keyframes };
  for (const child of parseStatements(statement.body)) collectBlock(child, allowed, inner);
  if (inner.lines.length > 0) {
    into.lines.push(`${oneLine(statement.prelude)} {`, ...indent(inner.lines), "}");
  }
}

function collectBlock(statement: Statement, allowed: ReadonlySet<string> | null, into: Collected): void {
  if (statement.kind === "rule") collectRule(statement, allowed, into);
  else collectAtRule(statement, allowed, into);
}

/** The rules of `css`: all of them when `allowed` is null, else the ones that use only allowed classes. */
function pickRules(css: string, allowed: ReadonlySet<string> | null): string[] {
  const collected: Collected = { lines: [], animations: new Set(), keyframes: new Map() };
  for (const statement of parseStatements(stripComments(css))) collectBlock(statement, allowed, collected);
  for (const [name, block] of collected.keyframes) {
    if (collected.animations.has(name)) collected.lines.push(...block);
  }
  return collected.lines;
}

/**
 * The product stylesheet for the guest pages, one rule per line. `read` returns the text of a file
 * under `packages/ui/src/styles` by its path relative to that folder.
 */
export function buildGuestPageProductCss(read: (relativePath: string) => string): string {
  const allowed = new Set(GUEST_PAGE_COMPONENT_CLASSES);
  const sections: string[] = [];
  for (const file of WHOLE_FILES) {
    sections.push(`/* ${file} */`, ...pickRules(read(file), null));
  }
  sections.push(`/* ${COMPONENTS_FILE}: the rules of the classes the guest pages use */`, ...pickRules(read(COMPONENTS_FILE), allowed));
  return sections.join("\n");
}

/** The text of `guest-page-css.generated.ts` for `css`. */
export function renderGeneratedModule(css: string): string {
  const lines = css.split("\n").map((line) => `  ${JSON.stringify(line)},`);
  return [
    "// Generated by `npm run guest-css -w @admitto/web` from packages/ui/src/styles. Do not edit it by hand:",
    "// apps/web/test/registration/guest-page-css.test.ts fails when it no longer matches those files.",
    "export const GUEST_PAGE_PRODUCT_CSS = [",
    ...lines,
    String.raw`].join("\n");`,
    "",
  ].join("\n");
}

/** `packages/ui/src/styles`, from the location of this file (a source checkout, not the built image). */
export function productStylesRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/ui/src/styles");
}

export function generatedModulePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), GENERATED_FILE);
}

/** Reads one product style file under `root`. */
export function readProductStyle(root: string, relativePath: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed relative names under the repo's own styles folder
  return readFileSync(join(root, relativePath), "utf8");
}

/** Rebuilds `guest-page-css.generated.ts` from the product styles. The arguments are for the test. */
export function writeGuestPageCss(stylesRoot: string = productStylesRoot(), target: string = generatedModulePath()): void {
  const css = buildGuestPageProductCss((relativePath) => readProductStyle(stylesRoot, relativePath));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the one generated file, or a file the test chose
  writeFileSync(target, renderGeneratedModule(css));
}
