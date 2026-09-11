// Shared helpers for driving/asserting on the MJML/HTML body field's CodeMirror editor from
// tests, since it's no longer a plain `<textarea>` (no `.value`/`.setSelectionRange` DOM API) -
// see `insertTokenIntoBody` and `bodyExtensions` in CommunicationPage.tsx for the real component
// side of this.
import { screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";

/** Resolves the CodeMirror `EditorView` behind the body editor field. The body's `aria-label`
 * sits directly on `.cm-content` (see `EditorView.contentAttributes` in CommunicationPage.tsx),
 * so `getByLabelText` already resolves to it without the "non-labellable element" escape hatch a
 * plain `<div>` would need - `.closest(".cm-editor")` then finds the root `EditorView.findFromDOM`
 * expects. */
export function getBodyView(labelText: "MJML body" | "HTML body" = "MJML body"): EditorView {
  const contentEl = screen.getByLabelText(labelText);
  const editorRoot = contentEl.closest(".cm-editor");
  const view = editorRoot && EditorView.findFromDOM(editorRoot as HTMLElement);
  if (!view) throw new Error(`CodeMirror view not found for label "${labelText}"`);
  return view;
}

/** Current document text of the body editor - the CodeMirror equivalent of reading a textarea's
 * `.value`. */
export function bodyValue(view: EditorView): string {
  return view.state.doc.toString();
}

/** Places the body editor's cursor at `pos` by dispatching a selection transaction - the
 * CodeMirror equivalent of a textarea's `setSelectionRange`. Dispatching sets `view.state`
 * directly (what `insertTokenIntoBody` reads), so no real DOM focus is needed for these
 * position-only setups. */
export function setBodyCursor(view: EditorView, pos: number) {
  view.dispatch({ selection: { anchor: pos } });
}

/** Places the cursor at the very end of the body's current document - the CodeMirror equivalent
 * of a textarea `focusAtEnd` helper, so a chip click's insertion point is deterministic. */
export function focusBodyAtEnd(view: EditorView) {
  setBodyCursor(view, view.state.doc.length);
}

/** Replaces the whole document, like `fireEvent.change(textarea, { target: { value } })` did for
 * the old textarea - dispatches a single transaction covering the full existing range. */
export function setBodyValue(view: EditorView, value: string) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
}
