/** The preview iframe is `sandbox=""` (no scripts), so we can't emulate `prefers-color-scheme`
 * the way a real browser devtools panel does - there is no JS running inside it to react to a
 * media-query change. Instead, before the HTML is handed to the iframe, this rewrites every
 * `@media (prefers-color-scheme: dark) {...}` block found in the document's `<style>` text so the
 * chosen mode always wins, regardless of what the *actual* browser/OS reports. See the Safari vs.
 * Brave logo report this was built for: two browsers can disagree on `prefers-color-scheme` for
 * the exact same page, so a real toggle here has to be deterministic rather than relying on it.
 *
 * Resolving that media query alone only changes whatever the template's own author chose to make
 * dark-reactive (often just a logo swap, like the sample template this was built against) - most
 * of a typical email (backgrounds, borders, body text) has no dark variant at all and stays flatly
 * light. To actually show what a dark rendering would look like, the caller also applies a CSS
 * `filter: invert(1) hue-rotate(180deg)` to the whole iframe element (communication.css), which
 * turns light backgrounds dark and dark text light with no per-template color knowledge needed.
 * That inversion would also flip every image (a photo becomes a color negative), so this function
 * injects a counter-filter for `img`/`svg` that inverts them right back - invert then hue-rotate
 * then invert then hue-rotate is the identity transform, so a photographic hero image or a wallet
 * badge round-trips to its original colors. A logo image picked by the (now-resolved) dark-mode
 * CSS above round-trips the same way, so it renders exactly as authored against the new dark
 * background instead of being flattened back to its light-mode colors. */

const MEDIA_DARK_RE = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/gi;

/** Finds the `{...}` body following a matched `@media (prefers-color-scheme: dark)` header by
 * counting brace depth, since the body itself contains nested selector blocks with their own
 * braces - a non-greedy regex can't close on the right `}`. Returns the body's start/end offsets
 * (exclusive of the outer braces) plus the whole block's end offset (inclusive of the closing
 * brace), or null if the CSS is malformed (unbalanced braces) and this block can't be resolved. */
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

function transformDarkModeBlocks(css: string, mode: "light" | "dark"): string {
  let result = "";
  let cursor = 0;
  MEDIA_DARK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MEDIA_DARK_RE.exec(css))) {
    const block = findMediaBlock(css, MEDIA_DARK_RE.lastIndex);
    if (!block) break;
    result += css.slice(cursor, match.index);
    // "dark": keep the rules but drop the @media wrapper, so they always apply (and still win
    // the cascade, since they come after the light-mode defaults in source order). "light":
    // drop the whole block, leaving only the light-mode defaults declared earlier in the file.
    if (mode === "dark") result += css.slice(block.bodyStart, block.bodyEnd);
    cursor = block.blockEnd;
    MEDIA_DARK_RE.lastIndex = cursor;
  }
  result += css.slice(cursor);
  return result;
}

export function forcePreviewColorScheme(html: string, mode: "light" | "dark"): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const styleEl of doc.querySelectorAll("style")) {
    if (styleEl.textContent) styleEl.textContent = transformDarkModeBlocks(styleEl.textContent, mode);
  }
  if (mode === "dark") {
    const counterInvert = doc.createElement("style");
    counterInvert.textContent = "img,svg{filter:invert(1) hue-rotate(180deg) !important}";
    doc.head.appendChild(counterInvert);
  }
  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>` : "";
  return doctype + doc.documentElement.outerHTML;
}
