import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveTranscriptForLink: vi.fn(),
}));

vi.mock("../packages/core/src/content/transcript/index.js", () => ({
  resolveTranscriptForLink: mocks.resolveTranscriptForLink,
}));

import { fetchLinkContent } from "../packages/core/src/content/link-preview/content/index.js";

const buildDeps = (fetchImpl: typeof fetch) => ({
  fetch: fetchImpl,
  scrapeWebsite: null,
  apifyApiToken: "TOKEN",
  ytDlpPath: "/usr/bin/yt-dlp",
  groqApiKey: null,
  falApiKey: null,
  openaiApiKey: "OPENAI",
  convertHtmlToMarkdown: null,
  transcriptCache: null,
  readTweetWithBird: null,
  resolveTwitterCookies: null,
  onProgress: null,
});

describe("link preview YouTube explicit transcript short-circuit", () => {
  beforeEach(() => {
    mocks.resolveTranscriptForLink.mockReset();
  });

  it("skips watch HTML fetch when apify transcript succeeds", async () => {
    mocks.resolveTranscriptForLink.mockResolvedValueOnce({
      text: "Apify transcript",
      source: "apify",
      metadata: { durationSeconds: 123 },
      diagnostics: {
        cacheMode: "default",
        cacheStatus: "miss",
        textProvided: true,
        provider: "apify",
        attemptedProviders: ["apify"],
        notes: null,
      },
      segments: null,
    });

    const fetchMock = vi.fn(async () => {
      throw new Error("watch HTML fetch should not happen");
    });

    const result = await fetchLinkContent(
      "https://www.youtube.com/watch?v=abcdefghijk",
      { format: "text", youtubeTranscript: "apify" },
      buildDeps(fetchMock as unknown as typeof fetch),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.resolveTranscriptForLink).toHaveBeenCalledTimes(1);
    expect(mocks.resolveTranscriptForLink).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=abcdefghijk",
      null,
      expect.any(Object),
      expect.objectContaining({ youtubeTranscriptMode: "apify" }),
    );
    expect(result.siteName).toBe("YouTube");
    expect(result.transcriptSource).toBe("apify");
    expect(result.content).toContain("Apify transcript");
    expect(result.mediaDurationSeconds).toBe(123);
    expect(result.diagnostics.websiteScrape.notes).toContain("skipped watch HTML");
  });

  it("skips watch HTML fetch when yt-dlp transcript succeeds", async () => {
    mocks.resolveTranscriptForLink.mockResolvedValueOnce({
      text: "yt-dlp transcript",
      source: "yt-dlp",
      metadata: { durationSeconds: 321, transcriptionProvider: "openai" },
      diagnostics: {
        cacheMode: "default",
        cacheStatus: "miss",
        textProvided: true,
        provider: "yt-dlp",
        attemptedProviders: ["yt-dlp"],
        notes: null,
      },
      segments: null,
    });

    const fetchMock = vi.fn(async () => {
      throw new Error("watch HTML fetch should not happen");
    });

    const result = await fetchLinkContent(
      "https://www.youtube.com/watch?v=abcdefghijk",
      { format: "text", youtubeTranscript: "yt-dlp" },
      buildDeps(fetchMock as unknown as typeof fetch),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.resolveTranscriptForLink).toHaveBeenCalledTimes(1);
    expect(result.transcriptSource).toBe("yt-dlp");
    expect(result.transcriptionProvider).toBe("openai");
    expect(result.content).toContain("yt-dlp transcript");
    expect(result.mediaDurationSeconds).toBe(321);
  });

  it("reuses the first explicit transcript attempt when it falls back to HTML", async () => {
    mocks.resolveTranscriptForLink.mockResolvedValueOnce({
      text: null,
      source: "unavailable",
      metadata: null,
      diagnostics: {
        cacheMode: "default",
        cacheStatus: "miss",
        textProvided: false,
        provider: "unavailable",
        attemptedProviders: ["apify", "unavailable"],
        notes: null,
      },
      segments: null,
    });

    const html =
      "<!doctype html><html><head><title>Sample</title>" +
      '<script>var ytInitialPlayerResponse = {"videoDetails":{"shortDescription":"Line one\\n\\nLine two"}};</script>' +
      "</head><body><main><p>Fallback paragraph</p></main></body></html>";
    const fetchMock = vi.fn(
      async () => new Response(html, { status: 200, headers: { "Content-Type": "text/html" } }),
    );

    const result = await fetchLinkContent(
      "https://www.youtube.com/watch?v=abcdefghijk",
      { format: "text", youtubeTranscript: "apify" },
      buildDeps(fetchMock as unknown as typeof fetch),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.resolveTranscriptForLink).toHaveBeenCalledTimes(1);
    expect(result.transcriptSource).toBe("unavailable");
    expect(result.content).toBe("Line one\nLine two");
  });
});
