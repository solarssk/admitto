# AGENTS.md - apps/admin (staff SPA)

Loaded in addition to the root [AGENTS.md](../../AGENTS.md), whose security, test and PR rules apply here too. This file is the short version. The full rules, with the recipe for each screen, are in [standards/admin-spa/](../../standards/admin-spa/README.md): open the file for the part you are changing before you write code, not after review.

## Before you change a screen

- Look at it in real Chrome at 1280px and at 390px, in every state it has: placeholder, slow note, error with Retry, empty, loaded. Use data as long as real data is (an address as a name, a long word in a note). [readability.md](../../standards/admin-spa/readability.md)
- Run the full admin suite and `npm run build -w @admitto/admin` before pushing. Vitest alone does not run `tsc`.

## Which surface says it

| Situation | Use |
|---|---|
| Outcome of something the user just did, no retry needed | Toast (`useToast()`) |
| Lasting fact or warning about the view | `Notice` |
| The page's first load failed, or data is missing until Retry | `<EmptyState variant="error">` with Retry (an empty list is a plain `EmptyState`) |
| Destructive or irreversible step | `ConfirmDialog`, never `window.confirm()` or `window.alert()` |
| Error tied to a modal, a field or an overlay that has focus | Inline, in that place |

`confirmVariant` is `"primary"` unless the action really destroys something. Full table and the check-in camera exception: [feedback-and-errors.md](../../standards/admin-spa/feedback-and-errors.md).

## Errors come from the helper, never from the server text

Do not put `ApiError.message` into a toast or an inline string. Use `operatorApiErrorMessage(err, fallback)`, and `hasApiErrorCode(err, "code")` to branch. Server JSON can carry machine codes or internal detail. Wording rules: [docs/dev/error-and-notice-copy.md](../../docs/dev/error-and-notice-copy.md).

## Every wait uses the shared kit from `@admitto/ui`

| Situation | Use | Appears |
|---|---|---|
| Whole screen | `PageLoader` | at once |
| Panel or dialog of unknown shape | `SectionLoader` with `minHeight`, once per view | after 200 ms |
| Shape known | `Skeleton` of that shape | after 200 ms |
| Data on screen is refetched | keep it, dim it, block clicks (`RefetchRegion`) | after 200 ms |
| Page change | `TopProgressBar` | after 200 ms |
| User clicked a button | `<Button loading>` | at once |

- Timing comes from `useLoadingGate`: 200 ms before it shows, 400 ms at least once shown, "Taking longer than usual" at 8 s, an error with Retry at 30 s.
- A failed load is an error state with Retry, never an empty state. A Retry keeps the error and its busy button on screen until the answer is in.
- A busy button keeps keyboard focus: use `loading` (it sets `aria-disabled`), never `disabled={busy}` on a button that starts the work. One busy flag per action. A `loadingLabel` is never longer than the label at rest.
- Never write your own spinner, shimmer, `Loading…` text or `saving ? "Saving…" : "Save"`.
- Detail and the recipe for each screen: [loading.md](../../standards/admin-spa/loading.md), and the three `loading-*` files it links.

## Gotchas that pass tests and break later

- Never import the root of `@admitto/mail-templates`, `@admitto/tickets` or `@admitto/wallet`: they pull Prisma and Node-only server code into the browser bundle. Use the subpaths in [ui-gotchas.md](../../standards/admin-spa/ui-gotchas.md). Watch the `vite build` output for "externalized for browser compatibility".
- Pages are lazy chunks: each component imports the CSS it uses itself.
- Check `src/components/` (`SearchableSelect`, `MultiSelect`) before writing a dropdown.
- A `ConfirmDialog` opened over a modal must suspend the parent's focus trap. Test it with Escape.
- Fonts bundled by the app are woff2 only. A `var(--token, #hex)` fallback must equal the token.
