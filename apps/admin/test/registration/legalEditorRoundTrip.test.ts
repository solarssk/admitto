// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
// The one place where the editor (this app) and the server's cleaning (apps/web) meet: a test may read the server's source, the
// bundle of this app never does. Both are pure functions of their input.
import { sanitizeLegalHtml } from "../../../web/src/legal/sanitize-legal-html.js";
import { createLegalEditorExtensions, serializeLegalEditor } from "../../src/registration/LegalHtmlEditor.js";
import { stubProseMirrorLayout } from "./proseMirrorJsdom.js";

/** Texts as the server stores them: every one is what `sanitizeLegalHtml` returns for itself. */
const STORED_TEXTS: ReadonlyArray<readonly [string, string]> = [
  ["a paragraph with bold words", "<p>Plain text and <strong>bold</strong> words.</p>"],
  ["two levels of heading", "<h2>Title</h2><p>Intro</p><h3>Part</h3><p>Body</p>"],
  ["bold in a heading", "<h2>A <strong>bold</strong> heading</h2>"],
  ["a bulleted list", "<ul><li>One</li><li>Two</li></ul>"],
  ["a numbered list with bold", "<ol><li>First <strong>one</strong></li><li>Second</li></ol>"],
  ["a list inside a list", "<ul><li>Parent<ul><li>Child</li></ul></li><li>Next</li></ul>"],
  ["an item with two paragraphs", "<ul><li><p>One</p><p>Two</p></li></ul>"],
  ["links", '<p><a href="https://example.com/">the site</a> and <a href="mailto:privacy@example.com">the email</a></p>'],
  ["a link with a query", '<p><a href="https://example.com/path?a=1&amp;b=2#part">query</a></p>'],
  ["characters that need escaping", "<p>Fish &amp; chips &lt;not a tag&gt; \"quoted\" 'single'</p>"],
  ["letters outside ASCII", "<p>Zażółć gęślą jaźń 😀</p>"],
  ["a longer text", `<h2>Who we are</h2><p>${"We keep your name and email for the event. ".repeat(40).trim()}</p><ul><li>one</li></ul>`],
];

let editors: Editor[] = [];

function makeEditor(content: string): Editor {
  const editor = new Editor({ element: document.createElement("div"), extensions: createLegalEditorExtensions(), content });
  editors.push(editor);
  return editor;
}

beforeAll(() => {
  stubProseMirrorLayout();
});

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

describe("the legal text editor and the server's cleaning", () => {
  it.each(STORED_TEXTS)("shows %s and writes it back as it was stored", (_name, stored) => {
    expect(sanitizeLegalHtml(stored)).toBe(stored);

    const written = serializeLegalEditor(makeEditor(stored));

    expect(written).toBe(stored);
  });

  it.each(STORED_TEXTS)("writes %s in a form the server keeps unchanged", (_name, stored) => {
    const written = serializeLegalEditor(makeEditor(stored));

    expect(sanitizeLegalHtml(written)).toBe(written);
  });

  it("writes what is made with the toolbar's commands in a form the server keeps unchanged", () => {
    const editor = makeEditor("");
    editor
      .chain()
      .toggleHeading({ level: 2 })
      .insertContent("Privacy notice")
      .insertContent({ type: "paragraph", content: [{ type: "text", text: "We keep " }, { type: "text", text: "your name", marks: [{ type: "bold" }] }] })
      .insertContent({
        type: "bulletList",
        content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "for the event" }] }] }],
      })
      .run();
    editor.chain().selectAll().setLink({ href: "https://example.com" }).run();

    const written = serializeLegalEditor(editor);

    expect(written).toContain("<h2>");
    expect(written).toContain("<strong>your name</strong>");
    expect(written).toContain("<li>");
    // A link the person typed without the slash is stored the way the server writes it, so what is sent is what is kept.
    expect(written).toContain('href="https://example.com/"');
    expect(sanitizeLegalHtml(written)).toBe(written);
  });

  it("keeps only the four things a legal text may have when a page is pasted into it", () => {
    const editor = makeEditor("");
    const page =
      '<h1>Top</h1><h5>Small</h5><p style="color:red" class="x">A <b>bold</b>, <i>italic</i>, <u>under</u>, <s>strike</s> and <code>code</code> word, ' +
      '<a href="javascript:alert(1)">js link</a>, <a href="tel:+48123">phone</a>, <a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="nofollow" title="t">fine</a>.</p>' +
      '<blockquote>quote</blockquote><table><tr><td>cell</td></tr></table><img src="x" onerror="alert(1)"><hr><script>alert(1)</script><iframe src="https://example.com"></iframe>' +
      "<ul><li>one<ul><li>nested</li></ul></li></ul>";

    editor.view.pasteHTML(page);
    const written = serializeLegalEditor(editor);

    expect(sanitizeLegalHtml(written)).toBe(written);
    expect(written).not.toMatch(/<(?:h1|h4|h5|h6|em|i|b|u|s|code|blockquote|table|td|img|hr|script|iframe|br)\b/);
    expect(written).not.toMatch(/\b(?:style|class|target|rel|title|onerror)=/);
    expect(written).not.toMatch(/javascript:|tel:/);
    expect(written).toContain("<strong>bold</strong>");
    expect(written).toContain('<a href="https://example.com/a?b=1&amp;c=2">fine</a>');
    expect(written).toContain("<li>one<ul><li>nested</li></ul></li>");
    // What is shown in the editor has no such link either, so nothing there can be followed to somewhere else.
    expect([...editor.view.dom.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["https://example.com/a?b=1&c=2"]);
    // Their words stay: only the markup is gone.
    for (const word of ["Top", "Small", "italic", "js link", "phone", "quote", "cell"]) expect(written).toContain(word);
  });

  it("writes nothing for a text with no words, whatever markup is left", () => {
    expect(serializeLegalEditor(makeEditor(""))).toBe("");
    expect(serializeLegalEditor(makeEditor("<p></p><p>\u00a0</p><h2></h2>"))).toBe("");
    expect(serializeLegalEditor(makeEditor("<p>\u200b</p>"))).toBe("");
  });

  it("does not take Tab for an indent, which would keep the keyboard in the editor", () => {
    const editor = makeEditor("<ul><li>One</li><li>Two</li></ul>");
    editor.commands.setTextSelection(editor.state.doc.content.size - 3);

    const handled = editor.view.someProp("handleKeyDown", (handle) => handle(editor.view, new KeyboardEvent("keydown", { key: "Tab", cancelable: true })));

    expect(handled).toBeFalsy();
    expect(serializeLegalEditor(editor)).toBe("<ul><li>One</li><li>Two</li></ul>");
  });

  it("drops what the editor cannot show when a stored text has it (italics, a quote, a rule, a line break)", () => {
    const stored = "<p>An <em>italic</em> word<br>and a break</p><blockquote><p>quote</p></blockquote><hr><h4>Deep</h4>";
    expect(sanitizeLegalHtml(stored)).toBe(stored.replace("<br>", "<br />").replace("<hr>", "<hr />"));

    const written = serializeLegalEditor(makeEditor(stored));

    expect(written).not.toBe(stored);
    expect(written).not.toMatch(/<(?:em|br|hr|blockquote|h4)\b/);
    expect(written).toContain("italic");
  });
});
