import { describe, expect, it } from "vitest";
import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import {
  LEGAL_HTML_ALLOWED_SCHEMES,
  LEGAL_HTML_ALLOWED_TAGS,
  LEGAL_HTML_FOLDED_TAGS,
  cleanUntilStable,
  legalHtmlHasVisibleText,
  sanitizeLegalHtml as sanitizeOrRefuse,
} from "../../src/legal/sanitize-legal-html.js";

/** The cleaned HTML. A test that expects a refusal calls `sanitizeOrRefuse`; every other one must not get one. */
function sanitizeLegalHtml(raw: string): string {
  const out = sanitizeOrRefuse(raw);
  if (out === null) throw new Error(`refused: ${JSON.stringify(raw)}`);
  return out;
}

/** The parts of a parse5 node these tests read. */
type ParsedNode = {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: ParsedNode[];
  content?: ParsedNode;
};

/** The markup inside an element, written out the way a browser writes `innerHTML`. */
function innerHtml(node: ParsedNode): string {
  return serialize(node as unknown as DefaultTreeAdapterMap["parentNode"]);
}

/** What a browser makes of the markup when it is the content of the legal page's `<div>`. */
function parseAsPageContent(html: string): ParsedNode {
  const document = parse(`<!DOCTYPE html><html><body><div id="c">${html}</div></body></html>`) as unknown as ParsedNode;
  const found: ParsedNode[] = [];
  walk(document, (node) => {
    if (node.attrs?.some((attr) => attr.name === "id" && attr.value === "c")) found.push(node);
  });
  expect(found).toHaveLength(1);
  return found[0]!;
}

function walk(node: ParsedNode, visit: (node: ParsedNode) => void): void {
  visit(node);
  for (const child of node.childNodes ?? []) walk(child, visit);
  if (node.content) walk(node.content, visit);
}

const ALLOWED_TAGS: ReadonlySet<string> = new Set(LEGAL_HTML_ALLOWED_TAGS);
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(LEGAL_HTML_ALLOWED_SCHEMES.map((scheme) => `${scheme}:`));

/**
 * What must hold for anything the sanitizer returns, whatever went in: parsed the way a browser parses
 * it, the result holds only allowed elements, no attribute but a safe `href` on a link, and no
 * comment or other node a browser could treat as markup. And it is stable: written out by the parser
 * and parsed again it gives the same markup, which is what a mutation-based bypass cannot survive.
 */
function expectSafe(sanitized: string): void {
  const root = parseAsPageContent(sanitized);
  walk(root, (node) => {
    if (node === root) return;
    if (node.nodeName === "#text") return;
    expect(node.nodeName, `unexpected node in ${JSON.stringify(sanitized)}`).toSatisfy((name: string) =>
      ALLOWED_TAGS.has(name),
    );
    const attrs = node.attrs ?? [];
    if (node.tagName !== "a") {
      expect(attrs, `attributes on <${node.tagName}> in ${JSON.stringify(sanitized)}`).toEqual([]);
      return;
    }
    expect(attrs.map((attr) => attr.name)).toEqual(["href"]);
    const url = new URL(attrs[0]!.value);
    expect(ALLOWED_PROTOCOLS.has(url.protocol)).toBe(true);
    expect(url.username + url.password).toBe("");
  });
  const once = innerHtml(root);
  expect(innerHtml(parseAsPageContent(once)), `unstable: ${JSON.stringify(sanitized)}`).toBe(once);
  expectContained(sanitized);
}

/** Nothing the sanitizer returns can leave its container: after it comes the rest of the page, as the
 * parser reads it, and nothing was moved in front of it or out of the content element. */
function expectContained(sanitized: string): void {
  const document = parse(
    `<!DOCTYPE html><html><body><div id="c">${sanitized}</div><p id="after">x</p></body></html>`,
  ) as unknown as ParsedNode;
  const body: ParsedNode[] = [];
  walk(document, (node) => {
    if (node.nodeName === "body") body.push(node);
  });
  expect(body).toHaveLength(1);
  const children = (body[0]!.childNodes ?? []).filter((node) => node.nodeName !== "#text");
  expect(
    children.map((node) => `${node.nodeName}#${node.attrs?.find((attr) => attr.name === "id")?.value}`),
    `escaped its container: ${JSON.stringify(sanitized)}`,
  ).toEqual(["div#c", "p#after"]);
}

describe("the allowlist", () => {
  it("is exactly this: a change to it is a decision, not a side effect", () => {
    expect([...LEGAL_HTML_ALLOWED_TAGS]).toEqual([
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
    ]);
    expect([...LEGAL_HTML_ALLOWED_SCHEMES]).toEqual(["http", "https", "mailto"]);
  });

  it("folds only these tags, into tags that are allowed", () => {
    expect([...LEGAL_HTML_FOLDED_TAGS]).toEqual([
      ["h1", "h2"],
      ["h5", "h4"],
      ["h6", "h4"],
      ["b", "strong"],
      ["i", "em"],
    ]);
    for (const target of LEGAL_HTML_FOLDED_TAGS.values()) expect(ALLOWED_TAGS.has(target)).toBe(true);
  });
});

describe("sanitizeLegalHtml keeps what an editor writes", () => {
  it("leaves clean markup as it is", () => {
    const clean =
      "<h2>Who we are</h2><p>Text with <strong>bold</strong> and <em>italic</em>.<br />Next line.</p>" +
      "<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul><ol><li>first</li></ol>" +
      "<blockquote><p>Quoted.</p></blockquote><hr />";
    expect(sanitizeLegalHtml(clean)).toBe(clean);
  });

  it("keeps a link to a web page or a mail address, in the form a browser reads it", () => {
    expect(sanitizeLegalHtml('<a href="https://example.com/privacy?lang=en&x=1">Policy</a>')).toBe(
      '<a href="https://example.com/privacy?lang=en&amp;x=1">Policy</a>',
    );
    expect(sanitizeLegalHtml('<a href="http://example.com">x</a>')).toBe('<a href="http://example.com/">x</a>');
    expect(sanitizeLegalHtml('<a href="mailto:dpo@example.com">Write to us</a>')).toBe(
      '<a href="mailto:dpo@example.com">Write to us</a>',
    );
    expect(sanitizeLegalHtml('<a href="https://example.com/a b">x</a>')).toBe('<a href="https://example.com/a%20b">x</a>');
  });

  it("folds the tags an editor or a pasted page brings into the allowed ones", () => {
    expect(sanitizeLegalHtml("<h1>Title</h1><h5>Small</h5><h6>Smaller</h6>")).toBe(
      "<h2>Title</h2><h4>Small</h4><h4>Smaller</h4>",
    );
    expect(sanitizeLegalHtml("<p><b>bold</b> <i>italic</i></p>")).toBe("<p><strong>bold</strong> <em>italic</em></p>");
  });

  it("keeps the text of what it removes, escaped", () => {
    expect(sanitizeLegalHtml('<div><span style="color:red">kept</span> &amp; <u>this</u></div>')).toBe("kept &amp; this");
    expect(sanitizeLegalHtml("<p>a &lt;script&gt;alert(1)&lt;/script&gt; b</p>")).toBe(
      "<p>a &lt;script&gt;alert(1)&lt;/script&gt; b</p>",
    );
  });

  it("keeps letters of every script", () => {
    const text = "<p>Zażółć gęślą jaźń, 数据保护, معالجة البيانات, Daten\u00ADschutz</p>";
    expect(sanitizeLegalHtml(text)).toBe(text);
  });

  it("is idempotent", () => {
    for (const html of [
      "<h1>T</h1><p><b>x</b><a href=\"HTTPS://Example.com/A\">l</a></p>",
      "<p>1 &lt; 2 &amp;&amp; 3 &gt; 2</p>",
      "<ul><li>a<li>b</ul>",
      "plain text without markup",
    ]) {
      const once = sanitizeLegalHtml(html);
      expect(sanitizeLegalHtml(once)).toBe(once);
    }
  });
});

/** Real payloads: the classics of the OWASP XSS Filter Evasion list, the vectors of public sanitizer
 * bypasses (namespace confusion, mutation, nesting), and attribute break-outs through a URL. */
const XSS_PAYLOADS: [name: string, payload: string][] = [
  ["script tag", "<script>alert(1)</script>"],
  ["script with a source", "<SCRIPT SRC=//evil.example/x.js></SCRIPT>"],
  ["script split by an inner tag", "<scr<script>ipt>alert(1)</scr</script>ipt>"],
  ["script behind a doubled bracket", "<<script>script>alert(1)<</script>/script>"],
  ["script with NUL", "<scr\u0000ipt>alert(1)</scr\u0000ipt>"],
  ["script in a comment", "<!-- --><script>alert(1)</script><!-- -->"],
  ["conditional comment", "<!--[if gte IE 4]><script>alert(1)</script><![endif]-->"],
  ["CDATA", "<![CDATA[<script>alert(1)</script>]]>"],
  ["image onerror", "<img src=x onerror=alert(1)>"],
  ["image with a javascript source", "<IMG SRC=\"javascript:alert('XSS');\">"],
  ["image with entities", "<IMG SRC=&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;&#97;&#108;&#101;&#114;&#116;&#40;&#39;&#88;&#83;&#83;&#39;&#41;>"],
  ["image srcset", '<img src="x" srcset="javascript:alert(1)">'],
  ["unclosed image", "<img src=x onerror=alert(1)//"],
  ["picture", "<picture><source srcset=x><img src=x onerror=alert(1)></picture>"],
  ["svg onload", "<svg onload=alert(1)>"],
  ["svg script", "<svg><script>alert(1)</script></svg>"],
  ["svg link", '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>'],
  ["svg animate retargeting href", "<svg><animate attributeName=href values=javascript:alert(1) /><a><text>x</text></a></svg>"],
  ["svg set retargeting a handler", "<svg><set attributeName=onmouseover to=alert(1)>"],
  ["math link", '<math><mi xlink:href="javascript:alert(1)">x</mi></math>'],
  ["math mutation (DOMPurify 2020)", '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;/mglyph&gt;&lt;img&Tab;src=1&Tab;onerror=alert(1)&gt;">'],
  ["svg style mutation", '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">'],
  ["form math mutation (DOMPurify 2.0)", '<form><math><mtext></form><form><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">'],
  ["noscript attribute", '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>'],
  ["noscript mutation", '<noscript><style></noscript><img src=x onerror=alert(1)>'],
  ["template", "<template><script>alert(1)</script></template>"],
  ["xmp", "<xmp><script>alert(1)</script></xmp>"],
  ["plaintext", "<plaintext><script>alert(1)</script>"],
  ["title", "<title><script>alert(1)</script></title>"],
  ["textarea", "<textarea><script>alert(1)</script></textarea>"],
  ["select and option", "<select><option><script>alert(1)</script></option></select>"],
  ["iframe javascript", '<iframe src="javascript:alert(1)"></iframe>'],
  ["iframe srcdoc", '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ["nested iframe fallbacks", "<iframe><iframe><iframe><img src=x onerror=alert(1)></iframe></iframe></iframe>"],
  ["object", '<object data="javascript:alert(1)"></object>'],
  ["object scriptlet", '<object type="text/x-scriptlet" data="https://evil.example/x"></object>'],
  ["embed", '<embed src="javascript:alert(1)">'],
  ["applet", "<applet code=x></applet>"],
  ["frameset", '<frameset><frame src="javascript:alert(1)"></frameset>'],
  ["body onload", "<body onload=alert(1)>"],
  ["style import", "<style>@import 'https://evil.example/x.css';</style>"],
  ["style url", "<style>body{background:url(javascript:alert(1))}</style>"],
  ["style attribute", '<p style="background:url(javascript:alert(1))">x</p>'],
  ["style expression", '<div style="width:expression(alert(1))">x</div>'],
  ["stylesheet link", "<link rel=stylesheet href=https://evil.example/x.css>"],
  ["meta refresh", '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
  ["base", '<base href="https://evil.example/">'],
  ["form", '<form action="https://evil.example"><input name=x><button>go</button></form>'],
  ["form action on a button", '<form><button formaction="javascript:alert(1)">x</button></form>'],
  ["autofocus", "<input autofocus onfocus=alert(1)>"],
  ["input image", "<input type=image src=x onerror=alert(1)>"],
  ["popover", "<button popovertarget=x onclick=alert(1)>x</button>"],
  ["marquee", "<marquee onstart=alert(1)>x</marquee>"],
  ["details", "<details open ontoggle=alert(1)>x</details>"],
  ["dialog", "<dialog open onclose=alert(1)>x</dialog>"],
  ["video source", "<video><source onerror=alert(1)></video>"],
  ["audio", "<audio src onloadstart=alert(1)>"],
  ["isindex", "<isindex action=javascript:alert(1) type=image>"],
  ["bgsound", '<bgsound src="javascript:alert(1)">'],
  ["table background", '<table background="javascript:alert(1)"><tr><td>x</td></tr></table>'],
  ["event handler on a paragraph", '<p onmouseover="alert(1)">x</p>'],
  ["attributes on a paragraph", '<p class="x" id="y" data-x="1" title="t" lang="pl" dir="rtl" hidden>x</p>'],
  ["link javascript", '<a href="javascript:alert(1)">x</a>'],
  ["link javascript in capitals", '<A HREF="JAVASCRIPT:alert(1)">x</A>'],
  ["link javascript with a mixed case", '<a href="JaVaScRiPt:alert(1)">x</a>'],
  ["link javascript with a tab entity", '<a href="java&#x09;script:alert(1)">x</a>'],
  ["link javascript with a newline", '<a href="java\nscript:alert(1)">x</a>'],
  ["link javascript with a tab", '<a href="java\tscript:alert(1)">x</a>'],
  ["link javascript with NUL", '<a href="java\u0000script:alert(1)">x</a>'],
  ["link javascript with a leading space", '<a href=" javascript:alert(1)">x</a>'],
  ["link javascript with a hex entity", '<a href="&#x6A;avascript:alert(1)">x</a>'],
  ["link javascript with a decimal colon", '<a href="javascript&#58;alert(1)">x</a>'],
  ["link javascript with a hex colon", '<a href="javascript&#x3A;alert(1)">x</a>'],
  ["link javascript with a named colon", '<a href="javascript&colon;alert(1)">x</a>'],
  ["link vbscript", '<a href="vbscript:msgbox(1)">x</a>'],
  ["link data", '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>'],
  ["link blob", '<a href="blob:https://example.com/00000000-0000-0000-0000-000000000000">x</a>'],
  ["link file", '<a href="file:///etc/passwd">x</a>'],
  ["link ftp", '<a href="ftp://example.com/x">x</a>'],
  ["link tel", '<a href="tel:+48123456789">x</a>'],
  ["link with a protocol-relative URL", '<a href="//evil.example/x">x</a>'],
  ["link with backslashes", '<a href="\\\\evil.example\\x">x</a>'],
  ["link with a slash and a backslash", '<a href="/\\evil.example">x</a>'],
  ["relative link", '<a href="/admin">x</a>'],
  ["link to an anchor", '<a href="#top">x</a>'],
  ["link with credentials", '<a href="https://trusted.example@evil.example/">x</a>'],
  ["link with credentials and a password", '<a href="https://user:pw@evil.example/">x</a>'],
  ["link with a handler", '<a href="https://example.com" onclick="alert(1)">x</a>'],
  ["link with target and rel", '<a href="https://example.com" target="_blank" rel="opener">x</a>'],
  ["link with a style", '<a href="https://example.com" style="background:url(javascript:alert(1))">x</a>'],
  ["link slash separator", '<a/href="javascript:alert(1)">x</a>'],
  ["link with a tag in the attribute list", '<a href="https://example.com"<script>alert(1)</script>>x</a>'],
  ["link with quotes only", '<a """><script>alert(1)</script>">x</a>'],
  ["link attribute break-out, double quotes", '<a href="https://example.com/\\"onmouseover=\\"alert(1)">x</a>'],
  ["link attribute break-out, single quotes", "<a href='https://example.com/'onmouseover='alert(1)'>x</a>"],
  ["link attribute break-out, no quotes", "<a href=https://example.com/ onmouseover=alert(1)>x</a>"],
  ["mail link with a tag", '<a href="mailto:x@example.com?subject=<script>alert(1)</script>">x</a>'],
  ["mail link with a quote", '<a href="mailto:a@example.com&quot;onmouseover=&quot;alert(1)">x</a>'],
  ["mail link with a raw quote", '<a href=\'mailto:a@example.com"onmouseover="alert(1)\'>x</a>'],
  ["entity-encoded tags", "&lt;script&gt;alert(1)&lt;/script&gt;<p>&#60;img src=x onerror=alert(1)&#62;</p>"],
  ["double-encoded entities", "<p>&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</p>"],
  ["nested forms", "<form><form><input onfocus=alert(1) autofocus></form></form>"],
  ["stray closing tags", "</p></div></body></html><script>alert(1)</script>"],
];

describe("sanitizeLegalHtml refuses the payloads of real attacks", () => {
  it.each(XSS_PAYLOADS)("%s", (_name, payload) => {
    expectSafe(sanitizeLegalHtml(payload));
  });

  it("returns no script, handler or dangerous URL as markup, whatever surrounds it", () => {
    for (const [, payload] of XSS_PAYLOADS) {
      const out = sanitizeLegalHtml(`<p>before</p>${payload}<p>after</p>`);
      expectSafe(out);
      expect(out).not.toMatch(/<(script|style|iframe|object|embed|svg|math|form|input|img|link|meta|base)\b/i);
      expect(out).not.toMatch(/<[^>]*\son\w+\s*=/i);
      expect(out).not.toMatch(/href="(?!https?:|mailto:)/i);
    }
  });

  it("turns a link that is not allowed into plain text", () => {
    expect(sanitizeLegalHtml('<a href="javascript:alert(1)">read this</a>')).toBe("read this");
    expect(sanitizeLegalHtml('<a href="//evil.example/x">read this</a>')).toBe("read this");
    expect(sanitizeLegalHtml('<a href="/admin">read this</a>')).toBe("read this");
    expect(sanitizeLegalHtml('<a name="x">anchor</a>')).toBe("anchor");
    expect(sanitizeLegalHtml('<a href="https://trusted.example@evil.example/">read this</a>')).toBe("read this");
  });

  it("drops the text of containers that are not text", () => {
    expect(sanitizeLegalHtml("<p>a</p><script>alert(1)</script><style>p{}</style><p>b</p>")).toBe("<p>a</p><p>b</p>");
    expect(sanitizeLegalHtml("<title>Page</title><p>a</p><template><p>hidden</p></template>")).toBe("<p>a</p>");
  });

  // About 1.3 s on a laptop, but CI runs this file next to other workers with coverage on: a longer limit
  // than the default 5 s keeps a slow runner from failing a correct sanitiser.
  it("holds when the payload is mixed into a long ordinary text", { timeout: 60_000 }, () => {
    const filler = "<p>Ordinary text of a privacy notice. </p>".repeat(100);
    for (const [, payload] of XSS_PAYLOADS) expectSafe(sanitizeLegalHtml(filler + payload + filler));
  });
});

/** A small deterministic generator (mulberry32), so a failure can be reproduced from its seed. */
function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_TOKENS = [
  "<",
  ">",
  "</",
  "/>",
  "=",
  '"',
  "'",
  "`",
  "&",
  "&amp;",
  "&lt;",
  "&#x6a;",
  "&Tab;",
  "&colon;",
  "<p>",
  "</p>",
  "<a href=",
  "<a ",
  '<a href="https://example.com/x">',
  '<a href="https://example.com/y">',
  '<a href="javascript:alert(1)">',
  "<a href=//evil.example>",
  "</a>",
  "<h2>",
  "</h2>",
  "href=",
  "javascript:",
  "https://example.com/",
  "mailto:a@example.com",
  "<svg>",
  "<math>",
  "<mglyph>",
  "<mtext>",
  "<style>",
  "</style>",
  "<noscript>",
  "</noscript>",
  "<template>",
  "<form>",
  "</form>",
  "<table>",
  "<select>",
  "<option>",
  "<textarea>",
  "<xmp>",
  "<plaintext>",
  "<iframe>",
  "<title>",
  "<script>",
  "</script>",
  "<img src=x onerror=1>",
  "<!--",
  "-->",
  "<![CDATA[",
  "]]>",
  "<b>",
  "<i>",
  "<h1>",
  "<ul><li>",
  "</li></ul>",
  "<br>",
  "onerror=",
  "onload=",
  "style=",
  "word ",
  "\t",
  "\n",
  " ",
  "\u0000",
  "\u202e",
];

describe("sanitizeLegalHtml on generated input", () => {
  it("is always safe, stable and never throws (3000 seeded inputs)", () => {
    const next = randomGenerator(20261021);
    for (let i = 0; i < 3000; i += 1) {
      const length = 1 + Math.floor(next() * 40);
      let input = "";
      for (let j = 0; j < length; j += 1) input += FUZZ_TOKENS[Math.floor(next() * FUZZ_TOKENS.length)]!;
      const out = sanitizeLegalHtml(input);
      expectSafe(out);
      expect(sanitizeLegalHtml(out), `not idempotent for ${JSON.stringify(input)}`).toBe(out);
    }
  });
});

// Not a speed test: it catches a runaway (minutes, not seconds). The same input takes about 1 s on a laptop and
// 2 s on a loaded CI runner, so a tighter limit makes a correct sanitiser fail by chance.
const SLOW_RUNNER_LIMIT_MS = 20_000;

describe("sanitizeLegalHtml and awkward text", () => {
  it("removes control characters but keeps tabs and line breaks", () => {
    expect(sanitizeLegalHtml("<p>a\u0000b\u0007c\u001bd\u007fe\u0085f\tg\nh</p>")).toBe("<p>a\ufffdb" + "cdef\tg\nh</p>");
  });

  it("replaces a lone surrogate, which a database refuses", () => {
    const out = sanitizeLegalHtml("<p>x\ud800y</p>");
    expect(out).toBe("<p>x\ufffdy</p>");
  });

  it("returns an empty string for nothing, for only markup that is removed, and for null-like input", () => {
    expect(sanitizeLegalHtml("")).toBe("");
    expect(sanitizeLegalHtml("   \n ")).toBe("");
    expect(sanitizeLegalHtml("<script>alert(1)</script>")).toBe("");
    expect(sanitizeLegalHtml("<img src=x><svg></svg>")).toBe("");
  });

  it("trims the result", () => {
    expect(sanitizeLegalHtml("\n  <p>x</p>  \n")).toBe("<p>x</p>");
  });

  it("unwraps what is nested beyond any real text instead of failing", () => {
    const deep = "<blockquote>".repeat(50) + "deep text" + "</blockquote>".repeat(50);
    const out = sanitizeLegalHtml(deep);
    expect(out).toContain("deep text");
    expect(out.split("<blockquote>").length - 1).toBeLessThanOrEqual(12);
    expectSafe(out);
  });

  it("copes with a long run of unclosed tags in a moment", () => {
    const started = performance.now();
    const out = sanitizeLegalHtml("<div><span>".repeat(10_000) + "text" + "<p>".repeat(20_000));
    expect(performance.now() - started).toBeLessThan(SLOW_RUNNER_LIMIT_MS);
    expectSafe(out);
  });

  it("handles a full-size text of ordinary markup in a moment", () => {
    const paragraph = '<p>Our <strong>data</strong> policy &amp; <a href="https://example.com/p">details</a>.</p>';
    const text = paragraph.repeat(Math.floor(100_000 / paragraph.length));
    const started = performance.now();
    const out = sanitizeLegalHtml(text);
    expect(performance.now() - started).toBeLessThan(SLOW_RUNNER_LIMIT_MS);
    expect(out.length).toBeGreaterThan(90_000);
  });
});

describe("legalHtmlHasVisibleText", () => {
  it.each([
    ["a paragraph", "<p>Text</p>"],
    ["text without markup", "Text"],
    ["a sign that is escaped", "<p>&amp;</p>"],
    ["a letter among spaces", "<p> &nbsp; x &nbsp; </p>"],
    ["a link with text", '<a href="https://example.com/">here</a>'],
  ])("is true for %s", (_name, html) => {
    expect(legalHtmlHasVisibleText(html)).toBe(true);
  });

  it.each([
    ["nothing", ""],
    ["spaces", "   \n\t "],
    ["an empty paragraph", "<p></p>"],
    ["a non-breaking space", "<p>&nbsp;</p>"],
    ["a line break", "<p><br /></p>"],
    ["a rule", "<hr />"],
    ["a zero-width space", "<p>&#8203;</p>"],
    ["a bidi mark and a joiner", "<p>\u200e\u200d\u2060</p>"],
    ["an empty link", '<a href="https://example.com/"></a>'],
    ["only a script", "<script>alert(1)</script>"],
    ["only a style", "<style>p { color: red }</style>"],
  ])("is false for %s", (_name, html) => {
    expect(legalHtmlHasVisibleText(html)).toBe(false);
  });
});

describe("a link that is refused leaves the markup around it as it was", () => {
  it.each([
    [
      "a phone link before a mail link",
      '<p>Call <a href="tel:+48221234567">+48 22 123 45 67</a> or write to <a href="mailto:dpo@example.com">dpo@example.com</a>. We reply within 30 days.</p>',
      '<p>Call +48 22 123 45 67 or write to <a href="mailto:dpo@example.com">dpo@example.com</a>. We reply within 30 days.</p>',
    ],
    [
      "a Word bookmark before the headings",
      '<a name="_Toc1"></a><h2>1. Who we are</h2><p>We are X.</p><h2>2. Your rights</h2><p>Access.</p>',
      "<h2>1. Who we are</h2><p>We are X.</p><h2>2. Your rights</h2><p>Access.</p>",
    ],
    [
      "a link to an anchor before a quote",
      '<a href="#x">x</a><blockquote>Quote</blockquote><p>After</p><p>After 2</p>',
      "x<blockquote>Quote</blockquote><p>After</p><p>After 2</p>",
    ],
    [
      "refused links in a list",
      '<ul><li><a href="/a">one</a></li><li><a href="javascript:alert(1)">two</a></li><li>three</li></ul><p>after</p>',
      "<ul><li>one</li><li>two</li><li>three</li></ul><p>after</p>",
    ],
    [
      "refused links around a good one",
      '<p><a href="/a">one</a> <a href="https://example.com/b">two</a> <a href="tel:1">three</a> <em>four</em></p><h3>next</h3>',
      '<p>one <a href="https://example.com/b">two</a> three <em>four</em></p><h3>next</h3>',
    ],
  ])("%s", (_name, input, expected) => {
    expect(sanitizeLegalHtml(input)).toBe(expected);
  });
});

describe("a link inside a link", () => {
  it.each([
    [
      "directly: the parser closes the outer one",
      '<a href="https://a.example/">one <a href="https://b.example/">two</a> three</a>',
      '<a href="https://a.example/">one </a><a href="https://b.example/">two</a> three',
    ],
    [
      "through another element: the inner one is not a link",
      '<a href="https://a.example/"><b><a href="https://b.example/">in</a></b></a><a href="https://c.example/">after</a>',
      '<a href="https://a.example/"><strong>in</strong></a><a href="https://c.example/">after</a>',
    ],
    [
      "through a heading",
      '<a href="https://a.example/"><h1>title <a href="https://b.example/">in</a></h1></a><p>after</p>',
      '<a href="https://a.example/"><h2>title in</h2></a><p>after</p>',
    ],
    [
      "after a link that has closed: a link again",
      '<p><a href="https://a.example/">one</a><b><a href="https://b.example/">two</a></b></p>',
      '<p><a href="https://a.example/">one</a><strong><a href="https://b.example/">two</a></strong></p>',
    ],
    [
      "after a stray closing tag",
      '</a><a href="https://a.example/">x</a>',
      '<a href="https://a.example/">x</a>',
    ],
  ])("%s", (_name, input, expected) => {
    expect(sanitizeLegalHtml(input)).toBe(expected);
    expectSafe(expected);
  });

  it("is a tree a browser reads back the same, for the input that once did not round trip", () => {
    const input =
      '</title><a href="https://example.com/x"><a href="javascript:1"><h1><a href="https://example.com/x"><h1><div>&#x6a;<a href="https://example.com/x"><embed src=x><tr><details>';
    const out = sanitizeLegalHtml(input);
    expect(out).toBe('<a href="https://example.com/x"></a><h2></h2><h2>j</h2>');
    expectSafe(out);
  });
});

/** A document made of the elements a legal text uses, with links that are good and links that are not. */
type Tree =
  | { kind: "text"; value: string }
  | { kind: "tag"; name: string; alias: string; children: Tree[] }
  | { kind: "void"; name: string }
  | { kind: "link"; href: string | null; children: Tree[] };

const WORDS = ["alpha", "beta", "gamma", "delta", "data", "notice", "event", "terms"];
const GOOD_HREFS = ["https://example.com/a", "http://example.com", "mailto:dpo@example.com", "https://example.com/b?x=1"];
const BAD_HREFS = [
  "tel:+48123456789",
  "#section",
  "/relative",
  "javascript:alert(1)",
  "//evil.example/x",
  "ftp://example.com/",
  "https://user:pw@example.com/",
  null,
];

type Rng = () => number;

function pick<T>(next: Rng, items: readonly T[]): T {
  return items[Math.floor(next() * items.length)]!;
}

function textNode(next: Rng): Tree {
  return { kind: "text", value: `${pick(next, WORDS)} ${pick(next, WORDS)} ` };
}

function linkNode(next: Rng): Tree {
  const href = next() < 0.5 ? pick(next, GOOD_HREFS) : pick(next, BAD_HREFS);
  return { kind: "link", href, children: [textNode(next)] };
}

/** An element, written with the name an editor or a pasted page may use for it (`alias`). */
function aliasedTag(next: Rng, name: string, aliases: readonly string[], children: Tree[]): Tree {
  return { kind: "tag", name, alias: pick(next, aliases), children };
}

function emphasisNode(next: Rng, depth: number): Tree {
  const strong = next() < 0.5;
  return aliasedTag(next, strong ? "strong" : "em", strong ? ["strong", "b"] : ["em", "i"], inlineNodes(next, depth + 1));
}

function inlineNodes(next: Rng, depth: number): Tree[] {
  const items: Tree[] = [textNode(next)];
  for (let i = Math.floor(next() * 3); i > 0; i -= 1) {
    const roll = next();
    if (roll < 0.35) items.push(linkNode(next));
    else if (roll < 0.7 && depth < 2) items.push(emphasisNode(next, depth));
    else if (roll < 0.8) items.push({ kind: "void", name: "br" });
    items.push(textNode(next));
  }
  return items;
}

function listNode(next: Rng, depth: number): Tree {
  const name = pick(next, ["ul", "ol"]);
  const items: Tree[] = [];
  for (let i = 1 + Math.floor(next() * 3); i > 0; i -= 1) {
    const children = inlineNodes(next, 0);
    if (depth < 2 && next() < 0.3) children.push(listNode(next, depth + 1));
    items.push({ kind: "tag", name: "li", alias: "li", children });
  }
  return { kind: "tag", name, alias: name, children: items };
}

const HEADING_ALIASES: ReadonlyMap<string, readonly string[]> = new Map([
  ["h2", ["h2", "h1"]],
  ["h3", ["h3"]],
  ["h4", ["h4", "h5", "h6"]],
]);

function headingNode(next: Rng): Tree {
  const name = pick(next, [...HEADING_ALIASES.keys()]);
  return aliasedTag(next, name, HEADING_ALIASES.get(name)!, inlineNodes(next, 0));
}

function quoteNode(next: Rng, depth: number): Tree {
  const children: Tree[] = [];
  for (let i = 1 + Math.floor(next() * 2); i > 0; i -= 1) children.push(blockNode(next, depth + 1));
  return { kind: "tag", name: "blockquote", alias: "blockquote", children };
}

function blockNode(next: Rng, depth: number): Tree {
  const roll = next();
  if (roll < 0.4) return { kind: "tag", name: "p", alias: "p", children: inlineNodes(next, 0) };
  if (roll < 0.55) return headingNode(next);
  if (roll < 0.7) return listNode(next, 0);
  if (roll < 0.85 && depth < 2) return quoteNode(next, depth);
  if (roll < 0.92) return { kind: "void", name: "hr" };
  return { kind: "tag", name: "p", alias: "p", children: inlineNodes(next, 0) };
}

function documentNodes(next: Rng): Tree[] {
  const blocks: Tree[] = [];
  for (let i = 1 + Math.floor(next() * 5); i > 0; i -= 1) blocks.push(blockNode(next, 0));
  return blocks;
}

function renderChildren(children: Tree[], render: (node: Tree) => string): string {
  return children.map(render).join("");
}

function renderInput(node: Tree): string {
  switch (node.kind) {
    case "text":
      return node.value;
    case "void":
      return `<${node.name}>`;
    case "tag":
      return `<${node.alias}>${renderChildren(node.children, renderInput)}</${node.alias}>`;
    case "link": {
      const attribute = node.href === null ? 'name="x"' : `href="${node.href}"`;
      return `<a ${attribute}>${renderChildren(node.children, renderInput)}</a>`;
    }
  }
}

function renderExpected(node: Tree): string {
  switch (node.kind) {
    case "text":
      return node.value;
    case "void":
      return `<${node.name} />`;
    case "tag":
      return `<${node.name}>${renderChildren(node.children, renderExpected)}</${node.name}>`;
    case "link": {
      const inner = renderChildren(node.children, renderExpected);
      if (node.href === null || !GOOD_HREFS.includes(node.href)) return inner;
      return `<a href="${new URL(node.href).href.replaceAll("&", "&amp;")}">${inner}</a>`;
    }
  }
}

describe("sanitizeLegalHtml keeps the structure of a text, whatever links it holds", () => {
  it("gives back exactly the same document, bar the links it refuses and the tags it folds (1500 seeded documents)", () => {
    const next = randomGenerator(20261022);
    for (let i = 0; i < 1500; i += 1) {
      const document = documentNodes(next);
      const input = renderChildren(document, renderInput);
      const expected = renderChildren(document, renderExpected).trim();
      expect(sanitizeLegalHtml(input), input).toBe(expected);
    }
  });
});

describe("folding tags", () => {
  it("renames what an editor or a pasted page writes, and only that", () => {
    expect(sanitizeLegalHtml("<h1>A</h1><h5>B</h5><h6>C</h6><p><b>D</b><i>E</i></p>")).toBe(
      "<h2>A</h2><h4>B</h4><h4>C</h4><p><strong>D</strong><em>E</em></p>",
    );
  });

  it("never touches text that spells a tag", () => {
    expect(sanitizeLegalHtml("<p>write &lt;b&gt;bold&lt;/b&gt; or &lt;h1&gt; here</p>")).toBe(
      "<p>write &lt;b&gt;bold&lt;/b&gt; or &lt;h1&gt; here</p>",
    );
  });

  it("never touches an attribute value that spells a tag", () => {
    const out = sanitizeLegalHtml('<p><a href="mailto:a@example.com?subject=<b>x</b>">mail</a> <a href="https://example.com/?q=<i>">web</a></p>');
    expect(out).not.toContain("<strong>");
    expect(out).not.toContain("<em>");
    expect(out).toContain("subject=%3Cb%3Ex%3C/b%3E");
    expect(out).toContain("%3Ci%3E");
    expectSafe(out);
  });

  it("folds inside a nested structure and a link", () => {
    expect(sanitizeLegalHtml('<ul><li><a href="https://example.com/"><b>bold <i>both</i></b></a></li></ul>')).toBe(
      '<ul><li><a href="https://example.com/"><strong>bold <em>both</em></strong></a></li></ul>',
    );
  });
});

describe("character references", () => {
  it("do not bring control characters into the result", () => {
    expect(sanitizeLegalHtml("<p>x</p><p>&#1;&#x1b;&#7;y&#127;</p>")).toBe("<p>x</p><p>y</p>");
  });

  it("keep the characters a language needs inside a word", () => {
    const persian = "<p>\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645</p>";
    expect(sanitizeLegalHtml(persian)).toBe(persian);
  });
});

describe("cleanUntilStable", () => {
  /** A cleaner that removes one "aa" a pass, and counts its runs. */
  function shrinkingCleaner() {
    const runs = { count: 0 };
    const clean = (html: string): string => {
      runs.count += 1;
      return html.replace("aa", "a");
    };
    return { clean, runs };
  }

  it("returns the input after one run when cleaning does not change it", () => {
    const { clean, runs } = shrinkingCleaner();
    expect(cleanUntilStable("a", clean)).toBe("a");
    expect(runs.count).toBe(1);
  });

  it("runs again on what it got, and returns the first output that equals its input", () => {
    const { clean, runs } = shrinkingCleaner();
    expect(cleanUntilStable("aaaa", clean)).toBe("a");
    expect(runs.count).toBe(4);
  });

  it("gives up with null when the output is still changing after the last allowed run", () => {
    const { clean, runs } = shrinkingCleaner();
    expect(cleanUntilStable("aaaaa", clean)).toBeNull();
    expect(runs.count).toBe(4);
    expect(cleanUntilStable("aaaaa", clean, 6)).toBe("a");
  });

  it("never settles for a cleaner that keeps adding to the text", () => {
    expect(cleanUntilStable("<p>x</p>", (html) => `${html}<p>x</p>`)).toBeNull();
  });
});

describe("sanitizeLegalHtml returns", () => {
  it("the text for markup that is already clean, and an empty string for nothing: never null", () => {
    expect(sanitizeOrRefuse("<p>x</p>")).toBe("<p>x</p>");
    expect(sanitizeOrRefuse("")).toBe("");
    expect(sanitizeOrRefuse("<script>alert(1)</script>")).toBe("");
  });
});
