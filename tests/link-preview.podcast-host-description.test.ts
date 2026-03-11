import { describe, expect, it, vi } from "vitest";
import { createLinkPreviewClient } from "../src/content/index.js";

const htmlResponse = (html: string, status = 200) =>
  new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });

describe("link preview extraction (podcast host description)", () => {
  it("prefers meta description on podcast hosts when page text is noisy", async () => {
    const description = "P".repeat(200);
    const navText = "Noisy listing content that should not dominate output";
    const html = `<!doctype html><html><head>
      <title>Episode</title>
      <meta name="description" content="${description}" />
    </head><body>
      <nav><ul><li>${navText}</li></ul></nav>
      <section><p>${navText} ${navText} ${navText}</p></section>
    </body></html>`;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "https://podbean.com/e/sample-episode") return htmlResponse(html);
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await client.fetchLinkContent("https://podbean.com/e/sample-episode", {
      timeoutMs: 2000,
      firecrawl: "off",
      format: "text",
    });

    expect(result.content).toContain(description);
    expect(result.content).not.toContain(navText);
  });
});
