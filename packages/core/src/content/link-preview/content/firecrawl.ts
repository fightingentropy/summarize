import { load } from "cheerio";
import { resolveTranscriptForLink } from "../../transcript/index.js";
import type { WebsiteScrapeResult, LinkPreviewDeps } from "../deps.js";
import { measureAsyncProfile, measureSyncProfile } from "../profiling.js";
import type { WebsiteScrapeDiagnostics } from "../types.js";
import { extractArticleContent, extractPlainText } from "./article.js";
import { normalizeForPrompt } from "./cleaner.js";
import {
  BLOCKED_HTML_HINT_PATTERN,
  MIN_HTML_CONTENT_CHARACTERS,
  MIN_HTML_DOCUMENT_CHARACTERS_FOR_FALLBACK,
  MIN_METADATA_DESCRIPTION_CHARACTERS,
  READABILITY_RELATIVE_THRESHOLD,
} from "./constants.js";
import { extractJsonLdContent } from "./jsonld.js";
import { extractMetadataFromFirecrawl, extractMetadataFromHtml } from "./parsers.js";
import { isPodcastHost, isPodcastLikeJsonLdType } from "./podcast-utils.js";
import { prepareHtmlForStructuredParsing } from "./structured-html.js";
import type { ExtractedLinkContent, FetchLinkContentOptions } from "./types.js";
import {
  appendNote,
  ensureTranscriptDiagnostics,
  finalizeExtractedLinkContent,
  pickFirstText,
  safeHostname,
  selectBaseContent,
} from "./utils.js";
import { detectPrimaryVideoFromHtml } from "./video.js";
import { stripHiddenHtml } from "./visibility.js";

export function shouldFallbackToFirecrawl(html: string): boolean {
  const visibleHtml = stripHiddenHtml(html);
  const plainText = normalizeForPrompt(extractPlainText(visibleHtml, { inputIsVisibleHtml: true }));
  if (BLOCKED_HTML_HINT_PATTERN.test(plainText)) return true;
  const normalized = normalizeForPrompt(
    extractArticleContent(visibleHtml, { inputIsVisibleHtml: true }),
  );
  if (normalized.length >= MIN_HTML_CONTENT_CHARACTERS) {
    return false;
  }

  // Avoid spending Firecrawl on truly small/simple pages where the extracted HTML content is short but
  // likely complete (e.g. https://example.com). Only treat "thin" content as a Firecrawl signal when
  // the HTML document itself is large (SSR/app-shell pages, blocked pages without a match, etc.).
  return html.length >= MIN_HTML_DOCUMENT_CHARACTERS_FOR_FALLBACK;
}

export async function buildResultFromWebsiteScrape({
  url,
  payload,
  cacheMode,
  maxCharacters,
  youtubeTranscriptMode,
  mediaTranscriptMode,
  transcriptTimestamps,
  websiteScrapeDiagnostics,
  markdownRequested,
  deps,
}: {
  url: string;
  payload: WebsiteScrapeResult;
  cacheMode: FetchLinkContentOptions["cacheMode"];
  maxCharacters: number | null;
  youtubeTranscriptMode: FetchLinkContentOptions["youtubeTranscript"];
  mediaTranscriptMode: FetchLinkContentOptions["mediaTranscript"];
  transcriptTimestamps?: FetchLinkContentOptions["transcriptTimestamps"];
  websiteScrapeDiagnostics: WebsiteScrapeDiagnostics;
  markdownRequested: boolean;
  deps: LinkPreviewDeps;
}): Promise<ExtractedLinkContent | null> {
  return await measureAsyncProfile(
    {
      sink: deps.onProfile,
      name: "firecrawl.build.total",
      url,
      details: {
        markdownRequested,
        hasHtml: Boolean(payload.html),
      },
      onSuccessDetails: (result) => ({
        used: Boolean(result),
        contentChars: result?.content.length ?? 0,
        transcriptSource: result?.transcriptSource ?? null,
      }),
    },
    async () => {
      const provider = payload.provider ?? "firecrawl";
      websiteScrapeDiagnostics.provider = provider;
      const normalizedMarkdown = measureSyncProfile(
        {
          sink: deps.onProfile,
          name: "firecrawl.markdown.normalize",
          url,
          details: { markdownChars: payload.markdown?.length ?? 0 },
          onSuccessDetails: (value) => ({ normalizedChars: value.length }),
        },
        () => normalizeForPrompt(payload.markdown ?? ""),
      );
      if (normalizedMarkdown.length === 0) {
        websiteScrapeDiagnostics.notes = appendNote(
          websiteScrapeDiagnostics.notes,
          "Website scraper markdown normalization yielded empty text",
        );
        return null;
      }

      const structuredHtml = payload.html
        ? measureSyncProfile(
            {
              sink: deps.onProfile,
              name: "firecrawl.document.prepare",
              url,
              details: { htmlChars: payload.html.length },
              onSuccessDetails: (value) => ({ structuredHtmlChars: value.length }),
            },
            () => prepareHtmlForStructuredParsing(payload.html!),
          )
        : null;
      const document = payload.html
        ? measureSyncProfile(
            {
              sink: deps.onProfile,
              name: "firecrawl.document.load",
              url,
              details: {
                htmlChars: payload.html.length,
                structuredHtmlChars: structuredHtml?.length ?? null,
              },
            },
            () => load(structuredHtml ?? payload.html!),
          )
        : null;
      const jsonLd = payload.html
        ? measureSyncProfile(
            {
              sink: deps.onProfile,
              name: "firecrawl.jsonld",
              url,
              details: { htmlChars: payload.html.length },
              onSuccessDetails: (value) => ({
                hasJsonLd: Boolean(value),
                type: value?.type ?? null,
              }),
            },
            () => extractJsonLdContent(document ?? payload.html!),
          )
        : null;
      const isPodcastJsonLd = isPodcastLikeJsonLdType(jsonLd?.type);

      const transcriptResolution = await resolveTranscriptForLink(url, payload.html ?? null, deps, {
        youtubeTranscriptMode,
        mediaTranscriptMode,
        transcriptTimestamps,
        cacheMode,
      });
      const htmlMetadata = payload.html
        ? measureSyncProfile(
            {
              sink: deps.onProfile,
              name: "firecrawl.metadata.html",
              url,
              details: { htmlChars: payload.html.length },
              onSuccessDetails: (value) => ({
                hasTitle: Boolean(value.title),
                hasDescription: Boolean(value.description),
                hasSiteName: Boolean(value.siteName),
              }),
            },
            () => extractMetadataFromHtml(document ?? payload.html!, url),
          )
        : { title: null, description: null, siteName: null };
      const metadata = measureSyncProfile(
        {
          sink: deps.onProfile,
          name: "firecrawl.metadata.payload",
          url,
          onSuccessDetails: (value) => ({
            hasTitle: Boolean(value.title),
            hasDescription: Boolean(value.description),
            hasSiteName: Boolean(value.siteName),
          }),
        },
        () => extractMetadataFromFirecrawl(payload.metadata ?? null),
      );

      const title = pickFirstText([jsonLd?.title, metadata.title, htmlMetadata.title]);
      const description = pickFirstText([
        jsonLd?.description,
        metadata.description,
        htmlMetadata.description,
      ]);
      const siteName = pickFirstText([metadata.siteName, htmlMetadata.siteName, safeHostname(url)]);

      const descriptionCandidate = description ? normalizeForPrompt(description) : "";
      const preferDescription =
        descriptionCandidate.length >= MIN_METADATA_DESCRIPTION_CHARACTERS &&
        (isPodcastJsonLd ||
          isPodcastHost(url) ||
          normalizedMarkdown.length < MIN_HTML_CONTENT_CHARACTERS ||
          descriptionCandidate.length >=
            normalizedMarkdown.length * READABILITY_RELATIVE_THRESHOLD);
      const baseCandidate = preferDescription ? descriptionCandidate : normalizedMarkdown;
      const baseContent = selectBaseContent(baseCandidate, transcriptResolution.text);
      if (baseContent.length === 0) {
        websiteScrapeDiagnostics.notes = appendNote(
          websiteScrapeDiagnostics.notes,
          "Website scraper produced content that normalized to an empty string",
        );
        return null;
      }

      websiteScrapeDiagnostics.used = true;

      const transcriptDiagnostics = ensureTranscriptDiagnostics(
        transcriptResolution,
        cacheMode ?? "default",
      );

      const video = payload.html
        ? measureSyncProfile(
            {
              sink: deps.onProfile,
              name: "firecrawl.video.detect",
              url,
              details: { htmlChars: payload.html.length },
              onSuccessDetails: (value) => ({
                hasVideo: Boolean(value),
                videoKind: value?.kind ?? null,
              }),
            },
            () => detectPrimaryVideoFromHtml(document ?? payload.html!, url),
          )
        : null;
      const isVideoOnly =
        !transcriptResolution.text &&
        normalizedMarkdown.length < MIN_HTML_CONTENT_CHARACTERS &&
        video !== null;

      return finalizeExtractedLinkContent({
        url,
        baseContent,
        maxCharacters,
        title,
        description,
        siteName,
        transcriptResolution,
        video,
        isVideoOnly,
        diagnostics: {
          strategy: provider,
          websiteScrape: websiteScrapeDiagnostics,
          markdown: {
            requested: markdownRequested,
            used: true,
            provider,
          },
          transcript: transcriptDiagnostics,
        },
      });
    },
  );
}
