import { describe, expect, it, vi } from "vitest";
import { createLinkPreviewClient } from "../src/content/index.js";

const htmlResponse = (html: string, status = 200) =>
  new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });

describe("link preview extraction (non-podcast host description)", () => {
  it("keeps extracted body when description is short", async () => {
    const description = "Short description.";
    const bodyText = "B".repeat(260);
    const html = `<!doctype html><html><head>
      <title>Article</title>
      <meta name="description" content="${description}" />
    </head><body>
      <article><p>${bodyText}</p></article>
    </body></html>`;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "https://example.com/article") return htmlResponse(html);
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await client.fetchLinkContent("https://example.com/article", {
      timeoutMs: 2000,
      firecrawl: "off",
      format: "text",
    });

    expect(result.content).toContain(bodyText);
    expect(result.content).not.toContain(description);
  });
});
