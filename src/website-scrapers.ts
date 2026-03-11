import type { WebsiteScrapeResult, ScrapeWebsite } from "summarize-core/content";
import { createFirecrawlScraper } from "./firecrawl.js";

type ExaContentsResponse = {
  results?: Array<{
    text?: string | null;
    title?: string | null;
    url?: string | null;
    publishedDate?: string | null;
    author?: string | null;
  }>;
  error?: string | null;
};

type CloudflareMarkdownResponse = {
  success?: boolean;
  result?:
    | string
    | {
        markdown?: string | null;
        content?: string | null;
        text?: string | null;
      }
    | null;
  errors?: Array<{ message?: string | null }> | null;
  messages?: Array<{ message?: string | null }> | null;
};

function withTimeout(timeoutMs?: number): { signal: AbortSignal; clear: () => void } | null {
  const hasTimeout = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0;
  if (!hasTimeout) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

export function createExaScraper({
  apiKey,
  fetchImpl,
}: {
  apiKey: string;
  fetchImpl: typeof fetch;
}): ScrapeWebsite {
  return async (
    url: string,
    options?: { timeoutMs?: number },
  ): Promise<WebsiteScrapeResult | null> => {
    const timeout = withTimeout(options?.timeoutMs);
    try {
      const response = await fetchImpl("https://api.exa.ai/contents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        ...(timeout ? { signal: timeout.signal } : {}),
        body: JSON.stringify({
          urls: [url],
          text: true,
          livecrawl: "always",
        }),
      });

      const payload = (await response.json().catch(() => null)) as ExaContentsResponse | null;
      if (!response.ok) {
        const message = payload?.error ? `: ${payload.error}` : "";
        throw new Error(`Exa contents request failed (${response.status})${message}`);
      }

      const result = Array.isArray(payload?.results) ? payload.results[0] : null;
      const markdown = result?.text?.trim() ?? "";
      if (markdown.length === 0) return null;

      return {
        markdown,
        metadata: {
          title: result?.title ?? null,
          url: result?.url ?? url,
          publishedDate: result?.publishedDate ?? null,
          author: result?.author ?? null,
        },
        provider: "exa",
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Exa contents request timed out");
      }
      throw error;
    } finally {
      timeout?.clear();
    }
  };
}

export function createCloudflareScraper({
  apiToken,
  accountId,
  fetchImpl,
}: {
  apiToken: string;
  accountId: string;
  fetchImpl: typeof fetch;
}): ScrapeWebsite {
  return async (
    url: string,
    options?: { timeoutMs?: number },
  ): Promise<WebsiteScrapeResult | null> => {
    const timeout = withTimeout(options?.timeoutMs);
    try {
      const response = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/markdown`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          ...(timeout ? { signal: timeout.signal } : {}),
          body: JSON.stringify({ url }),
        },
      );

      const payload = (await response
        .json()
        .catch(() => null)) as CloudflareMarkdownResponse | null;
      if (!response.ok || payload?.success === false) {
        const message =
          payload?.errors
            ?.map((entry) => entry?.message?.trim())
            .filter(Boolean)
            .join("; ") ??
          payload?.messages
            ?.map((entry) => entry?.message?.trim())
            .filter(Boolean)
            .join("; ") ??
          "";
        const suffix = message ? `: ${message}` : "";
        throw new Error(`Cloudflare markdown request failed (${response.status})${suffix}`);
      }

      const rawResult = payload?.result;
      const markdown =
        typeof rawResult === "string"
          ? rawResult.trim()
          : typeof rawResult?.markdown === "string"
            ? rawResult.markdown.trim()
            : typeof rawResult?.content === "string"
              ? rawResult.content.trim()
              : typeof rawResult?.text === "string"
                ? rawResult.text.trim()
                : "";
      if (markdown.length === 0) return null;

      return {
        markdown,
        provider: "cloudflare",
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Cloudflare markdown request timed out");
      }
      throw error;
    } finally {
      timeout?.clear();
    }
  };
}

export function createWebsiteScraperChain({
  fetchImpl,
  exaApiKey,
  cloudflareApiToken,
  cloudflareAccountId,
  firecrawlApiKey,
}: {
  fetchImpl: typeof fetch;
  exaApiKey?: string | null;
  cloudflareApiToken?: string | null;
  cloudflareAccountId?: string | null;
  firecrawlApiKey?: string | null;
}): ScrapeWebsite | null {
  const scrapers: ScrapeWebsite[] = [];

  if (typeof exaApiKey === "string" && exaApiKey.trim().length > 0) {
    scrapers.push(createExaScraper({ apiKey: exaApiKey.trim(), fetchImpl }));
  }
  if (
    typeof cloudflareApiToken === "string" &&
    cloudflareApiToken.trim().length > 0 &&
    typeof cloudflareAccountId === "string" &&
    cloudflareAccountId.trim().length > 0
  ) {
    scrapers.push(
      createCloudflareScraper({
        apiToken: cloudflareApiToken.trim(),
        accountId: cloudflareAccountId.trim(),
        fetchImpl,
      }),
    );
  }
  if (typeof firecrawlApiKey === "string" && firecrawlApiKey.trim().length > 0) {
    scrapers.push(createFirecrawlScraper({ apiKey: firecrawlApiKey.trim(), fetchImpl }));
  }

  if (scrapers.length === 0) return null;

  return async (
    url: string,
    options?: { cacheMode?: "default" | "bypass"; timeoutMs?: number },
  ): Promise<WebsiteScrapeResult | null> => {
    for (const scraper of scrapers) {
      try {
        const payload = await scraper(url, options);
        if (payload?.markdown?.trim()) {
          return payload;
        }
      } catch {
        // Try the next provider in the fallback chain.
      }
    }
    return null;
  };
}
