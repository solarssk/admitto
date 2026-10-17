# Admin SPA standards

Rules for the staff app in `apps/admin`. [apps/admin/AGENTS.md](../../apps/admin/AGENTS.md) is the short version that is loaded when you work there; the files below hold the full rules and the recipes for individual screens.

| You are about to | Read |
|---|---|
| Show a success, error, warning or confirmation | [feedback-and-errors.md](feedback-and-errors.md) |
| Add or change any wait: spinner, placeholder, busy button, Retry, failed load | [loading.md](loading.md) |
| ...on a settings panel, a modal editor, Event settings, Communication, Overview, Requirements, Account, the event deep link | [loading-settings-and-pages.md](loading-settings-and-pages.md) |
| ...on a card list, the delivery log, a record modal, a Reports tab, the Attendees list, the events picker, the attendee page | [loading-lists-and-reports.md](loading-lists-and-reports.md) |
| ...on the send panels, Add attendee, Import, the setup wizard, the custom field editor, a lookup of options | [loading-flows-and-dialogs.md](loading-flows-and-dialogs.md) |
| Change what a screen shows, in any state (placeholder, error, empty, loaded) | [readability.md](readability.md) |
| Show a time: a timestamp, a "last updated", a "Today 14:05" | [time-display.md](time-display.md) |
| Add a component, dropdown, modal, CSS file, font, or an import from a workspace package | [ui-gotchas.md](ui-gotchas.md) |
| Write the words of an error or a notice | [docs/dev/error-and-notice-copy.md](../../docs/dev/error-and-notice-copy.md) |

## What checks these rules for you

The mechanical parts are tests, so a violation fails CI with a hint of what to use instead:

- `apps/admin/test/styles/loading-standard.test.ts`: no one-off spinner or shimmer keyframes, no `Loading…` text, no hand-made `Saving…` labels, no Retry button that is not busy while it works, no `disabled={busy}` on a raw button.
- `apps/admin/test/styles/loading-label-length.test.ts`: a `loadingLabel` is never longer than the label at rest.
- `apps/admin/test/styles/readable-text-css.test.ts`: the CSS that keeps text readable.
- `apps/admin/test/styles/token-fallback-coverage.test.ts`: a `var(--token, #hex)` fallback equals the token.
- `apps/admin/test/api/operator-api-error.coverage.test.ts`: every known API error code has its UI string.
- `apps/admin/test/locale/time-zone-standard.test.ts`: no new read of the viewer's own time zone, no time formatted without a zone, no fallback from an actor's zone to another zone.

The rest (what the screen looks like at 390px, a focus that falls to the page, a message that is announced twice) is in the rules and in review. Look at the screen in a real browser before you change what it shows.
