// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CompletionContext, insertBracket } from "@codemirror/autocomplete";
import {
  createPlaceholderCompletionSource,
  placeholderBracesConfig,
  PLACEHOLDER_TRIGGER_RE,
} from "../../src/communication/placeholderAutocomplete.js";

const ITEMS = [
  { name: "first_name", description: "Attendee's first name." },
  { name: "first_ticket_type", description: "First ticket type on the order." },
  { name: "event_name", description: "This event's title." },
];

/** Runs the completion source against `doc` with the cursor at `pos` (default: end of doc) - the
 * exact pattern CM6's own docs recommend for testing a `CompletionSource` (a manually built
 * `CompletionContext`), rather than driving a real view through the extension's popup/typing-
 * detection machinery. */
function complete(doc: string, pos = doc.length, explicit = false) {
  const state = EditorState.create({ doc });
  const context = new CompletionContext(state, pos, explicit);
  return createPlaceholderCompletionSource(ITEMS)(context);
}

describe("createPlaceholderCompletionSource", () => {
  it("offers every known placeholder right after typing an open \"{{\"", () => {
    const result = complete("Hi {{");
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toEqual([
      "first_name",
      "first_ticket_type",
      "event_name",
    ]);
    // The replaced range starts right after "{{", not at the braces themselves.
    expect(result!.from).toBe("Hi {{".length);
  });

  it("still triggers (with the same full option list) once a partial name has been typed", () => {
    const result = complete("Hi {{first_");
    expect(result).not.toBeNull();
    // The source itself always returns the full, unfiltered option list, plus `validFor` - actual
    // narrowing against what's typed so far is CodeMirror's own job at render time (fuzzy/prefix
    // matching against each option's label), not something this source does itself.
    expect(result!.options.map((o) => o.label)).toEqual([
      "first_name",
      "first_ticket_type",
      "event_name",
    ]);
    expect(result!.validFor).toBeTruthy();
    // The replaced range still starts right after "{{", not at the already-typed "first_".
    expect(result!.from).toBe("Hi {{".length);
  });

  it("completing a suggestion inserts the rest of the name plus the closing braces", () => {
    const doc = "Hi {{first_";
    const result = complete(doc);
    const picked = result!.options.find((o) => o.label === "first_name")!;
    expect(typeof picked.apply).toBe("function");

    const view = new EditorView({ state: EditorState.create({ doc }) });
    (picked.apply as (view: EditorView, completion: typeof picked, from: number, to: number) => void)(
      view,
      picked,
      result!.from,
      doc.length,
    );
    expect(view.state.doc.toString()).toBe("Hi {{first_name}}");
    expect(view.state.selection.main.head).toBe("Hi {{first_name}}".length);
    view.destroy();
  });

  // Regression (real PO repro on a live screenshot): closeBrackets (on by default) auto-inserts
  // "}}" the moment the second "{" of "{{" is typed, so by the time a completion is picked the
  // document already reads "{{first_|}}" - a plain string `apply` blindly appends its own "}}" on
  // top of that, producing "{{first_name}}}}" (four closing braces).
  it("does not duplicate the closing braces when closeBrackets already auto-inserted them", () => {
    const doc = "Hi {{first_}}"; // cursor sits right before the auto-inserted "}}"
    const cursorPos = "Hi {{first_".length;
    const result = complete(doc, cursorPos);
    const picked = result!.options.find((o) => o.label === "first_name")!;

    const view = new EditorView({ state: EditorState.create({ doc }) });
    (picked.apply as (view: EditorView, completion: typeof picked, from: number, to: number) => void)(
      view,
      picked,
      result!.from,
      cursorPos,
    );
    expect(view.state.doc.toString()).toBe("Hi {{first_name}}");
    expect(view.state.selection.main.head).toBe("Hi {{first_name}}".length);
    view.destroy();
  });

  it("returns null once the placeholder is already closed with \"}}\"", () => {
    expect(complete("Hi {{first_name}}")).toBeNull();
  });

  it("returns null with no open \"{{\" before the cursor at all", () => {
    expect(complete("Hi there")).toBeNull();
  });

  it("carries the same description text shown on the chip tooltips, as the completion's detail - always visible on the row, not gated behind keyboard-only selection", () => {
    const result = complete("{{");
    const eventName = result!.options.find((o) => o.label === "event_name")!;
    expect(eventName.detail).toBe("This event's title.");
    expect(eventName.info).toBeUndefined();
  });
});

describe("PLACEHOLDER_TRIGGER_RE", () => {
  it("matches an open, in-progress placeholder", () => {
    expect(PLACEHOLDER_TRIGGER_RE.test("{{first_name")).toBe(true);
  });

  it("does not match plain text with no braces", () => {
    const re = new RegExp(PLACEHOLDER_TRIGGER_RE.source, PLACEHOLDER_TRIGGER_RE.flags);
    expect(re.test("first_name")).toBe(false);
  });
});

// Regression (real PO repro): without this config, typing the very first "{" of "{{placeholder}}"
// auto-closes to "{}" (closeBrackets, on by default), and the second "{" then produces "{{}}" -
// a complete, empty placeholder attempt that round-trips through the page's live-preview request
// on every keystroke, so just pausing with the completion popup open (before picking anything)
// was enough to fire a genuine 400 from the template/preview endpoint.
describe("placeholderBracesConfig", () => {
  it("stops closeBrackets from auto-closing an open curly brace", () => {
    const state = EditorState.create({ doc: "", extensions: [placeholderBracesConfig] });
    expect(insertBracket(state, "{")).toBeNull();
  });

  it("leaves closeBrackets' normal behavior for other bracket types untouched (parens still auto-close in attribute values)", () => {
    const state = EditorState.create({ doc: "", extensions: [placeholderBracesConfig] });
    const tr = insertBracket(state, "(");
    expect(tr).not.toBeNull();
    expect(tr!.state.doc.toString()).toBe("()");
  });

  it("sanity check: without this config, closeBrackets really does auto-close curly braces by default", () => {
    const state = EditorState.create({ doc: "" });
    const tr = insertBracket(state, "{");
    expect(tr).not.toBeNull();
    expect(tr!.state.doc.toString()).toBe("{}");
  });
});
