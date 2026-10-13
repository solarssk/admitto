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

/** Reads comment membership at ascending offsets without searching the prefix again. */
export function createHtmlCommentContextReader(html: string): (index: number) => boolean {
  let nextStart = html.indexOf("<!--");
  let seenComment = false;
  let commentEnd = -1;
  return (index) => {
    while (nextStart !== -1 && nextStart <= index) {
      if (!seenComment || (commentEnd !== -1 && commentEnd < nextStart)) {
        commentEnd = html.indexOf("-->", nextStart);
      }
      seenComment = true;
      nextStart = html.indexOf("<!--", nextStart + 1);
    }
    return seenComment && (commentEnd === -1 || commentEnd + 2 > index);
  };
}

/** True inside `<!-- ... -->`, including Outlook conditional comments. */
export function isPlaceholderInHtmlComment(html: string, index: number): boolean {
  return createHtmlCommentContextReader(html)(index);
}

/** Mutable scan state tracked while walking the characters of an opening tag. */
interface AttributeScanState {
  inQuote: '"' | "'" | null;
  pendingAttr: string | null;
  unquotedAttributeName: string | null;
  inUnquotedValue: boolean;
}

interface HtmlScanState {
  cursor: number;
  tagStart: number | null;
  attributes: AttributeScanState;
}

/** Starts the next tag or skips a comment; the cursor never walks backwards. */
function enterNextTag(html: string, index: number, state: HtmlScanState): void {
  const tagStart = html.indexOf("<", state.cursor);
  if (tagStart === -1 || tagStart >= index) {
    state.cursor = tagStart === -1 ? html.length : tagStart;
    return;
  }
  if (html.startsWith("<!--", tagStart)) {
    const end = html.indexOf("-->", tagStart + 4);
    state.cursor = end === -1 ? html.length : end + 3;
    return;
  }
  state.tagStart = tagStart;
  state.attributes = newAttributeScanState();
  state.cursor = skipTagName(html, tagStart, index);
}

/** Walks tag/attribute states once, ignoring literal tag delimiters inside quoted values. */
function advanceHtmlScan(html: string, index: number, state: HtmlScanState): void {
  while (state.cursor < index) {
    if (state.tagStart === null) {
      enterNextTag(html, index, state);
    } else if (!state.attributes.inQuote && html.charAt(state.cursor) === ">") {
      state.tagStart = null;
      state.cursor++;
    } else {
      state.cursor = advanceTagScan(html, state.cursor, index, state.attributes);
    }
  }
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
 * index to resume scanning from.
 */
function advanceTagScan(
  html: string,
  i: number,
  index: number,
  state: AttributeScanState,
): number {
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

  if (ch === "=") {
    if (state.pendingAttr) return enterAttributeValue(html, i, index, state);
    return i + 1;
  }

  // HTML attribute names can start with digits or punctuation (for example 0 or :name).
  if (/[^\s/="'<>]/.test(ch)) {
    const nameStart = i;
    let j = i;
    while (j < index && /[^\s/="'<>]/.test(html.charAt(j))) j++;
    state.pendingAttr = html.slice(nameStart, j);
    return j;
  }

  return i + 1;
}

function newAttributeScanState(): AttributeScanState {
  return { inQuote: null, pendingAttr: null, unquotedAttributeName: null, inUnquotedValue: false };
}

/**
 * Reads contexts at ascending placeholder offsets in one template. Each validation or
 * substitution owns a reader; no template text is retained in a process-wide cache.
 */
export function createHtmlAttributeContextReader(html: string): (index: number) => HtmlAttributeContext {
  const state: HtmlScanState = { cursor: 0, tagStart: null, attributes: newAttributeScanState() };
  const inComment = createHtmlCommentContextReader(html);
  return (index) => {
    advanceHtmlScan(html, index, state);
    if (inComment(index) || state.tagStart === null) return EMPTY_CONTEXT;
    const tagOpen = html.slice(state.tagStart, state.tagStart + 2);
    if (["</", "<!"].includes(tagOpen)) return EMPTY_CONTEXT;
    const attributes = state.attributes;
    return {
      inTag: true,
      inQuotedAttribute: attributes.inQuote !== null,
      unquotedAttributeName: attributes.unquotedAttributeName,
      inBareTagMarkup: attributes.inQuote === null && !attributes.inUnquotedValue,
    };
  };
}

/** Reads a single offset; repeated placeholder callers should own an ascending reader. */
export function getHtmlAttributeContext(html: string, index: number): HtmlAttributeContext {
  return createHtmlAttributeContextReader(html)(index);
}

export function isInsideQuotedAttribute(html: string, index: number): boolean {
  return getHtmlAttributeContext(html, index).inQuotedAttribute;
}
