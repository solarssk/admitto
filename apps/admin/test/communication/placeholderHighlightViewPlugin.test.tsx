// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { createRef } from "react";
import {
  PLACEHOLDER_MARK_CLASS,
  PLACEHOLDER_SELECTED_MARK_CLASS,
  placeholderHighlightViewPlugin,
} from "../../src/communication/placeholderHighlightViewPlugin.js";

afterEach(() => cleanup());

/** Renders the body editor exactly like `TemplateEditorCard` does (its own `html()` +
 * `placeholderHighlightViewPlugin`, nothing else stubbed out) and returns the container, the
 * matched placeholder spans, and the live view (for tests that need to change the selection), so
 * each test just asserts on the outcome. */
function renderBody(value: string) {
  const ref = createRef<ReactCodeMirrorRef>();
  const { container } = render(
    <CodeMirror ref={ref} value={value} extensions={[html(), placeholderHighlightViewPlugin]} />,
  );
  const marks = Array.from(container.querySelectorAll<HTMLElement>(`.${PLACEHOLDER_MARK_CLASS}`));
  return { container, marks, view: ref.current!.view! };
}

describe("placeholderHighlightViewPlugin", () => {
  it("decorates a plain-text placeholder inside mj-text markup", () => {
    const { marks } = renderBody("<mj-text>Hi {{first_name}}</mj-text>");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("{{first_name}}");
  });

  it("decorates a placeholder inside an attribute value (src=)", () => {
    const { marks } = renderBody('<mj-image src="{{logo_url}}" alt="Logo" width="200px" />');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("{{logo_url}}");
  });

  it("decorates multiple placeholders in the same document independently", () => {
    const { marks } = renderBody(
      "<mj-text>Hi {{first_name}}, your event is {{event_name}}.</mj-text>" +
        '<mj-image src="{{logo_url}}" alt="Logo" width="200px" />',
    );
    expect(marks.map((el) => el.textContent)).toEqual([
      "{{first_name}}",
      "{{event_name}}",
      "{{logo_url}}",
    ]);
  });

  it("does not decorate malformed or invalid-case look-alikes", () => {
    const { marks } = renderBody(
      '<mj-text>Hi {{first_name}}</mj-text><mj-image src="{{logo_url}}" /> {{Foo}} {oops} {{}} {{first_name',
    );
    // Only the two well-formed, lowercase-snake-case placeholders match - {{Foo}} (uppercase),
    // {oops} (single brace), {{}} (empty), and the unterminated {{first_name are all left alone.
    expect(marks.map((el) => el.textContent)).toEqual(["{{first_name}}", "{{logo_url}}"]);
  });

  it("works the same way for a plain HTML body (not MJML-specific)", () => {
    const { marks } = renderBody("<p>Hi {{first_name}}</p>");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("{{first_name}}");
  });

  it("composes with lang-html's own syntax highlighting instead of replacing it", () => {
    const { container, marks } = renderBody('<mj-image src="{{logo_url}}" />');
    expect(marks).toHaveLength(1);
    const mark = marks[0];

    // The placeholder mark itself must carry our class...
    expect(mark.classList.contains(PLACEHOLDER_MARK_CLASS)).toBe(true);

    // ...and lang-html's own highlighting must still be present elsewhere in the same rendered
    // line (tag name / attribute name / string spans it always produces for this markup), proving
    // our decoration didn't blow away or replace the syntax tree's own decorations. CodeMirror's
    // default highlight style assigns dynamically-hashed classes (not fixed "tok-*" names), so
    // assert on "some other class besides ours exists on some other span in the line" rather than
    // a specific class name.
    const line = mark.closest(".cm-line");
    expect(line).not.toBeNull();
    const otherHighlightedSpans = Array.from(line!.querySelectorAll("span")).filter(
      (span) => !span.classList.contains(PLACEHOLDER_MARK_CLASS) && span.className.length > 0,
    );
    expect(otherHighlightedSpans.length).toBeGreaterThan(0);

    // And the placeholder mark's own computed class list is exactly our one class - it wasn't
    // merged/overwritten into a single span that dropped the highlighting classes either way.
    expect(mark.classList.length).toBe(1);
  });
});

// Regression coverage (real PO feedback, twice): selecting text that includes a {{placeholder}}
// must show that selection clearly - a fully opaque background on the placeholder's own span
// previously hid CodeMirror's own selection layer outright (it paints behind normal content), and
// a translucent version of the same background was tried next but still read as barely different
// from unselected. The fix lives here: the plugin swaps in a modifier class for exactly the
// placeholder ranges that currently overlap a real selection, dropping only its own background so
// CodeMirror's selection layer shows through undiminished (communication.css).
describe("placeholderHighlightViewPlugin - selection awareness", () => {
  it("adds the --selected modifier once a real (non-empty) selection covers the placeholder", () => {
    const { container, view } = renderBody("<mj-text>Hi {{first_name}}</mj-text>");
    const doc = view.state.doc.toString();
    const start = doc.indexOf("{{first_name}}");
    view.dispatch({ selection: { anchor: start, head: start + "{{first_name}}".length } });

    const mark = container.querySelector(`.${PLACEHOLDER_MARK_CLASS}`)!;
    expect(mark.classList.contains(PLACEHOLDER_SELECTED_MARK_CLASS)).toBe(true);
  });

  it("does not add the --selected modifier for a plain cursor with no real selection, even sitting right inside the placeholder", () => {
    const { container, view } = renderBody("<mj-text>Hi {{first_name}}</mj-text>");
    const doc = view.state.doc.toString();
    const posInsidePlaceholder = doc.indexOf("{{first_name}}") + 5;
    view.dispatch({ selection: { anchor: posInsidePlaceholder } });

    const mark = container.querySelector(`.${PLACEHOLDER_MARK_CLASS}`)!;
    expect(mark.classList.contains(PLACEHOLDER_SELECTED_MARK_CLASS)).toBe(false);
  });

  it("removes the --selected modifier again once the selection moves away", () => {
    const { container, view } = renderBody("<mj-text>Hi {{first_name}}</mj-text>");
    const doc = view.state.doc.toString();
    const start = doc.indexOf("{{first_name}}");
    view.dispatch({ selection: { anchor: start, head: start + "{{first_name}}".length } });
    expect(
      container
        .querySelector(`.${PLACEHOLDER_MARK_CLASS}`)!
        .classList.contains(PLACEHOLDER_SELECTED_MARK_CLASS),
    ).toBe(true);

    view.dispatch({ selection: { anchor: 0 } });
    expect(
      container
        .querySelector(`.${PLACEHOLDER_MARK_CLASS}`)!
        .classList.contains(PLACEHOLDER_SELECTED_MARK_CLASS),
    ).toBe(false);
  });

  it("only marks the placeholder(s) actually covered by the selection, not every placeholder in the document", () => {
    const { container, view } = renderBody(
      "<mj-text>Hi {{first_name}}, your event is {{event_name}}.</mj-text>",
    );
    const doc = view.state.doc.toString();
    const start = doc.indexOf("{{first_name}}");
    view.dispatch({ selection: { anchor: start, head: start + "{{first_name}}".length } });

    const marks = Array.from(container.querySelectorAll<HTMLElement>(`.${PLACEHOLDER_MARK_CLASS}`));
    expect(marks).toHaveLength(2);
    expect(marks[0].classList.contains(PLACEHOLDER_SELECTED_MARK_CLASS)).toBe(true);
    expect(marks[1].classList.contains(PLACEHOLDER_SELECTED_MARK_CLASS)).toBe(false);
  });
});
