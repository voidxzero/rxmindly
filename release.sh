#!/usr/bin/env bash
# Publishes a new version: ./release.sh 1.2.0
# Bumps the version, commits, tags and pushes. GitHub then builds the APK and
# attaches it to a release, and the app on the phone offers the update.
set -euo pipefail
cd "$(dirname "$0")"

version="${1:-}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]{1,2}\.[0-9]{1,2}$ ]]; then
  echo "Usage: ./release.sh <version>, for example ./release.sh 1.2.0" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or discard your changes first; a release is made from a clean checkout." >&2
  exit 1
fi
if git rev-parse "v$version" >/dev/null 2>&1; then
  echo "Version $version has already been released." >&2
  exit 1
fi

(cd web && npm version "$version" --no-git-tag-version >/dev/null)
git add web/package.json web/package-lock.json
git commit -q -m "Release $version"
git tag "v$version"
git push -q origin HEAD "v$version"
echo "Pushed v$version. GitHub is building it: https://github.com/voidxzero/rxmindly/actions"
