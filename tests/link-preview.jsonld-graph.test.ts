import { describe, expect, it, vi } from "vitest";
import { createLinkPreviewClient } from "../src/content/index.js";

const htmlResponse = (html: string, status = 200) =>
  new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });

describe("link preview extraction (json-ld graph)", () => {
  it("selects the longest description across @graph entries", async () => {
    const shortDescription = "Short summary.";
    const longDescription = "L".repeat(240);

    const jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "PodcastEpisode",
          name: "Episode Short",
          description: shortDescription,
        },
        {
          "@type": "Article",
          headline: "Longform piece",
          description: longDescription,
        },
      ],
    });

    const html = `<!doctype html><html><head>
      <title>Example</title>
      <script type="application/ld+json">${jsonLd}</script>
    </head><body>
      <p>Fallback body text that should not win.</p>
    </body></html>`;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "https://example.com/graph") return htmlResponse(html);
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await client.fetchLinkContent("https://example.com/graph", {
      timeoutMs: 2000,
      firecrawl: "off",
      format: "text",
    });

    expect(result.content).toContain(longDescription);
    expect(result.content).not.toContain(shortDescription);
  });
});
