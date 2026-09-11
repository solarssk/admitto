/** The preview iframe is `sandbox=""` (no scripts), so we can't emulate `prefers-color-scheme`
 * the way a real browser devtools panel does - there is no JS running inside it to react to a
 * media-query change. Instead, before the HTML is handed to the iframe, this rewrites every
 * `@media (prefers-color-scheme: dark) {...}` block found in the document's `<style>` text so the
 * chosen mode always wins, deterministically, regardless of what the *actual* browser/OS reports
 * (Safari always follows the OS appearance for this; Chromium browsers can override it
 * independently, so the same template's dark-mode logo swap could render inconsistently).
 *
 * Resolving that media query alone only changes whatever the template's own author chose to make
 * dark-reactive. Two cases:
 *  - The template only swaps something cosmetic (commonly just a logo) and never touches
 *    background/text/border colors in its dark block - most of the email stays exactly as
 *    authored, flatly light. For this case we ALSO simulate a full dark rendering: a CSS
 *    `filter: invert(1) hue-rotate(180deg)` on the whole iframe (communication.css) turns light
 *    backgrounds dark and dark text light with no per-template color knowledge needed, and a
 *    matching counter-filter on `img`/`svg` (injected below) exactly undoes it for images - the
 *    two `invert(1) hue-rotate(180deg)` filters are literal self-inverses (`invert` is its own
 *    inverse at 100%, same for a 180° hue rotation), so a photo, QR code, wallet badge, or the
 *    logo picked by the resolved media query above round-trips to its authored pixels exactly,
 *    not merely approximately - any other unmatched invert amount on one side does NOT undo the
 *    other exactly (composing e.g. invert(0.87) with invert(1) measurably shifts every pixel,
 *    including image pixels, toward gray). `softenLightBackgrounds` pre-darkens near-white
 *    `background`/`background-color` CSS (never touching `<img>`/`<svg>` themselves, so this
 *    doesn't reopen the round-trip problem) so the *background*, once inverted, lands near a real
 *    dark-mode surface color (Gmail #202124, Outlook ~#201f1e, Apple ~#1c1c1e) instead of literal
 *    #000000, without needing an inexact partial invert to get there.
 *  - The template's own dark block actually sets real colors (`background`/`background-color`/
 *    `color`/`border(-color)`) - it already implements a genuine dark palette, so the resolved CSS
 *    above is already correct as rendered. Blanket-inverting on top of that would invert an
 *    *already-dark* result back toward light, misrepresenting exactly the templates that did the
 *    work to support dark mode themselves. `hasAuthoredDarkPalette` on the return value flags this
 *    so the caller skips applying the whole-iframe filter class. */

const MEDIA_RULE_RE = /@media\s*([^{]*)\{/gi;
const DARK_FEATURE_RE = /prefers-color-scheme\s*:\s*dark/i;
const COLOR_DECL_RE = /\b(background(-color)?|color|border(-color)?)\s*:/i;

/** True for a bare `(prefers-color-scheme: dark)` condition, a type/feature conjunction like
 * `only screen and (prefers-color-scheme: dark)` or `(prefers-color-scheme: dark) and
 * (min-width: 400px)`, and a comma-separated list where *every* alternative mentions the dark
 * feature. False (left untouched, same as before this function existed) for a comma-separated
 * list mixing a dark alternative with an unrelated one (e.g. `(prefers-color-scheme: dark),
 * (max-width: 500px)`) - a real "OR" there can't be resolved without evaluating the other
 * alternative against a hypothetical viewport, which this preview has no principled way to fake. */
function isDarkReactiveCondition(condition: string): boolean {
  if (!DARK_FEATURE_RE.test(condition)) return false;
  return condition.split(",").every((alt) => DARK_FEATURE_RE.test(alt));
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

function transformDarkModeBlocks(css: string, mode: "light" | "dark"): { css: string; hadColorDeclaration: boolean } {
  let result = "";
  let cursor = 0;
  let hadColorDeclaration = false;
  MEDIA_RULE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MEDIA_RULE_RE.exec(css))) {
    if (!isDarkReactiveCondition(match[1] ?? "")) continue; // not dark-reactive, or an unsafe OR-list - leave as literal, browser-dependent CSS
    const block = findMediaBlock(css, MEDIA_RULE_RE.lastIndex);
    if (!block) break;
    result += css.slice(cursor, match.index);
    // "dark": keep the rules but drop the @media wrapper, so they always apply (and still win
    // the cascade, since they come after the light-mode defaults in source order). "light":
    // drop the whole block, leaving only the light-mode defaults declared earlier in the file.
    if (mode === "dark") {
      const body = css.slice(block.bodyStart, block.bodyEnd);
      result += body;
      if (COLOR_DECL_RE.test(body)) hadColorDeclaration = true;
    }
    cursor = block.blockEnd;
    MEDIA_RULE_RE.lastIndex = cursor;
  }
  result += css.slice(cursor);
  return { css: result, hadColorDeclaration };
}

const LIGHT_BG_RE = /(background(?:-color)?\s*:\s*)#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
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
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Math.min(r, g, b) < LIGHT_CHANNEL_THRESHOLD) return `#${full}`;
  const scale = (c: number) => Math.round(c * DARKEN_FACTOR).toString(16).padStart(2, "0");
  return `#${scale(r)}${scale(g)}${scale(b)}`;
}

function softenLightBackgrounds(html: string): string {
  return html
    .replace(LIGHT_BG_RE, (_full, prefix: string, hex: string) => `${prefix}${darkenHex(hex)}`)
    .replace(LIGHT_BGCOLOR_ATTR_RE, (_full, prefix: string, hex: string, suffix: string) => `${prefix}${darkenHex(hex)}${suffix}`);
}

export function forcePreviewColorScheme(html: string, mode: "light" | "dark"): { html: string; hasAuthoredDarkPalette: boolean } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let hasAuthoredDarkPalette = false;
  for (const styleEl of doc.querySelectorAll("style")) {
    if (!styleEl.textContent) continue;
    const transformed = transformDarkModeBlocks(styleEl.textContent, mode);
    styleEl.textContent = transformed.css;
    if (transformed.hadColorDeclaration) hasAuthoredDarkPalette = true;
  }

  const applyFallbackInversion = mode === "dark" && !hasAuthoredDarkPalette;
  if (applyFallbackInversion) {
    const counterInvert = doc.createElement("style");
    counterInvert.textContent = "img,svg{filter:invert(1) hue-rotate(180deg) !important}";
    doc.head.appendChild(counterInvert);
  }

  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>` : "";
  let out = doctype + doc.documentElement.outerHTML;
  if (applyFallbackInversion) out = softenLightBackgrounds(out);
  return { html: out, hasAuthoredDarkPalette };
}
