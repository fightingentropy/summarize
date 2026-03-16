#!/usr/bin/env bash

set -euo pipefail

REPO="${SUMMARIZE_GITHUB_REPO:-fightingentropy/summarize}"
INSTALL_DIR="${SUMMARIZE_INSTALL_DIR:-$HOME/.local/bin}"
RELEASE_BASE_URL="${SUMMARIZE_RELEASE_BASE_URL:-}"
VERSION="${SUMMARIZE_VERSION:-}"
TARGET="${SUMMARIZE_TARGET:-}"
PRIMARY_BINARY="${SUMMARIZE_BINARY_NAME:-summarize}"
ALIASES="${SUMMARIZE_ALIASES:-ai-summary,summarizer}"
INSTALL_ALIASES="${SUMMARIZE_INSTALL_ALIASES:-1}"
ARCHIVE_BINARY="summarize"

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "${TMP_DIR:-}" && -d "${TMP_DIR:-}" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

trim() {
  local value
  value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

detect_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${os}:${arch}" in
    Darwin:arm64|Darwin:aarch64)
      printf 'macos-arm64\n'
      ;;
    Darwin:x86_64)
      printf 'macos-x64\n'
      ;;
    *)
      fail "unsupported platform ${os}/${arch}; current release installer supports macOS arm64/x64"
      ;;
  esac
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required tool: $1"
}

http_get() {
  curl -fsSL --retry 3 --connect-timeout 15 "$1"
}

latest_release_tag() {
  http_get "https://api.github.com/repos/${REPO}/releases/latest" \
    | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
}

compute_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
    return
  fi
  fail "missing checksum tool: need sha256sum or shasum"
}

verify_checksum() {
  local archive_path checksum_path expected actual
  archive_path="$1"
  checksum_path="$2"
  expected="$(awk 'NR==1 { print $1 }' "$checksum_path")"
  [[ -n "$expected" ]] || fail "checksum file is empty: $checksum_path"
  actual="$(compute_sha256 "$archive_path")"
  [[ "$expected" == "$actual" ]] || fail "checksum mismatch for $(basename "$archive_path")"
}

install_primary_binary() {
  local source target
  source="$1"
  target="${INSTALL_DIR}/${PRIMARY_BINARY}"
  [[ -f "$source" ]] || fail "release archive is missing ${ARCHIVE_BINARY}"
  install -m 755 "$source" "$target"
  log "installed ${target}"
}

install_aliases() {
  local alias target
  case "$INSTALL_ALIASES" in
    0|false|FALSE|False|no|NO|No)
      return
      ;;
  esac
  IFS=',' read -r -a alias_list <<< "$ALIASES"
  for alias in "${alias_list[@]}"; do
    alias="$(trim "$alias")"
    [[ -n "$alias" ]] || continue
    [[ "$alias" != "$PRIMARY_BINARY" ]] || continue
    target="${INSTALL_DIR}/${alias}"
    ln -sfn "$PRIMARY_BINARY" "$target"
    log "linked ${target} -> ${PRIMARY_BINARY}"
  done
}

print_path_hint() {
  case ":$PATH:" in
    *":${INSTALL_DIR}:"*)
      ;;
    *)
      log
      log "Add ${INSTALL_DIR} to PATH if needed:"
      log "  export PATH=\"${INSTALL_DIR}:\$PATH\""
      ;;
  esac
}

trap cleanup EXIT

require_tool curl
require_tool tar
require_tool install

if [[ -z "$TARGET" ]]; then
  TARGET="$(detect_target)"
fi

if [[ -n "$RELEASE_BASE_URL" && -z "$VERSION" ]]; then
  fail "SUMMARIZE_VERSION is required when SUMMARIZE_RELEASE_BASE_URL is set"
fi

if [[ -z "$VERSION" ]]; then
  VERSION="$(latest_release_tag)"
fi
[[ -n "$VERSION" ]] || fail "could not resolve a release version for ${REPO}"

ARCHIVE_NAME="summarize-${TARGET}-v${VERSION#v}.tar.gz"
CHECKSUM_NAME="${ARCHIVE_NAME}.sha256"

if [[ -n "$RELEASE_BASE_URL" ]]; then
  ARCHIVE_URL="${RELEASE_BASE_URL%/}/${ARCHIVE_NAME}"
  CHECKSUM_URL="${RELEASE_BASE_URL%/}/${CHECKSUM_NAME}"
else
  ARCHIVE_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ARCHIVE_NAME}"
  CHECKSUM_URL="https://github.com/${REPO}/releases/download/${VERSION}/${CHECKSUM_NAME}"
fi

TMP_DIR="$(mktemp -d)"
ARCHIVE_PATH="${TMP_DIR}/${ARCHIVE_NAME}"
CHECKSUM_PATH="${TMP_DIR}/${CHECKSUM_NAME}"
EXTRACTED_BINARY="${TMP_DIR}/${ARCHIVE_BINARY}"

log "Installing ${ARCHIVE_NAME} from ${REPO}"
mkdir -p "$INSTALL_DIR"
[[ -w "$INSTALL_DIR" ]] || fail "install directory is not writable: ${INSTALL_DIR}"

http_get "$ARCHIVE_URL" > "$ARCHIVE_PATH" || fail "failed to download ${ARCHIVE_URL}"
http_get "$CHECKSUM_URL" > "$CHECKSUM_PATH" || fail "failed to download ${CHECKSUM_URL}"
verify_checksum "$ARCHIVE_PATH" "$CHECKSUM_PATH"

tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"
install_primary_binary "$EXTRACTED_BINARY"
install_aliases
print_path_hint

log
log "Run 'summarize --help' to confirm the install."
