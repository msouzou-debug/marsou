#!/usr/bin/env bash
# Builds a release tarball of the source for staging on the server.
#   dist/ehr-<version>.tar.gz          the source, without .venv, tests, caches, briefs and the docs/ drafts
#   dist/ehr-<version>.tar.gz.sha256   checksum of the tarball
# Inside the tarball, SHA256SUMS lists every file, and RELEASE-INFO records the version and the test result.
# The full test suite runs first and must pass (Marios's rule). --skip-tests is for a dry run and is written into
# RELEASE-INFO, where scripts/preflight.sh fails on it.
# Usage: scripts/make-release.sh [--skip-tests] [VERSION]
# No sudo, no network, writes only to dist/ and a temporary folder.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"
SKIP_TESTS=0
if [ "${1:-}" = "--skip-tests" ]; then SKIP_TESTS=1; shift; fi

COMMIT="unknown"
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  COMMIT="$(git rev-parse --short HEAD)"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then COMMIT="$COMMIT-modified"; fi
fi
VERSION="${1:-$(date -u +%Y%m%d-%H%M)-$COMMIT}"
case "$VERSION" in *[!A-Za-z0-9._-]*|'') echo "version may hold only letters, digits, dot, dash, underscore" >&2; exit 64 ;; esac
NAME="ehr-$VERSION"

if [ "$SKIP_TESTS" -eq 1 ]; then
  TESTS="SKIPPED"
  echo "WARNING: tests skipped. This release must not be installed." >&2
else
  [ -x .venv/bin/python ] || { echo "no .venv: set it up first (see CLAUDE.md)" >&2; exit 1; }
  echo "running the full test suite ..."
  .venv/bin/python -m pytest -q --no-header -p no:cacheprovider >/dev/null || {
    echo "the test suite failed: no release built. Run scripts/test.sh to see why." >&2; exit 1; }
  TESTS="passed"
fi

STAGE="$(mktemp -d)"
cleanup() {
  case "$STAGE" in
    /tmp/*|"${TMPDIR:-/tmp}"/*) [ -d "$STAGE" ] && rm -rf -- "$STAGE" ;;
  esac
}
trap cleanup EXIT
DEST="$STAGE/$NAME"
mkdir -p "$DEST" dist

# Source only. docs/ is excluded as a whole, then operations.md is added back by name.
tar -c \
  --exclude=./.git --exclude=./.gitignore --exclude=./.venv --exclude=./.claude --exclude=./claude \
  --exclude=./tests --exclude=./docs --exclude=./dist --exclude=./instance \
  --exclude=./CLAUDE.md --exclude=./memory.md --exclude=./requirements-dev.txt \
  --exclude=__pycache__ --exclude='*.pyc' --exclude=.pytest_cache --exclude='*.sqlite3' --exclude='*.sqlite3-*' \
  --exclude='*.orig' --exclude='*.rej' --exclude='*~' --exclude=.DS_Store \
  -f - . | tar -x -C "$DEST"
mkdir -p "$DEST/docs"
cp docs/operations.md "$DEST/docs/operations.md"

cat > "$DEST/RELEASE-INFO" <<EOF
name: $NAME
version: $VERSION
commit: $COMMIT
built_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)
tests: $TESTS
EOF

# Checksums of every file in the release, sorted so the list is the same on every run.
(cd "$DEST" && find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS)
FILES="$(wc -l < "$DEST/SHA256SUMS" | tr -d ' ')"

OUT="$ROOT/dist/$NAME.tar.gz"
tar -C "$STAGE" --sort=name --owner=0 --group=0 --numeric-owner -czf "$OUT" "$NAME"
(cd "$ROOT/dist" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")

echo "built $OUT ($FILES files, tests: $TESTS)"
cat "$ROOT/dist/$NAME.tar.gz.sha256"
