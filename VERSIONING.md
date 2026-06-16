# Versioning

Admitto uses **one product version** for releases. Internal workspace packages are not versioned independently.

## Source of truth (product)

| What | Where |
|------|--------|
| **Release number** | Git tag `v0.x.y` on `main` |
| **Human-readable history** | [`CHANGELOG.md`](CHANGELOG.md) |
| **Tracked in repo** | Root [`package.json`](package.json) `"version"` — bumped when cutting a release |

GitHub **milestones** (`v0.3.6`, `v0.4.0`, …) group PRs toward the next tag; milestone title matches the upcoming product version.

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
