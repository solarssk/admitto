// Flags {{placeholder}} tokens that aren't in the template's known/allowed set as inline lint
// diagnostics (red squiggly underline + gutter marker + hover tooltip via @codemirror/lint) -
// the same "Unknown placeholder: X" wording the server already returns on Save/Preview (see
// collectTemplateSourceErrors in apps/web/src/admin/communication-api-routes.ts), surfaced live
// as the admin types instead of only after a failed save/preview round-trip.
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { VALID_PLACEHOLDER_RE } from "@admitto/mail-templates/placeholders";

/** Builds the inline-lint extension for a specific "known placeholder" set. Callers rebuild this
 * (see `bodyExtensions`' useMemo deps in CommunicationPage.tsx) whenever that set changes - e.g.
 * a template/event switch - so the closure below always reads the current allow-list; content
 * edits alone re-run the lint automatically (that's `linter()`'s own job, debounced). */
export function createUnknownPlaceholderLinter(knownPlaceholders: ReadonlySet<string>): Extension {
  return [
    linter((view) => {
      const diagnostics: Diagnostic[] = [];
      const text = view.state.doc.toString();
      // A fresh RegExp per lint pass, not VALID_PLACEHOLDER_RE directly - MatchDecorator-style
      // regex.exec loops mutate `.lastIndex` on whatever object they're given, and that object is
      // a shared module-level singleton other code also reads independently (see the same
      // reasoning in placeholderHighlightViewPlugin.ts).
      const re = new RegExp(VALID_PLACEHOLDER_RE.source, VALID_PLACEHOLDER_RE.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(text))) {
        const name = match[1];
        if (name && !knownPlaceholders.has(name)) {
          diagnostics.push({
            from: match.index,
            to: match.index + match[0].length,
            severity: "error",
            message: `Unknown placeholder: ${name}`,
          });
        }
      }
      return diagnostics;
    }),
    lintGutter(),
  ];
}
