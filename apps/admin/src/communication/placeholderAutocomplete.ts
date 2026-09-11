// Offers the template's own placeholders as an autocomplete list once the admin types "{{" in
// the MJML/HTML body editor, instead of only being reachable by reaching for a chip above the
// editor. Deliberately the ONLY completion source active in the editor: passed via
// `autocompletion({override: [...]})`, which replaces whatever completions the current language
// (@codemirror/lang-html) would otherwise offer from its own language data - those are built for
// standard HTML tags/attributes, not MJML's custom <mj-*> elements, and would be wrong/noisy here
// (see the basicSetup={{autocompletion: false}} call site in CommunicationPage.tsx, which turns
// off the language's own instance so this is the only one active).
import { autocompletion, type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";

export interface PlaceholderCompletionItem {
  name: string;
  description?: string;
}

/** Stops closeBrackets (on by default, part of basicSetup) from treating "{" as a bracket to
 * auto-close - it otherwise turns the very first "{" of a "{{placeholder}}" into "{|}" and the
 * second into "{{|}}}}" before the admin has typed a single identifier character. That empty
 * "{{}}" is a real, matchable-looking placeholder attempt: it round-trips through the page's
 * existing (pre-CodeMirror) live-preview request on every keystroke, so simply pausing with the
 * completion popup open - before picking anything - was enough to fire a genuine 400 back from
 * the template/preview endpoint (visible as console noise, real PO report). `@codemirror/lang-html`
 * doesn't register its own `"closeBrackets"` language data (confirmed by reading its source), so
 * this is the only provider active and applies cleanly - quotes, parens, and square brackets are
 * untouched and still auto-close normally in attribute values. */
export const placeholderBracesConfig: Extension = EditorState.languageData.of(() => [
  { closeBrackets: { brackets: ["(", "[", "'", '"'] } },
]);

/** Matches an open, in-progress `{{name` sequence ending at the cursor - deliberately requires
 * the literal "{{" (not just a bare identifier), so this only activates while actually typing a
 * placeholder token, and stops matching the moment "}}" closes it (`}` isn't part of the
 * following character class). Exported for the test file. */
export const PLACEHOLDER_TRIGGER_RE = /\{\{[a-z0-9_]*/i;

/** Inserts the placeholder name and closes it with "}}" - unless "}}" is already sitting right
 * after the completion range, in which case it just moves the cursor past that existing pair
 * instead of adding a second one. That already-there case is the common one: typing the first
 * "{" auto-inserts its own "}" (closeBrackets, on by default), so by the time "{{" is typed the
 * editor already reads "{{|}}" - a plain `apply: name + "}}"` string is a raw text insert that
 * bypasses closeBrackets' own "skip over an auto-closed bracket" handling entirely (that only
 * triggers on real keystrokes), so it blindly appends a second closing pair on top of the first,
 * producing "{{name}}}}" (four closing braces - a real PO repro on a live screenshot). */
function applyPlaceholderCompletion(view: EditorView, completion: Completion, from: number, to: number) {
  const name = completion.label;
  const alreadyClosed = view.state.doc.sliceString(to, to + 2) === "}}";
  const insert = alreadyClosed ? name : `${name}}}`;
  view.dispatch({
    changes: { from, to, insert },
    // Relative to `from`, not `to`: the transaction replaces [from, to) with `insert`, so in the
    // resulting document `insert` always starts at `from`, regardless of how wide the replaced
    // range was (e.g. completing over an already-typed partial name like "first_" replaces more
    // than it inserts) - anchoring off `to` here previously landed the cursor past the end of the
    // document whenever `to > from`.
    selection: { anchor: from + insert.length + (alreadyClosed ? 2 : 0) },
  });
}

/** Builds the `CompletionSource` itself, separately from the `autocompletion()` extension that
 * wraps it - exported so tests can call it directly against a manually constructed
 * `CompletionContext` (the pattern CM6's own docs recommend for testing completion sources),
 * rather than driving a full CodeMirror view through the extension's actual popup/typing-
 * detection machinery just to exercise this logic. */
export function createPlaceholderCompletionSource(
  items: readonly PlaceholderCompletionItem[],
): CompletionSource {
  const options: Completion[] = items.map(({ name, description }) => ({
    label: name,
    apply: applyPlaceholderCompletion,
    type: "variable",
    // Deliberately `detail` (always rendered inline on the row), not `info` (a side panel that
    // only appears for whichever option is currently "selected" - which CodeMirror only moves via
    // the keyboard: there's no mouse hover handler on the list at all, confirmed by reading
    // @codemirror/autocomplete's own source). `info` left every row's description invisible to a
    // mouse-only user (real PO feedback after trying it live) - `detail` shows every description
    // unconditionally, and the readability problem that motivated trying `info` in the first place
    // is fixed with real CSS instead (see .communication-code-editor .cm-completion* below).
    detail: description,
  }));
  return (context: CompletionContext) => {
    const match = context.matchBefore(PLACEHOLDER_TRIGGER_RE);
    if (!match) return null;
    return {
      // +2 to land right after "{{" - the match itself always includes the two braces, options
      // replace only the identifier portion typed so far, not the braces themselves.
      from: match.from + 2,
      options,
      validFor: /^[a-z0-9_]*$/,
    };
  };
}

/** Builds the `{{`-triggered placeholder autocomplete extension for a specific set of known
 * placeholders. Callers rebuild this (see `bodyExtensions`' useMemo deps in
 * CommunicationPage.tsx) whenever the underlying list changes - e.g. a template/event switch. */
export function createPlaceholderAutocomplete(items: readonly PlaceholderCompletionItem[]): Extension {
  return autocompletion({ override: [createPlaceholderCompletionSource(items)] });
}
