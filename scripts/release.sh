#!/usr/bin/env bash
set -euo pipefail

# ai-summary release helper (npm)
# Phases: gates | build | verify | publish | smoke | tag | all

# npm@11 warns on unknown env configs; keep CI/logs clean.
unset npm_config_manage_package_manager_versions || true

PHASE="${1:-all}"

banner() {
  printf "\n==> %s\n" "$1"
}

run() {
  echo "+ $*"
  "$@"
}

require_clean_git() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Git working tree is dirty. Commit or stash before releasing."
    exit 1
  fi
}

phase_gates() {
  banner "Gates"
  require_clean_git
  run bun run check
}

phase_build() {
  banner "Build"
  run bun run build
}

phase_verify_pack() {
  banner "Verify pack"
  local version tmp_dir tarball install_dir
  version="$(node -p 'require("./package.json").version')"
  tmp_dir="$(mktemp -d)"
  tarball="${tmp_dir}/ai-summary-${version}.tgz"
  run bun pm pack --destination "${tmp_dir}"
  if [ ! -f "${tarball}" ]; then
    echo "Missing ${tarball}"
    exit 1
  fi
  install_dir="${tmp_dir}/install"
  run mkdir -p "${install_dir}"
  run npm install --prefix "${install_dir}" "${tarball}"
  run node "${install_dir}/node_modules/ai-summary/dist/cli.js" --help >/dev/null
  echo "ok"
}

phase_publish() {
  banner "Publish to npm"
  require_clean_git
  run bun publish --tag latest --access public
}

phase_smoke() {
  banner "Smoke"
  run npm view ai-summary version
  local version
  version="$(node -p 'require("./package.json").version')"
  run bash -c "bunx ai-summary@${version} --help >/dev/null"
  echo "ok"
}

phase_tag() {
  banner "Tag"
  require_clean_git
  local version
  version="$(node -p 'require("./package.json").version')"
  run git tag -a "v${version}" -m "v${version}"
  run git push --tags
}

case "$PHASE" in
  gates) phase_gates ;;
  build) phase_build ;;
  verify) phase_verify_pack ;;
  publish) phase_publish ;;
  smoke) phase_smoke ;;
  tag) phase_tag ;;
  all)
    phase_gates
    phase_build
    phase_verify_pack
    phase_publish
    phase_smoke
    phase_tag
    ;;
  *)
    echo "Usage: scripts/release.sh [phase]"
    echo
    echo "Phases:"
    echo "  gates     bun run check"
    echo "  build     bun run build"
    echo "  verify    pack + install tarball + --help"
    echo "  publish   bun publish --tag latest --access public"
    echo "  smoke     npm view + bunx ai-summary --help"
    echo "  tag       git tag vX.Y.Z + push tags"
    echo "  all       gates + build + verify + publish + smoke + tag"
    exit 2
    ;;
esac
