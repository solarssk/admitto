// Visually marks `{{placeholder}}` tokens (e.g. `{{first_name}}`, `{{logo_url}}`) inside the
// MJML/HTML body editor (CommunicationPage.tsx's TemplateEditorCard) so they stand out from the
// surrounding static markup - similar in spirit to the `.communication-chip` pills rendered above
// the editor, but as a lightweight inline mark rather than a button/chip, since this decorates
// text *inside* a CodeMirror document rather than a standalone DOM element.
//
// Technique: CodeMirror 6's documented "Decorating text" idiom - a `MatchDecorator` (regex-driven
// decoration matching, viewport-aware) wrapped in a `ViewPlugin.fromClass` that recomputes its
// `DecorationSet` on every doc/viewport change via the matcher's own `createDeco`/`updateDeco`
// helpers. This scans the raw document text directly, so it decorates a placeholder wherever it
// appears - inside `<mj-text>` body copy just as much as inside an attribute value like
// `src="{{logo_url}}"` - with no awareness of (and no interference with) the HTML syntax tree
// `@codemirror/lang-html` builds alongside it. Both sets of decorations (this plugin's placeholder
// mark, lang-html's tag/attribute-name highlighting) are independent `Decoration.mark` ranges that
// CodeMirror composes into nested `<span>`s wherever they overlap, so neither styling system
// clobbers the other.
//
// The regex is imported from the browser-safe `@admitto/mail-templates/placeholders` subpath
// (same subpath-only-import convention `apps/admin` already follows elsewhere) rather than hand-
// rolled, so this stays in sync with the one canonical placeholder grammar used at render time.
// Cloned rather than passed by reference: `MatchDecorator` mutates `.lastIndex` on whatever
// RegExp object it's given during every scan, and `VALID_PLACEHOLDER_RE` is a shared module-level
// singleton other code may also use independently.
import { Decoration, MatchDecorator, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate, EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { VALID_PLACEHOLDER_RE } from "@admitto/mail-templates/placeholders";

/** Class applied to each matched `{{placeholder}}` span - styled in communication.css, scoped
 * under `.communication-code-editor` alongside this editor's other CodeMirror-specific rules.
 * Exported so tests can query for it without hardcoding the string in two places. */
export const PLACEHOLDER_MARK_CLASS = "cm-admitto-placeholder";

/** Added alongside `PLACEHOLDER_MARK_CLASS` when the placeholder's own range currently overlaps a
 * real (non-empty) text selection - drops the mark's own background fill for exactly that span
 * (see communication.css) so CodeMirror's own selection layer, which paints *behind* normal
 * content and would otherwise be fully hidden under an opaque fill sitting in front of it, shows
 * through at full, undiminished strength instead of a dulled one. The underlying text color stays
 * the same either way, so the placeholder is still recognizable as one while selected. */
export const PLACEHOLDER_SELECTED_MARK_CLASS = "cm-admitto-placeholder--selected";

const placeholderDecoration = Decoration.mark({ class: PLACEHOLDER_MARK_CLASS });
const placeholderSelectedDecoration = Decoration.mark({
  class: `${PLACEHOLDER_MARK_CLASS} ${PLACEHOLDER_SELECTED_MARK_CLASS}`,
});

/** True when [from, to) overlaps some genuinely non-empty selection range - a plain cursor
 * (empty range) sitting inside or next to a placeholder (e.g. right after typing/inserting one)
 * must NOT count, or the background would flicker off any time the cursor is merely nearby, not
 * only while text is actually selected/highlighted. */
function overlapsRealSelection(view: EditorView, from: number, to: number): boolean {
  return view.state.selection.ranges.some((r) => !r.empty && r.from < to && r.to > from);
}

/** Matches the exact same `{{lowercase_snake_case}}` grammar template rendering accepts at send
 * time - anything that doesn't match (`{{Foo}}`, `{oops}`, `{{}}`, an unterminated `{{first_name`)
 * is left completely undecorated. `decoration` is a function (not a fixed value) specifically so
 * each match can pick the selection-aware variant above. */
const placeholderMatcher = new MatchDecorator({
  // Built from .source/.flags of the trusted, static VALID_PLACEHOLDER_RE constant (never from
  // user input) - only to get an independent RegExp *object*, not a dynamic pattern; see the
  // module comment above for why a shared instance isn't safe to hand to MatchDecorator directly.
  // eslint-disable-next-line security/detect-non-literal-regexp
  regexp: new RegExp(VALID_PLACEHOLDER_RE.source, VALID_PLACEHOLDER_RE.flags),
  decoration: (match, view, from) =>
    overlapsRealSelection(view, from, from + match[0].length)
      ? placeholderSelectedDecoration
      : placeholderDecoration,
});

class PlaceholderHighlightPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = placeholderMatcher.createDeco(view);
  }

  update(update: ViewUpdate) {
    // MatchDecorator.updateDeco() only re-invokes the `decoration` callback above for ranges
    // whose underlying *text* changed - a pure selection change (dragging to select, or just
    // moving the cursor) doesn't count as a doc change, so it would otherwise leave already-
    // rendered placeholders on their previous (possibly now-stale) selected/unselected variant.
    // A full recompute is cheap for a mail-template-sized document, so this just always takes the
    // correct, current-selection-aware path instead of trying to patch updateDeco's narrower one.
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = placeholderMatcher.createDeco(update.view);
    }
  }
}

/** Highlights `{{placeholder}}` tokens in the MJML/HTML body editor. Add alongside `html()` in
 * the editor's `extensions` array (order relative to `html()` doesn't matter - decorations from
 * different sources compose regardless of extension order). */
export const placeholderHighlightViewPlugin: Extension = ViewPlugin.fromClass(
  PlaceholderHighlightPlugin,
  { decorations: (instance) => instance.decorations },
);
