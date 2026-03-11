import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/run.js";

const LIVE = process.env.SUMMARIZE_LIVE_TEST === "1";

(LIVE ? describe : describe.skip)("live prompt length cap", () => {
  it("caps prompt guidance to extracted content length", async () => {
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

    await runCli(
      ["--json", "--extract-only", "--length", "xxl", "--timeout", "10s", "https://example.com"],
      {
        env: { ...process.env },
        fetch: globalThis.fetch.bind(globalThis),
        stdout,
        stderr,
      },
    );

    const parsed = JSON.parse(stdoutText) as { prompt: string; extracted: { content: string } };
    expect(parsed.prompt).toContain(
      `Extracted content length: ${parsed.extracted.content.length} characters`,
    );
  }, 20_000);
});
