export interface HtmlAttributeContext {
  inTag: boolean;
  inQuotedAttribute: boolean;
  /** Set when the placeholder sits in an unquoted attribute value. */
  unquotedAttributeName: string | null;
}

const EMPTY_CONTEXT: HtmlAttributeContext = {
  inTag: false,
  inQuotedAttribute: false,
  unquotedAttributeName: null,
};

function isInsideHtmlComment(html: string, index: number): boolean {
  const commentStart = html.lastIndexOf("<!--", index);
  if (commentStart === -1) return false;
  const commentEnd = html.indexOf("-->", commentStart);
  return commentEnd === -1 || commentEnd + 2 > index;
}

/** True when `index` is still within the same opening tag (quote-aware `>` handling). */
function isStillInsideOpeningTag(html: string, tagStart: number, index: number): boolean {
  let inQuote: '"' | "'" | null = null;
  for (let i = tagStart + 1; i < index; i++) {
    const ch = html[i]!;
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === ">") return false;
    if (ch === "/" && html[i + 1] === ">") return false;
  }
  return true;
}

/**
 * Parses the opening HTML tag containing `index` and returns whether the position
 * is inside a quoted attribute value or an unquoted one.
 *
 * Ignores `=` sequences inside quoted values (e.g. type="VIP" inside title='...').
 */
export function getHtmlAttributeContext(html: string, index: number): HtmlAttributeContext {
  if (isInsideHtmlComment(html, index)) return EMPTY_CONTEXT;

  const tagStart = html.lastIndexOf("<", index);
  if (tagStart === -1) return EMPTY_CONTEXT;

  // Skip closing tags, comments, doctype, and processing instructions.
  const tagOpen = html.slice(tagStart, tagStart + 4);
  if (tagOpen.startsWith("</") || tagOpen.startsWith("<!--") || tagOpen.startsWith("<!")) {
    return EMPTY_CONTEXT;
  }

  if (!isStillInsideOpeningTag(html, tagStart, index)) return EMPTY_CONTEXT;

  let i = tagStart + 1;
  while (i < index && /[A-Za-z0-9-]/.test(html[i]!)) i++;

  let inQuote: '"' | "'" | null = null;
  let pendingAttr: string | null = null;
  let unquotedAttributeName: string | null = null;
  let inUnquotedValue = false;

  while (i < index) {
    const ch = html[i]!;

    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
        pendingAttr = null;
        unquotedAttributeName = null;
        inUnquotedValue = false;
      }
      i++;
      continue;
    }

    if (inUnquotedValue) {
      if (/\s/.test(ch)) {
        inUnquotedValue = false;
        unquotedAttributeName = null;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === ">" || (ch === "/" && html[i + 1] === ">")) {
      break;
    }

    if (ch === "=") {
      if (pendingAttr) {
        i++;
        while (i < index && /\s/.test(html[i]!)) i++;
        if (i < index && (html[i] === '"' || html[i] === "'")) {
          inQuote = html[i] as '"' | "'";
          unquotedAttributeName = null;
          i++;
        } else {
          unquotedAttributeName = pendingAttr;
          inUnquotedValue = true;
        }
        pendingAttr = null;
      } else {
        i++;
      }
      continue;
    }

    if (/[A-Za-z]/.test(ch)) {
      const nameStart = i;
      while (i < index && /[\w-]/.test(html[i]!)) i++;
      pendingAttr = html.slice(nameStart, i);
      continue;
    }

    i++;
  }

  return {
    inTag: true,
    inQuotedAttribute: inQuote !== null,
    unquotedAttributeName,
  };
}

export function isInsideQuotedAttribute(html: string, index: number): boolean {
  return getHtmlAttributeContext(html, index).inQuotedAttribute;
}
