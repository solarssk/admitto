import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ADMIN_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const REPO_ROOT = join(ADMIN_SRC, "../../..");

export const RULES = [
  "hand-rolled-spinner-css",
  "bare-loading-text",
  "busy-label-swap",
  "error-state-not-an-alert",
  "retry-outside-an-alert",
  "retry-in-a-raw-button",
  "retry-not-busy",
  "raw-button-busy-disabled",
] as const;
export type Rule = (typeof RULES)[number];
export type Counts = Record<string, number>;

/** Where each rule sends the author instead. Shown in the failure message. */
export const RULE_HINTS: Record<Rule, string> = {
  "hand-rolled-spinner-css":
    "Use <Spinner> (or <Button loading> inside a button) from @admitto/ui. Do not define a *spin*/*shimmer* @keyframes or animate `at-spin` in admin CSS.",
  "bare-loading-text":
    'Do not render "Loading…" text. Use Skeleton when the shape is known, SectionLoader (once per view) when it is not, PageLoader only for a whole screen, all behind useLoadingGate. See AGENTS.md "Loading and busy states".',
  "busy-label-swap":
    'Do not swap a button label for "Saving…" by hand. Use <Button loading loadingLabel="Saving…">, which keeps the width and disables the button.',
  "error-state-not-an-alert":
    'A failed load shown in an <EmptyState> (a "Could not load …" title, or a Retry) needs variant="error", so assistive tech announces it as an alert like every other failed load.',
  "retry-outside-an-alert":
    'A Retry (or Reload) for a failed load belongs in the `action` of an <EmptyState variant="error"> or of an element that has role="alert" itself (a <Notice> leaves its role to the caller), or inside an element with role="alert", so the failure is announced.',
  "retry-in-a-raw-button":
    "Use <Button loading> for a Retry (or Reload), with the hook useRetry for a request that is run again (a <RetryHint> for a one-line hint). A raw <button> cannot show that it is working and keep keyboard focus, so a click on it drops the focus to the page behind.",
  "retry-not-busy":
    "A <Button> that says Retry (or Reload) needs a `loading` that can be true (not missing, not {false}, {undefined} or {null}), so a click shows that the retry ran, a retry that fails again at once is seen to have run, and the button keeps keyboard focus while it works. Use <RetryEmptyState>, <RetryAlert> or <RetryHint> with useRetryKeepingError (useRetry for a request that is run again), or pass `loading` from them to the button of a Notice action (with `actionBusy` on the Notice, so a repeat failure is announced again).",
  "raw-button-busy-disabled":
    "Do not put disabled={busy} on a raw <button> that starts an action: a browser drops the focus of a button that becomes disabled. Use <Button loading> (or <IconButton loading>, <MoreActionsMenuItem loading>), which stays focusable; a link-style button keeps `disabled` for what cannot change and uses aria-disabled plus an early return in onClick while it works. If the button is only disabled because ANOTHER control is busy (the user pressed a different one), add it to DISABLED_WHILE_ANOTHER_ACTION_RUNS in loading-standard.test.ts with the reason.",
};

/** Files that implement the busy contract itself, so they may name a busy flag next to `disabled`. */
const BUSY_DISABLED_KIT_FILES = new Set(["apps/admin/src/components/MoreActionsMenuItem.tsx"]);

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

/** Index just past the `>` that closes the JSX opening tag starting at `start` (braces and quotes are balanced). */
/** Index just past the `>` that ends the opening tag starting at `start`, or -1 when the tag never ends. */
function jsxOpeningTagEnd(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0 && (c === '"' || c === "'")) i = source.indexOf(c, i + 1);
    else if (c === ">" && depth === 0 && source[i - 1] !== "=") return i + 1;
    if (i === -1) break;
  }
  return -1;
}

/** The opening tags of one JSX element name, as written (so `<Button` does not match `<ButtonGroup`). */
interface TagSpan {
  name: string;
  start: number;
  end: number;
  tag: string;
}
/**
 * Every opening tag whose name matches `namePattern` (a regex source), with where it starts and ends, so a caller
 * can ask what sits inside it. A tag that never ends (a stray quote swallowing the rest of the file) is skipped
 * instead of excusing everything after it.
 */
function tagSpans(source: string, namePattern: string): TagSpan[] {
  const spans: TagSpan[] = [];
  for (const match of source.matchAll(new RegExp(`<(${namePattern})(?![\\w.-])`, "g"))) {
    const end = jsxOpeningTagEnd(source, match.index + match[0].length);
    if (end === -1) continue; // ran to the end of the file: not a tag that ends
    spans.push({ name: match[1]!, start: match.index, end, tag: source.slice(match.index, end) });
  }
  return spans;
}
function openingTags(source: string, name: string): string[] {
  return tagSpans(source, name).map((span) => span.tag);
}

// A load error: an EmptyState that offers a Retry, or whose title says "Could not ...".
const COULD_NOT_TITLE = /\btitle=(?:"Could not\b|\{[^}]*"Could not\b)/;
// Words a busy flag is named with, as part of any identifier (`bulkSendBusy`, `isSaving`, `exporting`).
const BUSY_WORDS = /busy|saving|loading|submitting|pending|sending|working|reloading|revoking|deleting/i;
// A busy flag is also named after what is happening, in any verb: `markingAll`, `clearing`, `isExporting`. Each camelCase
// word of the expression that ends in -ing counts, except the ones that are plain nouns or prepositions.
const NOT_A_BUSY_WORD = new Set(["string", "thing", "nothing", "something", "anything", "everything", "during", "setting", "building", "warning", "ceiling", "morning", "evening", "sibling", "spring"]);
function namesABusyFlag(expression: string): boolean {
  if (BUSY_WORDS.test(expression)) return true;
  const words = expression.split(/[^A-Za-z]+/).flatMap((chunk) => chunk.split(/(?<=[a-z])(?=[A-Z])/));
  return words.some((word) => /^[a-z]{3,}ing$/i.test(word) && !NOT_A_BUSY_WORD.has(word.toLowerCase()));
}
// How far above a Retry button an alert, an EmptyState or a Notice may sit and still be what shows it.
// role="alert" as an attribute of its own (not data-role or aria-role), in the spellings JSX allows.
const ALERT_ROLE_ATTR = /(?<![\w-])role=(?:"alert"|'alert'|\{\s*(?:"alert"|'alert'|`alert`)\s*\})/;
// A button that offers to run a failed load again: "Retry", "Retry now", "Reload" or "Reload page" on its own, at the
// start of a line or right after a tag or an expression (an icon before it). A longer label such as "Retry loading
// items" is a menu command, not the failure's own control.
const RETRY_BUTTON_TEXT = /(?:^\s*|[>}]\s*)(Retry(?: now)?|Reload(?: page)?)(?=\s*(?:<|$))/g;

/** EmptyStates that show a failed load but lack `variant="error"`. */
function countErrorEmptyStatesWithoutVariant(text: string): number {
  return openingTags(text, "EmptyState").filter((tag) => {
    const ownProps = stripJsxProp(tag, "action"); // the Retry button has a `variant` of its own
    const isLoadError = tag.includes("Retry") || COULD_NOT_TITLE.test(ownProps);
    return isLoadError && !/\bvariant="error"/.test(ownProps);
  }).length;
}

/**
 * The tag with every `name={...}` value dropped except the one of `role`, so a role that sits inside another prop
 * (`title={<span role="alert">…`) or in the Retry's action is not mistaken for the tag's own role.
 */
function ownRoleProps(tag: string): string {
  let out = "";
  let cursor = 0;
  for (const m of tag.matchAll(/(?<![\w-])([\w-]+)=(?=\{)/g)) {
    if (m.index < cursor || m[1] === "role") continue;
    const valueStart = m.index + m[0].length;
    out += tag.slice(cursor, valueStart);
    cursor = propValueEnd(tag, valueStart);
  }
  return out + tag.slice(cursor);
}

/** True when a `role="alert"` element that has not closed yet encloses the text at `at`. */
function insideAlertElement(source: string, tags: TagSpan[], at: number): boolean {
  const selfClosing = (span: TagSpan) => span.tag.trimEnd().endsWith("/>");
  return tags.some((alert) => {
    if (alert.end > at || selfClosing(alert) || !ALERT_ROLE_ATTR.test(ownRoleProps(alert.tag))) return false;
    // Walk the same-named elements between the alert and `at` in order: the alert is still open unless a closing
    // tag brings the depth back to zero before `at` (a later sibling of the same name must not bring it back).
    const closing = new RegExp(`</${alert.name.replaceAll(".", "\\.")}\\s*>`, "g");
    const moves = [
      ...tags.filter((t) => t.name === alert.name && t.start >= alert.end && t.start < at && !selfClosing(t)).map((t) => ({ at: t.start, by: 1 })),
      ...[...source.slice(alert.end, at).matchAll(closing)].map((m) => ({ at: alert.end + m.index, by: -1 })),
    ].sort((a, b) => a.at - b.at);
    let depth = 1;
    for (const move of moves) {
      depth += move.by;
      if (depth === 0) return false;
    }
    return true;
  });
}

/** Where each Retry / Reload text (see RETRY_BUTTON_TEXT) starts, as an offset into the source. */
function retryTextOffsets(text: string): number[] {
  const offsets: number[] = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const offset = lineStart;
    lineStart += line.length + 1;
    for (const found of line.matchAll(RETRY_BUTTON_TEXT)) offsets.push(offset + found.index + found[0].length - found[1]!.length);
  }
  return offsets;
}

/**
 * Retry (or Reload) buttons for a failed load that nothing announces. A Retry in the props of an EmptyState is left to
 * error-state-not-an-alert, which requires variant="error" there. Any other Retry needs role="alert" on the element
 * whose props hold it (a Notice leaves its role to the caller, so the name alone says nothing), or on an element
 * that has not closed yet around it.
 */
function countRetriesOutsideAnAlert(text: string): number {
  const tags = tagSpans(text, "[A-Za-z][\\w.]*");
  let count = 0;
  for (const at of retryTextOffsets(text)) {
    // The innermost tag whose own props hold the Retry (its action prop, usually).
    const owner = tags.findLast((span) => span.start <= at && at < span.end);
    if (owner?.name === "EmptyState") continue;
    // The action holds the Retry button itself, so only the tag's own role counts.
    if (owner && ALERT_ROLE_ATTR.test(ownRoleProps(owner.tag))) continue;
    if (!insideAlertElement(text, tags, at)) count++;
  }
  return count;
}

/**
 * Retry (or Reload) controls drawn as a raw <button>. It cannot show that it is working and keep keyboard
 * focus, which `<Button loading>` does, so a click on a Retry that takes the alert around it away with it (or
 * disables itself) drops the focus to the page behind. A raw <button> is the one opened last before the text and not
 * yet closed again.
 */
function countRetriesInRawButtons(text: string): number {
  const buttons = tagSpans(text, "button");
  return retryTextOffsets(text).filter((at) => {
    const open = buttons.findLast((span) => span.end <= at && !span.tag.trimEnd().endsWith("/>"));
    return open !== undefined && !/<\/button\s*>/.test(text.slice(open.end, at));
  }).length;
}

/** The props a JSX opening tag sets (`type`, `loading`, `onClick`...), each with what it is set to as written (`{false}`, `"button"`), or `null` for a bare name. */
function propValues(tag: string): Map<string, string | null> {
  const props = new Map<string, string | null>();
  const next = /\s+([A-Za-z_][\w:-]*)|\s*(\{)|\s*(\/?>)/y;
  // JSX allows white space on both sides of the `=` of an attribute: `loading = {false}`.
  const assign = /\s*=\s*/y;
  let at = tag.search(/\s/);
  while (at !== -1 && at < tag.length) {
    next.lastIndex = at;
    const found = next.exec(tag);
    if (!found || found[3]) break;
    at = next.lastIndex;
    if (found[2]) {
      at = propValueEnd(tag, at - 1); // a spread, `{...props}`
      continue;
    }
    assign.lastIndex = at;
    if (assign.test(tag)) {
      const start = assign.lastIndex;
      const end = propValueEnd(tag, start);
      props.set(found[1]!, tag.slice(start, end));
      at = end;
    } else {
      props.set(found[1]!, null);
    }
  }
  return props;
}

// A `loading` that is written as a value that can never be true: the button would never be busy. Parentheses around it do not change that.
const STATICALLY_NOT_BUSY = /^\{\s*\(*\s*(?:false|undefined|null|void 0|0|!true|!1)\s*\)*\s*\}$/;

/**
 * Retry (or Reload) kit buttons that are never busy. A `<Button>` that offers to run a failed load again passes `loading`
 * while it runs, so that the click is seen to have done something (a retry that fails again at once still shows that it ran)
 * and the button keeps keyboard focus instead of going off: a `loading` that is missing, or written as `{false}`,
 * `{undefined}` or `{null}`, never does. A Retry that is not inside a `<Button>` is the business of retry-in-a-raw-button.
 */
function countRetriesNotBusy(text: string): number {
  const buttons = tagSpans(text, "Button");
  return retryTextOffsets(text).filter((at) => {
    const open = buttons.findLast((span) => span.end <= at && !span.tag.trimEnd().endsWith("/>"));
    if (open === undefined || /<\/Button\s*>/.test(text.slice(open.end, at))) return false;
    const loading = propValues(open.tag).get("loading");
    return loading === undefined || (loading !== null && STATICALLY_NOT_BUSY.test(loading));
  }).length;
}

/** Raw `<button>`s whose `disabled` names a busy flag. */
function countRawButtonsDisabledWhileBusy(text: string): number {
  return openingTags(text, "button").filter((tag) => {
    // `aria-disabled={busy}` is the way a busy button is kept focusable, not the violation.
    const at = tag.search(/(?<![\w-])disabled=\{/);
    if (at === -1) return false;
    const valueStart = tag.indexOf("{", at);
    return namesABusyFlag(tag.slice(valueStart, propValueEnd(tag, valueStart)));
  }).length;
}

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
    "error-state-not-an-alert": countErrorEmptyStatesWithoutVariant(text),
    "retry-outside-an-alert": countRetriesOutsideAnAlert(text),
    "retry-in-a-raw-button": countRetriesInRawButtons(text),
    "retry-not-busy": countRetriesNotBusy(text),
    "raw-button-busy-disabled": countRawButtonsDisabledWhileBusy(text),
  };
}

/** Violation counts per rule and per file (path relative to the repo root), over apps/admin/src. */
export function scanLoadingViolations(): Record<Rule, Counts> {
  const result = Object.fromEntries(RULES.map((rule) => [rule, {}])) as Record<Rule, Counts>;
  for (const file of walk(ADMIN_SRC, /\.(css|tsx?)$/)) {
    const rel = relative(REPO_ROOT, file).split(sep).join("/");
    const counts = countLoadingViolations(readFileSync(file, "utf8"), file.endsWith(".css") ? "css" : "code");
    for (const rule of RULES) {
      if (rule === "raw-button-busy-disabled" && BUSY_DISABLED_KIT_FILES.has(rel)) continue;
      bump(result[rule], rel, counts[rule] ?? 0);
    }
  }
  return result;
}
