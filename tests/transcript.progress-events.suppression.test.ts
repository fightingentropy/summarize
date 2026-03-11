import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchYoutube: vi.fn(async () => ({
    text: null,
    source: null,
    attemptedProviders: [],
    metadata: null,
  })),
}));

vi.mock("../src/content/transcript/providers/youtube.js", () => ({
  canHandle: (ctx: { url: string }) =>
    ctx.url.includes("youtube.com") || ctx.url.includes("youtu.be"),
  fetchTranscript: mocks.fetchYoutube,
}));

import { resolveTranscriptForLink } from "../src/content/transcript/index.js";

describe("transcript progress events", () => {
  it("does not emit transcript-start/done for generic pages", async () => {
    const onProgress = vi.fn();
    const profileNames = new Set<string>();
    await resolveTranscriptForLink(
      "https://example.com",
      "<!doctype html><html><body><article><p>Hello</p></article></body></html>",
      {
        fetch: vi.fn() as unknown as typeof fetch,
        scrapeWebsite: null,
        apifyApiToken: null,
        ytDlpPath: null,
        groqApiKey: null,
        falApiKey: null,
        openaiApiKey: null,
        convertHtmlToMarkdown: null,
        transcriptCache: null,
        onProgress,
        onProfile: (event) => profileNames.add(event.name),
      },
    );
    expect(onProgress).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "transcript-start" }),
    );
    expect(onProgress).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "transcript-done" }),
    );
    expect(profileNames).not.toContain("transcript.provider.fetch");
  });

  it("still evaluates the generic provider when media transcript mode is prefer", async () => {
    const profileNames = new Set<string>();
    const result = await resolveTranscriptForLink(
      "https://example.com",
      "<!doctype html><html><body><article><p>Hello</p></article></body></html>",
      {
        fetch: vi.fn() as unknown as typeof fetch,
        scrapeWebsite: null,
        apifyApiToken: null,
        ytDlpPath: null,
        groqApiKey: null,
        falApiKey: null,
        openaiApiKey: null,
        convertHtmlToMarkdown: null,
        transcriptCache: null,
        onProfile: (event) => profileNames.add(event.name),
      },
      { mediaTranscriptMode: "prefer" },
    );

    expect(result.text).toBeNull();
    expect(profileNames).toContain("transcript.provider.fetch");
  });

  it("emits transcript-start/done for YouTube URLs", async () => {
    const onProgress = vi.fn();
    await resolveTranscriptForLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ", null, {
      fetch: vi.fn() as unknown as typeof fetch,
      scrapeWebsite: null,
      apifyApiToken: null,
      ytDlpPath: null,
      falApiKey: null,
      openaiApiKey: null,
      convertHtmlToMarkdown: null,
      transcriptCache: null,
      onProgress,
    });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ kind: "transcript-start" }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ kind: "transcript-done" }));
  });
});
