# AGENTS.md — Admitto

Instructions for AI agents in this repository (Cursor, Claude Code, Codex, Copilot, and others).

Repo: https://github.com/solarssk/admitto  
**Active milestone:** see the open GitHub milestone and `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) — this file does not track it to avoid drift.  
**Product version:** git tag `v0.x.y` + root `package.json` + [CHANGELOG.md](CHANGELOG.md) — see [VERSIONING.md](VERSIONING.md).

## Project

Admitto is a self-hostable **internal event access gateway**: attendee import (CSV/XLSX, agency UUIDs), QR tickets, M365 mail, check-in for operators, admin tooling. Tabler-based staff SPA; OIDC-ready auth.

**Out of scope for MVP:** payments, public registration UI inside Admitto (first-event intake is MS Forms → `/api/ingest` in v0.5), full CRM, drag-and-drop mail builder, native `.pkpass` (PassCreator first).

## Working style

- Act as a senior full-stack engineer; prefer small, reviewable PRs.
- Make strong recommendations; ask only when a decision blocks implementation or creates real risk.
- After each step: what changed, how to test, what remains.
- Touch only what the task requires; match existing conventions.

## Security

- **Never** commit secrets, tokens, API keys, or real personal data.
- Use `.env.example` for required configuration; synthetic `@example.com` in seeds/samples.
- QR/token payloads must be non-guessable; avoid PII in QR unless explicitly required.
- Separate admin / operator / superadmin responsibilities; no unnecessary PII in logs.
- Check-in must prevent duplicate QR use; design for short retention after events.
- Add `security` label on PRs touching auth, access control, secrets, or personal data.

## Tests

```bash
npm test
```

Integration tests need Postgres — run `npm run db:test-setup` once per environment. For coverage reports (same tests + LCOV, matches CI):

```bash
npm run coverage
```

Do not commit with a broken suite unless the PR explicitly documents why.

## Commits and branches

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <description>`

**Types:** `feat` `fix` `chore` `docs` `refactor` `test` `perf` `security`  
**Scopes:** `auth` `web` `admin` `db` `tickets` `mailer` `import` `crypto` `ui` `infra` `ci`

**Branches:** `feature/<slug>` · `fix/<slug>` · `chore/<slug>` · `docs/<slug>`

Breaking changes: `!` after scope + description in commit body.

## Pull requests

Follow [.github/pull_request_template.md](.github/pull_request_template.md) exactly:

`Description` · `How to test` · `What stays / known limitations` · `Checklist`

`Description` covers **business context** (the real operator/admin/attendee problem, plain
language, no jargon) and **technical changes** (what changed in the code, by area) as separate
paragraphs — not blended. Describe the diff that actually shipped, not the original plan.

Before handoff: assignee @solarssk, current milestone when it exists, labels — one `type:*`, at least one `area:*`, `prio:*` when obvious.

## Changelog and releases

[CHANGELOG.md](CHANGELOG.md) follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

**During feature work:** add operator-facing bullets under `[Unreleased]` as you implement (`Added`, `Changed`, `Fixed`, `Security`, …). Not a final-step chore.

**Closing a milestone (`v0.x.y`):** follow [VERSIONING.md](VERSIONING.md) end-to-end. In short:

1. Move `[Unreleased]` → `## [0.x.y] - YYYY-MM-DD`; update comparison links.
2. Bump root `package.json` `"version"`.
3. **Before** the release commit: `python3 scripts/generate-release-notes.py 0.x.y "tagline"` then `python3 scripts/sync-release-docs.py` (and `npm install --package-lock-only` so `package-lock.json` matches).
4. One release commit: `CHANGELOG.md`, `package.json`, `package-lock.json`, synced docs, `.github/release-notes/v0.x.y.md`, `.github/release-notes/v0.x.y.title` (commit subject exactly `release: v0.x.y`).
5. **Merge the release PR** — Actions creates tag, GitHub Release (`v0.x.y — tagline`), triggers `publish-container`, and closes the milestone.

Local `./scripts/release-tag.sh` is emergency-only (signed tag). Do **not** use the deprecated v0.3.x emoji GitHub Release template.

## Admin SPA feedback (toast vs inline)

Staff UI uses `useToast()` from `@admitto/ui` (`ToastProvider` in the admin shell). Pick the surface by how long the user needs the message and whether it blocks the current task.

| Pattern | When | Examples |
|--------|------|----------|
| **Toast** | Transient outcome of an action the user just took; does not need a retry control | Save/test success, mutation API errors, import finished, wizard step saved |
| **`Notice`** | Persistent fact or warning about the surrounding view (bordered/tinted box with icon) | Settings warnings, wizard banners, form-level auth errors. Server-rendered auth pages use the same `.at-notice` markup via `renderNoticeHtml` (not the React component) |
| **Inline / `EmptyState`** | Initial page load failed or data is missing until the user retries | Attendees/Requirements load error with **Retry**; AuthProvider session bootstrap failure |
| **`ConfirmDialog`** | Destructive or irreversible confirmation | Delete attendee, archive event — do not also toast the same message |
| **In-context inline** | Error is tied to a modal, form field, or overlay that already has focus | Mobile check-in camera overlay (no-match → overlay message, not toast behind overlay); form field validation |

Toasts dedupe identical `message + variant`, cap at five, and sit below the check-in overlay (`--z-toast` &lt; `--z-overlay`). Prefer `renderWithToast()` in admin tests when asserting toast behavior.

**Check-in camera exception:** the desktop inline camera (`CkInlineCamera`) is scan-only — unlike the mobile fullscreen overlay, it never doubles as the operator's check-in/item-issuing surface, so no result ever renders on top of it. A no-match scan there reports via **toast**, the same as manual lookup's no-match, and the camera keeps scanning. This is the opposite of the in-context-inline row above, which still governs the mobile overlay (where a toast would render below `--z-overlay`, invisible).

### Admin API errors in the UI

Do **not** pass `ApiError.message` straight into toasts or inline error strings. Server JSON may include machine codes or, in future, internal detail.

- Use `operatorApiErrorMessage(err, fallback)` from `apps/admin/src/api/operator-api-error.ts` for operator-visible copy.
- Use `hasApiErrorCode(err, "code")` when branching on a known API failure (exact match on normalized `err.code` / machine-readable `err.message`).
- Known codes are mapped to fixed UI strings; short human `detail` text is shown only when it passes the helper's safety checks; everything else logs in dev and returns `fallback`.
- `TemplateValidationError` and client-side validation stay separate — they never go through `operatorApiErrorMessage`.

## Compounding rules

When an agent repeats a mistake, add a precise rule here (or in a scoped `.cursor/rules/*.mdc` file). One line per gotcha; cut rules that no longer prevent real errors.

**Font formats (`apps/admin`'s own bundled fonts): woff2 only, no woff/truetype fallback** — the
app's JS already requires a browser new enough that woff2 is a given, so older formats are pure
dead weight in the package-shipped CSS (Tabler icons, `@fontsource` text fonts). This does **not**
apply to organisation-uploaded custom branding fonts (`FontFamilyModal.tsx`, `uploadThemeFont`) —
those accept whatever format the customer's own font file comes in
(`woff2`/`woff`/`ttf`/`otf`, see `FONT_FILE_RE`), and we don't control that. See
[packages/ui/README.md](packages/ui/README.md) "Fonts" for the full reasoning, what's currently
shipped vs. stripped, script/locale coverage gaps (Arabic, CJK, RTL), and why the same fix doesn't
mechanically extend to `@fontsource` text fonts (CSS `@import` bypasses Vite's plugin hooks — don't
re-attempt that approach without reading why it failed first).

**No production installs of unreleased feature work.** Admitto has no customer/staging deploy of WIP branches or unreleased milestone features until a tagged stable release ships. Do **not** invent “legacy cleanup”, migration backfills, or compatibility shims for code that only ever existed on a PR branch. If a review says delete dead “older builds” cleanup, delete it.

**Before push / claiming CI will pass:** run the **full package test suite** for every workspace
you changed (e.g. `npm test -w @admitto/admin`, not a single `--run some.test.ts`), **and** the same
gate CI uses for those packages (`npm run build` / typecheck when `.ts`/`.tsx` or tests included
in `tsc` changed). A subset Vitest run is for debugging only and does **not** authorize push.
Vitest alone is not enough for typecheck: `apps/web` and `apps/admin` both build with
`tsc` (CI jobs fail on `TS18047` / `TS2493` even when Vitest is green). Touching admin UI means
`npm run build -w @admitto/admin` before push; touching web means `npm run build -w @admitto/web`.
Prefer full `npm test` when blast radius is unclear. Do not push on red. Cite the commands and
pass/fail in the handoff. For fetch
mocks in web tests, type the first argument (`input: string | URL`); bare `vi.fn(async () => …)`
makes `mock.calls[0][0]` a `TS2493` under `tsc` even when Vitest is green. After a null-check on
React state, nest handlers must use narrowed locals (`const weather = weatherDraft`) — TypeScript
does not keep the narrowing inside nested functions.

**New `process.env.X` reads must be registered in `deploy/env-catalog.json`, then regenerated.**
CI's `wiki-docs` job runs `npm run docs:check`, which includes `generate-env-dictionary.mjs
--check` — it scans source for env var references and fails the build if one isn't listed in the
catalog (or under its `scanIgnore`). Add a catalog entry (`name`, `group`, `boot`, `consumers`,
`secret`, `ui`, `summary` — copy the shape of a sibling entry), then run `npm run docs:env` to
regenerate `deploy/ENV.md` and commit both files together; the check also fails if `ENV.md` is
stale relative to the catalog even when the catalog entry itself is present.

**A new AdminJob drain file mirroring an existing sibling (e.g. wallet_push → wallet_message)
will likely trip SonarCloud's new-code duplication gate (max 3%).** Structural copies like
`resolveEventWalletProvider` or the stale-job reclaim loop read as near-verbatim duplicates by
line/token comparison even when deliberately parallel by design. Extract genuinely shared pieces
into their own small module (see `resolve-event-wallet-provider.ts`,
`reclaim-stale-admin-jobs-by-type.ts`) rather than leaving two inline copies — check the SonarCloud
PR dashboard (`new_duplicated_lines_density` condition) before assuming a passing local build means
this gate will pass too, since duplication isn't caught by `tsc`/vitest.

**New runtime workspace package:** the Dockerfile production stage is an explicit allowlist.
Copy both `packages/<name>/package.json` and `--from=builder …/packages/<name>/dist` (same
pattern as crypto/location/…). Builder already has all of `packages/`; omitting the production
COPY lines yields `ERR_MODULE_NOT_FOUND` when the container starts (CI `migration-safety`).

**Renaming a Vitest project (`test.name`):** grep `package.json` scripts and CI workflows for
`--project <old-name>` first — the filter is an anchored exact match, so a stale reference fails
at startup ("No projects matched the filter").

**Integration tests sharing a package's `*_test` database run one file at a time** (their configs
set `fileParallelism: false`), so cross-file failures there are leftover-state pollution, not
concurrency races — fix them with cleanup in the polluting file, not with `sequence.concurrent`
(that option only affects tests within one file).

**`eslint-disable-next-line` only covers the literal next line.** When the reason needs 2-3 lines
of prose, put the plain `//` explanation lines first and the `eslint-disable-next-line` comment
itself last, directly above the code it's suppressing for — reversing that order (or splitting
the explanation across lines *after* the directive) silences nothing, since "next line" then
points at another comment instead of the real target. Grep for `eslint-disable-next-line` mid a
multi-line comment block if a lint warning appears on a line that already has one right above it.

**SonarCloud's `NOSONAR` marker must be the first thing in its own comment on the flagged line**,
e.g. `code // NOSONAR — reason` or `// NOSONAR — reason` as a whole standalone comment. Appending
` // NOSONAR — reason` after an *already-open* `//` comment (e.g. after an existing `// TODO: …`)
does not suppress anything — the whole line is one comment token to the parser either way, but
Sonar's own marker only registers when NOSONAR leads it. Confirmed by re-checking the PR's issue
list after pushing, not by assumption — the same file's own `role="presentation"` suppression a
few lines away (NOSONAR leading its own comment) did clear, this trailing form did not.

**`apps/admin` pages are lazily code-split (`React.lazy`) — a component's CSS import must live in
that component's own file, not just "somewhere already loaded on this page".** A modal/component
that reuses another feature's CSS classes (e.g. the shared `add-attendee-modal.css` "standard
modal" markup, or `IconPicker`'s `icon-picker.css`) needs its own `import "*.css"` line even if
some other already-visited lazy chunk happens to load that stylesheet too — that only works by
accident of navigation order within one browser session, and renders fully unstyled on a cold
visit straight to the page that's missing the import. Found via `CreateTemplateDialog.tsx` (in the
lazy `communication` chunk) using `.add-attendee-modal__*` classes with no import of that CSS file
at all. `grep -rn 'import "delivery-modals.css"' apps/admin/src/communication/` — every consumer of
a shared modal/component CSS file should show up importing it directly.

**Do not import `@admitto/mail-templates`, `@admitto/tickets`, or `@admitto/wallet` (package
root) from `apps/admin`.** All three barrels re-export Prisma/node-only server modules (mjml/fs
for mail-templates; Prisma, `node:crypto`, pdfkit for tickets; `node:crypto`, Prisma, and `pg`
transitively via `registration-sync.ts`/`passcreator-webhook.ts` for wallet); Vite can ship them
into a lazy SPA chunk (`fileURLToPath is not a function` on Event Settings was the mail-templates
incident; the tickets barrel separately pulled the entire `typescript` compiler into a lazy chunk
via `htmlnano`→`cosmiconfig`'s optional TS-config loader; the wallet barrel pulled `node:crypto`,
`node:url`, `@prisma/client/runtime`, `pg`, and `pgpass` into the Event Settings chunk via the same
`WALLET_MAPPING_PLACEHOLDERS` import). Use browser-safe subpaths only (e.g.
`@admitto/mail-templates/placeholders`, `@admitto/tickets/custom-data-reserved`,
`@admitto/tickets/event-item-usability`, `@admitto/wallet/passcreator-mapper`). Same idea as
avoiding `@admitto/auth`'s root entry for password helpers (`./constants`, `./password-strength`).
Type-only re-exports from the root remain OK when they stay `import type` / `export type`. A local
build's Vite output (`npm run build -w @admitto/admin`) surfaces new leaks as "Module ... has been
externalized for browser compatibility" warnings during the `vite build` step: do not ignore them.

**Do not create new top-level `.md` documentation files in this repo.** This repo's doc set is
fixed: `README.md`, `CHANGELOG.md`, `SECURITY.md`, `VERSIONING.md`, `DATA-PROTECTION.md`,
`AGENTS.md`, `CLAUDE.md`, plus package-level `README.md` files and `docs/*` referenced from them.
If something doesn't fit an existing file, add a section to the closest one instead of starting a
new file. Avoid hardcoding "current milestone/version" callouts in prose here — point to
`CHANGELOG.md`'s `[Unreleased]` section or the open GitHub milestone instead, so this file can't
drift out of date.

**User Wiki documentation gate:** `docs/wiki/` is the sole, versioned source for the published
GitHub Wiki and is the deliberate exception to the fixed-document-set rule above. For every
human- or AI-authored PR, assess whether a user-visible workflow, role, terminology, availability
status, or recovery step changed. Update the relevant Wiki source page when it did; otherwise
complete the `No Wiki update needed` declaration in the PR template with a specific reason. Run
`npm run docs:check` after changing Wiki source. Do not edit the GitHub Wiki directly: the publish
workflow replaces it from `docs/wiki/` after merge. Write user guidance in clear English, use only
synthetic examples, and never publish customer names, personal data, environments, credentials,
or unsupported operational workarounds.

**`docs:pr-check` (CI wiki-docs job) is not `docs:check`.** The job also runs
`scripts/check-pr-docs-impact.mjs`, which requires the PR body to include the template's
`## Documentation impact` section with **exactly one** checked line on its own line:
`- [x] Wiki updated` or `- [x] No Wiki update needed — <specific reason>` (em/en/hyphen dash
accepted). A Checklist bullet that merely mentions "Wiki updated" does **not** pass. Keep the
other option present and unchecked. If wiki files changed, the checked option must be
`Wiki updated`; if none changed, it must be `No Wiki update needed` with a real reason.
**Agents: this is a hard handoff gate** (same priority as local tests before push). See
`.cursor/rules/wiki-docs-pr-gate.mdc`. Body-only fixes need a **new push** on the PR head
(`gh run rerun` keeps the stale event body); stacked PRs each need their own correct checkbox.

For workflow pages, use the same reader-facing structure: `What this page helps you do`, `Before
you start`, `Steps`, `Expected result`, `Important decisions`, `What changes after this action`,
`Common problems`, and `Related pages`. Reference and landing pages may use a structure that fits
their purpose. Verify factual instructions against the current `main` UI and domain behaviour;
the documentation check proves structural consistency, not product correctness.

### Visual documentation

- Use tables to compare roles, statuses, fields, providers, or actions.
- Use Mermaid only to explain a lifecycle, decision path, scope, or relationship that is harder to understand in a short list.
- Give every Mermaid diagram a nearby text explanation; it must not be the only source of essential guidance.
- Use at most one main diagram per page. Keep labels short and never include personal data, secrets, ticket URLs, QR values, customer names, or internal environment details.
- Use GitHub alerts only for important, risky, or irreversible information. Keep to one or two per page.
- Use collapsed sections only for optional or advanced detail, never for required steps or warnings.

## Claude Code

Claude-specific workflow (plan gate, split guidelines): [CLAUDE.md](CLAUDE.md).

## Cursor Cloud specific instructions

Notes for Cursor Cloud agents. The startup update script only runs `npm install`; everything
below is intentionally **not** in that script (services, env, one-off setup) and persists in the
VM snapshot. Standard build/run/test commands live in [README.md](README.md).

- **Node 24 required** (`engines`). nvm's default is set to 24, so fresh login shells use it. If
  `node -v` prints 22, run `nvm use 24` — the `/exec-daemon/node` shim is v22 and can precede nvm
  on `PATH` in non-login shells.
- **Postgres + Redis are native (no Docker).** Docker is not installed here; Postgres 16 and
  Redis 7 are installed via apt and are **not** auto-started. Start them each session:
  `sudo pg_ctlcluster 16 main start` and `sudo redis-server /etc/redis/redis.conf --daemonize yes`.
  Role/creds `admitto`/`admitto`, database `admitto`, and the `admitto_*_test` databases are
  already created + migrated + seeded in the snapshot. `infra/docker-compose.yml` is unused — the
  test-db scripts fall back to local `psql`/`createdb`.
- **Local env files (gitignored):** `packages/db/.env` and `apps/web/.env` hold the dev
  `DATABASE_URL`, a generated `ENCRYPTION_KEY`, and `REDIS_URL=redis://localhost:6379`. Recreate
  from the matching `.env.example` if missing.
- **Tests:** `npm test`. `apps/web` integration tests start a Testcontainers Redis unless
  `REDIS_URL` is set; since Docker is absent, `export REDIS_URL=redis://localhost:6379` before
  `npm test` so they use the native Redis.
- **Run the app:** `npm run build -w @admitto/admin` once, then `npm run dev -w @admitto/web`
  serves the SPA at http://localhost:3000 (`/admin` after login). For SPA hot-reload also run
  `npm run dev -w @admitto/admin` (Vite :5173, proxies API to :3000).
- **First login needs MFA:** admin/superadmin roles must enroll TOTP on first login. Bootstrap a
  new superadmin with `npm run auth:bootstrap -- --email you@example.com` (password read from
  stdin); you will be prompted to enrol TOTP on first login. To clear an existing account's TOTP
  (e.g. the snapshot's pre-seeded account), run
  `npm run cli -w @admitto/auth -- reset-mfa --email you@example.com`.
