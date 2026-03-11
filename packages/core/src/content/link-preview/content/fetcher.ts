import {
  isBunCompressedResponseError,
  withBunCompressionHeaders,
  withBunIdentityEncoding,
} from "../../bun.js";
import { isYouTubeUrl } from "../../url.js";
import type {
  WebsiteScrapeResult,
  LinkPreviewProgressEvent,
  LinkPreviewProfileSink,
  ScrapeWebsite,
} from "../deps.js";
import { measureAsyncProfile } from "../profiling.js";
import type { CacheMode, WebsiteScrapeDiagnostics } from "../types.js";
import { appendNote } from "./utils.js";
import { hasCompleteYouTubeWatchBootstrap, hasYouTubeBlockingInterstitial } from "./youtube.js";

const REQUEST_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const YOUTUBE_EARLY_STOP_CHECK_BYTES = 64 * 1024;

export interface FirecrawlFetchResult {
  payload: WebsiteScrapeResult | null;
  diagnostics: WebsiteScrapeDiagnostics;
}

export interface HtmlDocumentFetchResult {
  html: string;
  finalUrl: string;
  partial?: boolean;
}

async function fetchHtmlOnce(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  {
    timeoutMs,
    onProgress,
    onProfile,
    profileName = "fetch.html",
  }: {
    timeoutMs?: number;
    onProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
    onProfile?: LinkPreviewProfileSink | null;
    profileName?: string;
  } = {},
): Promise<HtmlDocumentFetchResult> {
  return await measureAsyncProfile(
    {
      sink: onProfile,
      name: profileName,
      url,
      onSuccessDetails: (result) => ({
        finalUrl: result.finalUrl,
        htmlChars: result.html.length,
        partial: result.partial === true,
      }),
      onErrorDetails: (error) => ({
        error: error instanceof Error ? error.message : String(error),
      }),
    },
    async () => {
      onProgress?.({ kind: "fetch-html-start", url });

      const controller = new AbortController();
      const effectiveTimeoutMs =
        typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
          ? timeoutMs
          : DEFAULT_REQUEST_TIMEOUT_MS;
      const timeout = setTimeout(() => {
        controller.abort();
      }, effectiveTimeoutMs);

      try {
        const response = await fetchImpl(url, {
          headers,
          redirect: "follow",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch HTML document (status ${response.status})`);
        }

        const finalUrl = response.url?.trim() || url;

        const contentType = response.headers.get("content-type")?.toLowerCase() ?? null;
        if (
          contentType &&
          !contentType.includes("text/html") &&
          !contentType.includes("application/xhtml+xml") &&
          !contentType.includes("application/xml") &&
          !contentType.includes("text/xml") &&
          !contentType.includes("application/rss+xml") &&
          !contentType.includes("application/atom+xml") &&
          !contentType.startsWith("text/")
        ) {
          throw new Error(`Unsupported content-type for HTML document fetch: ${contentType}`);
        }

        const totalBytes = (() => {
          const raw = response.headers.get("content-length");
          if (!raw) return null;
          const parsed = Number(raw);
          return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
        })();

        const body = response.body;
        if (!body) {
          const text = await response.text();
          const bytes = new TextEncoder().encode(text).byteLength;
          onProgress?.({ kind: "fetch-html-done", url, downloadedBytes: bytes, totalBytes });
          return { html: text, finalUrl };
        }

        const reader = body.getReader();
        const decoder = new TextDecoder();
        let downloadedBytes = 0;
        let text = "";
        let partial = false;
        const shouldAttemptYouTubeEarlyStop = isYouTubeUrl(finalUrl);

        onProgress?.({ kind: "fetch-html-progress", url, downloadedBytes: 0, totalBytes });

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          downloadedBytes += value.byteLength;
          text += decoder.decode(value, { stream: true });
          onProgress?.({ kind: "fetch-html-progress", url, downloadedBytes, totalBytes });

          if (
            shouldAttemptYouTubeEarlyStop &&
            downloadedBytes >= YOUTUBE_EARLY_STOP_CHECK_BYTES &&
            (hasCompleteYouTubeWatchBootstrap(text) || hasYouTubeBlockingInterstitial(text))
          ) {
            partial = true;
            await reader.cancel();
            break;
          }
        }

        text += decoder.decode();
        onProgress?.({ kind: "fetch-html-done", url, downloadedBytes, totalBytes });
        return { html: text, finalUrl, partial };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new Error("Fetching HTML document timed out");
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  );
}

export async function fetchHtmlDocument(
  fetchImpl: typeof fetch,
  url: string,
  options: {
    timeoutMs?: number;
    onProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
    onProfile?: LinkPreviewProfileSink | null;
  } = {},
): Promise<HtmlDocumentFetchResult> {
  return await measureAsyncProfile(
    {
      sink: options.onProfile,
      name: "fetch.html.total",
      url,
      onSuccessDetails: (result) => ({
        finalUrl: result.finalUrl,
        htmlChars: result.html.length,
        partial: result.partial === true,
      }),
      onErrorDetails: (error) => ({
        error: error instanceof Error ? error.message : String(error),
      }),
    },
    async () => {
      try {
        return await fetchHtmlOnce(fetchImpl, url, withBunCompressionHeaders(REQUEST_HEADERS), {
          ...options,
          profileName: "fetch.html.compressed",
        });
      } catch (error) {
        // Bun's fetch has known bugs where its streaming zlib decompression throws
        // ZlibError / ShortRead on certain chunked+compressed responses. Retry the
        // request asking the server to skip compression entirely.
        // https://github.com/oven-sh/bun/issues/23149
        if (isBunCompressedResponseError(error)) {
          const uncompressedHeaders = withBunIdentityEncoding(REQUEST_HEADERS);
          return await fetchHtmlOnce(fetchImpl, url, uncompressedHeaders, {
            ...options,
            profileName: "fetch.html.identity",
          });
        }
        throw error;
      }
    },
  );
}

export async function fetchWithWebsiteScraper(
  url: string,
  scrapeWebsite: ScrapeWebsite | null,
  options: {
    timeoutMs?: number;
    cacheMode?: CacheMode;
    onProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
    onProfile?: LinkPreviewProfileSink | null;
    reason?: string | null;
  } = {},
): Promise<FirecrawlFetchResult> {
  const timeoutMs = options.timeoutMs;
  const cacheMode: CacheMode = options.cacheMode ?? "default";
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const onProfile = typeof options.onProfile === "function" ? options.onProfile : null;
  const reason = typeof options.reason === "string" ? options.reason : null;
  const diagnostics: WebsiteScrapeDiagnostics = {
    attempted: false,
    used: false,
    cacheMode,
    cacheStatus: cacheMode === "bypass" ? "bypassed" : "unknown",
    provider: null,
    notes: null,
  };

  return await measureAsyncProfile(
    {
      sink: onProfile,
      name: "firecrawl.fetch",
      url,
      details: { cacheMode, reason: reason ?? "firecrawl" },
      onSuccessDetails: (result) => ({
        attempted: result.diagnostics.attempted,
        used: result.diagnostics.used,
        hasPayload: Boolean(result.payload),
        markdownChars: result.payload?.markdown?.length ?? null,
        htmlChars: result.payload?.html?.length ?? null,
      }),
    },
    async () => {
      if (isYouTubeUrl(url)) {
        diagnostics.notes = appendNote(
          diagnostics.notes,
          "Skipped website scraper for YouTube URL",
        );
        return { payload: null, diagnostics };
      }

      if (!scrapeWebsite) {
        diagnostics.notes = appendNote(diagnostics.notes, "Website scraper is not configured");
        return { payload: null, diagnostics };
      }

      diagnostics.attempted = true;
      onProgress?.({ kind: "firecrawl-start", url, reason: reason ?? "firecrawl" });

      try {
        const payload = await scrapeWebsite(url, { timeoutMs, cacheMode });
        if (!payload) {
          diagnostics.notes = appendNote(
            diagnostics.notes,
            "Website scraper returned no content payload",
          );
          onProgress?.({
            kind: "firecrawl-done",
            url,
            ok: false,
            markdownBytes: null,
            htmlBytes: null,
          });
          return { payload: null, diagnostics };
        }
        diagnostics.provider = payload.provider ?? "firecrawl";

        const encoder = new TextEncoder();
        const markdownBytes =
          typeof payload.markdown === "string" ? encoder.encode(payload.markdown).byteLength : null;
        const htmlBytes =
          typeof payload.html === "string" ? encoder.encode(payload.html).byteLength : null;
        onProgress?.({ kind: "firecrawl-done", url, ok: true, markdownBytes, htmlBytes });

        return { payload, diagnostics };
      } catch (error) {
        diagnostics.notes = appendNote(
          diagnostics.notes,
          `Website scraper error: ${error instanceof Error ? error.message : "unknown error"}`,
        );
        onProgress?.({
          kind: "firecrawl-done",
          url,
          ok: false,
          markdownBytes: null,
          htmlBytes: null,
        });
        return { payload: null, diagnostics };
      }
    },
  );
}
