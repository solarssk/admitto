// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { forceLinting, forEachDiagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { createRef } from "react";
import { createUnknownPlaceholderLinter } from "../../src/communication/placeholderUnknownLint.js";

afterEach(() => cleanup());

/** Forces the debounced lint pass to start immediately, then waits past it - `forceLinting` only
 * kicks the pass off synchronously, but `linter()` always wraps even a sync source in
 * `Promise.resolve()` internally, so the actual `setDiagnostics` dispatch lands on a later
 * microtask/macrotask. A `setTimeout(0)` flush (not just one microtask - `linter()`'s own
 * batching chains a couple of `.then()`s) reliably waits past that before reading state back. */
async function runLintPass(view: EditorView) {
  forceLinting(view);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function readDiagnostics(view: EditorView) {
  const diagnostics: { from: number; to: number; message: string }[] = [];
  forEachDiagnostic(view.state, (d, from, to) => diagnostics.push({ from, to, message: d.message }));
  return diagnostics;
}

/** Renders the body editor with the real linter (same `html()` pairing as the actual component)
 * and returns the resulting diagnostics once the lint pass has settled. */
async function lintBody(value: string, knownPlaceholders: string[]) {
  const ref = createRef<ReactCodeMirrorRef>();
  render(
    <CodeMirror
      ref={ref}
      value={value}
      extensions={[html(), createUnknownPlaceholderLinter(new Set(knownPlaceholders))]}
    />,
  );
  const view = ref.current!.view!;
  await runLintPass(view);
  return { view, diagnostics: readDiagnostics(view) };
}

describe("createUnknownPlaceholderLinter", () => {
  it("flags a placeholder that isn't in the known set", async () => {
    const { diagnostics } = await lintBody("<mj-text>Hi {{not_a_real_one}}</mj-text>", [
      "first_name",
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe("Unknown placeholder: not_a_real_one");
  });

  it("does not flag a placeholder that is in the known set", async () => {
    const { diagnostics } = await lintBody("<mj-text>Hi {{first_name}}</mj-text>", ["first_name"]);
    expect(diagnostics).toHaveLength(0);
  });

  it("flags an unknown placeholder inside an attribute value too", async () => {
    const { diagnostics } = await lintBody('<mj-image src="{{not_configured}}" />', [
      "first_name",
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe("Unknown placeholder: not_configured");
  });

  it("reports the exact range of the token, braces included", async () => {
    const value = "<mj-text>{{oops}}</mj-text>";
    const { diagnostics } = await lintBody(value, []);
    expect(diagnostics).toHaveLength(1);
    const { from, to } = diagnostics[0];
    expect(value.slice(from, to)).toBe("{{oops}}");
  });

  it("does not flag malformed look-alikes that VALID_PLACEHOLDER_RE itself would reject", async () => {
    const { diagnostics } = await lintBody("{{Foo}} {oops} {{}} {{first_name", ["first_name"]);
    expect(diagnostics).toHaveLength(0);
  });

  it("re-lints live after an edit, without needing new extensions", async () => {
    const { view, diagnostics: before } = await lintBody("<mj-text>{{first_name}}</mj-text>", [
      "first_name",
    ]);
    expect(before).toHaveLength(0);

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "{{gone_now}}" } });
    await runLintPass(view);
    expect(readDiagnostics(view).map((d) => d.message)).toEqual(["Unknown placeholder: gone_now"]);
  });
});
