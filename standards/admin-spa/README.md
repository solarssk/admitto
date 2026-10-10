# Admin SPA standards

Rules for the staff app in `apps/admin`. [apps/admin/AGENTS.md](../../apps/admin/AGENTS.md) is the short version that is loaded when you work there; the files below hold the full rules and the recipes for individual screens.

| You are about to | Read |
|---|---|
| Show a success, error, warning or confirmation | [feedback-and-errors.md](feedback-and-errors.md) |
| Add or change any wait: spinner, placeholder, busy button, Retry, failed load, or the loading recipe of a screen | the section "Admin SPA loading and busy states" in [AGENTS.md](../../AGENTS.md#admin-spa-loading-and-busy-states) (moves here in the next step) |
| Change what a screen shows, in any state (placeholder, error, empty, loaded) | [readability.md](readability.md) |
| Add a component, dropdown, modal, CSS file, font, or an import from a workspace package | [ui-gotchas.md](ui-gotchas.md) |
| Write the words of an error or a notice | [docs/dev/error-and-notice-copy.md](../../docs/dev/error-and-notice-copy.md) |

## What checks these rules for you

The mechanical parts are tests, so a violation fails CI with a hint of what to use instead:

- `apps/admin/test/styles/loading-standard.test.ts`: no one-off spinner or shimmer keyframes, no `Loading…` text, no hand-made `Saving…` labels, no Retry button that is not busy while it works, no `disabled={busy}` on a raw button.
- `apps/admin/test/styles/loading-label-length.test.ts`: a `loadingLabel` is never longer than the label at rest.
- `apps/admin/test/styles/readable-text-css.test.ts`: the CSS that keeps text readable.
- `apps/admin/test/styles/token-fallback-coverage.test.ts`: a `var(--token, #hex)` fallback equals the token.
- `apps/admin/test/api/operator-api-error.coverage.test.ts`: every known API error code has its UI string.

The rest (what the screen looks like at 390px, a focus that falls to the page, a message that is announced twice) is in the rules and in review. Look at the screen in a real browser before you change what it shows.
