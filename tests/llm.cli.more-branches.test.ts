import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { runCliModel } from "../src/llm/cli.js";

describe("llm/cli extra branches", () => {
  it("parses the last JSON object when stdout includes a preface", async () => {
    const result = await runCliModel({
      provider: "gemini",
      prompt: "hi",
      model: "gemini-2.0",
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      config: null,
      execFileImpl: (_cmd, _args, _opts, cb) => {
        cb(
          null,
          [
            "some debug output",
            '{"result":"OK","stats":{"models":{"x":{"tokens":{"prompt":2,"candidates":3,"total":5}}}}}',
          ].join("\n"),
          "",
        );
        return { stdin: { write() {}, end() {} } } as unknown as ChildProcess;
      },
    });

    expect(result.text).toBe("OK");
    expect(result.usage?.promptTokens).toBe(2);
    expect(result.usage?.completionTokens).toBe(3);
    expect(result.usage?.totalTokens).toBe(5);
  });

  it("falls back to the last JSON object when the first looks like JSON but is invalid", async () => {
    const result = await runCliModel({
      provider: "claude",
      prompt: "hi",
      model: "claude-sonnet",
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      config: null,
      execFileImpl: (_cmd, _args, _opts, cb) => {
        cb(
          null,
          [
            "{ this is not json",
            '{"result":"OK","usage":{"input_tokens":1,"output_tokens":2}}',
          ].join("\n"),
          "",
        );
        return { stdin: { write() {}, end() {} } } as unknown as ChildProcess;
      },
    });

    expect(result.text).toBe("OK");
    expect(result.usage?.promptTokens).toBe(1);
    expect(result.usage?.completionTokens).toBe(2);
    expect(result.usage?.totalTokens).toBe(3);
  });
});
