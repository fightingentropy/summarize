import { load } from "cheerio";
import { resolveTranscriptForLink } from "../../transcript/index.js";
import { extractYouTubeVideoId, isYouTubeUrl, isYouTubeVideoUrl } from "../../url.js";
import type { LinkPreviewDeps } from "../deps.js";
import { measureAsyncProfile, measureSyncProfile } from "../profiling.js";
import type { WebsiteScrapeDiagnostics, MarkdownDiagnostics } from "../types.js";
import {
  extractArticleContent,
  extractPrimaryArticleHtml,
  sanitizeHtmlForMarkdownConversion,
} from "./article.js";
import { normalizeForPrompt } from "./cleaner.js";
import {
  MIN_HTML_CONTENT_CHARACTERS,
  MIN_METADATA_DESCRIPTION_CHARACTERS,
  MIN_READABILITY_CONTENT_CHARACTERS,
  READABILITY_RELATIVE_THRESHOLD,
} from "./constants.js";
import { extractJsonLdContent } from "./jsonld.js";
import { extractMetadataFromHtml } from "./parsers.js";
import { isPodcastHost, isPodcastLikeJsonLdType } from "./podcast-utils.js";
import { extractReadabilityFromHtml, toReadabilityHtml } from "./readability.js";
import { prepareHtmlForStructuredParsing } from "./structured-html.js";
import type {
  ExtractedLinkContent,
  FetchLinkContentOptions,
  MarkdownMode,
  TranscriptResolution,
} from "./types.js";
import {
  ensureTranscriptDiagnostics,
  finalizeExtractedLinkContent,
  pickFirstText,
  selectBaseContent,
} from "./utils.js";
import { detectPrimaryVideoFromHtml } from "./video.js";
import { stripHiddenHtml } from "./visibility.js";
import { extractYouTubeAvailabilityIssue, extractYouTubeShortDescription } from "./youtube.js";

const LEADING_CONTROL_PATTERN = /^[\s\p{Cc}]+/u;

function stripLeadingTitle(content: string, title: string | null | undefined): string {
  if (!(content && title)) {
    return content;
  }

  const normalizedTitle = title.trim();
  if (normalizedTitle.length === 0) {
    return content;
  }

  const trimmedContent = content.trimStart();
  if (!trimmedContent.toLowerCase().startsWith(normalizedTitle.toLowerCase())) {
    return content;
  }

  const remainderOriginal = trimmedContent.slice(normalizedTitle.length);
  const remainder = remainderOriginal.replace(LEADING_CONTROL_PATTERN, "");
  return remainder;
}

export async function buildResultFromHtmlDocument({
  url,
  html,
  cacheMode,
  maxCharacters,
  youtubeTranscriptMode,
  mediaTranscriptMode,
  transcriptTimestamps,
  websiteScrapeDiagnostics,
  markdownRequested,
  markdownMode,
  timeoutMs,
  deps,
  readabilityCandidate,
  transcriptResolutionCandidate,
}: {
  url: string;
  html: string;
  cacheMode: FetchLinkContentOptions["cacheMode"];
  maxCharacters: number | null;
  youtubeTranscriptMode: FetchLinkContentOptions["youtubeTranscript"];
  mediaTranscriptMode: FetchLinkContentOptions["mediaTranscript"];
  transcriptTimestamps?: FetchLinkContentOptions["transcriptTimestamps"];
  websiteScrapeDiagnostics: WebsiteScrapeDiagnostics;
  markdownRequested: boolean;
  markdownMode: MarkdownMode;
  timeoutMs: number;
  deps: LinkPreviewDeps;
  readabilityCandidate: Awaited<ReturnType<typeof extractReadabilityFromHtml>> | null;
  transcriptResolutionCandidate?: TranscriptResolution | null;
}): Promise<ExtractedLinkContent> {
  return await measureAsyncProfile(
    {
      sink: deps.onProfile,
      name: "html.total",
      url,
      details: {
        htmlChars: html.length,
        markdownRequested,
        markdownMode,
      },
      onSuccessDetails: (result) => ({
        contentChars: result.content.length,
        transcriptSource: result.transcriptSource ?? null,
        isVideoOnly: result.isVideoOnly,
      }),
    },
    async () => {
      if (isYouTubeVideoUrl(url) && !extractYouTubeVideoId(url)) {
        throw new Error("Invalid YouTube video id in URL");
      }

      const structuredHtml = measureSyncProfile(
        {
          sink: deps.onProfile,
          name: "html.document.prepare",
          url,
          details: { htmlChars: html.length },
          onSuccessDetails: (value) => ({ structuredHtmlChars: value.length }),
        },
        () => prepareHtmlForStructuredParsing(html),
      );
      const document = measureSyncProfile(
        {
          sink: deps.onProfile,
          name: "html.document.load",
          url,
          details: {
            htmlChars: html.length,
            structuredHtmlChars: structuredHtml.length,
          },
        },
        () => load(structuredHtml),
      );
      const { title, description, siteName } = measureSyncProfile(
        {
          sink: deps.onProfile,
          name: "html.metadata",
          url,
          details: { htmlChars: html.length },
          onSuccessDetails: (result) => ({
            hasTitle: Boolean(result.title),
            hasDescription: Boolean(result.description),
            hasSiteName: Boolean(result.siteName),
          }),
        },
        () => extractMetadataFromHtml(document, url),
      );
      const transcriptResolution =
        transcriptResolutionCandidate ??
        (await resolveTranscriptForLink(url, html, deps, {
          youtubeTranscriptMode,
          mediaTranscriptMode,
          transcriptTimestamps,
          cacheMode,
        }));
      const transcriptDiagnostics = ensureTranscriptDiagnostics(
        transcriptResolution,
        cacheMode ?? "default",
      );
      const youtubeDescription =
        transcriptResolution.text === null && isYouTubeUrl(url)
          ? measureSyncProfile(
              {
                sink: deps.onProfile,
                name: "html.youtube.short-description",
                url,
                details: { htmlChars: html.length },
                onSuccessDetails: (value) => ({
                  found: Boolean(value),
                  textChars: value?.length ?? 0,
                }),
              },
              () => extractYouTubeShortDescription(html),
            )
          : null;

      if (isYouTubeUrl(url)) {
        const descriptionCandidate = normalizeForPrompt(youtubeDescription ?? description ?? "");
        if (transcriptResolution.text || descriptionCandidate.length > 0) {
          return finalizeExtractedLinkContent({
            url,
            baseContent: selectBaseContent(descriptionCandidate, transcriptResolution.text),
            maxCharacters,
            title,
            description: youtubeDescription ?? description,
            siteName: siteName ?? "YouTube",
            transcriptResolution,
            video: { kind: "youtube", url },
            isVideoOnly: false,
            diagnostics: {
              strategy: "html",
              websiteScrape: websiteScrapeDiagnostics,
              markdown: markdownRequested
                ? {
                    requested: true,
                    used: false,
                    provider: null,
                    notes: "Skipping Markdown conversion for YouTube URLs",
                  }
                : {
                    requested: false,
                    used: false,
                    provider: null,
                    notes: null,
                  },
              transcript: transcriptDiagnostics,
            },
          });
        }

        const availabilityIssue = extractYouTubeAvailabilityIssue(html);
        if (availabilityIssue) {
          throw new Error(availabilityIssue.message);
        }
      }

      const jsonLd = measureSyncProfile(
        {
          sink: deps.onProfile,
          name: "html.jsonld",
          url,
          details: { htmlChars: html.length },
          onSuccessDetails: (value) => ({
            hasJsonLd: Boolean(value),
            type: value?.type ?? null,
          }),
        },
        () => extractJsonLdContent(document),
      );
      const primaryArticleHtml = measureSyncProfile(
        {
          sink: deps.onProfile,
          name: "html.article.primary",
          url,
          details: { htmlChars: html.length },
          onSuccessDetails: (value) => ({
            found: Boolean(value),
            articleHtmlChars: value?.length ?? 0,
          }),
        },
        () => extractPrimaryArticleHtml(document),
      );
      const visibleHtml = measureSyncProfile(
        {
          sink: deps.onProfile,
          name: "html.visible.prepare",
          url,
          details: { htmlChars: html.length },
          onSuccessDetails: (value) => ({ visibleHtmlChars: value.length }),
        },
        () => stripHiddenHtml(html),
      );
      const mergedTitle = pickFirstText([jsonLd?.title, title]);
      const mergedDescription = pickFirstText([jsonLd?.description, description]);
      const isPodcastJsonLd = isPodcastLikeJsonLdType(jsonLd?.type);
      const titleForContent = mergedTitle ?? title;
      const normalizedSegmentsFromPrimaryArticle = primaryArticleHtml
        ? measureSyncProfile(
            {
              sink: deps.onProfile,
              name: "html.article.extract.primary",
              url,
              details: { htmlChars: primaryArticleHtml.length },
              onSuccessDetails: (value) => ({ textChars: value.length }),
            },
            () => normalizeForPrompt(extractArticleContent(primaryArticleHtml)),
          )
        : "";
      const canUsePrimaryArticleFastPath =
        normalizedSegmentsFromPrimaryArticle.length > 0 &&
        stripLeadingTitle(normalizedSegmentsFromPrimaryArticle, titleForContent).trim().length > 0;
      const normalizedSegmentsFromHtml = canUsePrimaryArticleFastPath
        ? ""
        : measureSyncProfile(
            {
              sink: deps.onProfile,
              name: "html.article.extract.raw",
              url,
              details: { htmlChars: html.length },
              onSuccessDetails: (value) => ({ textChars: value.length }),
            },
            () =>
              normalizeForPrompt(extractArticleContent(visibleHtml, { inputIsVisibleHtml: true })),
          );
      const normalizedSegmentsBase = canUsePrimaryArticleFastPath
        ? normalizedSegmentsFromPrimaryArticle
        : normalizedSegmentsFromHtml;
      const shouldUseReadability =
        Boolean(readabilityCandidate) ||
        (markdownRequested && markdownMode === "readability") ||
        !canUsePrimaryArticleFastPath;
      const readability = shouldUseReadability
        ? (readabilityCandidate ??
          (await extractReadabilityFromHtml(html, url, {
            onProfile: deps.onProfile,
            visibleHtml,
          })))
        : null;
      const readabilityText = readability?.text ? normalizeForPrompt(readability.text) : "";
      const readabilityHtml = toReadabilityHtml(readability);

      const normalizedSegmentsFromReadabilityHtml = readabilityHtml
        ? measureSyncProfile(
            {
              sink: deps.onProfile,
              name: "html.article.extract.readability",
              url,
              details: { htmlChars: readabilityHtml.length },
              onSuccessDetails: (value) => ({ textChars: value.length }),
            },
            () => normalizeForPrompt(extractArticleContent(readabilityHtml)),
          )
        : "";
      const preferReadabilityHtml =
        normalizedSegmentsFromReadabilityHtml.length >= MIN_READABILITY_CONTENT_CHARACTERS &&
        (normalizedSegmentsBase.length < MIN_HTML_CONTENT_CHARACTERS ||
          normalizedSegmentsFromReadabilityHtml.length >=
            normalizedSegmentsBase.length * READABILITY_RELATIVE_THRESHOLD);
      const normalizedSegments = preferReadabilityHtml
        ? normalizedSegmentsFromReadabilityHtml
        : normalizedSegmentsBase;

      const preferReadabilityText =
        !preferReadabilityHtml &&
        readabilityText.length >= MIN_READABILITY_CONTENT_CHARACTERS &&
        (normalizedSegmentsBase.length < MIN_HTML_CONTENT_CHARACTERS ||
          readabilityText.length >= normalizedSegmentsBase.length * READABILITY_RELATIVE_THRESHOLD);
      const preferReadability = preferReadabilityHtml || preferReadabilityText;
      const effectiveNormalized = preferReadabilityText ? readabilityText : normalizedSegments;
      const descriptionCandidate = mergedDescription ? normalizeForPrompt(mergedDescription) : "";
      const preferDescription =
        descriptionCandidate.length >= MIN_METADATA_DESCRIPTION_CHARACTERS &&
        (isPodcastJsonLd ||
          isPodcastHost(url) ||
          (!preferReadability &&
            (effectiveNormalized.length < MIN_HTML_CONTENT_CHARACTERS ||
              descriptionCandidate.length >=
                effectiveNormalized.length * READABILITY_RELATIVE_THRESHOLD)));
      const effectiveNormalizedWithDescription = preferDescription
        ? descriptionCandidate
        : effectiveNormalized;

      const baseCandidate = youtubeDescription
        ? normalizeForPrompt(youtubeDescription)
        : effectiveNormalizedWithDescription;

      let baseContent = selectBaseContent(baseCandidate, transcriptResolution.text);
      if (baseContent === normalizedSegments) {
        baseContent = stripLeadingTitle(baseContent, titleForContent);
      }

      const markdownDiagnostics: MarkdownDiagnostics = await (async () => {
        if (!markdownRequested) {
          return { requested: false, used: false, provider: null, notes: null };
        }

        if (isYouTubeUrl(url)) {
          return {
            requested: true,
            used: false,
            provider: null,
            notes: "Skipping Markdown conversion for YouTube URLs",
          };
        }

        if (!deps.convertHtmlToMarkdown) {
          return {
            requested: true,
            used: false,
            provider: null,
            notes: "No HTML→Markdown converter configured",
          };
        }
        const convertHtmlToMarkdown = deps.convertHtmlToMarkdown;

        try {
          const normalizedMarkdown = await measureAsyncProfile(
            {
              sink: deps.onProfile,
              name: "html.markdown",
              url,
              details: {
                markdownMode,
                htmlChars:
                  markdownMode === "readability" && readabilityHtml
                    ? readabilityHtml.length
                    : html.length,
              },
              onSuccessDetails: (value) => ({ markdownChars: value.length }),
            },
            async () => {
              const htmlForMarkdown =
                markdownMode === "readability" && readabilityHtml ? readabilityHtml : html;
              const sanitizedHtml =
                htmlForMarkdown === html
                  ? sanitizeHtmlForMarkdownConversion(visibleHtml, { inputIsVisibleHtml: true })
                  : sanitizeHtmlForMarkdownConversion(htmlForMarkdown);
              const markdown = await convertHtmlToMarkdown({
                url,
                html: sanitizedHtml,
                title: mergedTitle ?? title,
                siteName,
                timeoutMs,
              });
              return normalizeForPrompt(markdown);
            },
          );
          if (normalizedMarkdown.length === 0) {
            return {
              requested: true,
              used: false,
              provider: null,
              notes: "HTML→Markdown conversion returned empty content",
            };
          }

          baseContent = normalizedMarkdown;
          return {
            requested: true,
            used: true,
            provider: "llm",
            notes:
              markdownMode === "readability" && readabilityHtml
                ? "Readability HTML used for markdown input"
                : null,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            requested: true,
            used: false,
            provider: null,
            notes: `HTML→Markdown conversion failed: ${message}`,
          };
        }
      })();

      const video = measureSyncProfile(
        {
          sink: deps.onProfile,
          name: "html.video.detect",
          url,
          details: { htmlChars: html.length },
          onSuccessDetails: (value) => ({
            hasVideo: Boolean(value),
            videoKind: value?.kind ?? null,
          }),
        },
        () => detectPrimaryVideoFromHtml(document, url),
      );
      const isVideoOnly =
        !transcriptResolution.text &&
        baseContent.length < MIN_HTML_CONTENT_CHARACTERS &&
        video !== null;

      return finalizeExtractedLinkContent({
        url,
        baseContent,
        maxCharacters,
        title: mergedTitle ?? title,
        description: mergedDescription ?? description,
        siteName,
        transcriptResolution,
        video,
        isVideoOnly,
        diagnostics: {
          strategy: "html",
          websiteScrape: websiteScrapeDiagnostics,
          markdown: markdownDiagnostics,
          transcript: transcriptDiagnostics,
        },
      });
    },
  );
}
