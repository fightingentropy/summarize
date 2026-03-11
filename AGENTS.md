# Summarize Guardrails

- Hard rule: single source of truth = `~/Projects/summarize`; never commit in `vendor/summarize` (treat it as a read-only checkout).
- Note: multiple agents often work in this folder. If you see files/changes you do not recognize, ignore them and list them at the end.

## Package layout (note)

- Single package repo.
- Package:
  - `ai-summary` = CLI + library surface (TTY/progress/streaming + reusable content/prompt exports).
- Versioning: single package release (`scripts/release.sh` / `RELEASING.md`).
- Dev:
  - Build: `bun run build`
  - Gate: `bun run check`
  - Import from apps: prefer `ai-summary/content` or `ai-summary/prompts`.
- Daemon: restart with `bun run summarize -- daemon restart`; verify via `bun run summarize -- daemon status`.
- Rebuild after daemon/runtime changes:
  1. `bun run build`
  2. `bun run summarize -- daemon restart`
- Commits: use `committer "type: message" <files...>` (Conventional Commits).
