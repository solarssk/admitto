# @admitto/ui

Design system for the staff SPA: Tabler-flavoured CSS tokens plus shared React primitives used by `@admitto/admin` (and anywhere else that needs the same look).

## What lives here

- **Tokens / theme** - CSS variables and theme helpers (`theme.ts`, `styles/`)
- **Primitives** - `Button`, `Input`, `Select`, `Checkbox`, `Switch`, `ModalBackdrop` (the shell the admin modals build on), `Toast`, `Notice`, `EmptyState`, `PageHeader`, `Avatar`, `Card`, `Tooltip`, `HintLabel`, `IconButton`, `PasswordStrengthMeter`, `StatusBadge`, `TicketTypeBadge`, tabs, badges, `Skeleton`/`Spinner`, `PageLoader`/`SectionLoader` (the Admitto mark as a loading screen), `TopProgressBar`, `Button loading`, etc.
- **Assets** - shared static pieces under `src/assets/`, exported as source through `@admitto/ui/assets/*`

This package does **not** own app routes or API calls. Page-level UI stays in `apps/admin`.

## Import

```ts
import { Button, Notice, useToast } from "@admitto/ui";
```

Stylesheets and assets are subpath exports served from source: `@admitto/ui/styles.css` (tokens and component styles), `@admitto/ui/shell.css`, `@admitto/ui/ticket.css` and `@admitto/ui/assets/*` (logo SVGs). The theme helpers (`resolveThemeVars`, `themeVarsToStyleBlock`, `applyThemeVars` and the branding font validators) are exported from the root.

Prefer these components over one-off markup so spacing, focus, and toast behaviour stay consistent (see root [AGENTS.md](../../AGENTS.md) toast vs Notice guidance).

Every loading or busy state uses these components and the timing in [AGENTS.md](../../AGENTS.md) "Admin SPA loading and busy states", not a hand-made spinner, shimmer or label swap.

## Build

```bash
npm run build -w @admitto/ui
```

The SPA resolves this package's TypeScript entry from `dist/`, so rebuild it after changing primitives or `theme.ts`. The CSS tokens and component styles are imported from `src/styles/` directly and update through Vite hot reload.

## Fonts

Self-hosted via `@fontsource` (`styles/tokens/fonts.css`). No third-party CDN requests: the families themselves are always loaded from bundled files, never from the visitor's OS (`--font-sans` still lists system fonts as a last-resort fallback, and monospace text uses a system mono stack, `--font-mono`). The Tabler icon font (`@tabler/icons-webfont`, `.ti-*` classes) is imported by `apps/admin` itself, not by this package.

Everything below covers this package's own bundled UI fonts only. It does **not** apply to
organisation-uploaded custom branding fonts (`apps/admin/src/settings/FontFamilyModal.tsx`,
`uploadThemeFont`) - those accept whatever format the customer's own font file comes in
(`.woff2`/`.woff`/`.ttf`/`.otf`), since Admitto doesn't control what format a customer supplies.

| Family | Role | Weights | Script coverage shipped |
|---|---|---|---|
| Inter | Default UI font (body and headings) | 400, 400 italic, 500, 600, 700, 700 italic | Latin, Latin Extended, Cyrillic, Cyrillic Ext, Greek, Greek Ext, Vietnamese |
| Manrope | Built-in option of the Branding theme font picker ("Modern sans") | 400, 500, 600, 700 | Latin, Latin Extended, Cyrillic, Cyrillic Ext, Greek, Vietnamese |
| Space Grotesk | Built-in option of the Branding theme font picker ("Geometric sans") | 400, 500, 600, 700 | Latin, Latin Extended, Vietnamese |
| IBM Plex Sans | Built-in option of the Branding theme font picker ("Corporate sans") | 400, 400 italic, 500, 600, 700, 700 italic | Latin, Latin Extended, Cyrillic, Cyrillic Ext, Greek, Vietnamese |
| Tabler Icons (imported by `apps/admin`, not bundled here) | Icon font (`.ti-*` classes) | 400 only | n/a (glyphs, not text) |

**Not covered by any of the above.** `SUPPORTED_LOCALE_TAGS` (`packages/shared/src/supportedLocales.ts`) already lists the CJK locales `ja-JP`, `zh-CN` and `ko-KR`, which need glyphs these fonts lack; Arabic and other right-to-left locales are not listed today, but would hit the same gaps:

- **Arabic (not a supported locale yet)** - none of these five typefaces ship Arabic glyphs at all; this isn't a missing subset import, the character set doesn't exist in the font files. Arabic text silently falls back to whatever font the visitor's OS provides, which won't match the app's branding.
- **CJK (Japanese/Chinese/Korean)** - `ja-JP`, `zh-CN`, `ko-KR` are valid `preferred_locale` values (used for `Intl`-based date/number formatting only, see below), but no shipped font has Han/Kana/Hangul glyphs either. Same silent-fallback behavior as Arabic.
- **RTL layout** - the app has no `dir="rtl"` handling anywhere, and its CSS is written with physical properties (`margin-left`, `text-align: left`, …) rather than logical ones (`margin-inline-start`, …). Even if a font covered Arabic/Hebrew glyphs, the layout itself would still render left-to-right.

Full UI-string translation (i18n) doesn't exist yet either - every visible label is a hardcoded English literal in JSX. `preferred_locale` only drives `Intl.DateTimeFormat`/`toLocaleString`-style formatting (enforced by `apps/admin/test/locale/locale-coverage.test.ts`), not text translation.

RTL, non-Latin/CJK font coverage, and UI translation are one combined internationalization effort, planned as a dedicated initiative rather than incremental patches.

**Format policy (this package's bundled fonts only): woff2 only, no woff/truetype fallback.**

- **Why woff2-only works here:** `apps/admin` ships as a native ES module with no legacy bundle (no `@vitejs/plugin-legacy`, no `.browserslistrc`, `tsconfig` targets `ES2022`). Any browser old enough to need a woff/truetype fallback can't run the app's JS at all, so those files are pure dead weight.
- **Tabler icons:** `@tabler/icons-webfont`'s default CSS ships woff2+woff+ttf. `apps/admin/vite.config.ts` has a build plugin (`stripLegacyIconFontFallback`) that strips the woff/ttf fallback before Vite's CSS pipeline turns them into shipped assets, saving ~3.3MB.
- **`@fontsource` is not stripped yet:** its per-weight CSS files still ship woff2+woff pairs as of this writing. The same plugin approach was tried and doesn't reach them: they're pulled in via CSS `@import` (not a JS `import`), and Vite resolves `@import` internally within its `vite:css` plugin without ever routing the imported file through the plugin container's `resolveId`/`load`/`transform` hooks (confirmed empirically, none of those hooks fire for `@fontsource/*` paths).
- **Follow-up, not attempted here:** trimming that woff duplication would require vendoring first-party `@font-face` CSS instead of importing the package's default stylesheet.
