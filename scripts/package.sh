#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_ROOT="${RELEASE_ROOT:-$ROOT/extension-release}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/package.sh chromium [release-directory]
  bash scripts/package.sh edge [release-directory]
  bash scripts/package.sh opera [release-directory]
  bash scripts/package.sh firefox [release-directory]

The optional release-directory is relative to extension-release/ or an absolute
path. Set RELEASE_ROOT to use another release root, for example:

  RELEASE_ROOT=/tmp/voxli-release bash scripts/package.sh chromium
EOF
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage >&2
  exit 2
fi

target="$1"
case "$target" in
  chromium)
    platform="chromium"
    archive_prefix="chrome"
    ;;
  edge)
    platform="chromium"
    archive_prefix="edge"
    ;;
  opera)
    platform="chromium"
    archive_prefix="opera"
    ;;
  firefox)
    platform="firefox"
    archive_prefix="firefox"
    ;;
  *)
    echo "Unknown target: $target" >&2
    usage >&2
    exit 2
    ;;
esac

if [[ $# -eq 2 ]]; then
  release_dir="$2"
  if [[ "$release_dir" != /* ]]; then
    release_dir="$RELEASE_ROOT/$release_dir"
  fi
else
  release_dir="$RELEASE_ROOT/$archive_prefix"
fi

manifest="$ROOT/platforms/$platform/manifest.json"
version="$(python3 - "$manifest" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    print(json.load(stream)["version"])
PY
)"

stage="$(mktemp -d "${TMPDIR:-/tmp}/voxli-package.XXXXXX")"
cleanup() {
  rm -rf "$stage"
}
trap cleanup EXIT

cp -R "$ROOT/common/." "$stage/"
cp "$manifest" "$stage/manifest.json"
cp "$ROOT/platforms/$platform/src/background.js" "$stage/src/background.js"

mkdir -p "$release_dir"
archive="$release_dir/voxli-book-reader-${archive_prefix}-v${version}.zip"
if [[ -e "$archive" && "${FORCE:-0}" != "1" ]]; then
  echo "Refusing to overwrite existing archive: $archive" >&2
  echo "Set FORCE=1 only when replacing that archive is intentional." >&2
  exit 1
fi

(
  cd "$stage"
  zip -qr "$archive" \
    manifest.json options.html filepicker.html reader.html styles.css _locales icons src
)

printf 'Created %s\n' "$archive"
