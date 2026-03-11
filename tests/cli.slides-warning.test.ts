import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/run.js";

function collectStream() {
  let text = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  return { stream, getText: () => text };
}

const TEST_URL = "https://www.youtube.com/watch?v=abc123def45";

vi.mock("../src/run/flows/url/extract.js", () => {
  return {
    fetchLinkContentWithBirdTip: vi.fn(async () => ({
      content: "Hello from the article body.",
      title: "Test video",
      description: null,
      url: "https://www.youtube.com/watch?v=abc123def45",
      siteName: "YouTube",
      wordCount: 5,
      totalCharacters: 28,
      truncated: false,
      mediaDurationSeconds: null,
      video: null,
      isVideoOnly: false,
      transcriptSource: null,
      transcriptCharacters: null,
      transcriptWordCount: null,
      transcriptLines: null,
      transcriptMetadata: null,
      transcriptSegments: null,
      transcriptTimedText: null,
      transcriptionProvider: null,
      diagnostics: {
        strategy: "html",
        websiteScrape: {
          attempted: false,
          used: false,
          provider: null,
          cacheMode: "bypassed",
          cacheStatus: "bypassed",
          notes: null,
        },
        markdown: {
          requested: false,
          used: false,
          provider: null,
          notes: null,
        },
        transcript: {
          cacheMode: "bypassed",
          cacheStatus: "bypassed",
          textProvided: false,
          provider: null,
          attemptedProviders: [],
          notes: null,
        },
      },
    })),
    deriveExtractionUi: () => ({
      contentSizeLabel: "28 B",
      viaSourceLabel: "",
      footerParts: ["html"],
      finishSourceLabel: "html",
    }),
    logExtractionDiagnostics: () => {},
  };
});

vi.mock("../src/slides/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/slides/index.js")>();
  return {
    ...actual,
    extractSlidesForSource: vi.fn(async () => {
      throw new Error("Missing ffmpeg (install ffmpeg or add it to PATH).");
    }),
    resolveSlideSource: () => ({
      url: "https://www.youtube.com/watch?v=abc123def45",
      kind: "youtube",
      sourceId: "abc123def45",
    }),
    validateSlidesCache: async () => null,
  };
});

describe("--slides dependency warning", () => {
  it("warns when slide extraction dependencies are missing in summary mode", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-slides-warning-"));
    const stdout = collectStream();
    const stderr = collectStream();

    await runCli([TEST_URL, "--plain", "--timeout", "2s", "--slides"], {
      env: { HOME: root },
      fetch: globalThis.fetch.bind(globalThis),
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stderr.getText()).toContain(
      "--slides could not extract slide images: Missing ffmpeg (install ffmpeg or add it to PATH).",
    );
    expect(stderr.getText()).toContain(
      "Install ffmpeg + yt-dlp for --slides. macOS uses Vision OCR for --slides-ocr; source/dev builds may need Xcode Command Line Tools.",
    );
    expect(stdout.getText()).toContain("Hello from the article body.");
  });
});
