# @admitto/ui

Design system for the staff SPA: Tabler-flavoured CSS tokens plus shared React primitives used by `@admitto/admin` (and anywhere else that needs the same look).

## What lives here

- **Tokens / theme** - CSS variables and theme helpers (`theme.ts`, `styles/`)
- **Primitives** - `Button`, `Input`, `Select`, `Checkbox`, `Switch`, `Modal`, `Toast`, `Notice`, `EmptyState`, `PageHeader`, tabs, badges, skeleton/spinner, etc.
- **Assets** - shared static pieces under `src/assets/` (copied into `dist/assets` on build)

This package does **not** own app routes or API calls. Page-level UI stays in `apps/admin`.

## Import

```ts
import { Button, Notice, useToast } from "@admitto/ui";
```

Prefer these components over one-off markup so spacing, focus, and toast behaviour stay consistent (see root [AGENTS.md](../../AGENTS.md) toast vs Notice guidance).

## Build

```bash
npm run build -w @admitto/ui
```

The SPA must be built (or run via Vite) against `dist/`; hot reload in admin still depends on this package being built when you change tokens or primitives.
