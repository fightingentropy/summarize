# releasing

---

## summary: "Release checklist for GitHub tags, releases, and Bun installer assets."

# Releasing

## Goals

- Push the release tag.
- Publish the GitHub release.
- Attach the Bun tarballs and `.sha256` files used by the installer.

## Checklist

1. `scripts/release.sh all`
2. Verify the release assets exist in GitHub.
3. Smoke the installer for the new version.
4. If anything fails, fix it and re-cut the release. Do not leave a partial release behind.

## Common failure

- The tag exists, but the GitHub release is missing assets or installer smoke was skipped.
  Fix: always finish the asset upload and install smoke before announcing.
