#!/usr/bin/env bash
# Cut a signed git tag for a milestone release (VERSIONING.md).
# Prerequisites: gpg.format + user.signingkey configured; SSH/GPG key uploaded to GitHub as a signing key.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage: scripts/release-tag.sh <version> [options]

  <version>   Product version: 0.3.7 or v0.3.7

Options:
  -m, --message <text>   Annotated tag message (default: "vX.Y.Z")
  --push                 Push tag to origin after creating it
  --no-sign-check        Skip local signing-key check

Examples:
  scripts/release-tag.sh 0.3.7 -m "v0.3.7 — short summary" --push
EOF
}

VERSION_RAW="${1:-}"
shift || true

MESSAGE=""
PUSH=false
SIGN_CHECK=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)
      MESSAGE="${2:?missing message}"
      shift 2
      ;;
    --push)
      PUSH=true
      shift
      ;;
    --no-sign-check)
      SIGN_CHECK=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$VERSION_RAW" ]]; then
  usage >&2
  exit 1
fi

TAG="${VERSION_RAW#v}"
TAG="v${TAG}"
VERSION="${TAG#v}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid version: $VERSION_RAW (expected semver like 0.3.7)" >&2
  exit 1
fi

if [[ -z "$MESSAGE" ]]; then
  MESSAGE="$TAG"
fi

if [[ "$SIGN_CHECK" == true ]] && ! git config --get user.signingkey >/dev/null; then
  echo "user.signingkey is not set — configure SSH or GPG signing first (see VERSIONING.md)." >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "Tag $TAG already exists locally. Delete it first if you intend to re-sign." >&2
  exit 1
fi

BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "main" ]]; then
  echo "Refusing to tag from branch '$BRANCH' (expected main)." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean — commit or stash before tagging." >&2
  exit 1
fi

git pull --ff-only origin main

echo "Creating signed tag $TAG at $(git rev-parse --short HEAD)"
git tag -s "$TAG" -m "$MESSAGE"

if [[ "$PUSH" == true ]]; then
  echo "Pushing $TAG to origin"
  git push origin "$TAG"
  echo "Done. Next: gh release create $TAG --latest."
else
  echo "Created locally. Push with: git push origin $TAG"
fi
