import { describe, expect, it, vi } from "vitest";
import {
  fetchHtmlDocument,
  fetchWithWebsiteScraper,
} from "../src/content/link-preview/content/fetcher.js";

const htmlResponse = (html: string, status = 200) =>
  new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });

describe("link preview fetcher", () => {
  it("does not request compressed HTML outside Bun", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["Accept-Encoding"]).toBeUndefined();
      return htmlResponse("<html>ok</html>");
    });

    const result = await fetchHtmlDocument(
      fetchMock as unknown as typeof fetch,
      "https://example.com",
    );

    expect(result.html).toContain("ok");
  });

  it("throws when HTML response is non-2xx", async () => {
    const fetchMock = vi.fn(async () => htmlResponse("<html></html>", 403));
    await expect(
      fetchHtmlDocument(fetchMock as unknown as typeof fetch, "https://example.com"),
    ).rejects.toThrow("Failed to fetch HTML document (status 403)");
  });

  it("returns the final URL when fetch follows redirects", async () => {
    const response = htmlResponse("<html>ok</html>");
    Object.defineProperty(response, "url", {
      value: "https://summarize.sh/",
      configurable: true,
    });
    const fetchMock = vi.fn(async () => response);

    const result = await fetchHtmlDocument(
      fetchMock as unknown as typeof fetch,
      "https://t.co/abc",
    );

    expect(result.finalUrl).toBe("https://summarize.sh/");
    expect(result.html).toContain("ok");
  });

  it("throws a timeout error when HTML fetch is aborted", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise((_resolve, reject) => {
          if (!signal) {
            reject(new Error("Missing abort signal"));
            return;
          }
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }) as Promise<Response>;
      });

      const promise = fetchHtmlDocument(
        fetchMock as unknown as typeof fetch,
        "https://example.com",
        {
          timeoutMs: 10,
        },
      );
      const assertion = expect(promise).rejects.toThrow("Fetching HTML document timed out");
      await vi.advanceTimersByTimeAsync(20);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries with identity encoding for Bun decompression errors", async () => {
    const originalBun = Object.getOwnPropertyDescriptor(globalThis, "Bun");
    Object.defineProperty(globalThis, "Bun", {
      value: {},
      configurable: true,
    });

    try {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        if (fetchMock.mock.calls.length === 1) {
          expect(headers["Accept-Encoding"]).toBe("gzip, deflate");
          throw new Error("ZlibError: ShortRead");
        }
        expect(headers["Accept-Encoding"]).toBe("identity");
        return htmlResponse("<html>retry ok</html>");
      });

      const result = await fetchHtmlDocument(
        fetchMock as unknown as typeof fetch,
        "https://example.com",
      );

      expect(result.html).toContain("retry ok");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      if (originalBun) {
        Object.defineProperty(globalThis, "Bun", originalBun);
      } else {
        Reflect.deleteProperty(globalThis, "Bun");
      }
    }
  });

  it("skips Firecrawl for YouTube URLs", async () => {
    const scrape = vi.fn(async () => ({
      markdown: "# nope",
      html: null,
      metadata: null,
    }));

    const result = await fetchWithWebsiteScraper(
      "https://www.youtube.com/watch?v=abcdefghijk",
      scrape as unknown as typeof scrape,
    );

    expect(result.payload).toBeNull();
    expect(result.diagnostics.attempted).toBe(false);
    expect(result.diagnostics.notes).toContain("Skipped website scraper for YouTube URL");
  });

  it("returns diagnostics when the website scraper is not configured", async () => {
    const result = await fetchWithWebsiteScraper("https://example.com", null);
    expect(result.payload).toBeNull();
    expect(result.diagnostics.attempted).toBe(false);
    expect(result.diagnostics.notes).toContain("Website scraper is not configured");
  });

  it("records diagnostics when the website scraper returns null", async () => {
    const scrape = vi.fn(async () => null);
    const result = await fetchWithWebsiteScraper("https://example.com", scrape, { timeoutMs: 1 });
    expect(result.payload).toBeNull();
    expect(result.diagnostics.attempted).toBe(true);
    expect(result.diagnostics.notes).toContain("Website scraper returned no content payload");
  });

  it("records diagnostics when the website scraper throws", async () => {
    const scrape = vi.fn(async () => {
      throw new Error("boom");
    });
    const result = await fetchWithWebsiteScraper("https://example.com", scrape, { timeoutMs: 1 });
    expect(result.payload).toBeNull();
    expect(result.diagnostics.attempted).toBe(true);
    expect(result.diagnostics.notes).toContain("Website scraper error: boom");
  });
});
