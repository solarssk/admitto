/**
 * The one door for the HTML of a legal text (SEC-17). An organiser's editor sends HTML; it is cleaned
 * here, once, on save, and only the cleaned markup is ever stored or served. The page that serves it
 * adds a second layer (the zero-script headers of the ticket page), but this list is the first.
 *
 * Allowlist, not blocklist: a tag or attribute that is not named below is gone (its text stays, apart
 * from the containers listed in NON_TEXT_TAGS, whose text is not content). There is no `style`,
 * `class`, `id`, `on*`, image, table, form or frame. The only attribute is `href` on a link, and an
 * `href` is kept only when it is an absolute http, https or mailto URL.
 *
 * Server side only: `sanitize-html` must never reach the admin bundle (apps/admin does not import
 * this file).
 *
 * One rule about the library: nothing here renames a tag inside sanitize-html (no `transformTags`
 * that changes a name). When a renamed tag is dropped, sanitize-html keeps its rename in a table that
 * is not cleared, and the next tag that closes at the same depth is closed with the wrong name; the
 * text around a link that was refused (a `tel:` link, a Word bookmark) came out restructured. Tags
 * are folded afterwards, on the library's own canonical output (foldTags).
 */
import sanitizeHtml from "sanitize-html";
import { toDatabaseText } from "@admitto/shared";

/** The only elements that survive. Headings start at h2: the page itself carries the one h1. */
export const LEGAL_HTML_ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "h2",
  "h3",
  "h4",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
] as const;

/** What an editor's commands and a pasted page use for the same things, and what each becomes. */
export const LEGAL_HTML_FOLDED_TAGS: ReadonlyMap<string, string> = new Map([
  ["h1", "h2"],
  ["h5", "h4"],
  ["h6", "h4"],
  ["b", "strong"],
  ["i", "em"],
]);

/** The only URL schemes of a link. Relative and protocol-relative references are dropped too. */
export const LEGAL_HTML_ALLOWED_SCHEMES = ["http", "https", "mailto"] as const;

/** Elements whose content is not text to read: dropped with their text, not unwrapped. The first five
 * are sanitize-html's own default; the rest are containers a pasted page brings along. */
const NON_TEXT_TAGS = [
  "script",
  "style",
  "textarea",
  "option",
  "xmp",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "noembed",
  "noframes",
  "title",
  "head",
  "svg",
  "math",
];

/** Deeper than any real text; what is nested beyond it is unwrapped. */
const MAX_NESTING = 12;

/** Cleaning is repeated until the markup stops changing; no input seen so far needs more than three. */
const MAX_PASSES = 4;

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(LEGAL_HTML_ALLOWED_SCHEMES.map((scheme) => `${scheme}:`));

/** The link in the form the browser will read it, or null when it must not be a link. Parsing with
 * the URL standard (as a browser does) strips the tabs, newlines and spaces that hide a
 * `java\tscript:` scheme, and the serialised form is what is stored, so the stored URL means the
 * same to the next parser as to this one. A reference without a scheme does not parse and is dropped. */
function safeHref(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  // https://trusted.example@elsewhere.example reads as a link to the first and goes to the second.
  if (url.username !== "" || url.password !== "") return null;
  return url.href;
}

/** A link keeps its name and gets nothing but a safe `href`. One that has none is removed by
 * `exclusiveFilter` below, and its text stays. */
const transformLink: sanitizeHtml.Transformer = (tagName, attribs) => {
  const href = safeHref(attribs["href"]);
  const attributes: sanitizeHtml.Attributes = href === null ? {} : { href };
  return { tagName, attribs: attributes };
};

/** A link inside a link is not valid HTML. A browser repairs it by closing the outer link first, so
 * the markup it ends up with is not the markup that was cleaned: exactly the disagreement between a
 * sanitiser's parser and a browser that bypasses sanitisers. The inner link loses its `href` here
 * and is removed with the other links that are not links. Counted per call, so the state is new
 * every time. */
function withoutNestedLinks(): Pick<sanitizeHtml.IOptions, "onOpenTag" | "onCloseTag"> {
  let open = 0;
  return {
    onOpenTag: (name, attribs) => {
      if (name !== "a") return;
      if (open > 0) delete attribs["href"];
      open += 1;
    },
    onCloseTag: (name) => {
      if (name === "a" && open > 0) open -= 1;
    },
  };
}

const OPTIONS: sanitizeHtml.IOptions = {
  // What is let through here includes the tags foldTags then renames.
  allowedTags: [...LEGAL_HTML_ALLOWED_TAGS, ...LEGAL_HTML_FOLDED_TAGS.keys()],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: [...LEGAL_HTML_ALLOWED_SCHEMES],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  // A tag that is not allowed is removed and its text kept.
  disallowedTagsMode: "discard",
  nonTextTags: NON_TEXT_TAGS,
  nestingLimit: MAX_NESTING,
  transformTags: { a: transformLink },
  exclusiveFilter: (frame) => (frame.tag === "a" && !frame.attribs["href"] ? "excludeTag" : false),
};

/** Only the text of some markup. */
const TEXT_ONLY: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  nonTextTags: NON_TEXT_TAGS,
};

/** A control character that is not a tab, a line feed or a carriage return. Zero-width and
 * direction marks stay: scripts such as Persian and Hindi need them in a word. */
function dropControlCharacters(text: string): string {
  return text.replace(/\p{Cc}/gu, (char) => (char === "\t" || char === "\n" || char === "\r" ? char : ""));
}

/** Renames the folded tags. Exact, because it only ever reads what sanitize-html wrote: a tag that
 * survives has no attribute, is lower case and is written as `<name>` or `</name>`, and a `<` in
 * text or in an attribute value is written as `&lt;`. */
function foldTags(html: string): string {
  return html.replace(/<(\/?)(h1|h5|h6|b|i)>/g, (_tag, slash: string, name: string) => {
    return `<${slash}${LEGAL_HTML_FOLDED_TAGS.get(name) ?? name}>`;
  });
}

/** One pass of cleaning. Control characters are dropped from what comes out too, because a
 * character reference such as `&#1;` only becomes a control character while it is parsed. */
function cleanOnce(html: string): string {
  return dropControlCharacters(foldTags(sanitizeHtml(html, { ...OPTIONS, ...withoutNestedLinks() })));
}

/** Runs `clean` until its output equals its input; null when that has not happened after `passes`
 * runs. Cleaning clean markup must give it back unchanged, and when it keeps changing, the parser
 * and a browser are not going to agree about the markup. */
export function cleanUntilStable(input: string, clean: (html: string) => string, passes: number = MAX_PASSES): string | null {
  let current = input;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = clean(current);
    if (next === current) return next;
    current = next;
  }
  return null;
}

/**
 * The cleaned HTML of a legal text: an empty string when nothing is left of it, and null when it
 * is refused because cleaning it does not settle (see cleanUntilStable).
 */
export function sanitizeLegalHtml(raw: string): string | null {
  const settled = cleanUntilStable(dropControlCharacters(toDatabaseText(raw)), cleanOnce);
  return settled === null ? null : settled.trim();
}

/** False for markup that shows nothing a reader could read: no text, or only spaces and invisible
 * characters (a text of `<p>&nbsp;</p>` is an empty page, not a published one). */
export function legalHtmlHasVisibleText(html: string): boolean {
  return /[^\p{White_Space}\p{Default_Ignorable_Code_Point}]/u.test(sanitizeHtml(html, TEXT_ONLY));
}
