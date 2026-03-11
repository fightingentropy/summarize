import { describe, expect, it, vi } from "vitest";
import {
  fetchHtmlDocument,
  fetchWithWebsiteScraper,
} from "../packages/core/src/content/link-preview/content/fetcher.js";

describe("link preview fetcher - more branches", () => {
  it("stops reading YouTube watch HTML once the head contains a player payload", async () => {
    const playerHead =
      "<!doctype html><html><head><title>Sample</title>" +
      '<script>ytcfg.set({"INNERTUBE_API_KEY":"TEST_KEY"})</script>' +
      '<script>var ytInitialPlayerResponse = {"videoDetails":{"shortDescription":"Hello world"}};</script>' +
      "</head>";
    const firstChunk = `${playerHead}${" ".repeat(70 * 1024)}`;
    const secondChunk = `<body>${"x".repeat(32 * 1024)}</body></html>`;

    let readCalls = 0;
    const cancel = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        headers: new Headers({
          "content-type": "text/html",
          "content-length": String(firstChunk.length + secondChunk.length),
        }),
        body: {
          getReader: () => ({
            read: async () => {
              readCalls += 1;
              if (readCalls === 1) {
                return { done: false, value: new TextEncoder().encode(firstChunk) };
              }
              if (readCalls === 2) {
                return { done: false, value: new TextEncoder().encode(secondChunk) };
              }
              return { done: true, value: undefined as unknown as Uint8Array };
            },
            cancel,
          }),
        },
      } as unknown as Response;
    });

    const result = await fetchHtmlDocument(
      fetchMock as unknown as typeof fetch,
      "https://www.youtube.com/watch?v=abcdefghijk",
    );

    expect(result.html).toBe(firstChunk);
    expect(result.partial).toBe(true);
    expect(readCalls).toBe(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("stops reading YouTube watch HTML once a consent or bot interstitial is obvious", async () => {
    const firstChunk =
      "<!doctype html><html><head><title>Before you continue to YouTube</title></head>" +
      `<body>Before you continue to YouTube. consent.youtube.com ${" ".repeat(70 * 1024)}</body>`;
    const secondChunk = `<div>${"x".repeat(32 * 1024)}</div></html>`;

    let readCalls = 0;
    const cancel = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        headers: new Headers({
          "content-type": "text/html",
          "content-length": String(firstChunk.length + secondChunk.length),
        }),
        body: {
          getReader: () => ({
            read: async () => {
              readCalls += 1;
              if (readCalls === 1) {
                return { done: false, value: new TextEncoder().encode(firstChunk) };
              }
              if (readCalls === 2) {
                return { done: false, value: new TextEncoder().encode(secondChunk) };
              }
              return { done: true, value: undefined as unknown as Uint8Array };
            },
            cancel,
          }),
        },
      } as unknown as Response;
    });

    const result = await fetchHtmlDocument(
      fetchMock as unknown as typeof fetch,
      "https://www.youtube.com/watch?v=abcdefghijk",
    );

    expect(result.html).toBe(firstChunk);
    expect(result.partial).toBe(true);
    expect(readCalls).toBe(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("falls back to a full YouTube HTML read when no player payload is found", async () => {
    const firstChunk =
      "<!doctype html><html><head><title>Sample</title>" +
      '<script>ytcfg.set({"INNERTUBE_API_KEY":"TEST_KEY"})</script>' +
      `${" ".repeat(70 * 1024)}`;
    const secondChunk = "</head><body>done</body></html>";

    let readCalls = 0;
    const cancel = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        headers: new Headers({
          "content-type": "text/html",
          "content-length": String(firstChunk.length + secondChunk.length),
        }),
        body: {
          getReader: () => ({
            read: async () => {
              readCalls += 1;
              if (readCalls === 1) {
                return { done: false, value: new TextEncoder().encode(firstChunk) };
              }
              if (readCalls === 2) {
                return { done: false, value: new TextEncoder().encode(secondChunk) };
              }
              return { done: true, value: undefined as unknown as Uint8Array };
            },
            cancel,
          }),
        },
      } as unknown as Response;
    });

    const result = await fetchHtmlDocument(
      fetchMock as unknown as typeof fetch,
      "https://www.youtube.com/watch?v=abcdefghijk",
    );

    expect(result.html).toBe(`${firstChunk}${secondChunk}`);
    expect(result.partial).toBeFalsy();
    expect(readCalls).toBe(3);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("throws on non-OK response and unsupported content-type", async () => {
    await expect(
      fetchHtmlDocument(
        vi.fn(
          async () =>
            new Response("nope", { status: 403, headers: { "content-type": "text/html" } }),
        ) as unknown as typeof fetch,
        "https://example.com",
      ),
    ).rejects.toThrow(/status 403/);

    await expect(
      fetchHtmlDocument(
        vi.fn(
          async () =>
            new Response("nope", { status: 200, headers: { "content-type": "application/pdf" } }),
        ) as unknown as typeof fetch,
        "https://example.com",
      ),
    ).rejects.toThrow(/Unsupported content-type/);
  });

  it("handles missing body, streaming bodies, and abort errors", async () => {
    const events: Array<{ kind: string }> = [];
    const fetchNoBody = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html", "content-length": "3" }),
        body: null,
        async text() {
          return "abc";
        },
      } as unknown as Response;
    });
    const htmlResult = await fetchHtmlDocument(
      fetchNoBody as unknown as typeof fetch,
      "https://example.com",
      {
        onProgress: (e) => events.push(e as { kind: string }),
      },
    );
    expect(htmlResult.html).toBe("abc");
    expect(events.some((e) => e.kind === "fetch-html-done")).toBe(true);

    const reader = (() => {
      let i = 0;
      return {
        async read() {
          i += 1;
          if (i === 1) return { done: false, value: undefined as unknown as Uint8Array };
          if (i === 2) return { done: false, value: new TextEncoder().encode("hi") };
          return { done: true, value: undefined as unknown as Uint8Array };
        },
      };
    })();
    const fetchStream = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        body: { getReader: () => reader },
      } as unknown as Response;
    });
    const streamed = await fetchHtmlDocument(
      fetchStream as unknown as typeof fetch,
      "https://example.com",
    );
    expect(streamed.html).toContain("hi");

    const abortingFetch = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      fetchHtmlDocument(abortingFetch as unknown as typeof fetch, "https://example.com", {
        timeoutMs: 1,
      }),
    ).rejects.toThrow(/timed out/);
  });

  it("does not retry decompression errors outside Bun", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ZlibError: ShortRead");
    });

    await expect(
      fetchHtmlDocument(fetchMock as unknown as typeof fetch, "https://example.com"),
    ).rejects.toThrow("ZlibError: ShortRead");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("covers Firecrawl skip/no-config/no-payload/success/error branches", async () => {
    const progress: Array<{ kind: string; ok?: boolean }> = [];
    const onProgress = (e: unknown) => progress.push(e as { kind: string; ok?: boolean });

    const youtube = await fetchWithWebsiteScraper("https://www.youtube.com/watch?v=abc", null, {
      onProgress,
    });
    expect(youtube.payload).toBeNull();
    expect(youtube.diagnostics.notes).toContain("Skipped website scraper");

    const noConfig = await fetchWithWebsiteScraper("https://example.com", null, { onProgress });
    expect(noConfig.payload).toBeNull();
    expect(noConfig.diagnostics.notes).toContain("not configured");

    const noPayload = await fetchWithWebsiteScraper(
      "https://example.com",
      vi.fn(async () => null) as unknown as NonNullable<
        Parameters<typeof fetchWithWebsiteScraper>[1]
      >,
      { onProgress, reason: "test" },
    );
    expect(noPayload.payload).toBeNull();
    expect(progress.some((e) => e.kind === "firecrawl-done" && e.ok === false)).toBe(true);

    const okPayload = await fetchWithWebsiteScraper(
      "https://example.com",
      vi.fn(async () => ({ markdown: "# hi", html: null })) as unknown as NonNullable<
        Parameters<typeof fetchWithWebsiteScraper>[1]
      >,
      { onProgress },
    );
    expect(okPayload.payload).not.toBeNull();
    expect(progress.some((e) => e.kind === "firecrawl-done" && e.ok === true)).toBe(true);

    const okHtmlOnly = await fetchWithWebsiteScraper(
      "https://example.com",
      vi.fn(async () => ({ markdown: null, html: "<p>hi</p>" })) as unknown as NonNullable<
        Parameters<typeof fetchWithWebsiteScraper>[1]
      >,
      { onProgress, cacheMode: "bypass" },
    );
    expect(okHtmlOnly.payload).not.toBeNull();
    expect(okHtmlOnly.diagnostics.cacheStatus).toBe("bypassed");

    const errorPayload = await fetchWithWebsiteScraper(
      "https://example.com",
      vi.fn(async () => {
        throw new Error("boom");
      }) as unknown as NonNullable<Parameters<typeof fetchWithWebsiteScraper>[1]>,
      { onProgress },
    );
    expect(errorPayload.payload).toBeNull();
    expect(errorPayload.diagnostics.notes).toContain("Website scraper error");
  });
});
