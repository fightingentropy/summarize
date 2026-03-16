#!/usr/bin/env bash
set -euo pipefail

# summarize release helper (GitHub)
# Phases: gates | build | tag | release | all

PHASE="${1:-all}"

banner() {
  printf "\n==> %s\n" "$1"
}

run() {
  echo "+ $*"
  "$@"
}

fail() {
  echo "$*" >&2
  exit 1
}

require_clean_git() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    fail "Git working tree is dirty. Commit or stash before releasing."
  fi
}

package_version() {
  node -p 'require("./package.json").version'
}

tag_name() {
  printf 'v%s\n' "$(package_version)"
}

asset_paths() {
  local version
  version="$(package_version)"
  printf '%s\n' \
    "dist-bun/summarize-macos-arm64-v${version}.tar.gz" \
    "dist-bun/summarize-macos-arm64-v${version}.tar.gz.sha256" \
    "dist-bun/summarize-linux-x64-v${version}.tar.gz" \
    "dist-bun/summarize-linux-x64-v${version}.tar.gz.sha256"
}

require_release_assets() {
  local asset
  while IFS= read -r asset; do
    [ -f "$asset" ] || fail "Missing release asset: $asset"
  done < <(asset_paths)
}

release_notes_file() {
  local version notes
  version="$(package_version)"
  notes="$(mktemp)"
  awk -v start="$version" '
    BEGIN { p=0 }
    $0 ~ ("^## " start " ") { p=1; next }
    p && /^## / { exit }
    p { print }
  ' CHANGELOG.md > "$notes"
  [ -s "$notes" ] || fail "Could not extract release notes for ${version} from CHANGELOG.md"
  printf '%s\n' "$notes"
}

phase_gates() {
  banner "Gates"
  require_clean_git
  run bun run check
}

phase_build() {
  banner "Build"
  run bun run build
  run bun run build:bun:test
}

phase_tag() {
  local tag
  banner "Tag"
  require_clean_git
  tag="$(tag_name)"
  if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
    fail "Tag already exists: ${tag}"
  fi
  run git push origin HEAD
  run git tag -a "${tag}" -m "${tag}"
  run git push origin "${tag}"
}

phase_release() {
  local tag notes version
  banner "GitHub release"
  require_clean_git
  require_release_assets
  tag="$(tag_name)"
  version="$(package_version)"
  if gh release view "${tag}" >/dev/null 2>&1; then
    fail "GitHub release already exists: ${tag}"
  fi
  notes="$(release_notes_file)"
  run gh release create "${tag}" \
    "dist-bun/summarize-macos-arm64-v${version}.tar.gz" \
    "dist-bun/summarize-macos-arm64-v${version}.tar.gz.sha256" \
    "dist-bun/summarize-linux-x64-v${version}.tar.gz" \
    "dist-bun/summarize-linux-x64-v${version}.tar.gz.sha256" \
    --title "${tag}" \
    --notes-file "${notes}"
  rm -f "${notes}"
}

case "$PHASE" in
  gates) phase_gates ;;
  build) phase_build ;;
  tag) phase_tag ;;
  release) phase_release ;;
  all)
    phase_gates
    phase_build
    phase_tag
    phase_release
    ;;
  *)
    echo "Usage: scripts/release.sh [phase]"
    echo
    echo "Phases:"
    echo "  gates     bun run check"
    echo "  build     bun run build + bun run build:bun:test"
    echo "  tag       push HEAD + create/push vX.Y.Z tag"
    echo "  release   gh release create with macOS arm64 + Linux x64 Bun tarballs and sha256 assets"
    echo "  all       gates + build + tag + release"
    exit 2
    ;;
esac
