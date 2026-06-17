# Versioning

Admitto uses **one product version** for releases. Internal workspace packages are not versioned independently.

## Source of truth (product)

| What | Where |
|------|--------|
| **Release number** | Git tag `v0.x.y` on `main` |
| **Human-readable history** | [`CHANGELOG.md`](CHANGELOG.md) |
| **Tracked in repo** | Root [`package.json`](package.json) `"version"` — bumped when cutting a release |

GitHub **milestones** (`v0.3.6`, `v0.4.0`, …) group PRs toward the next tag; milestone title matches the upcoming product version.

## Product version lines (what `v0.x` vs `v1.0` means)

Admitto ships as **one product** with git tags like `v0.4.0`. That is **not** independent semver for each npm workspace package — it is the **release train** toward the first real event.

| Line | Meaning |
|------|---------|
| **`v0.x`** | **Path to MVP.** Everything required for the **first event** is built across `v0.4` → `v0.9`. Pre-1.0 tags are expected to iterate and refactor. |
| **`v1.0`** | **First-event go-live gate.** MVP is complete and event-ready. After this tag, the product can run a real event end-to-end. |
| **`v1.1+`** | **Post-first-event feature waves.** Capabilities that are useful but **not** required for the first go-live (see examples below). |

### Planned sequence (high level)

This is the current product roadmap — details live in milestone descriptions and `CHANGELOG.md`:

| Version | Focus |
|---------|--------|
| **v0.4** | Operator UI + event-day ops + staff SPA foundation (`v0.4.0` tagged). Remaining operator work (attendee card, manual lookup, scan history, camera) → `v0.4.1+`. |
| **v0.5** | Wallet passes (Apple/Google via PassCreator). |
| **v0.6** | First-event **registration → attendance** engine: authenticated `/api/ingest` (MS Forms → Power Automate), calendar iMIP/ICS + RSVP, capacity/waitlist, exports, lifecycle mail. |
| **v0.7–v0.9** | Hardening + dry run (Outlook/devices, batch tests, backup/restore, event-day readiness — ADR 0012). |
| **v1.0** | First event **go-live ready** = MVP complete. |
| **v1.1+** | New waves **after** the first event — e.g. native bounded registration form, branded domain (CNAME), i18n, multi-room, mini-CRM. |

### Common scope mistakes (read before opening a milestone PR)

- **First-event attendee intake** is **MS Forms → Power Automate → `/api/ingest`** (target **v0.6**), not a native public registration UI inside Admitto.
- **Native registration form**, custom branded domain, full i18n, multi-room scheduling, and mini-CRM belong to **`v1.1+`**, not to `v0.6`/`v0.7` pre-go-live milestones.
- **`v0.x` patches** (`v0.4.1`, `v0.4.2`, …) are normal — they still belong to the same minor line until the next tagged minor (e.g. `v0.5.0`).

Internal Polish product guide (maintainer docs, outside this public repo) mirrors this model; **this file is the canonical English definition for contributors and operators.**

## Workspace packages (`0.0.1`)

Every `packages/*` and `apps/web` `package.json` keeps `"version": "0.0.1"`. That is intentional:

- packages are `private: true` and linked with `"@admitto/foo": "*"`
- they are not published to npm
- only the **monorepo product version** matters for operators and release notes

Do not bump per-package versions unless we start publishing libraries separately.

## Cutting a release

1. Move `CHANGELOG.md` items from `Unreleased` → `## v0.x.y — date`
2. Set root `package.json` `"version"` to `0.x.y` (no `v` prefix)
3. Commit on `main`, then create a **signed** annotated tag and push it:
   ```bash
   ./scripts/release-tag.sh 0.x.y -m "v0.x.y — one-line summary" --push
   ```
   (`git tag -s` — never lightweight or unsigned `git tag -a`.)
4. Create the GitHub Release: `gh release create v0.x.y --title "…" --notes-file …`  
   Use the **v0.3.x release notes template** (see e.g. GitHub Release `v0.3.7`): milestone + merged PR links, summary blockquote, `### ✨ Included`, deploy/docker section, `### 🗄️ Database`, checklist, `### ⏳ Not in this release`, `### ➡️ Next`, `### 📦 Release scope`.  
   Do **not** paste raw `CHANGELOG.md` into the GitHub Release body — CHANGELOG is the engineering log; the Release is the operator/maintainer-facing summary.
5. Close the matching GitHub milestone

### Tag signing (one-time maintainer setup)

Tags must be signed so GitHub shows **Verified** on the tag (same trust model as signed commits).

**SSH signing** (if commits already use `gpg.format ssh`):

```bash
git config gpg.format ssh
git config user.signingkey ~/.ssh/id_ed25519.pub   # path to your *public* key
```

Upload that public key on GitHub → **Settings → SSH and GPG keys → New SSH key → Signing Key**.

**GPG** alternative: `git config gpg.format openpgp`, set `user.signingkey` to your key id, upload the public GPG key to GitHub.

Smoke test (optional):

```bash
git tag -s v0.0.0-signing-smoke -m test HEAD~1
git cat-file tag v0.0.0-signing-smoke | grep -E -q 'BEGIN (SSH|PGP) SIGNATURE'
git tag -d v0.0.0-signing-smoke
```

**Container image:** pushing git tag `v0.x.y` publishes `ghcr.io/solarssk/admitto:0.x.y` and the rolling minor tag `ghcr.io/solarssk/admitto:0.x` (see `deploy/README.md`).

Runtime (`/healthz`, Docker labels) does not expose version yet — by design until we need operator-facing build info.
