# Admin SPA component and bundling gotchas

Read when you add a component, a dropdown, a modal, CSS, a font, or an import from a workspace package in `apps/admin`.

---

**Font formats (`apps/admin`'s own bundled fonts): woff2 only, no woff/truetype fallback** - the
app's JS already requires a browser new enough that woff2 is a given, so older formats are pure
dead weight in the package-shipped CSS (Tabler icons, `@fontsource` text fonts). This does **not**
apply to organisation-uploaded custom branding fonts (`FontFamilyModal.tsx`, `uploadThemeFont`) -
those accept whatever format the customer's own font file comes in
(`woff2`/`woff`/`ttf`/`otf`, see `FONT_FILE_RE`), and we don't control that. See
[packages/ui/README.md](../../packages/ui/README.md) "Fonts" for the full reasoning, what's currently
shipped vs. stripped, script/locale coverage gaps (Arabic, CJK, RTL), and why the same fix doesn't
mechanically extend to `@fontsource` text fonts (CSS `@import` bypasses Vite's plugin hooks - don't
re-attempt that approach without reading why it failed first).

**`apps/admin` pages are lazily code-split (`React.lazy`) - a component's CSS import must live in
that component's own file, not just "somewhere already loaded on this page".** A modal/component
that reuses another feature's CSS classes (e.g. the shared `add-attendee-modal.css` "standard
modal" markup, or `IconPicker`'s `icon-picker.css`) needs its own `import "*.css"` line even if
some other already-visited lazy chunk happens to load that stylesheet too - that only works by
accident of navigation order within one browser session, and renders fully unstyled on a cold
visit straight to the page that's missing the import. Found via `CreateTemplateDialog.tsx` (in the
lazy `communication` chunk) using `.add-attendee-modal__*` classes with no import of that CSS file
at all. `grep -rn 'import "delivery-modals.css"' apps/admin/src/communication/` - every consumer of
a shared modal/component CSS file should show up importing it directly.

**Do not import `@admitto/mail-templates`, `@admitto/tickets`, or `@admitto/wallet` (package root) from `apps/admin`.** All three barrels re-export Prisma/node-only server modules, and Vite can ship them into a lazy SPA chunk.

| Package | Why it leaks | Safe subpath to use instead |
|---|---|---|
| `@admitto/mail-templates` | Barrel pulls in mjml/fs. Caused `fileURLToPath is not a function` on Event Settings. | `@admitto/mail-templates/placeholders` |
| `@admitto/tickets` | Barrel pulls in Prisma, `node:crypto`, pdfkit, and, via `htmlnano`→`cosmiconfig`'s optional TS-config loader, the entire `typescript` compiler. | `@admitto/tickets/custom-data-reserved`, `@admitto/tickets/event-item-usability` |
| `@admitto/wallet` | Barrel pulls in `node:crypto`, Prisma, and `pg` transitively via `registration-sync.ts`/`passcreator-webhook.ts`; pulled `node:crypto`, `node:url`, `@prisma/client/runtime`, `pg`, and `pgpass` into the Event Settings chunk via the `WALLET_MAPPING_PLACEHOLDERS` import. | `@admitto/wallet/passcreator-mapper`, `@admitto/wallet/capabilities` (static provider facts, type-only imports) |

Same idea as avoiding `@admitto/auth`'s root entry for password helpers (`./constants`, `./password-strength`). Type-only re-exports from the root remain OK when they stay `import type` / `export type`.

A local build's Vite output (`npm run build -w @admitto/admin`) surfaces new leaks as "Module ... has been externalized for browser compatibility" warnings during the `vite build` step: do not ignore them.

**A CSS custom-property fallback (`var(--token, #hex)`) must match the token's real value in `packages/ui/src/styles/tokens/colors.css` exactly.** The fallback only renders when the variable is genuinely undefined (a stylesheet load race, or a standalone page that never imports `colors.css`), so a drifted fallback is invisible in normal use and easy to introduce with a hand-typed hex that's merely close to the real color.

`apps/admin/test/styles/token-fallback-coverage.test.ts` parses `colors.css` at test time (not a hardcoded copy) and fails the build on any mismatch across `apps/admin/src`, `apps/web/src`, and `packages/ui/src`. If you add a new token or a new `var(--x, #hex)` usage, run this test rather than eyeballing the hex.

> **Reusable technique:** when a set of things must each map to exactly one fixed value (an API error code to its UI message, see `apps/admin/test/api/operator-api-error.coverage.test.ts` for `CODE_MESSAGES`; a design token to its fallback; a status enum to its label), write a test that scans real usages and fails on drift, rather than trusting the mapping stays complete by review alone. Neither `tsc` nor a normal Vitest assertion catches this class of gap.

**A `ConfirmDialog` (or any child modal) opened from inside a parent modal must suspend the parent's own `useModalFocusTrap` while it's open:**

```ts
useModalFocusTrap(panelRef, open && !anyConfirmDialogOpen, handleClose)
```

See `apps/admin/src/pages/users/UserEditModal.tsx` and `apps/admin/src/identity/useUnsavedChangesGuard.ts`.

Why: both traps register a capture-phase `keydown` listener on `document`. If the parent's stays active, its listener (registered first, since it mounts before the child dialog opens) fires ahead of the child's on every Escape press, which can reopen a second copy of the same dialog instead of letting the topmost one close.

> **Test this explicitly:** the bug surfaces specifically on Escape (Tab-trapping still works, since focus itself is already inside the child), so a click-only manual test of a nested dialog can look correct while the bug is present. Test Escape whenever a `ConfirmDialog` can appear on top of an already-open modal.

**Before writing a new dropdown, combobox, or checkbox-list picker, check `apps/admin/src/components/` first.** `SearchableSelect.tsx` (single choice from a list, with a search box past 6 options) and its sibling `MultiSelect.tsx` (same trigger/panel/`useDropdownMenu` mechanism, checkbox rows that stay open instead of closing on click) already cover "pick one" and "pick several" from a fixed option list, including the multi-select filters on the Attendees list (ticket type, attendance, mail delivery status). Reach for `SearchableSelect`/`MultiSelect` even for a page-local, one-off filter.

**A floating panel (menu, picker, suggestion list) is placed by `useFloatingPlacement` (`apps/admin/src/components/useFloatingPlacement.ts`), never by your own `getBoundingClientRect()` math.** It uses Floating UI (offset, flip, shift, size against the visual viewport) and applies the result as a `transform` on a `position: fixed` panel at `left: 0; top: 0`, so the panel is never measured squeezed against an edge. `useDropdownMenu` is built on it; a component that keeps its own open state and click-outside (a date, time or timezone picker, an autocomplete list) calls it directly and spreads `panelStyle` on the panel. Hand-rolled copies of this had to be fixed again and again for narrow viewports, a CSS `min-width` wider than the viewport, a max-height that changes the width, and a panel remeasured while visible. A new panel that also sets its own `top`, `left` or `transform` fights the hook. `apps/admin/test/styles/placement-standard.test.ts` fails on an inline `position: "fixed"`, on `attachFixedOverlayLifecycle` or `getFixedOverlayViewport` outside the hook, and on a function that both measures an element with `getBoundingClientRect()` and reads the window's size (`window.innerWidth`, `innerHeight`, `visualViewport`, `documentElement.clientWidth`/`clientHeight`); it reads the code as a syntax tree, so comments, strings and unrelated uses in one file do not count; it is a ratchet, and its only exception today is the `Tooltip` in `packages/ui`, which cannot import the hook.

This class of duplication has already happened silently once: `FiltersMenu.tsx` exists only because the Attendees list's `FilterToolbar` and the Reports admission log had each already written their own copy of the same trigger/panel/badge wiring before anyone noticed and extracted it (see that file's own doc comment).
