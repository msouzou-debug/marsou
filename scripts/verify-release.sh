#!/usr/bin/env bash
# Checks a release before it is installed, or an installed folder afterwards.
#   scripts/verify-release.sh dist/ehr-VERSION.tar.gz
#       checks the tarball against its .sha256 file, then every file inside against SHA256SUMS,
#       and fails when the tarball holds a file that SHA256SUMS does not list.
#   scripts/verify-release.sh --dir /opt/ehr/current
#       checks that every listed file in an installed folder is present and unchanged
#       (extra files such as .venv or instance/ are ignored).
# Exit 0 only when everything matches. No sudo, no network, writes only to a temporary folder.
set -euo pipefail

usage() { echo "usage: verify-release.sh TARBALL | --dir FOLDER" >&2; exit 64; }
[ "$#" -ge 1 ] || usage

check_folder() {  # folder, strict (1 = also reject unlisted files)
  local dir="$1" strict="$2"
  [ -f "$dir/SHA256SUMS" ] || { echo "FAIL: no SHA256SUMS in $dir" >&2; return 1; }
  (cd "$dir" && sha256sum --quiet -c SHA256SUMS) || { echo "FAIL: a file is missing or changed" >&2; return 1; }
  if [ "$strict" = 1 ]; then
    local extra
    extra="$(cd "$dir" && comm -13 <(awk '{print substr($0, 67)}' SHA256SUMS | LC_ALL=C sort) \
      <(find . -type f ! -name SHA256SUMS | LC_ALL=C sort))"
    if [ -n "$extra" ]; then
      echo "FAIL: files that SHA256SUMS does not list:" >&2
      echo "$extra" >&2
      return 1
    fi
  fi
  echo "ok: $(wc -l < "$dir/SHA256SUMS" | tr -d ' ') files match SHA256SUMS"
}

if [ "$1" = "--dir" ]; then
  [ "$#" -eq 2 ] || usage
  check_folder "$2" 0
  exit $?
fi

TARBALL="$1"
[ -f "$TARBALL" ] || { echo "FAIL: $TARBALL not found" >&2; exit 1; }
SUMFILE="$TARBALL.sha256"
[ -f "$SUMFILE" ] || { echo "FAIL: $SUMFILE not found (keep it next to the tarball)" >&2; exit 1; }
(cd "$(dirname "$TARBALL")" && sha256sum --quiet -c "$(basename "$SUMFILE")") \
  || { echo "FAIL: the tarball does not match its checksum" >&2; exit 1; }
echo "ok: tarball checksum matches"

WORK="$(mktemp -d)"
cleanup() {
  case "$WORK" in
    /tmp/*|"${TMPDIR:-/tmp}"/*) [ -d "$WORK" ] && rm -rf -- "$WORK" ;;
  esac
}
trap cleanup EXIT

# Refuse paths that leave the extraction folder before unpacking anything.
if tar -tzf "$TARBALL" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "FAIL: the tarball holds absolute or .. paths" >&2
  exit 1
fi
tar -xzf "$TARBALL" -C "$WORK"
TOP="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d)"
[ "$(echo "$TOP" | wc -l)" -eq 1 ] || { echo "FAIL: expected one top folder" >&2; exit 1; }
check_folder "$TOP" 1
grep -E '^(name|version|commit|built_utc|tests):' "$TOP/RELEASE-INFO"
if grep -q '^tests: SKIPPED' "$TOP/RELEASE-INFO"; then
  echo "FAIL: this release was built with the tests skipped" >&2
  exit 1
fi
