import { describe, expect, it, vi } from "vitest";
import { createWebsiteScraperChain } from "../src/website-scrapers.js";

describe("website scraper chain", () => {
  it("prefers Exa before Cloudflare and Firecrawl", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "https://api.exa.ai/contents") {
        return new Response(
          JSON.stringify({
            results: [{ text: "Hello from Exa", title: "Exa title", url: "https://example.com" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const scrape = createWebsiteScraperChain({
      fetchImpl: fetchMock as unknown as typeof fetch,
      exaApiKey: "exa-key",
      cloudflareApiToken: "cf-key",
      cloudflareAccountId: "cf-account",
      firecrawlApiKey: "firecrawl-key",
    });

    const result = await scrape?.("https://example.com", { timeoutMs: 2000 });
    expect(result?.provider).toBe("exa");
    expect(result?.markdown).toContain("Hello from Exa");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
