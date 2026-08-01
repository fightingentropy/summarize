import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { CliProvider } from "../src/config.js";
import { isCliDisabled, resolveCliBinary, runCliModel } from "../src/llm/cli.js";
import type { ExecFileFn } from "../src/markitdown.js";

const makeStub = (handler: (args: string[]) => { stdout?: string; stderr?: string }) => {
  const execFileStub: ExecFileFn = ((_cmd, args, _options, cb) => {
    const result = handler(args);
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    if (cb) cb(null, stdout, stderr);
    return {
      stdin: {
        write: () => {},
        end: () => {},
      },
    } as unknown as ReturnType<ExecFileFn>;
  }) as ExecFileFn;
  return execFileStub;
};

const runCliModelForTest = (options: Parameters<typeof runCliModel>[0]) =>
  runCliModel({
    ...options,
    env: {
      ...options.env,
      [`SUMMARIZE_CLI_${options.provider.toUpperCase()}`]: process.execPath,
    },
  });

describe("runCliModel", () => {
  it("allows only Claude Read tools without bypassing permissions", async () => {
    const seen: string[][] = [];
    const execFileImpl = makeStub((args) => {
      seen.push(args);
      return {
        stdout: JSON.stringify({
          result: "ok",
          total_cost_usd: 0.0125,
          usage: {
            input_tokens: 4,
            cache_creation_input_tokens: 1,
            cache_read_input_tokens: 2,
            output_tokens: 3,
          },
        }),
      };
    });
    const result = await runCliModelForTest({
      provider: "claude",
      prompt: "Test",
      model: "sonnet",
      allowTools: true,
      timeoutMs: 1000,
      env: {},
      execFileImpl,
      config: null,
    });
    expect(result.text).toBe("ok");
    expect(result.costUsd).toBe(0.0125);
    expect(result.usage).toEqual({
      promptTokens: 7,
      completionTokens: 3,
      totalTokens: 10,
    });
    expect(seen[0]?.includes("--tools")).toBe(true);
    expect(seen[0]).toContain("Read");
    expect(seen[0]?.includes("--dangerously-skip-permissions")).toBe(false);
  });

  it("handles Gemini JSON output without yolo mode", async () => {
    const seen: string[][] = [];
    const execFileImpl = makeStub((args) => {
      seen.push(args);
      return {
        stdout: JSON.stringify({
          response: "ok",
          stats: {
            models: {
              "gemini-3-flash-preview": {
                tokens: { prompt: 5, candidates: 7, total: 12 },
              },
            },
          },
        }),
      };
    });
    const result = await runCliModelForTest({
      provider: "gemini",
      prompt: "Test",
      model: "gemini-3-flash-preview",
      allowTools: true,
      timeoutMs: 1000,
      env: {},
      execFileImpl,
      config: null,
    });
    expect(result.text).toBe("ok");
    expect(result.usage).toEqual({
      promptTokens: 5,
      completionTokens: 7,
      totalTokens: 12,
    });
    expect(seen[0]?.includes("--yolo")).toBe(false);
    expect(seen[0]?.includes("--prompt")).toBe(true);
    expect(seen[0]?.includes("Test")).toBe(true);
  });

  it("sets GEMINI_CLI_NO_RELAUNCH by default for Gemini", async () => {
    let seenEnv: Record<string, unknown> | null = null;

    const execFileImpl: ExecFileFn = ((_cmd, _args, options, cb) => {
      seenEnv = (options as { env?: Record<string, unknown> } | null)?.env ?? null;
      cb?.(null, JSON.stringify({ response: "ok" }), "");
      return {
        stdin: {
          write: () => {},
          end: () => {},
        },
      } as unknown as ReturnType<ExecFileFn>;
    }) as ExecFileFn;

    await runCliModelForTest({
      provider: "gemini",
      prompt: "Test",
      model: "gemini-3-flash-preview",
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      execFileImpl,
      config: null,
    });

    expect(seenEnv?.GEMINI_CLI_NO_RELAUNCH).toBe("true");
  });

  it("adds provider and call-site extra args", async () => {
    const seen: string[][] = [];
    const execFileImpl = makeStub((args) => {
      seen.push(args);
      return { stdout: JSON.stringify({ result: "ok" }) };
    });
    const result = await runCliModelForTest({
      provider: "claude",
      prompt: "Test",
      model: null,
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      execFileImpl,
      config: { claude: { extraArgs: ["--verbose"] } },
      extraArgs: ["--bar"],
    });
    expect(result.text).toBe("ok");
    expect(seen[0]).toContain("--verbose");
    expect(seen[0]).toContain("--bar");
  });

  it("rejects configured arguments that can alter the provider security policy", async () => {
    await expect(
      runCliModel({
        provider: "claude",
        prompt: "Test",
        model: "sonnet",
        allowTools: false,
        timeoutMs: 1000,
        env: {},
        execFileImpl: makeStub(() => ({ stdout: JSON.stringify({ result: "ok" }) })),
        config: { claude: { extraArgs: ["--tools", "Bash"] } },
      }),
    ).rejects.toThrow(/Unsafe CLI provider extra argument/i);

    await expect(
      runCliModel({
        provider: "gemini",
        prompt: "Test",
        model: "flash",
        allowTools: false,
        timeoutMs: 1000,
        env: {},
        execFileImpl: makeStub(() => ({ stdout: JSON.stringify({ response: "ok" }) })),
        config: { gemini: { extraArgs: ["--yolo"] } },
      }),
    ).rejects.toThrow(/Unsafe CLI provider extra argument/i);
  });

  it("handles Agent CLI JSON output in ask mode", async () => {
    const seen: string[][] = [];
    const execFileImpl = makeStub((args) => {
      seen.push(args);
      return { stdout: JSON.stringify({ result: "ok" }) };
    });
    const result = await runCliModelForTest({
      provider: "agent",
      prompt: "Test",
      model: "gpt-5.2",
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      execFileImpl,
      config: null,
    });
    expect(result.text).toBe("ok");
    expect(seen[0]).toContain("--print");
    expect(seen[0]).toContain("--output-format");
    expect(seen[0]).toContain("json");
    expect(seen[0]).toContain("--mode");
    expect(seen[0]).toContain("ask");
    expect(seen[0]).toContain("--model");
    expect(seen[0]).toContain("gpt-5.2");
    expect(seen[0]?.[seen[0].length - 1]).toBe("Test");
  });

  it("accepts common JSON output fields across JSON CLI providers", async () => {
    const providers: Array<{ provider: CliProvider; model: string }> = [
      { provider: "claude", model: "sonnet" },
      { provider: "gemini", model: "gemini-3-flash-preview" },
      { provider: "agent", model: "gpt-5.2" },
    ];
    for (const { provider, model } of providers) {
      const result = await runCliModelForTest({
        provider,
        prompt: "Test",
        model,
        allowTools: false,
        timeoutMs: 1000,
        env: {},
        execFileImpl: makeStub(() => ({ stdout: JSON.stringify({ message: "ok" }) })),
        config: null,
      });
      expect(result.text).toBe("ok");
    }
  });

  it("extracts result payloads from JSON array output", async () => {
    const result = await runCliModelForTest({
      provider: "agent",
      prompt: "Test",
      model: "gpt-5.2",
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      execFileImpl: makeStub(() => ({
        stdout: JSON.stringify([
          { type: "status", message: "working" },
          { type: "result", result: "ok from array" },
        ]),
      })),
      config: null,
    });

    expect(result.text).toBe("ok from array");
  });

  it("reads the Codex output file", async () => {
    const execFileImpl: ExecFileFn = ((_cmd, args, _options, cb) => {
      const outputIndex = args.indexOf("--output-last-message");
      const outputPath = outputIndex === -1 ? null : args[outputIndex + 1];
      if (!outputPath) {
        cb?.(new Error("missing output path"), "", "");
        return {
          stdin: { write: () => {}, end: () => {} },
        } as unknown as ReturnType<ExecFileFn>;
      }
      void fs.writeFile(outputPath, "ok", "utf8").then(
        () => cb?.(null, "", ""),
        (error) => cb?.(error as Error, "", ""),
      );
      return {
        stdin: { write: () => {}, end: () => {} },
      } as unknown as ReturnType<ExecFileFn>;
    }) as ExecFileFn;

    const result = await runCliModelForTest({
      provider: "codex",
      prompt: "Test",
      model: "gpt-5.2",
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      execFileImpl,
      config: null,
    });
    expect(result.text).toBe("ok");
  });

  it("returns Codex stdout when present", async () => {
    const execFileImpl = makeStub(() => ({ stdout: "from stdout" }));
    const result = await runCliModelForTest({
      provider: "codex",
      prompt: "Test",
      model: "gpt-5.2",
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      execFileImpl,
      config: null,
    });
    expect(result.text).toBe("from stdout");
  });

  it("parses Codex JSONL usage + cost when present", async () => {
    const execFileImpl = makeStub(() => ({
      stdout: [
        JSON.stringify({
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        }),
        JSON.stringify({
          response: { usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 } },
          cost_usd: 0.5,
        }),
        JSON.stringify({
          metrics: { usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 } },
        }),
      ].join("\n"),
    }));

    const result = await runCliModelForTest({
      provider: "codex",
      prompt: "Test",
      model: "gpt-5.2",
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      execFileImpl,
      config: null,
    });

    expect(result.text).toContain("{");
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 6, totalTokens: 11 });
    expect(result.costUsd).toBe(0.5);
  });

  it("throws when Codex returns no output file and empty stdout", async () => {
    const execFileImpl = makeStub(() => ({ stdout: "" }));
    await expect(
      runCliModel({
        provider: "codex",
        prompt: "Test",
        model: "gpt-5.2",
        allowTools: false,
        timeoutMs: 1000,
        env: {},
        execFileImpl,
        config: null,
      }),
    ).rejects.toThrow(/empty output/i);
  });

  it("falls back to plain text output", async () => {
    const execFileImpl = makeStub(() => ({ stdout: "plain text" }));
    const result = await runCliModelForTest({
      provider: "claude",
      prompt: "Test",
      model: "sonnet",
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      execFileImpl,
      config: null,
    });
    expect(result.text).toBe("plain text");
  });

  it("falls back to plain text when JSON lacks result", async () => {
    const execFileImpl = makeStub(() => ({ stdout: JSON.stringify({ ok: true }) }));
    const result = await runCliModelForTest({
      provider: "claude",
      prompt: "Test",
      model: "sonnet",
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      execFileImpl,
      config: null,
    });
    expect(result.text).toBe('{"ok":true}');
  });

  it("throws on empty output", async () => {
    const execFileImpl = makeStub(() => ({ stdout: "   " }));
    await expect(
      runCliModel({
        provider: "gemini",
        prompt: "Test",
        model: "gemini-3-flash-preview",
        allowTools: false,
        timeoutMs: 1000,
        env: {},
        execFileImpl,
        config: null,
      }),
    ).rejects.toThrow(/empty output/);
  });

  it("surfaces exec errors with stderr", async () => {
    const execFileImpl: ExecFileFn = ((_cmd, _args, _options, cb) => {
      cb?.(new Error("boom"), "", "nope");
      return {
        stdin: { write: () => {}, end: () => {} },
      } as unknown as ReturnType<ExecFileFn>;
    }) as ExecFileFn;

    await expect(
      runCliModel({
        provider: "claude",
        prompt: "Test",
        model: "sonnet",
        allowTools: false,
        timeoutMs: 1000,
        env: {},
        execFileImpl,
        config: null,
      }),
    ).rejects.toThrow(/boom: nope/);
  });
});

describe("cli helpers", () => {
  it("resolves disabled providers", () => {
    expect(isCliDisabled("claude", null)).toBe(false);
    expect(isCliDisabled("codex", { enabled: ["claude"] })).toBe(true);
    expect(isCliDisabled("gemini", { enabled: ["gemini"] })).toBe(false);
  });

  it("resolves binaries", () => {
    expect(resolveCliBinary("claude", { claude: { binary: "/opt/claude" } }, {})).toBe(
      "/opt/claude",
    );
    expect(resolveCliBinary("codex", null, { SUMMARIZE_CLI_CODEX: "/opt/codex" })).toBe(
      "/opt/codex",
    );
    expect(resolveCliBinary("agent", null, { AGENT_PATH: "/opt/agent" })).toBe("/opt/agent");
    expect(resolveCliBinary("gemini", null, {})).toBe("gemini");
  });
});
