# releasing

---

## summary: "Release checklist for npm publishing and tags."

# Releasing

## Goals

- Publish npm.
- Push the release tag.
- Create a GitHub release when you want release notes/assets.

## Checklist

1. `scripts/release.sh all` (gates → build → verify → publish → smoke → tag).
2. Create a GitHub release for the new tag if you want release notes/assets.
3. Verify `npm view ai-summary version` matches the version you just published.
4. If anything fails, fix it and re-cut the release. Do not leave a partial release behind.

## Common failure

- npm published, but the tag or GitHub release is stale.
  Fix: always finish the tag/release steps before announcing.
