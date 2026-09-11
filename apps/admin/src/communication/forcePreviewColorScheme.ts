/** The preview iframe is `sandbox=""` (no scripts), so we can't emulate `prefers-color-scheme`
 * the way a real browser devtools panel does - there is no JS running inside it to react to a
 * media-query change. Instead, before the HTML is handed to the iframe, this rewrites every
 * `@media` block gated on `prefers-color-scheme: dark` or `prefers-color-scheme: light` so the
 * chosen mode always wins, deterministically, regardless of what the *actual* browser/OS reports
 * (Safari always follows the OS appearance for this; Chromium browsers can override it
 * independently, so the same template's dark-mode logo swap could render inconsistently) - and
 * regardless of which of the two features a given template actually authored, since some only
 * write a `dark` override and rely on default-is-light, while others write both explicitly.
 *
 * Resolving those media queries alone only changes whatever the template's own author chose to
 * make color-scheme-reactive. Two cases:
 *  - The template only swaps something cosmetic (commonly just a logo) and never touches
 *    background/text/border colors in its dark block - most of the email stays exactly as
 *    authored, flatly light. For this case we ALSO simulate a full dark rendering: a CSS
 *    `filter: invert(1) hue-rotate(180deg)` on the whole iframe (communication.css) turns light
 *    backgrounds dark and dark text light with no per-template color knowledge needed, and a
 *    matching counter-filter set inline on every `img`/`svg` (composed with whatever filter the
 *    template already authored for that element, so a dark-mode logo recolored with e.g.
 *    `brightness(0) invert(1)` keeps that look instead of losing it) exactly undoes the outer
 *    filter for images - the two `invert(1) hue-rotate(180deg)` steps are literal self-inverses
 *    (`invert` is its own inverse at 100%, same for a 180° hue rotation), so a photo, QR code,
 *    wallet badge, or the logo picked by the resolved media query above round-trips to its
 *    authored pixels exactly, not merely approximately - any other unmatched invert amount on one
 *    side does NOT undo the other exactly (composing e.g. invert(0.87) with invert(1) measurably
 *    shifts every pixel, including image pixels, toward gray). `softenLightBackgrounds`
 *    pre-darkens near-white `background`/`background-color` CSS (never touching `<img>`/`<svg>`
 *    themselves, so this doesn't reopen the round-trip problem) so the *background*, once
 *    inverted, lands near a real dark-mode surface color (Gmail #202124, Outlook ~#201f1e, Apple
 *    ~#1c1c1e) instead of literal #000000, without needing an inexact partial invert to get there.
 *  - The template's own dark block actually sets real colors (`background`/`background-color`/
 *    `color`/`border(-color)`) - it already implements a genuine dark palette, so the resolved CSS
 *    above is already correct as rendered. Blanket-inverting on top of that would invert an
 *    *already-dark* result back toward light, misrepresenting exactly the templates that did the
 *    work to support dark mode themselves. `hasAuthoredDarkPalette` on the return value flags this
 *    so the caller skips applying the whole-iframe filter class. */

// No `\s*` before the capture group: `[^{]*` already matches whitespace, and the two
// overlapping unbounded quantifiers back-to-back gave this super-linear backtracking on input
// with no `{` (SonarCloud typescript:S8786) - dropping the redundant one removes the ambiguity
// without changing what's captured (leading whitespace in the condition still ends up in group 1).
const MEDIA_RULE_RE = /@media([^{]*)\{/gi;
const COLOR_SCHEME_TEST_RE = /prefers-color-scheme\s*:\s*(dark|light)/i;
const COLOR_SCHEME_PAREN_RE = /\(\s*prefers-color-scheme\s*:\s*(?:dark|light)\s*\)/gi;
// `(?<!-)` rejects a match starting right after a hyphen, which is the one case a plain `\b`
// can't tell apart from a real declaration: a custom property like `--brand-color:` or
// `--mycolor-scheme:` contains the same "color:"/"background-color:" substring a real declaration
// would, immediately preceded by a hyphen either way (custom properties always start `--`).
const COLOR_DECL_RE = /(?<!-)\b(background(-color)?|color|border(-color)?)\s*:/i;
const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

/** Which single color-scheme value (if any) this `@media` condition is unambiguously gated on -
 * a bare feature test, a type/feature conjunction (`only screen and (...)`, `(...) and
 * (min-width: 400px)`), and a comma-separated list where *every* alternative names the same value
 * all qualify. Returns null (left untouched, same as before this function existed) for a
 * condition that doesn't mention the feature at all, or a comma-separated list mixing dark and
 * light (or either with an unrelated alternative) - a real "OR" there can't be resolved without
 * evaluating the other alternative against a hypothetical viewport, which this preview has no
 * principled way to fake. */
function colorSchemeGate(condition: string): "dark" | "light" | null {
  let gate: "dark" | "light" | null = null;
  for (const alt of condition.split(",")) {
    const match = COLOR_SCHEME_TEST_RE.exec(alt);
    if (!match) return null;
    const value = (match[1] ?? "").toLowerCase() as "dark" | "light";
    if (gate !== null && gate !== value) return null;
    gate = value;
  }
  return gate;
}

/** Trims a residual condition fragment and drops one leading and/or trailing "and" left behind
 * by removing the color-scheme feature it used to be conjoined with - plain string methods
 * instead of a `\s+and\s*$`-shaped regex, which SonarCloud (typescript:S8786) flagged for
 * super-linear backtracking on a long run of whitespace with no literal "and" to terminate it. */
function stripAndBoundaries(alt: string): string {
  let s = alt.trim();
  if (s.toLowerCase().startsWith("and ")) s = s.slice(4).trim();
  if (s.toLowerCase().endsWith(" and")) s = s.slice(0, -4).trim();
  return s;
}

/** What's left of a color-scheme-gated condition once the `(prefers-color-scheme: ...)` feature
 * test itself is removed - `""` for a bare condition (the block should always apply once
 * resolved), otherwise a real residual condition (e.g. `(max-width: 400px)` out of `(prefers-
 * color-scheme: dark) and (max-width: 400px)`) that still needs to gate the block, so a
 * width-conditioned rule doesn't start applying at every preview width just because the preview
 * forced its color-scheme half. */
function residualCondition(condition: string): string {
  return condition
    .replace(COLOR_SCHEME_PAREN_RE, "")
    .split(",")
    .map(stripAndBoundaries)
    .filter(Boolean)
    .join(", ");
}

/** Finds the `{...}` body following a matched `@media (...)` header by counting brace depth,
 * since the body itself contains nested selector blocks with their own braces - a non-greedy
 * regex can't close on the right `}`. Returns the body's start/end offsets (exclusive of the
 * outer braces) plus the whole block's end offset (inclusive of the closing brace), or null if
 * the CSS is malformed (unbalanced braces) and this block can't be resolved. */
function findMediaBlock(css: string, headerEnd: number): { bodyStart: number; bodyEnd: number; blockEnd: number } | null {
  let depth = 1;
  for (let i = headerEnd; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        return { bodyStart: headerEnd, bodyEnd: i, blockEnd: i + 1 };
      }
    }
  }
  return null;
}

/** Removes every `@media {...}` block from `css` regardless of what it's conditioned on, using
 * the same brace-depth counter as the color-scheme resolution above so nested rule blocks inside
 * a media query don't confuse it. Used to give `extractFilterRules` only top-level rules to look
 * at - a `filter:` declaration that only applies inside some other, still-conditional media query
 * (e.g. a mobile breakpoint) isn't reliably "authored" for this fixed-width preview either way. */
function stripAllMediaBlocks(css: string): string {
  let result = "";
  let cursor = 0;
  const re = /@media([^{]*)\{/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    const block = findMediaBlock(css, re.lastIndex);
    if (!block) break;
    result += css.slice(cursor, match.index);
    cursor = block.blockEnd;
    re.lastIndex = cursor;
  }
  result += css.slice(cursor);
  return result;
}

function transformColorSchemeBlocks(css: string, mode: "light" | "dark"): { css: string; hadColorDeclaration: boolean } {
  let result = "";
  let cursor = 0;
  let hadColorDeclaration = false;
  MEDIA_RULE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MEDIA_RULE_RE.exec(css))) {
    const condition = match[1] ?? "";
    const gate = colorSchemeGate(condition);
    if (!gate) continue; // not color-scheme-gated, or an unsafe/mixed OR-list - leave as literal, browser-dependent CSS
    const block = findMediaBlock(css, MEDIA_RULE_RE.lastIndex);
    if (!block) break;
    result += css.slice(cursor, match.index);
    if (gate === mode) {
      // Matches the forced mode: keep the rules, dropping only the color-scheme half of the
      // condition. A bare condition disappears entirely (the rules always apply, and still win
      // the cascade coming after the light-mode defaults in source order); any residual condition
      // (width, other media features) is kept as a real `@media` wrapper for the iframe to
      // evaluate normally. A block gating the *other* mode is dropped entirely (mode !== gate
      // falls through without emitting anything), same as a plain light-mode strip always did.
      const body = css.slice(block.bodyStart, block.bodyEnd);
      const residual = residualCondition(condition);
      result += residual ? `@media ${residual}{${body}}` : body;
      if (mode === "dark" && COLOR_DECL_RE.test(body.replace(CSS_COMMENT_RE, ""))) hadColorDeclaration = true;
    }
    cursor = block.blockEnd;
    MEDIA_RULE_RE.lastIndex = cursor;
  }
  result += css.slice(cursor);
  return { css: result, hadColorDeclaration };
}

const LIGHT_BG_RE = /(?<!-)(background(?:-color)?\s*:\s*)#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
const LIGHT_BGCOLOR_ATTR_RE = /(bgcolor\s*=\s*["'])#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})(["'])/g;
/** Scaling every channel down by this much before the exact `invert(1)` filter runs is
 * equivalent, for backgrounds, to the softer `invert(0.87)` this preview used before it was
 * found to also (measurably, incorrectly) soften every image - #ffffff still lands within a
 * pixel of the same #202124-ish result, but now via a source-text rewrite that never touches
 * `<img>`/`<svg>`, so the *runtime* filter pair can stay an exact, provable self-inverse. */
const DARKEN_FACTOR = 0.87;
/** Below this, a channel is no longer "near white" - leave mid-tone/saturated colors (including
 * the brand red used elsewhere in a real template) alone; only literal near-white page/card
 * backgrounds get pre-darkened. */
const LIGHT_CHANNEL_THRESHOLD = 200;

function darkenHex(hex: string): string {
  const full = hex.length === 3 ? hex.replace(/./g, "$&$&") : hex;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  if (Math.min(r, g, b) < LIGHT_CHANNEL_THRESHOLD) return `#${full}`;
  const scale = (c: number) => Math.round(c * DARKEN_FACTOR).toString(16).padStart(2, "0");
  return `#${scale(r)}${scale(g)}${scale(b)}`;
}

function softenLightBackgrounds(html: string): string {
  return html
    .replace(LIGHT_BG_RE, (_full, prefix: string, hex: string) => `${prefix}${darkenHex(hex)}`)
    .replace(LIGHT_BGCOLOR_ATTR_RE, (_full, prefix: string, hex: string, suffix: string) => `${prefix}${darkenHex(hex)}${suffix}`);
}

const FILTER_DECL_RE = /filter\s*:\s*([^;]+)/i;

/** Best-effort: extracts `selector{...filter:VALUE...}` pairs from CSS with every `@media` block
 * already removed (`stripAllMediaBlocks`), so this only ever sees flat, non-nested rule bodies -
 * a naive single-level scan, not a real CSS parser. Good enough to find a template's own class-
 * based image filter (e.g. a dark-mode logo recolored with `brightness(0) invert(1)`) without
 * needing a full selector/specificity engine. Finds each rule's `{`/`}` pair with plain
 * `indexOf` rather than a `([^{}]+)\{([^{}]*)\}` regex - two adjacent unbounded character-class
 * quantifiers like that gave SonarCloud (typescript:S8786) the same super-linear backtracking
 * concern as the media-query matcher above, and `indexOf` is worst-case linear by construction. */
function extractFilterRules(css: string): Array<{ selector: string; filter: string }> {
  const rules: Array<{ selector: string; filter: string }> = [];
  let cursor = 0;
  while (cursor < css.length) {
    const openIndex = css.indexOf("{", cursor);
    if (openIndex === -1) break;
    const closeIndex = css.indexOf("}", openIndex + 1);
    if (closeIndex === -1) break;
    const selector = css.slice(cursor, openIndex).trim();
    const body = css.slice(openIndex + 1, closeIndex);
    const filterMatch = FILTER_DECL_RE.exec(body);
    if (filterMatch) rules.push({ selector, filter: (filterMatch[1] ?? "").trim() });
    cursor = closeIndex + 1;
  }
  return rules;
}

/** The template's own authored filter for this element, if any - its inline `style` (which is
 * what actually applies in a real browser when both an inline and a class-based filter exist)
 * takes priority over a matching class-based rule, matching normal CSS cascade behavior. */
function authoredFilterFor(el: Element, rules: Array<{ selector: string; filter: string }>): string {
  const inlineMatch = FILTER_DECL_RE.exec(el.getAttribute("style") ?? "");
  if (inlineMatch) return (inlineMatch[1] ?? "").trim();
  let matched = "";
  for (const rule of rules) {
    try {
      if (el.matches(rule.selector)) matched = rule.filter;
    } catch {
      // A selector this naive extractor mis-scanned, or one `matches()` doesn't support on a
      // detached document - skip it rather than let one bad rule break every image.
    }
  }
  return matched;
}

/** Resolves every `<style>` tag's color-scheme media blocks in place for `mode`, returning
 * whether any of them counts as an authored dark palette (see the file-level doc comment). */
function resolveColorSchemeStyles(doc: Document, mode: "light" | "dark"): boolean {
  let hasAuthoredDarkPalette = false;
  for (const styleEl of doc.querySelectorAll("style")) {
    if (!styleEl.textContent) continue;
    const transformed = transformColorSchemeBlocks(styleEl.textContent, mode);
    styleEl.textContent = transformed.css;
    if (transformed.hadColorDeclaration) hasAuthoredDarkPalette = true;
  }
  return hasAuthoredDarkPalette;
}

/** Sets the fallback-simulation counter-filter on every `img`/`svg` in `doc`, composed with
 * whatever filter that element already authors (inline, or via a matching top-level CSS rule)
 * instead of replacing it - see the file-level doc comment. */
function applyImageCounterFilters(doc: Document): void {
  const allCss = [...doc.querySelectorAll("style")].map((el) => el.textContent ?? "").join("\n");
  const filterRules = extractFilterRules(stripAllMediaBlocks(allCss));
  for (const el of doc.querySelectorAll("img, svg")) {
    const authored = authoredFilterFor(el, filterRules);
    const composed = authored ? `${authored} invert(1) hue-rotate(180deg)` : "invert(1) hue-rotate(180deg)";
    const existingStyle = el.getAttribute("style") ?? "";
    const separator = existingStyle && !existingStyle.trim().endsWith(";") ? ";" : "";
    el.setAttribute("style", `${existingStyle}${separator}filter:${composed} !important`);
  }
}

export function forcePreviewColorScheme(html: string, mode: "light" | "dark"): { html: string; hasAuthoredDarkPalette: boolean } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const hasAuthoredDarkPalette = resolveColorSchemeStyles(doc, mode);

  const applyFallbackInversion = mode === "dark" && !hasAuthoredDarkPalette;
  if (applyFallbackInversion) applyImageCounterFilters(doc);

  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>` : "";
  let out = doctype + doc.documentElement.outerHTML;
  if (applyFallbackInversion) out = softenLightBackgrounds(out);
  return { html: out, hasAuthoredDarkPalette };
}
