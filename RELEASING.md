# Releasing `summarize` (GitHub)

Ship is **not done** until:

- the release tag is pushed
- the GitHub release is published
- the Bun installer assets are attached

## Version sources (keep in sync)

- `package.json` `version`
- `src/version.ts` `FALLBACK_VERSION` (needed for the Bun-compiled binary; it can’t read `package.json`)

## Fast path

0. Preflight
   - Clean git: `git status`
   - Auth: `gh auth status`

1. Bump version + notes
   - Update:
     - `package.json`
     - `src/version.ts`
   - Update `CHANGELOG.md` with the release date and notes

2. Run the helper

   ```bash
   scripts/release.sh all
   ```

   That does:
   - `bun run check`
   - `bun run build`
   - `bun run build:bun:test`
   - `git push origin HEAD`
   - create/push `v<ver>`
   - `gh release create` with the Bun tarballs and `.sha256` files

## Release assets

For version `<ver>`, the release must include:

- `dist-bun/summarize-macos-arm64-v<ver>.tar.gz`
- `dist-bun/summarize-macos-arm64-v<ver>.tar.gz.sha256`
- `dist-bun/summarize-linux-x64-v<ver>.tar.gz`
- `dist-bun/summarize-linux-x64-v<ver>.tar.gz.sha256`

## Manual path

If you need to run the steps separately:

```bash
scripts/release.sh gates
scripts/release.sh build
scripts/release.sh tag
scripts/release.sh release
```

## Verify

- `gh release view v<ver> --json body,assets --jq .body`
- `gh release view v<ver> --json assets --jq '.assets[].name'`
- `curl -fsSL https://raw.githubusercontent.com/fightingentropy/summarize/main/scripts/install.sh | SUMMARIZE_VERSION=v<ver> bash`
