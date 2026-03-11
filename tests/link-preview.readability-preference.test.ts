import { describe, expect, it, vi } from "vitest";
import type { LinkPreviewProfileEvent } from "../src/content/index.js";
import { createLinkPreviewClient } from "../src/content/index.js";

const htmlResponse = (html: string, status = 200) =>
  new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });

describe("link preview extraction (readability preference)", () => {
  it("prefers readability HTML content over noisy nav content", async () => {
    const events: LinkPreviewProfileEvent[] = [];
    const articleText = "A".repeat(400);
    const navNoise = "Access OpenAI via web";
    const navNoise2 = "Another extremely long navigation item";
    const articleQuestion = "Is “Access OpenAI via web” enabled in Settings?";
    const articleListItem =
      "This is a long list item inside the article content that should become a bullet.";
    const html = `<!doctype html><html><head><title>Episode</title></head><body>
      <nav><ul><li>${navNoise}</li><li>${navNoise2}</li></ul></nav>
      <article>
        <h1>Settings</h1>
        <p>${articleQuestion}</p>
        <p>${articleText}</p>
        <ul><li>${articleListItem}</li></ul>
      </article>
    </body></html>`;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "https://example.com") return htmlResponse(html);
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({
      fetch: fetchMock as unknown as typeof fetch,
      onProfile: (event) => events.push(event),
    });

    const result = await client.fetchLinkContent("https://example.com", {
      timeoutMs: 2000,
      firecrawl: "off",
      format: "text",
    });

    expect(result.content).toContain(articleQuestion);
    expect(result.content).toContain(articleText);
    expect(result.content).toContain(`• ${articleListItem}`);
    expect(result.content).not.toContain(`• ${navNoise}`);
    expect(result.content).not.toContain(`• ${navNoise2}`);
    const names = new Set(events.map((event) => event.name));
    expect(names).toContain("html.article.primary");
    expect(names).toContain("html.article.extract.primary");
    expect(names).not.toContain("readability.total");
  });
});
