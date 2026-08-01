# cli

---

summary: "CLI model providers and config for Claude, Codex, Gemini, and Cursor Agent."
read_when:

- "When changing CLI model integration."

---

# CLI models

Summarize can use installed coding CLIs (Claude, Codex, Gemini, Cursor Agent) as agentic model backends. They are an explicit, per-run opt-in and are never selected by normal API auto mode or by the daemon.

## Model ids

- `cli/claude/<model>` (e.g. `cli/claude/sonnet`)
- `cli/codex/<model>` (optional model suffix; `cli/codex` uses your Codex CLI default)
- `cli/gemini/<model>` (e.g. `cli/gemini/gemini-3-flash`)
- `cli/agent/<model>` (e.g. `cli/agent/gpt-5.2`)

Use `--allow-agent-tools --cli [provider]` (case-insensitive) for the provider default, or `--allow-agent-tools --model cli/<provider>/<model>` to pin a model. Both forms require `--allow-agent-tools`; without it the run fails closed.

If `--cli` is provided without a provider, only the configured/available CLI order is tried. This is still an explicit CLI request and still requires `--allow-agent-tools`.

For Codex specifically, `summarize --cli codex` and `--model cli/codex` defer to your Codex CLI's own configured default model instead of pinning one in summarize.

## Selection boundary

- Normal `--model auto` uses API-style, non-agentic providers only.
- `cli.enabled` is an allowlist/order for an explicitly requested CLI run; setting it does not activate CLI fallback.
- Legacy `cli.autoFallback` is parsed for compatibility but cannot activate a CLI backend by itself and defaults to disabled.
- The daemon always disables CLI providers, even if its inherited configuration contains legacy CLI fallback settings.
- A successful explicitly requested CLI provider can still be remembered in `~/.summarize/cli-state.json` to order a later explicit `--cli` run.

Gemini CLI performance: summarize sets `GEMINI_CLI_NO_RELAUNCH=true` for Gemini CLI runs to avoid a costly self-relaunch (can be overridden by setting it yourself).

Set explicit CLI allowlist:

```json
{
  "cli": { "enabled": ["gemini"] }
}
```

Keep the legacy fallback setting disabled:

```json
{
  "cli": {
    "autoFallback": {
      "enabled": false,
      "onlyWhenNoApiKeys": true,
      "order": ["codex", "gemini", "claude", "agent"]
    }
  }
}
```

## CLI discovery

Binary lookup:

- `CLAUDE_PATH`, `CODEX_PATH`, `GEMINI_PATH` (optional overrides)
- `AGENT_PATH` (optional override)
- Otherwise uses `PATH`

## Attachments (images/files)

Summarize extracts documents and media itself and passes plain text whenever possible. If an explicitly opted-in image/file run truly needs a path, Summarize:

- creates a fresh `0700` temporary root with isolated work, home, and temp directories;
- copies only the required input into the work directory with mode `0600`;
- launches from that directory with an empty `HOME` and a provider-specific environment allowlist;
- disables Claude tools unless the staged file needs `Read`, uses Codex read-only/ephemeral mode, and forces Cursor Agent ask/sandbox mode;
- never adds `--dangerously-skip-permissions` or `--yolo`; and
- removes the workspace after the provider exits.

On macOS, a Seatbelt profile also denies reads and writes outside the isolated workspace except for the system/runtime paths needed to launch the provider. Network access remains available because provider CLIs must reach their APIs.

On Linux, `bubblewrap` (`bwrap`) is required and builds an equivalent mount/user namespace. Other operating systems fail closed rather than launching an unsandboxed agent. Unix launches also apply CPU, memory (resident-memory watchdog on macOS; virtual-address-space limit on Linux), file-size, process, and open-file limits in addition to the elapsed-time and output caps.

## Config

```json
{
  "cli": {
    "enabled": ["claude", "gemini", "codex", "agent"],
    "autoFallback": {
      "enabled": false,
      "onlyWhenNoApiKeys": true,
      "order": ["claude", "gemini", "codex", "agent"]
    },
    "codex": { "model": "gpt-5.2" },
    "gemini": { "model": "gemini-3-flash", "extraArgs": ["--verbose"] },
    "claude": {
      "model": "sonnet",
      "binary": "/usr/local/bin/claude",
      "extraArgs": ["--verbose"]
    },
    "agent": {
      "model": "gpt-5.2",
      "binary": "/usr/local/bin/agent"
    }
  }
}
```

Notes:

- CLI output is treated as text only (no token accounting).
- If an explicitly requested `--cli` run fails, it may try the next explicitly allowed CLI candidate.
- The isolated empty `HOME` intentionally hides normal interactive login files. Supply the selected provider's API key in the environment (for Agent, `CURSOR_API_KEY`). Other provider keys and unrelated credentials are not inherited.
- Gemini CLI is invoked in headless mode with `--prompt` for compatibility with current Gemini CLI releases.
- Provider output is capped and the process is killed when the configured elapsed timeout expires.

## Quick smoke test (all CLI providers)

Use a tiny local text file and run each provider with a longer timeout (Gemini can be slower):

```bash
printf "Summarize CLI smoke input.\nOne short paragraph. Reply can be brief.\n" >/tmp/summarize-cli-smoke.txt

summarize --allow-agent-tools --cli codex --plain --timeout 2m /tmp/summarize-cli-smoke.txt
summarize --allow-agent-tools --cli claude --plain --timeout 2m /tmp/summarize-cli-smoke.txt
summarize --allow-agent-tools --cli gemini --plain --timeout 2m /tmp/summarize-cli-smoke.txt
summarize --allow-agent-tools --cli agent --plain --timeout 2m /tmp/summarize-cli-smoke.txt
```

Interactive login state is deliberately unavailable inside the isolated home; use the provider's environment API key.

## Generate free preset (OpenRouter)

`summarize` ships with a built-in preset `free`, backed by OpenRouter `:free` models.
To regenerate the candidate list (and persist it in your config):

```bash
summarize refresh-free
```

Options:

- `--runs 2` (default): extra timing runs per selected model (total runs = 1 + runs)
- `--smart 3` (default): number of “smart-first” picks (rest filled by fastest)
- `--set-default`: also sets `"model": "free"` in `~/.summarize/config.json`
