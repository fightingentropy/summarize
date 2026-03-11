import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/run.js";

const LIVE = process.env.SUMMARIZE_LIVE_TEST === "1";

(LIVE ? describe : describe.skip)("live destroyallsoftware talk transcript", () => {
  it("extracts embedded captions via transcript-first mode", async () => {
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

    const url = "https://www.destroyallsoftware.com/talks/the-birth-and-death-of-javascript";
    await runCli(["--json", "--extract", "--video-mode", "transcript", "--timeout", "20s", url], {
      env: { ...process.env },
      fetch: globalThis.fetch.bind(globalThis),
      stdout,
      stderr,
    });

    const parsed = JSON.parse(stdoutText) as {
      extracted: {
        content: string;
        transcriptSource: string | null;
        transcriptCharacters: number | null;
      };
    };

    expect(parsed.extracted.content.length).toBeGreaterThan(200);
    expect(parsed.extracted.transcriptCharacters ?? 0).toBeGreaterThan(0);
    expect(["embedded", "yt-dlp"]).toContain(parsed.extracted.transcriptSource);
  }, 30_000);

  it("extract-only returns transcript metadata", async () => {
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

    const url = "https://www.destroyallsoftware.com/talks/the-birth-and-death-of-javascript";
    await runCli(["--json", "--extract-only", "--video-mode", "transcript", url], {
      env: { ...process.env },
      fetch: globalThis.fetch.bind(globalThis),
      stdout,
      stderr,
    });

    const parsed = JSON.parse(stdoutText) as {
      extracted: {
        transcriptSource: string | null;
        transcriptCharacters: number | null;
        transcriptWordCount: number | null;
      };
    };

    expect(parsed.extracted.transcriptCharacters ?? 0).toBeGreaterThan(0);
    expect(parsed.extracted.transcriptWordCount ?? 0).toBeGreaterThan(0);
    expect(["embedded", "yt-dlp"]).toContain(parsed.extracted.transcriptSource);
  }, 30_000);
});
