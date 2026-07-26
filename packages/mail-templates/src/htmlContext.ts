export interface HtmlAttributeContext {
  inTag: boolean;
  inQuotedAttribute: boolean;
  /** Set when the placeholder sits in an unquoted attribute value. */
  unquotedAttributeName: string | null;
  /** Set when the placeholder sits in opening-tag markup outside any attribute value. */
  inBareTagMarkup: boolean;
}

const EMPTY_CONTEXT: HtmlAttributeContext = {
  inTag: false,
  inQuotedAttribute: false,
  unquotedAttributeName: null,
  inBareTagMarkup: false,
};

/** True inside `<!-- ... -->`, including Outlook `<!--[if mso]>...<![endif]-->` blocks. */
export function isPlaceholderInHtmlComment(html: string, index: number): boolean {
  const commentStart = html.lastIndexOf("<!--", index);
  if (commentStart === -1) return false;
  const commentEnd = html.indexOf("-->", commentStart);
  return commentEnd === -1 || commentEnd + 2 > index;
}

/** True when `index` is still within the same opening tag (quote-aware `>` handling). */
function isStillInsideOpeningTag(html: string, tagStart: number, index: number): boolean {
  let inQuote: '"' | "'" | null = null;
  for (let i = tagStart + 1; i < index; i++) {
    const ch = html.charAt(i);
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === ">") return false;
    if (ch === "/" && html.charAt(i + 1) === ">") return false;
  }
  return true;
}

/** Mutable scan state tracked while walking the characters of an opening tag. */
interface AttributeScanState {
  inQuote: '"' | "'" | null;
  pendingAttr: string | null;
  unquotedAttributeName: string | null;
  inUnquotedValue: boolean;
}

/**
 * Returns the start index (the `<`) of the opening tag containing `index`, or `null`
 * if `index` isn't inside a relevant opening tag (comment, closing tag, doctype, etc.).
 */
function findOpeningTagStart(html: string, index: number): number | null {
  if (isPlaceholderInHtmlComment(html, index)) return null;

  const tagStart = html.lastIndexOf("<", index);
  if (tagStart === -1) return null;

  // Skip closing tags, comments, doctype, and processing instructions.
  const tagOpen = html.slice(tagStart, tagStart + 4);
  if (tagOpen.startsWith("</") || tagOpen.startsWith("<!--") || tagOpen.startsWith("<!")) {
    return null;
  }

  if (!isStillInsideOpeningTag(html, tagStart, index)) return null;

  return tagStart;
}

/** Advances past the tag name (e.g. `div` in `<div ...>`) and returns the index right after it. */
function skipTagName(html: string, tagStart: number, index: number): number {
  let i = tagStart + 1;
  while (i < index && /[A-Za-z0-9-]/.test(html.charAt(i))) i++;
  return i;
}

/** Handles one character while inside a quoted attribute value. */
function advanceInQuotedValue(ch: string, state: AttributeScanState): void {
  if (ch === state.inQuote) {
    state.inQuote = null;
    state.pendingAttr = null;
    state.unquotedAttributeName = null;
    state.inUnquotedValue = false;
  }
}

/** Handles one character while inside an unquoted attribute value. */
function advanceInUnquotedValue(ch: string, state: AttributeScanState): void {
  if (/\s/.test(ch)) {
    state.inUnquotedValue = false;
    state.unquotedAttributeName = null;
  }
}

/** Handles the `=` after a pending attribute name: enters a quoted or unquoted value. */
function enterAttributeValue(html: string, i: number, index: number, state: AttributeScanState): number {
  let next = i + 1;
  while (next < index && /\s/.test(html.charAt(next))) next++;
  if (next < index && (html.charAt(next) === '"' || html.charAt(next) === "'")) {
    state.inQuote = html.charAt(next) as '"' | "'";
    state.unquotedAttributeName = null;
    next++;
  } else {
    state.unquotedAttributeName = state.pendingAttr;
    state.inUnquotedValue = true;
  }
  state.pendingAttr = null;
  return next;
}

/**
 * Processes the character at `i`, mutating `state` as needed, and returns the next
 * index to resume scanning from, or `null` when the opening tag ends here.
 */
function advanceTagScan(
  html: string,
  i: number,
  index: number,
  state: AttributeScanState,
): number | null {
  const ch = html.charAt(i);

  if (state.inQuote) {
    advanceInQuotedValue(ch, state);
    return i + 1;
  }

  if (state.inUnquotedValue) {
    advanceInUnquotedValue(ch, state);
    return i + 1;
  }

  if (/\s/.test(ch)) return i + 1;

  if (ch === ">" || (ch === "/" && html.charAt(i + 1) === ">")) return null;

  if (ch === "=") {
    if (state.pendingAttr) return enterAttributeValue(html, i, index, state);
    return i + 1;
  }

  if (/[A-Za-z]/.test(ch)) {
    const nameStart = i;
    let j = i;
    while (j < index && /[\w-]/.test(html.charAt(j))) j++;
    state.pendingAttr = html.slice(nameStart, j);
    return j;
  }

  return i + 1;
}

/** Scans the attribute portion of an opening tag from `start` up to (excluding) `index`. */
function scanOpeningTagAttributes(html: string, start: number, index: number): AttributeScanState {
  const state: AttributeScanState = {
    inQuote: null,
    pendingAttr: null,
    unquotedAttributeName: null,
    inUnquotedValue: false,
  };

  let i = start;
  while (i < index) {
    const next = advanceTagScan(html, i, index, state);
    if (next === null) break;
    i = next;
  }

  return state;
}

/**
 * Parses the opening HTML tag containing `index` and returns whether the position
 * is inside a quoted attribute value or an unquoted one.
 *
 * Ignores `=` sequences inside quoted values (e.g. type="VIP" inside title='...').
 */
export function getHtmlAttributeContext(html: string, index: number): HtmlAttributeContext {
  const tagStart = findOpeningTagStart(html, index);
  if (tagStart === null) return EMPTY_CONTEXT;

  const afterTagName = skipTagName(html, tagStart, index);
  const state = scanOpeningTagAttributes(html, afterTagName, index);

  return {
    inTag: true,
    inQuotedAttribute: state.inQuote !== null,
    unquotedAttributeName: state.unquotedAttributeName,
    inBareTagMarkup:
      state.inQuote === null && !state.inUnquotedValue && state.unquotedAttributeName === null,
  };
}

export function isInsideQuotedAttribute(html: string, index: number): boolean {
  return getHtmlAttributeContext(html, index).inQuotedAttribute;
}
