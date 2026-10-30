// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LegalHtmlEditor, type LegalEditorMode } from "../../src/registration/LegalHtmlEditor.js";
import { LINK_NOT_ALLOWED_MESSAGE } from "../../src/registration/legalHtml.js";
import { isOff } from "../test-utils.js";
import { stubProseMirrorLayout } from "./proseMirrorJsdom.js";

beforeAll(() => {
  stubProseMirrorLayout();
});

afterEach(() => {
  cleanup();
});

const INITIAL = "<h2>Title</h2><p>Some words to work with.</p>";

function renderEditor({ html = INITIAL, mode = "edit" }: { html?: string; mode?: LegalEditorMode } = {}) {
  const onHtml = vi.fn();
  render(
    <>
      <span id="label">Text</span>
      <p id="hint">A hint</p>
      <LegalHtmlEditor initialHtml={html} labelledBy="label" describedBy="hint" mode={mode} onHtml={onHtml} />
    </>,
  );
  return { onHtml };
}

/** The editor behind the editing surface (Tiptap keeps it on the element). */
function tiptap(): Editor {
  return (screen.getByRole("textbox") as HTMLElement & { editor: Editor }).editor;
}

const button = (name: string) => screen.getByRole("button", { name });
const lastHtml = (onHtml: ReturnType<typeof vi.fn>) => onHtml.mock.calls.at(-1)?.[0] as string;

/** Selects the words "Some words" of the paragraph. */
function selectWords(editor: Editor) {
  let start = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.startsWith("Some words")) start = pos;
  });
  act(() => {
    editor.commands.setTextSelection({ from: start, to: start + "Some words".length });
  });
}

describe("LegalHtmlEditor: the editing surface", () => {
  it("is a multi-line textbox named by the visible label and described by the hint", () => {
    renderEditor();

    const box = screen.getByRole("textbox", { name: "Text" });
    expect(box.getAttribute("aria-multiline")).toBe("true");
    expect(box.getAttribute("aria-describedby")).toBe("hint");
    expect(box.getAttribute("contenteditable")).toBe("true");
    expect(box.getAttribute("aria-readonly")).toBeNull();
    expect(within(box).getByRole("heading", { level: 2, name: "Title" })).toBeTruthy();
  });

  it("reports the text as it would be sent once it is there, and after each change", async () => {
    const { onHtml } = renderEditor({ html: "<ul><li><p>One</p></li></ul>" });

    await vi.waitFor(() => expect(onHtml).toHaveBeenCalled());
    expect(onHtml.mock.calls[0]?.[0]).toBe("<ul><li>One</li></ul>");

    act(() => {
      tiptap().commands.insertContentAt(tiptap().state.doc.content.size, "<p>Two</p>");
    });
    expect(lastHtml(onHtml)).toBe("<ul><li>One</li></ul><p>Two</p>");
  });

  it("reports a text with no words as an empty string", async () => {
    const { onHtml } = renderEditor({ html: "" });

    await vi.waitFor(() => expect(onHtml).toHaveBeenCalledWith(""));
  });
});

describe("LegalHtmlEditor: the toolbar", () => {
  it("is a group named for what it does, with a button for each of the four things", () => {
    renderEditor();

    const group = screen.getByRole("group", { name: "Text formatting" });
    expect(within(group).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Heading",
      "Subheading",
      "Bold",
      "Bulleted list",
      "Numbered list",
      "Link",
    ]);
  });

  it("marks the buttons that are on: the heading the caret is in", () => {
    renderEditor();

    expect(button("Heading").getAttribute("aria-pressed")).toBe("true");
    expect(button("Subheading").getAttribute("aria-pressed")).toBe("false");
    expect(button("Bold").getAttribute("aria-pressed")).toBe("false");
  });

  it("makes the selected words bold, and says so", () => {
    const { onHtml } = renderEditor();
    selectWords(tiptap());

    fireEvent.click(button("Bold"));

    expect(lastHtml(onHtml)).toBe("<h2>Title</h2><p><strong>Some words</strong> to work with.</p>");
    expect(button("Bold").getAttribute("aria-pressed")).toBe("true");
  });

  it("turns the paragraph into a subheading and back", () => {
    const { onHtml } = renderEditor();
    selectWords(tiptap());

    fireEvent.click(button("Subheading"));
    expect(lastHtml(onHtml)).toBe("<h2>Title</h2><h3>Some words to work with.</h3>");

    fireEvent.click(button("Subheading"));
    expect(lastHtml(onHtml)).toBe("<h2>Title</h2><p>Some words to work with.</p>");
  });

  it.each([
    ["Bulleted list", "<h2>Title</h2><ul><li>Some words to work with.</li></ul>"],
    ["Numbered list", "<h2>Title</h2><ol><li>Some words to work with.</li></ol>"],
  ])("makes the paragraph a list with %s", (name, expected) => {
    const { onHtml } = renderEditor();
    selectWords(tiptap());

    fireEvent.click(button(name));

    expect(lastHtml(onHtml)).toBe(expected);
    expect(button(name).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("LegalHtmlEditor: the link field", () => {
  it("opens under the toolbar with the focus in it, and closes with Escape and the focus back in the text", async () => {
    renderEditor();

    fireEvent.click(button("Link"));
    const field = screen.getByRole("textbox", { name: "Link address" });
    expect(document.activeElement).toBe(field);
    expect(button("Link").getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(field, { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: "Link address" })).toBeNull();
    // Tiptap moves the focus on the next animation frame.
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Text" })));
  });

  it("closes when the editor goes busy, so that it does not come back and take the focus from Save", () => {
    const element = (mode: LegalEditorMode) => (
      <LegalHtmlEditor initialHtml={INITIAL} labelledBy="label" describedBy="hint" mode={mode} onHtml={vi.fn()} />
    );
    const view = render(element("edit"));
    fireEvent.click(button("Link"));
    expect(screen.getByRole("textbox", { name: "Link address" })).toBeTruthy();

    view.rerender(element("busy"));
    view.rerender(element("edit"));

    expect(screen.queryByRole("textbox", { name: "Link address" })).toBeNull();
    expect(button("Link").getAttribute("aria-pressed")).toBe("false");
  });

  it("makes the selected words a link, written the way the server stores it", () => {
    const { onHtml } = renderEditor();
    selectWords(tiptap());
    fireEvent.click(button("Link"));

    fireEvent.change(screen.getByRole("textbox", { name: "Link address" }), { target: { value: "example.com/privacy" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(lastHtml(onHtml)).toBe('<h2>Title</h2><p><a href="https://example.com/privacy">Some words</a> to work with.</p>');
    expect(screen.queryByRole("group", { name: "Link" })).toBeNull();
  });

  it("applies the link when Enter is pressed in the field", () => {
    const { onHtml } = renderEditor();
    selectWords(tiptap());
    fireEvent.click(button("Link"));
    const field = screen.getByRole("textbox", { name: "Link address" });

    fireEvent.change(field, { target: { value: "privacy@example.com" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(lastHtml(onHtml)).toContain('<a href="mailto:privacy@example.com">Some words</a>');
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "tel:+48123456789"])("refuses %j and leaves the text alone", (address) => {
    const { onHtml } = renderEditor();
    selectWords(tiptap());
    fireEvent.click(button("Link"));
    const before = onHtml.mock.calls.length;

    fireEvent.change(screen.getByRole("textbox", { name: "Link address" }), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByRole("alert").textContent).toBe(LINK_NOT_ALLOWED_MESSAGE);
    expect(onHtml.mock.calls).toHaveLength(before);
    expect(screen.getByRole("textbox", { name: "Link address" })).toBeTruthy();
  });

  it("asks for an address, and takes the message away when the person types again", () => {
    renderEditor();
    selectWords(tiptap());
    fireEvent.click(button("Link"));

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a link address.");

    fireEvent.change(screen.getByRole("textbox", { name: "Link address" }), { target: { value: "e" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks for words to be selected when nothing is, instead of linking nothing", () => {
    const { onHtml } = renderEditor();
    act(() => {
      tiptap().commands.setTextSelection(3);
    });
    fireEvent.click(button("Link"));
    const before = onHtml.mock.calls.length;

    fireEvent.change(screen.getByRole("textbox", { name: "Link address" }), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByRole("alert").textContent).toBe("Select the words you want to turn into a link first.");
    expect(onHtml.mock.calls).toHaveLength(before);
  });

  it("shows the address of the link the caret is in, changes it, and removes it", () => {
    const { onHtml } = renderEditor({ html: '<p>See <a href="https://example.com/old">the policy</a> here.</p>' });
    const editor = tiptap();
    act(() => {
      editor.commands.setTextSelection(8);
    });
    expect(button("Link").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(button("Link"));
    const field = screen.getByRole("textbox", { name: "Link address" }) as HTMLInputElement;
    expect(field.value).toBe("https://example.com/old");

    fireEvent.change(field, { target: { value: "https://example.com/new" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastHtml(onHtml)).toBe('<p>See <a href="https://example.com/new">the policy</a> here.</p>');

    fireEvent.click(button("Link"));
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    expect(lastHtml(onHtml)).toBe("<p>See the policy here.</p>");
  });

  it("offers Remove link only where there is a link, and Cancel closes the field without a change", () => {
    const { onHtml } = renderEditor();
    selectWords(tiptap());
    fireEvent.click(button("Link"));

    expect(screen.queryByRole("button", { name: "Remove link" })).toBeNull();
    const before = onHtml.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("textbox", { name: "Link address" })).toBeNull();
    expect(onHtml.mock.calls).toHaveLength(before);
  });
});

describe("LegalHtmlEditor: the modes", () => {
  it("while a save is on its way keeps the toolbar, off, and the text cannot be typed in", () => {
    renderEditor({ mode: "busy" });

    for (const name of ["Heading", "Subheading", "Bold", "Bulleted list", "Numbered list", "Link"]) expect(isOff(button(name))).toBe(true);
    const box = screen.getByRole("textbox", { name: "Text" });
    expect(box.getAttribute("contenteditable")).toBe("false");
    expect(box.getAttribute("aria-readonly")).toBe("true");
  });

  it("for an archived event shows the text with no toolbar, and says it is read-only", () => {
    renderEditor({ mode: "view" });

    expect(screen.queryByRole("group", { name: "Text formatting" })).toBeNull();
    const box = screen.getByRole("textbox", { name: "Text" });
    expect(box.getAttribute("contenteditable")).toBe("false");
    expect(box.getAttribute("aria-readonly")).toBe("true");
    expect(within(box).getByText("Some words to work with.")).toBeTruthy();
  });

  it("is typed in again when the save is over", () => {
    const { rerender } = render(<LegalHtmlEditor initialHtml={INITIAL} labelledBy="label" mode="busy" onHtml={() => undefined} />);
    expect(screen.getByRole("textbox").getAttribute("contenteditable")).toBe("false");

    rerender(<LegalHtmlEditor initialHtml={INITIAL} labelledBy="label" mode="edit" onHtml={() => undefined} />);

    expect(screen.getByRole("textbox").getAttribute("contenteditable")).toBe("true");
    expect(screen.getByRole("textbox").getAttribute("aria-readonly")).toBeNull();
  });
});
