import { describe, expect, it } from "vitest";
import type { LinkPreviewProfileEvent } from "../src/content/index.js";
import { createLinkPreviewClient } from "../src/content/index.js";

const htmlResponse = (html: string, status = 200) =>
  new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });

describe("link preview profiling", () => {
  it("emits phase timings for HTML extraction", async () => {
    const events: LinkPreviewProfileEvent[] = [];
    const html = `<!doctype html><html><head><title>Hello</title></head><body><article><h1>Hello</h1><p>${"A".repeat(
      320,
    )}</p></article></body></html>`;

    const fetchMock = async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "https://example.com") {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    };

    const client = createLinkPreviewClient({
      fetch: fetchMock as unknown as typeof fetch,
      onProfile: (event) => events.push(event),
    });

    const result = await client.fetchLinkContent("https://example.com", {
      timeoutMs: 2000,
      firecrawl: "off",
      format: "text",
    });

    expect(result.content.length).toBeGreaterThan(200);
    const names = new Set(events.map((event) => event.name));
    expect(names).toContain("fetch.html.total");
    expect(names).toContain("html.total");
    expect(names).toContain("html.article.primary");
    expect(names).toContain("html.article.extract.primary");
    expect(names).not.toContain("readability.total");
    expect(names).toContain("transcript.total");
    for (const event of events) {
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
