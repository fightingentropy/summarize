import type { ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isCliDisabled, resolveCliBinary, runCliModel } from "../src/llm/cli.js";

const runCliModelForTest = (options: Parameters<typeof runCliModel>[0]) =>
  runCliModel({
    ...options,
    env: {
      ...options.env,
      [`SUMMARIZE_CLI_${options.provider.toUpperCase()}`]: process.execPath,
    },
  });

describe("llm/cli more branches", () => {
  it("isCliDisabled respects cli.enabled allowlist", () => {
    expect(isCliDisabled("codex", { enabled: ["claude"] })).toBe(true);
    expect(isCliDisabled("codex", { enabled: ["codex"] })).toBe(false);
    expect(isCliDisabled("codex", null)).toBe(false);
  });

  it("resolveCliBinary prefers config binary, then env override, then defaults", () => {
    expect(
      resolveCliBinary(
        "codex",
        { codex: { binary: "  /usr/local/bin/codex  " } },
        { SUMMARIZE_CLI_CODEX: "codex-env" },
      ),
    ).toBe("/usr/local/bin/codex");

    expect(resolveCliBinary("gemini", null, { SUMMARIZE_CLI_GEMINI: " gemini-env " })).toBe(
      "gemini-env",
    );
    expect(resolveCliBinary("agent", null, { AGENT_PATH: " /tmp/agent-bin " })).toBe(
      "/tmp/agent-bin",
    );

    expect(resolveCliBinary("claude", null, {})).toBe("claude");
    expect(resolveCliBinary("agent", null, {})).toBe("agent");
  });

  it("includes stderr in exec error messages", async () => {
    await expect(
      runCliModelForTest({
        provider: "gemini",
        prompt: "hi",
        model: "m",
        allowTools: false,
        timeoutMs: 1000,
        env: {},
        config: null,
        execFileImpl: (_cmd, _args, _opts, cb) => {
          const error = Object.assign(new Error("boom"), { code: 1 });
          cb(error as unknown as NodeJS.ErrnoException, "", "stderr details");
          return { stdin: { write() {}, end() {} } } as unknown as ChildProcess;
        },
      }),
    ).rejects.toThrow(/boom: stderr details/i);
  });

  it("does not duplicate stderr when exec error message already includes stderr", async () => {
    const error = await runCliModelForTest({
      provider: "gemini",
      prompt: "hi",
      model: "m",
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      config: null,
      execFileImpl: (_cmd, _args, _opts, cb) => {
        const stderrText = "stderr details";
        const error = Object.assign(new Error(`Command failed: gemini\n${stderrText}`), {
          code: 1,
        });
        cb(error as unknown as NodeJS.ErrnoException, "", stderrText);
        return { stdin: { write() {}, end() {} } } as unknown as ChildProcess;
      },
    }).catch((error: unknown) => error as Error);

    expect(error.message).toContain("stderr details");
    const occurrences = error.message.match(/stderr details/gi)?.length ?? 0;
    expect(occurrences).toBe(1);
  });

  it("formats timeout errors with duration and hint", async () => {
    const error = await runCliModelForTest({
      provider: "gemini",
      prompt: "hi",
      model: "m",
      allowTools: false,
      timeoutMs: 2000,
      env: {},
      config: null,
      execFileImpl: (_cmd, _args, _opts, cb) => {
        const timeoutError = Object.assign(new Error("Command failed: gemini --prompt hi"), {
          code: "ETIMEDOUT",
          cmd: "gemini --prompt hi",
          killed: true,
          signal: "SIGTERM",
        });
        cb(timeoutError as unknown as NodeJS.ErrnoException, "", "Reading prompt from stdin...");
        return { stdin: { write() {}, end() {} } } as unknown as ChildProcess;
      },
    }).catch((error: unknown) => error as Error);

    expect(error.message).toContain("timed out after 2s");
    expect(error.message).toContain("Increase --timeout");
    expect(error.message).toContain("Reading prompt from stdin...");
  });

  it("codex: uses last-message file when present, otherwise stdout fallback", async () => {
    // file present
    const resultFile = await runCliModelForTest({
      provider: "codex",
      prompt: "hi",
      model: null,
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      config: null,
      execFileImpl: (_cmd, args, _opts, cb) => {
        const outputIndex = args.indexOf("--output-last-message");
        const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
        if (!outputPath) throw new Error("missing output path");
        writeFileSync(outputPath, "FROM FILE", "utf8");
        cb(
          null,
          [
            '{"usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3},"cost_usd":0.01}',
            '{"response":{"usage":{"prompt_tokens":4,"completion_tokens":5,"total_tokens":9}}}',
          ].join("\n"),
          "",
        );
        return { stdin: { write() {}, end() {} } } as unknown as ChildProcess;
      },
    });
    expect(resultFile.text).toBe("FROM FILE");
    expect(resultFile.usage?.promptTokens).toBe(4);
    expect(resultFile.costUsd).toBe(0.01);

    // stdout fallback when file is empty
    const resultStdout = await runCliModelForTest({
      provider: "codex",
      prompt: "hi",
      model: null,
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      config: null,
      execFileImpl: (_cmd, args, _opts, cb) => {
        const outputIndex = args.indexOf("--output-last-message");
        const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
        if (!outputPath) throw new Error("missing output path");
        writeFileSync(outputPath, "   ", "utf8");
        cb(null, "STDOUT", "");
        return { stdin: { write() {}, end() {} } } as unknown as ChildProcess;
      },
    });
    expect(resultStdout.text).toBe("STDOUT");
  });

  it("codex: gpt-fast alias resolves to gpt-5.5 with service_tier=fast", async () => {
    let capturedArgs: string[] | null = null;
    const result = await runCliModelForTest({
      provider: "codex",
      prompt: "hi",
      model: "gpt-fast",
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      config: null,
      execFileImpl: (_cmd, args, _opts, cb) => {
        capturedArgs = args.slice();
        const outputIndex = args.indexOf("--output-last-message");
        const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
        if (!outputPath) throw new Error("missing output path");
        writeFileSync(outputPath, "ok", "utf8");
        cb(null, "", "");
        return { stdin: { write() {}, end() {} } } as unknown as ChildProcess;
      },
    });
    expect(result.text).toBe("ok");
    expect(capturedArgs).not.toBeNull();
    const args = capturedArgs as unknown as string[];
    const modelIndex = args.indexOf("-m");
    expect(modelIndex).toBeGreaterThanOrEqual(0);
    expect(args[modelIndex + 1]).toBe("gpt-5.5");
    expect(args).toContain('service_tier="fast"');
  });

  it("codex: existing service_tier override is preserved", async () => {
    let capturedArgs: string[] | null = null;
    await runCliModelForTest({
      provider: "codex",
      prompt: "hi",
      model: "gpt-5.5-fast",
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      config: { codex: { extraArgs: ["-c", 'service_tier="priority"'] } },
      execFileImpl: (_cmd, args, _opts, cb) => {
        capturedArgs = args.slice();
        const outputIndex = args.indexOf("--output-last-message");
        const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
        if (!outputPath) throw new Error("missing output path");
        writeFileSync(outputPath, "ok", "utf8");
        cb(null, "", "");
        return { stdin: { write() {}, end() {} } } as unknown as ChildProcess;
      },
    });
    const args = capturedArgs as unknown as string[];
    expect(args).toContain('service_tier="priority"');
    expect(args).not.toContain('service_tier="fast"');
  });

  it("returns trimmed stdout when JSON payload has no usable result field", async () => {
    const result = await runCliModelForTest({
      provider: "claude",
      prompt: "hi",
      model: "m",
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      config: null,
      execFileImpl: (_cmd, _args, _opts, cb) => {
        cb(null, '{"foo":"bar"}', "");
        return { stdin: { write() {}, end() {} } } as unknown as ChildProcess;
      },
    });
    expect(result.text).toBe('{"foo":"bar"}');
    expect(result.usage).toBeNull();
  });
});
