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

phase_gates() {
  banner "Gates"
  require_clean_git
  run bun run check
}

phase_build() {
  banner "Build"
  run bun run build
  run bun run build:bun:test
  run bun run release:artifacts:check
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
  local tag
  banner "GitHub release workflow"
  require_clean_git
  tag="$(tag_name)"
  git ls-remote --exit-code --tags origin "refs/tags/${tag}" >/dev/null \
    || fail "Remote tag does not exist: ${tag}. Run the tag phase first."
  run gh workflow run release.yml --ref "${tag}" -f "tag=${tag}"
  echo "Release artifacts will be rebuilt, validated, attested, and published by GitHub Actions."
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
    banner "GitHub release workflow"
    echo "The ${tag:-$(tag_name)} tag push triggered .github/workflows/release.yml."
    ;;
  *)
    echo "Usage: scripts/release.sh [phase]"
    echo
    echo "Phases:"
    echo "  gates     bun run check"
    echo "  build     bun run build + bun run build:bun:test"
    echo "  tag       push HEAD + create/push vX.Y.Z tag"
    echo "  release   dispatch the attested GitHub Actions release workflow for the existing tag"
    echo "  all       gates + build + tag (the tag push triggers the attested release workflow)"
    exit 2
    ;;
esac
