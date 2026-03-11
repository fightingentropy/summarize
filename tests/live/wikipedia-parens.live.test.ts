import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/run.js";

const LIVE = process.env.SUMMARIZE_LIVE_TEST === "1";

(LIVE ? describe : describe.skip)("live wikipedia parentheses url", () => {
  it("preserves parentheses in URL paths", async () => {
    let stdoutText = "";
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutText += chunk.toString();
        callback();
      },
    });
    const stderr = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    const url = "https://en.wikipedia.org/wiki/Set_(mathematics)";
    await runCli(["--json", "--extract-only", "--timeout", "20s", url], {
      env: { ...process.env },
      fetch: globalThis.fetch.bind(globalThis),
      stdout,
      stderr,
    });

    const parsed = JSON.parse(stdoutText) as {
      input: { url: string };
      extracted: { content: string };
    };
    expect(parsed.input.url).toBe(url);
    expect(parsed.extracted.content.length).toBeGreaterThan(0);
  }, 30_000);
});
