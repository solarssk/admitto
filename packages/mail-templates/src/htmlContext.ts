import { collectHtmlSourceRanges, type SourceRange } from "./htmlTokens.js";

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

/** Reads actual HTML comments at ascending offsets, including bogus declarations. */
export function createHtmlCommentContextReader(html: string): (index: number) => boolean {
  const comments = collectHtmlSourceRanges(html).comments;
  let cursor = 0;
  return (index) => {
    while (comments.at(cursor) && comments.at(cursor)!.endOffset <= index) cursor++;
    const comment = comments.at(cursor);
    return comment !== undefined && comment.startOffset <= index && index < comment.endOffset;
  };
}

/** True inside `<!-- ... -->`, including Outlook conditional comments. */
export function isPlaceholderInHtmlComment(html: string, index: number): boolean {
  return createHtmlCommentContextReader(html)(index);
}

type AttributePhase = "beforeName" | "name" | "afterName" | "beforeValue" |
  "doubleQuoted" | "singleQuoted" | "unquoted" | "afterQuoted" | "selfClosing";
interface AttributeScanState {
  phase: AttributePhase;
  name: string;
}
const HTML_SPACE = /[\t\n\f\r ]/;

/** Tag names end at HTML whitespace, a slash or > (quotes are not tag-name delimiters). */
function skipTagName(html: string, tagStart: number, index: number): number {
  let cursor = tagStart + 1;
  while (cursor < index && /[^\t\n\f\r />]/.test(html.charAt(cursor))) cursor++;
  return cursor;
}

function beginAttribute(ch: string, state: AttributeScanState): void {
  state.phase = "name";
  state.name = ch;
}

function advanceBeforeName(ch: string, state: AttributeScanState): void {
  if (HTML_SPACE.test(ch)) return;
  if (ch === "/") state.phase = "selfClosing";
  else beginAttribute(ch, state);
}

function advanceName(ch: string, state: AttributeScanState): void {
  if (HTML_SPACE.test(ch)) state.phase = "afterName";
  else if (ch === "=") state.phase = "beforeValue";
  else if (ch === "/") state.phase = "selfClosing";
  else state.name += ch;
}

function advanceAfterName(ch: string, state: AttributeScanState): void {
  if (HTML_SPACE.test(ch)) return;
  if (ch === "=") state.phase = "beforeValue";
  else advanceBeforeName(ch, state);
}

function advanceBeforeValue(ch: string, state: AttributeScanState): void {
  if (HTML_SPACE.test(ch)) return;
  if (ch === '"') state.phase = "doubleQuoted";
  else if (ch === "'") state.phase = "singleQuoted";
  else state.phase = "unquoted";
}

/** Attribute states follow HTML tokenization, including malformed but parseable names. */
function advanceTagScan(html: string, cursor: number, state: AttributeScanState): number {
  const ch = html.charAt(cursor);
  switch (state.phase) {
    case "beforeName": advanceBeforeName(ch, state); break;
    case "name": advanceName(ch, state); break;
    case "afterName": advanceAfterName(ch, state); break;
    case "beforeValue": advanceBeforeValue(ch, state); break;
    case "doubleQuoted": if (ch === '"') state.phase = "afterQuoted"; break;
    case "singleQuoted": if (ch === "'") state.phase = "afterQuoted"; break;
    case "unquoted": if (HTML_SPACE.test(ch)) state.phase = "beforeName"; break;
    case "afterQuoted":
    case "selfClosing": state.phase = "beforeName"; return cursor;
  }
  return cursor + 1;
}

function newAttributeScanState(): AttributeScanState {
  return { phase: "beforeName", name: "" };
}

function attributeContext(state: AttributeScanState): HtmlAttributeContext {
  const quoted = state.phase === "doubleQuoted" || state.phase === "singleQuoted";
  const unquoted = state.phase === "unquoted" || state.phase === "beforeValue";
  return {
    inTag: true,
    inQuotedAttribute: quoted,
    unquotedAttributeName: unquoted ? state.name : null,
    inBareTagMarkup: !quoted && !unquoted,
  };
}

/**
 * Reads contexts at ascending placeholder offsets in one template. Each validation or
 * substitution owns a reader; no template text is retained in a process-wide cache.
 */
export function createHtmlAttributeContextReader(html: string): (index: number) => HtmlAttributeContext {
  const ranges = collectHtmlSourceRanges(html);
  const tags = ranges.startTags;
  let tagIndex = 0;
  let activeTag: SourceRange | undefined;
  let cursor = 0;
  let attributes = newAttributeScanState();
  return (index) => {
    while (tags.at(tagIndex) && tags.at(tagIndex)!.endOffset <= index) tagIndex++;
    const tag = tags.at(tagIndex);
    if (!tag || tag.startOffset >= index) {
      return ranges.structuralBoundaries.has(index)
        ? { ...EMPTY_CONTEXT, inTag: true, inBareTagMarkup: true }
        : EMPTY_CONTEXT;
    }
    if (activeTag !== tag) {
      activeTag = tag;
      cursor = skipTagName(html, tag.startOffset, index);
      attributes = newAttributeScanState();
    }
    while (cursor < index) cursor = advanceTagScan(html, cursor, attributes);
    return attributeContext(attributes);
  };
}

/** Reads a single offset; repeated placeholder callers should own an ascending reader. */
export function getHtmlAttributeContext(html: string, index: number): HtmlAttributeContext {
  return createHtmlAttributeContextReader(html)(index);
}

export function isInsideQuotedAttribute(html: string, index: number): boolean {
  return getHtmlAttributeContext(html, index).inQuotedAttribute;
}
