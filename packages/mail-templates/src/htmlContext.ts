export interface HtmlAttributeContext {
  inTag: boolean;
  inQuotedAttribute: boolean;
  /** Set when the placeholder sits in an unquoted attribute value. */
  unquotedAttributeName: string | null;
}

/**
 * Parses the opening HTML tag containing `index` and returns whether the position
 * is inside a quoted attribute value or an unquoted one.
 *
 * Ignores `=` sequences inside quoted values (e.g. type="VIP" inside title='...').
 */
export function getHtmlAttributeContext(html: string, index: number): HtmlAttributeContext {
  const empty: HtmlAttributeContext = {
    inTag: false,
    inQuotedAttribute: false,
    unquotedAttributeName: null,
  };

  const tagStart = html.lastIndexOf("<", index);
  if (tagStart === -1) return empty;

  const tagClose = html.indexOf(">", tagStart);
  if (tagClose !== -1 && tagClose < index) return empty;

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
