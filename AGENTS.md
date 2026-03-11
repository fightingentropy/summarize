# Summarize Guardrails

- Hard rule: single source of truth = `~/Projects/summarize`; never commit in `vendor/summarize` (treat it as a read-only checkout).
- Note: multiple agents often work in this folder. If you see files/changes you do not recognize, ignore them and list them at the end.

## Workspace layout (note)

- Monorepo (Bun workspace).
- Packages:
  - `summarize` = CLI + UX (TTY/progress/streaming). Depends on core.
  - `summarize-core` (`packages/core`) = library surface for programmatic use (Sweetistics etc). No CLI entrypoints.
- Versioning: lockstep versions; publish order: core first, then CLI (`scripts/release.sh` / `RELEASING.md`).
- Dev:
  - Build: `bun run build` (builds core first)
  - Gate: `bun run check`
  - Import from apps: prefer `summarize-core` to avoid pulling CLI-only deps.
- Daemon: restart with `bun run summarize -- daemon restart`; verify via `bun run summarize -- daemon status`.
- Rebuild after daemon/runtime changes:
  1. `bun run build`
  2. `bun run summarize -- daemon restart`
- Commits: use `committer "type: message" <files...>` (Conventional Commits).
