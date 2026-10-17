# Versioning

> **Where the project stands:** check the current release tag or the open GitHub milestone. That status lives there and is not restated here, so it can't go stale between releases.

Admitto uses **one product version** for releases. Internal workspace packages are not versioned independently.

## Source of truth (product)

| What | Where |
|------|--------|
| **Release number** | Git tag `v0.x.y` on `main` |
| **Human-readable history** | [`CHANGELOG.md`](CHANGELOG.md) |
| **Tracked in repo** | Root [`package.json`](package.json) `"version"` - bumped when cutting a release |

GitHub **milestones** (titled `vX.Y.Z`) group PRs toward the next tag. The milestone title matches the upcoming product version.

## Version numbers

Admitto ships as **one product** with git tags like `v0.x.y`. That is **not** independent semver for each npm workspace package.

- **Pre-1.0 tags** are expected to iterate and refactor, so read [`CHANGELOG.md`](CHANGELOG.md) before you upgrade.
- **Patches** (`v0.x.1`, `v0.x.2`, ...) are normal. They belong to the same minor line until the next tagged minor.

The documents in this repository describe the product as it is today. What changed in each release is in the CHANGELOG, not in the other documents.

## Workspace packages (`0.0.1`)

Every `packages/*` and `apps/*` `package.json` keeps `"version": "0.0.1"`. That is intentional:

- packages are `private: true` and linked with `"@admitto/foo": "*"`
- they are not published to npm
- only the **monorepo product version** matters for operators and release notes

Do not bump per-package versions unless we start publishing libraries separately.

## Cutting a release

1. Move `CHANGELOG.md` entries from `[Unreleased]` to a new `## [0.x.y] - YYYY-MM-DD` section following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format
2. Update the `[Unreleased]` comparison link at the bottom of `CHANGELOG.md` to point to the new tag
3. Add the new comparison link for the release (e.g. `[0.x.y]: https://github.com/solarssk/admitto/compare/v0.x.z...v0.x.y`)
4. Set root `package.json` `"version"` to `0.x.y` (no `v` prefix)
5. Generate the release artifacts and sync the doc markers before you open the release PR:
   ```bash
   python3 scripts/generate-release-notes.py 0.x.y "short tagline for GitHub Release title"
   python3 scripts/sync-release-docs.py
   npm install --package-lock-only
   ```
   - `generate-release-notes.py` writes `.github/release-notes/v0.x.y.md` and `.github/release-notes/v0.x.y.title`. The title file holds the tagline only, and the workflow composes `v0.x.y - tagline`, the same pattern as earlier releases.
   - `sync-release-docs.py` updates the `<!-- admitto:latest-patch -->` markers (for example in `SECURITY.md`) from `package.json`. CI runs `python3 scripts/sync-release-docs.py --check` on every PR.
   - The release notes follow the same [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) typed sections as `CHANGELOG.md` for that version, plus a short **Deploy** footer (container image, migration policy). Do not use the deprecated v0.3.x emoji template. See [`.github/release-notes/v0.4.4.md`](.github/release-notes/v0.4.4.md) as reference.
6. Commit on `main`. Include `CHANGELOG.md`, `package.json`, `package-lock.json`, the synced docs, `.github/release-notes/v0.x.y.md`, and `.github/release-notes/v0.x.y.title` in one release commit (subject exactly `release: v0.x.y`).
7. **Merge the release PR.** GitHub Actions [`.github/workflows/release.yml`](.github/workflows/release.yml) on `main` then does the following:
   - It verifies the release artifacts: `sync-release-docs.py --check`, the notes file, a non-empty `.title` file, and the CHANGELOG section.
   - It creates git tag `v0.x.y` **on the exact commit that push introduced and whose CI it just verified** (`--target`). A merge that lands on `main` while the workflow waits for CI therefore cannot end up inside the tag. It simply becomes part of the next release.
   - It creates a GitHub Release from `.github/release-notes/v0.x.y.md`, with the title `v0.x.y - …` taken from the `.title` file, marked as the **latest** release.
   - It triggers [`publish-container.yml`](.github/workflows/publish-container.yml) (GHCR image, SBOM upload).
   - It closes the open milestone titled `v0.x.y`. The title must be exactly that, with the leading `v`: a milestone named `0.x.y` is silently skipped, so rename it before you merge the release PR.

   Local [`scripts/release-tag.sh`](scripts/release-tag.sh) remains for emergency **GPG/SSH-signed** tags only (see below). It is not the default path.

### Tag signing (optional - emergency manual releases)

CI-created tags from `release.yml` are ordinary GitHub tags (not GPG/SSH-signed). For a **Verified** signed tag, delete the CI tag and use `release-tag.sh` instead - rare.

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

**Container image:** pushing git tag `v0.x.y` publishes `ghcr.io/solarssk/admitto:0.x.y` and the rolling minor tag `ghcr.io/solarssk/admitto:0.x`, mirrored to `docker.io/solarssk/admitto` under the same tags (see `deploy/README.md`).

The admin sidebar footer and Organisation settings → Health check show the running version and commit, and the published image carries its commit in the `org.opencontainers.image.revision` label. `/healthz` does not expose either.
