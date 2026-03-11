#!/usr/bin/env bash
set -euo pipefail

# summify release helper (npm)
# Phases: gates | build | verify | publish | smoke | tag | tap | all

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
  tarball="${tmp_dir}/summify-${version}.tgz"
  run bun pm pack --destination "${tmp_dir}"
  if [ ! -f "${tarball}" ]; then
    echo "Missing ${tarball}"
    exit 1
  fi
  install_dir="${tmp_dir}/install"
  run mkdir -p "${install_dir}"
  run npm install --prefix "${install_dir}" "${tarball}"
  run node "${install_dir}/node_modules/summify/dist/cli.js" --help >/dev/null
  echo "ok"
}

phase_publish() {
  banner "Publish to npm"
  require_clean_git
  run bun publish --tag latest --access public
}

phase_smoke() {
  banner "Smoke"
  run npm view summify version
  local version
  version="$(node -p 'require("./package.json").version')"
  run bash -c "bunx summify@${version} --help >/dev/null"
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

phase_tap() {
  banner "Homebrew tap"
  local version root_dir tap_dir formula_path tmp_dir
  local url_arm url_x64 tarball_arm tarball_x64 sha_arm sha_x64
  version="$(node -p 'require("./package.json").version')"
  root_dir="$(pwd)"
  tap_dir="${root_dir}/../homebrew-tap"
  formula_path="${tap_dir}/Formula/summarize.rb"
  if [ ! -d "${tap_dir}/.git" ]; then
    echo "Missing tap repo at ${tap_dir}"
    exit 1
  fi
  if ! git -C "${tap_dir}" diff --quiet || ! git -C "${tap_dir}" diff --cached --quiet; then
    echo "Tap repo is dirty: ${tap_dir}"
    exit 1
  fi

  url_arm="https://github.com/erlinhoxha/summify/releases/download/v${version}/summarize-macos-arm64-v${version}.tar.gz"
  url_x64="https://github.com/erlinhoxha/summify/releases/download/v${version}/summarize-macos-x64-v${version}.tar.gz"

  tmp_dir="$(mktemp -d)"
  tarball_arm="${tmp_dir}/summarize-macos-arm64-v${version}.tar.gz"
  tarball_x64="${tmp_dir}/summarize-macos-x64-v${version}.tar.gz"
  run curl -fsSL "${url_arm}" -o "${tarball_arm}"
  run curl -fsSL "${url_x64}" -o "${tarball_x64}"

  sha_arm="$(shasum -a 256 "${tarball_arm}" | awk '{print $1}')"
  sha_x64="$(shasum -a 256 "${tarball_x64}" | awk '{print $1}')"

  run node scripts/release-formula.js "${formula_path}" "${url_arm}" "${sha_arm}" "${url_x64}" "${sha_x64}"

  echo "Tap updated: ${formula_path}"
  echo "arm64 sha: ${sha_arm}"
  echo "x64   sha: ${sha_x64}"
  echo "Next: git -C ${tap_dir} add ${formula_path} && git -C ${tap_dir} commit -m \"chore: bump summarize to v${version}\" && git -C ${tap_dir} push"
}

case "$PHASE" in
  gates) phase_gates ;;
  build) phase_build ;;
  verify) phase_verify_pack ;;
  publish) phase_publish ;;
  smoke) phase_smoke ;;
  tag) phase_tag ;;
  tap) phase_tap ;;
  all)
    phase_gates
    phase_build
    phase_verify_pack
    phase_publish
    phase_smoke
    phase_tag
    phase_tap
    ;;
  *)
    echo "Usage: scripts/release.sh [phase]"
    echo
    echo "Phases:"
    echo "  gates     bun run check"
    echo "  build     bun run build"
    echo "  verify    pack + install tarball + --help"
    echo "  publish   bun publish --tag latest --access public"
    echo "  smoke     npm view + bunx summify --help"
    echo "  tag       git tag vX.Y.Z + push tags"
    echo "  tap       update homebrew-tap formula + sha"
    echo "  all       gates + build + verify + publish + smoke + tag + tap"
    exit 2
    ;;
esac
