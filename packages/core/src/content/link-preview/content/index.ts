import { resolveTranscriptForLink } from "../../transcript/index.js";
import { resolveTranscriptionAvailability } from "../../transcript/providers/transcription-start.js";
import { resolveTranscriptionConfig } from "../../transcript/transcription-config.js";
import { extractYouTubeVideoId, isDirectMediaUrl, isYouTubeUrl } from "../../url.js";
import type { WebsiteScrapeResult, LinkPreviewDeps } from "../deps.js";
import type { CacheMode, WebsiteScrapeDiagnostics, TranscriptResolution } from "../types.js";
import { normalizeForPrompt } from "./cleaner.js";
import { MIN_READABILITY_CONTENT_CHARACTERS } from "./constants.js";
import { fetchHtmlDocument, fetchWithWebsiteScraper } from "./fetcher.js";
import { buildResultFromWebsiteScrape, shouldFallbackToFirecrawl } from "./firecrawl.js";
import { buildResultFromHtmlDocument } from "./html.js";
import { extractApplePodcastIds, extractSpotifyEpisodeId } from "./podcast-utils.js";
import { extractReadabilityFromHtml } from "./readability.js";
import {
  isAnubisHtml,
  isBlockedTwitterContent,
  isTwitterBroadcastUrl,
  isTwitterStatusUrl,
  toNitterUrls,
} from "./twitter-utils.js";
import type { ExtractedLinkContent, FetchLinkContentOptions, MarkdownMode } from "./types.js";
import {
  appendNote,
  ensureTranscriptDiagnostics,
  finalizeExtractedLinkContent,
  resolveCacheMode,
  resolveFirecrawlMode,
  resolveMaxCharacters,
  resolveTimeoutMs,
  selectBaseContent,
} from "./utils.js";
import {
  extractYouTubeShortDescription,
  extractYouTubeTitle,
  fetchYouTubeOEmbedMetadata,
} from "./youtube.js";

const MAX_TWITTER_TEXT_FOR_TRANSCRIPT = 500;

const buildSkippedTwitterTranscript = (
  cacheMode: CacheMode,
  notes: string,
): TranscriptResolution => ({
  text: null,
  source: null,
  diagnostics: {
    cacheMode,
    cacheStatus: cacheMode === "bypass" ? "bypassed" : "unknown",
    textProvided: false,
    provider: null,
    attemptedProviders: [],
    notes,
  },
});

export async function fetchLinkContent(
  url: string,
  options: FetchLinkContentOptions | undefined,
  deps: LinkPreviewDeps,
): Promise<ExtractedLinkContent> {
  const transcription = resolveTranscriptionConfig({
    env: deps.env,
    transcription: deps.transcription ?? null,
    falApiKey: deps.falApiKey,
    groqApiKey: deps.groqApiKey,
    assemblyaiApiKey: deps.assemblyaiApiKey,
    geminiApiKey: deps.geminiApiKey,
    openaiApiKey: deps.openaiApiKey,
  });
  const timeoutMs = resolveTimeoutMs(options);
  const cacheMode = resolveCacheMode(options);
  const maxCharacters = resolveMaxCharacters(options);
  const youtubeTranscriptMode = options?.youtubeTranscript ?? "auto";
  const mediaTranscriptMode = options?.mediaTranscript ?? "auto";
  const transcriptTimestamps = options?.transcriptTimestamps ?? false;
  const firecrawlMode = resolveFirecrawlMode(options);
  const markdownRequested = (options?.format ?? "text") === "markdown";
  const markdownMode: MarkdownMode = options?.markdownMode ?? "auto";
  const fileMtime = options?.fileMtime ?? null;

  const canUseFirecrawl =
    firecrawlMode !== "off" && deps.scrapeWebsite !== null && !isYouTubeUrl(url);

  const spotifyEpisodeId = extractSpotifyEpisodeId(url);
  if (spotifyEpisodeId) {
    const transcriptionAvailability = await resolveTranscriptionAvailability({
      transcription,
    });
    if (!transcriptionAvailability.hasAnyProvider) {
      throw new Error(
        "Spotify episode transcription requires a transcription provider (install whisper-cpp or set GROQ_API_KEY, ASSEMBLYAI_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or FAL_KEY); otherwise you may only get a captcha/recaptcha HTML page.",
      );
    }

    const transcriptResolution = await resolveTranscriptForLink(url, null, deps, {
      youtubeTranscriptMode,
      mediaTranscriptMode,
      transcriptTimestamps,
      cacheMode,
      fileMtime,
    });
    if (!transcriptResolution.text) {
      const notes = transcriptResolution.diagnostics?.notes;
      const suffix = notes ? ` (${notes})` : "";
      throw new Error(`Failed to transcribe Spotify episode${suffix}`);
    }

    const transcriptDiagnostics = ensureTranscriptDiagnostics(
      transcriptResolution,
      cacheMode ?? "default",
    );
    transcriptDiagnostics.notes = appendNote(
      transcriptDiagnostics.notes,
      "Spotify episode: skipped HTML fetch to avoid captcha pages",
    );

    return finalizeExtractedLinkContent({
      url,
      baseContent: selectBaseContent("", transcriptResolution.text, transcriptResolution.segments),
      maxCharacters,
      title: null,
      description: null,
      siteName: "Spotify",
      transcriptResolution,
      video: null,
      isVideoOnly: false,
      diagnostics: {
        strategy: "html",
        websiteScrape: {
          attempted: false,
          used: false,
          cacheMode,
          cacheStatus: cacheMode === "bypass" ? "bypassed" : "unknown",
          notes: "Spotify short-circuit skipped HTML/external scraper",
        },
        markdown: {
          requested: markdownRequested,
          used: false,
          provider: null,
          notes: "Spotify short-circuit uses transcript content",
        },
        transcript: transcriptDiagnostics,
      },
    });
  }

  const appleIds = extractApplePodcastIds(url);
  if (appleIds) {
    const transcriptionAvailability = await resolveTranscriptionAvailability({
      transcription,
    });
    if (!transcriptionAvailability.hasAnyProvider) {
      throw new Error(
        "Apple Podcasts transcription requires a transcription provider (install whisper-cpp or set GROQ_API_KEY, ASSEMBLYAI_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or FAL_KEY); otherwise you may only get a slow/blocked HTML page.",
      );
    }

    const transcriptResolution = await resolveTranscriptForLink(url, null, deps, {
      youtubeTranscriptMode,
      mediaTranscriptMode,
      transcriptTimestamps,
      cacheMode,
      fileMtime,
    });
    if (!transcriptResolution.text) {
      const notes = transcriptResolution.diagnostics?.notes;
      const suffix = notes ? ` (${notes})` : "";
      throw new Error(`Failed to transcribe Apple Podcasts episode${suffix}`);
    }

    const transcriptDiagnostics = ensureTranscriptDiagnostics(
      transcriptResolution,
      cacheMode ?? "default",
    );
    transcriptDiagnostics.notes = appendNote(
      transcriptDiagnostics.notes,
      "Apple Podcasts: skipped HTML fetch (prefer iTunes lookup / enclosures)",
    );

    return finalizeExtractedLinkContent({
      url,
      baseContent: selectBaseContent("", transcriptResolution.text, transcriptResolution.segments),
      maxCharacters,
      title: null,
      description: null,
      siteName: "Apple Podcasts",
      transcriptResolution,
      video: null,
      isVideoOnly: false,
      diagnostics: {
        strategy: "html",
        websiteScrape: {
          attempted: false,
          used: false,
          cacheMode,
          cacheStatus: cacheMode === "bypass" ? "bypassed" : "unknown",
          notes: "Apple Podcasts short-circuit skipped HTML/external scraper",
        },
        markdown: {
          requested: markdownRequested,
          used: false,
          provider: null,
          notes: "Apple Podcasts short-circuit uses transcript content",
        },
        transcript: transcriptDiagnostics,
      },
    });
  }

  if (isTwitterBroadcastUrl(url)) {
    const broadcastTranscriptMode = mediaTranscriptMode === "auto" ? "prefer" : mediaTranscriptMode;
    const transcriptResolution = await resolveTranscriptForLink(url, null, deps, {
      youtubeTranscriptMode,
      mediaTranscriptMode: broadcastTranscriptMode,
      transcriptTimestamps,
      cacheMode,
      fileMtime,
    });
    if (!transcriptResolution.text) {
      const notes = transcriptResolution.diagnostics?.notes;
      const suffix = notes ? ` (${notes})` : "";
      throw new Error(`Failed to transcribe X broadcast${suffix}`);
    }

    const transcriptDiagnostics = ensureTranscriptDiagnostics(
      transcriptResolution,
      cacheMode ?? "default",
    );
    transcriptDiagnostics.notes = appendNote(
      transcriptDiagnostics.notes,
      "X broadcast: skipped HTML/external scraper",
    );

    return finalizeExtractedLinkContent({
      url,
      baseContent: selectBaseContent("", transcriptResolution.text, transcriptResolution.segments),
      maxCharacters,
      title: null,
      description: null,
      siteName: "X",
      transcriptResolution,
      video: { kind: "direct", url },
      isVideoOnly: true,
      diagnostics: {
        strategy: "html",
        websiteScrape: {
          attempted: false,
          used: false,
          cacheMode,
          cacheStatus: cacheMode === "bypass" ? "bypassed" : "unknown",
          notes: "X broadcast short-circuit skipped HTML/external scraper",
        },
        markdown: {
          requested: markdownRequested,
          used: false,
          provider: null,
          notes: "X broadcast uses transcript content",
        },
        transcript: transcriptDiagnostics,
      },
    });
  }

  if (isDirectMediaUrl(url)) {
    const directMediaTranscriptMode = "prefer" as const;
    const transcriptResolution = await resolveTranscriptForLink(url, null, deps, {
      youtubeTranscriptMode,
      mediaTranscriptMode: directMediaTranscriptMode,
      transcriptTimestamps,
      cacheMode,
      fileMtime,
    });
    if (!transcriptResolution.text) {
      const notes = transcriptResolution.diagnostics?.notes;
      const suffix = notes ? ` (${notes})` : "";
      throw new Error(`Failed to transcribe media${suffix}`);
    }

    const transcriptDiagnostics = ensureTranscriptDiagnostics(
      transcriptResolution,
      cacheMode ?? "default",
    );
    transcriptDiagnostics.notes = appendNote(
      transcriptDiagnostics.notes,
      "Direct media URL: skipped HTML/external scraper",
    );

    return finalizeExtractedLinkContent({
      url,
      baseContent: selectBaseContent("", transcriptResolution.text, transcriptResolution.segments),
      maxCharacters,
      title: null,
      description: null,
      siteName: null,
      transcriptResolution,
      video: { kind: "direct", url },
      isVideoOnly: true,
      diagnostics: {
        strategy: "html",
        websiteScrape: {
          attempted: false,
          used: false,
          cacheMode,
          cacheStatus: cacheMode === "bypass" ? "bypassed" : "unknown",
          notes:
            mediaTranscriptMode === "prefer"
              ? "Direct media URL skipped HTML/external scraper"
              : "Direct media URL auto-promoted to transcript and skipped HTML/external scraper",
        },
        markdown: {
          requested: markdownRequested,
          used: false,
          provider: null,
          notes: "Direct media URL uses transcript content",
        },
        transcript: transcriptDiagnostics,
      },
    });
  }

  const isExplicitYoutubeTranscriptMode =
    isYouTubeUrl(url) && (youtubeTranscriptMode === "yt-dlp" || youtubeTranscriptMode === "apify");
  let youtubeTranscriptResolutionCandidate: TranscriptResolution | null = null;
  if (isExplicitYoutubeTranscriptMode) {
    youtubeTranscriptResolutionCandidate = await resolveTranscriptForLink(url, null, deps, {
      youtubeTranscriptMode,
      mediaTranscriptMode,
      transcriptTimestamps,
      cacheMode,
      fileMtime,
    });

    if (youtubeTranscriptResolutionCandidate.text) {
      const transcriptDiagnostics = ensureTranscriptDiagnostics(
        youtubeTranscriptResolutionCandidate,
        cacheMode ?? "default",
      );
      transcriptDiagnostics.notes = appendNote(
        transcriptDiagnostics.notes,
        `YouTube ${youtubeTranscriptMode}: skipped watch HTML fetch`,
      );

      return finalizeExtractedLinkContent({
        url,
        baseContent: selectBaseContent(
          "",
          youtubeTranscriptResolutionCandidate.text,
          youtubeTranscriptResolutionCandidate.segments,
        ),
        maxCharacters,
        title: null,
        description: null,
        siteName: "YouTube",
        transcriptResolution: youtubeTranscriptResolutionCandidate,
        video: { kind: "youtube", url },
        isVideoOnly: false,
        diagnostics: {
          strategy: "html",
          websiteScrape: {
            attempted: false,
            used: false,
            cacheMode,
            cacheStatus: cacheMode === "bypass" ? "bypassed" : "unknown",
            notes: `YouTube ${youtubeTranscriptMode}: skipped watch HTML/external scraper`,
          },
          markdown: {
            requested: markdownRequested,
            used: false,
            provider: null,
            notes: `YouTube ${youtubeTranscriptMode} uses transcript content`,
          },
          transcript: transcriptDiagnostics,
        },
      });
    }
  }

  const canAttemptYoutubeEmbedTranscriptProbe =
    isYouTubeUrl(url) &&
    (youtubeTranscriptMode === "auto" || youtubeTranscriptMode === "web") &&
    !isExplicitYoutubeTranscriptMode;
  if (canAttemptYoutubeEmbedTranscriptProbe) {
    const youtubeVideoId = extractYouTubeVideoId(url);
    if (youtubeVideoId) {
      try {
        const canonicalYouTubeUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
        const embedMetadataPromise = fetchYouTubeOEmbedMetadata(deps.fetch, canonicalYouTubeUrl, {
          timeoutMs,
          onProfile: deps.onProfile ?? null,
        }).catch(() => null);
        const embedResult = await fetchHtmlDocument(
          deps.fetch,
          `https://www.youtube.com/embed/${youtubeVideoId}`,
          {
            timeoutMs,
            onProgress: deps.onProgress ?? null,
            onProfile: deps.onProfile ?? null,
          },
        );
        const embedTranscriptResolution = await resolveTranscriptForLink(
          url,
          embedResult.html,
          deps,
          {
            youtubeTranscriptMode: "web",
            mediaTranscriptMode,
            transcriptTimestamps,
            cacheMode,
            fileMtime,
            skipNegativeCacheWrite: true,
          },
        );

        if (embedTranscriptResolution.text) {
          const embedMetadata = await embedMetadataPromise;
          const transcriptDiagnostics = ensureTranscriptDiagnostics(
            embedTranscriptResolution,
            cacheMode ?? "default",
          );
          transcriptDiagnostics.notes = appendNote(
            transcriptDiagnostics.notes,
            "YouTube: resolved transcript from embed bootstrap; skipped watch HTML",
          );

          return finalizeExtractedLinkContent({
            url,
            baseContent: selectBaseContent(
              "",
              embedTranscriptResolution.text,
              embedTranscriptResolution.segments,
            ),
            maxCharacters,
            title: embedMetadata?.title ?? null,
            description: null,
            siteName: "YouTube",
            transcriptResolution: embedTranscriptResolution,
            video: { kind: "youtube", url },
            isVideoOnly: false,
            diagnostics: {
              strategy: "html",
              websiteScrape: {
                attempted: false,
                used: false,
                cacheMode,
                cacheStatus: cacheMode === "bypass" ? "bypassed" : "unknown",
                notes: "YouTube embed bootstrap skipped watch HTML/external scraper",
              },
              markdown: {
                requested: markdownRequested,
                used: false,
                provider: null,
                notes: "YouTube embed bootstrap uses transcript content",
              },
              transcript: transcriptDiagnostics,
            },
          });
        }
      } catch {
        // Fall through to the standard watch-page path.
      }
    }
  }

  let firecrawlAttempted = false;
  let firecrawlPayload: WebsiteScrapeResult | null = null;
  const websiteScrapeDiagnostics: WebsiteScrapeDiagnostics = {
    attempted: false,
    used: false,
    cacheMode,
    cacheStatus: cacheMode === "bypass" ? "bypassed" : "unknown",
    provider: null,
    notes: null,
  };

  const twitterStatus = isTwitterStatusUrl(url);
  const nitterUrls = twitterStatus ? toNitterUrls(url) : [];
  let birdError: unknown = null;
  let nitterError: unknown = null;

  const attemptFirecrawl = async (reason: string): Promise<ExtractedLinkContent | null> => {
    if (!canUseFirecrawl) {
      return null;
    }

    if (!firecrawlAttempted) {
      const attempt = await fetchWithWebsiteScraper(url, deps.scrapeWebsite, {
        timeoutMs,
        cacheMode,
        onProgress: deps.onProgress ?? null,
        onProfile: deps.onProfile ?? null,
        reason,
      });
      firecrawlAttempted = true;
      firecrawlPayload = attempt.payload;
      websiteScrapeDiagnostics.attempted = attempt.diagnostics.attempted;
      websiteScrapeDiagnostics.used = attempt.diagnostics.used;
      websiteScrapeDiagnostics.cacheMode = attempt.diagnostics.cacheMode;
      websiteScrapeDiagnostics.cacheStatus = attempt.diagnostics.cacheStatus;
      websiteScrapeDiagnostics.provider = attempt.diagnostics.provider ?? null;
      websiteScrapeDiagnostics.notes = attempt.diagnostics.notes ?? null;
    }

    websiteScrapeDiagnostics.notes = appendNote(websiteScrapeDiagnostics.notes, reason);

    if (!firecrawlPayload) {
      return null;
    }

    const firecrawlResult = await buildResultFromWebsiteScrape({
      url,
      payload: firecrawlPayload,
      cacheMode,
      maxCharacters,
      youtubeTranscriptMode,
      mediaTranscriptMode,
      transcriptTimestamps,
      websiteScrapeDiagnostics,
      markdownRequested,
      deps,
    });
    if (firecrawlResult) {
      return firecrawlResult;
    }

    websiteScrapeDiagnostics.notes = appendNote(
      websiteScrapeDiagnostics.notes,
      "Website scraper returned empty content",
    );
    return null;
  };

  const attemptBird = async (): Promise<ExtractedLinkContent | null> => {
    if (!deps.readTweetWithBird || !twitterStatus) {
      return null;
    }

    deps.onProgress?.({ kind: "bird-start", url, client: null });
    try {
      const tweet = await deps.readTweetWithBird({ url, timeoutMs });
      const text = tweet?.text?.trim() ?? "";
      const tweetClient = tweet?.client === "xurl" ? "xurl" : "bird";
      if (text.length === 0) {
        deps.onProgress?.({
          kind: "bird-done",
          url,
          client: tweetClient,
          ok: false,
          textBytes: null,
        });
        return null;
      }

      const title = tweet?.author?.username ? `@${tweet.author.username}` : null;
      const description = null;
      const siteName = "X";
      const media = tweet?.media ?? null;
      const mediaUrl = media?.preferredUrl ?? media?.urls?.[0] ?? null;
      const hasMedia = Boolean(mediaUrl);
      const shouldAttemptTranscript =
        mediaTranscriptMode === "prefer" || (mediaTranscriptMode === "auto" && hasMedia);
      const autoModeNote = !shouldAttemptTranscript
        ? "Skipped tweet transcript (media transcript mode is auto; enable --video-mode transcript to force audio)."
        : null;
      const longFormNote =
        !hasMedia && text.length >= MAX_TWITTER_TEXT_FOR_TRANSCRIPT
          ? `Skipped yt-dlp transcript for long-form tweet text (${text.length} chars)`
          : null;
      const skipTranscriptReason = [autoModeNote, longFormNote].filter(Boolean).join(" ") || null;
      const mediaTranscriptModeForTweet = shouldAttemptTranscript ? "prefer" : mediaTranscriptMode;
      const transcriptResolution = skipTranscriptReason
        ? buildSkippedTwitterTranscript(cacheMode, skipTranscriptReason)
        : await resolveTranscriptForLink(url, null, deps, {
            youtubeTranscriptMode,
            mediaTranscriptMode: mediaTranscriptModeForTweet,
            mediaKindHint: media?.kind ?? null,
            transcriptTimestamps,
            cacheMode,
            fileMtime,
          });
      const transcriptDiagnostics = ensureTranscriptDiagnostics(
        transcriptResolution,
        cacheMode ?? "default",
      );
      const result = finalizeExtractedLinkContent({
        url,
        baseContent: selectBaseContent(
          text,
          transcriptResolution.text,
          transcriptResolution.segments,
        ),
        maxCharacters,
        title,
        description,
        siteName,
        transcriptResolution,
        video:
          mediaUrl && media?.kind === "video"
            ? {
                kind: "direct",
                url: mediaUrl,
              }
            : null,
        isVideoOnly: false,
        diagnostics: {
          strategy: tweetClient,
          websiteScrape: websiteScrapeDiagnostics,
          markdown: {
            requested: markdownRequested,
            used: false,
            provider: null,
            notes: `${tweetClient} tweet fetch provides plain text`,
          },
          transcript: transcriptDiagnostics,
        },
      });
      deps.onProgress?.({
        kind: "bird-done",
        url,
        client: tweetClient,
        ok: true,
        textBytes: Buffer.byteLength(result.content, "utf8"),
      });
      return result;
    } catch (error) {
      birdError = error;
      deps.onProgress?.({ kind: "bird-done", url, client: null, ok: false, textBytes: null });
      return null;
    }
  };

  const birdResult = await attemptBird();
  if (birdResult) {
    return birdResult;
  }

  const attemptNitter = async (): Promise<string | null> => {
    if (nitterUrls.length === 0) {
      return null;
    }
    for (const nitterUrl of nitterUrls) {
      deps.onProgress?.({ kind: "nitter-start", url: nitterUrl });
      try {
        const nitterResult = await fetchHtmlDocument(deps.fetch, nitterUrl, {
          timeoutMs,
          onProfile: deps.onProfile ?? null,
        });
        const nitterHtml = nitterResult.html;
        if (!nitterHtml.trim()) {
          nitterError = new Error(`Nitter returned empty body from ${new URL(nitterUrl).host}`);
          deps.onProgress?.({ kind: "nitter-done", url: nitterUrl, ok: false, textBytes: null });
          continue;
        }
        if (isAnubisHtml(nitterHtml)) {
          nitterError = new Error(
            `Nitter returned Anubis challenge from ${new URL(nitterUrl).host}`,
          );
          deps.onProgress?.({ kind: "nitter-done", url: nitterUrl, ok: false, textBytes: null });
          continue;
        }
        deps.onProgress?.({
          kind: "nitter-done",
          url: nitterUrl,
          ok: true,
          textBytes: Buffer.byteLength(nitterHtml, "utf8"),
        });
        return nitterHtml;
      } catch (error) {
        nitterError = error;
        deps.onProgress?.({ kind: "nitter-done", url: nitterUrl, ok: false, textBytes: null });
      }
    }
    return null;
  };

  const nitterHtml = await attemptNitter();
  if (nitterHtml) {
    const nitterResult = await buildResultFromHtmlDocument({
      url,
      html: nitterHtml,
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
      readabilityCandidate: null,
    });
    if (!isBlockedTwitterContent(nitterResult.content)) {
      nitterResult.diagnostics.strategy = "nitter";
      return nitterResult;
    }
    nitterError = new Error("Nitter returned blocked or empty content");
  }

  if (firecrawlMode === "always") {
    const firecrawlResult = await attemptFirecrawl("Website scraper forced via options");
    if (firecrawlResult) {
      return firecrawlResult;
    }
  }

  let htmlResult: { html: string; finalUrl: string; partial?: boolean } | null = null;
  let htmlError: unknown = null;

  try {
    htmlResult = await fetchHtmlDocument(deps.fetch, url, {
      timeoutMs,
      onProgress: deps.onProgress ?? null,
      onProfile: deps.onProfile ?? null,
    });
  } catch (error) {
    htmlError = error;
  }

  if (!htmlResult) {
    if (!canUseFirecrawl) {
      throw htmlError instanceof Error ? htmlError : new Error("Failed to fetch HTML document");
    }

    const firecrawlResult = await attemptFirecrawl(
      "HTML fetch failed; falling back to website scraper",
    );
    if (firecrawlResult) {
      return firecrawlResult;
    }

    const firecrawlError = websiteScrapeDiagnostics.notes
      ? `; Website scrape notes: ${websiteScrapeDiagnostics.notes}`
      : "";
    throw new Error(
      `Failed to fetch HTML document${firecrawlError}${
        htmlError instanceof Error ? `; HTML error: ${htmlError.message}` : ""
      }`,
    );
  }

  const html = htmlResult.html;
  const effectiveUrl = htmlResult.finalUrl || url;
  let readabilityCandidate: Awaited<ReturnType<typeof extractReadabilityFromHtml>> | null = null;

  if (isYouTubeUrl(effectiveUrl)) {
    const transcriptResolution =
      youtubeTranscriptResolutionCandidate ??
      (await resolveTranscriptForLink(effectiveUrl, html, deps, {
        youtubeTranscriptMode,
        mediaTranscriptMode,
        transcriptTimestamps,
        cacheMode,
        fileMtime,
      }));
    youtubeTranscriptResolutionCandidate ??= transcriptResolution;

    const youtubeTitle = extractYouTubeTitle(html);
    const youtubeDescription = extractYouTubeShortDescription(html);
    const descriptionCandidate = normalizeForPrompt(youtubeDescription ?? "");

    if (transcriptResolution.text || descriptionCandidate.length > 0) {
      const transcriptDiagnostics = ensureTranscriptDiagnostics(
        transcriptResolution,
        cacheMode ?? "default",
      );
      if (htmlResult.partial) {
        transcriptDiagnostics.notes = appendNote(
          transcriptDiagnostics.notes,
          "YouTube: stopped watch HTML fetch after bootstrap",
        );
      }

      return finalizeExtractedLinkContent({
        url: effectiveUrl,
        baseContent: selectBaseContent(
          descriptionCandidate,
          transcriptResolution.text,
          transcriptResolution.segments,
        ),
        maxCharacters,
        title: youtubeTitle,
        description: youtubeDescription,
        siteName: "YouTube",
        transcriptResolution,
        video: { kind: "youtube", url: effectiveUrl },
        isVideoOnly: false,
        diagnostics: {
          strategy: "html",
          websiteScrape: {
            ...websiteScrapeDiagnostics,
            notes: htmlResult.partial
              ? appendNote(
                  websiteScrapeDiagnostics.notes,
                  "YouTube: stopped watch HTML fetch after bootstrap",
                )
              : websiteScrapeDiagnostics.notes,
          },
          markdown: {
            requested: markdownRequested,
            used: false,
            provider: null,
            notes: "Skipping Markdown conversion for YouTube URLs",
          },
          transcript: transcriptDiagnostics,
        },
      });
    }

    if (htmlResult.partial) {
      try {
        htmlResult = await fetchHtmlDocument(deps.fetch, effectiveUrl, {
          timeoutMs,
          onProgress: deps.onProgress ?? null,
          onProfile: deps.onProfile ?? null,
        });
      } catch (error) {
        htmlError = error;
        htmlResult = null;
      }
    }
  }

  if (!htmlResult) {
    if (!canUseFirecrawl) {
      throw htmlError instanceof Error ? htmlError : new Error("Failed to fetch HTML document");
    }

    const firecrawlResult = await attemptFirecrawl(
      "HTML fetch failed; falling back to website scraper",
    );
    if (firecrawlResult) {
      return firecrawlResult;
    }

    const firecrawlError = websiteScrapeDiagnostics.notes
      ? `; Website scrape notes: ${websiteScrapeDiagnostics.notes}`
      : "";
    throw new Error(
      `Failed to fetch HTML document${firecrawlError}${
        htmlError instanceof Error ? `; HTML error: ${htmlError.message}` : ""
      }`,
    );
  }

  const fullHtml = htmlResult.html;
  const fullEffectiveUrl = htmlResult.finalUrl || effectiveUrl;

  if (firecrawlMode === "auto" && shouldFallbackToFirecrawl(fullHtml)) {
    readabilityCandidate = await extractReadabilityFromHtml(fullHtml, fullEffectiveUrl, {
      onProfile: deps.onProfile ?? null,
      phasePrefix: "readability.prefetch",
    });
    const readabilityText = readabilityCandidate?.text
      ? normalizeForPrompt(readabilityCandidate.text)
      : "";
    if (readabilityText.length < MIN_READABILITY_CONTENT_CHARACTERS) {
      const firecrawlResult = await attemptFirecrawl(
        "HTML content looked blocked/thin; falling back to website scraper",
      );
      if (firecrawlResult) {
        return firecrawlResult;
      }
    }
  }

  const htmlExtracted = await buildResultFromHtmlDocument({
    url: fullEffectiveUrl,
    html: fullHtml,
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
    transcriptResolutionCandidate: youtubeTranscriptResolutionCandidate,
  });
  if (twitterStatus && isBlockedTwitterContent(htmlExtracted.content)) {
    const birdNote = !deps.readTweetWithBird
      ? "X CLI not available"
      : birdError
        ? `X CLI failed: ${birdError instanceof Error ? birdError.message : String(birdError)}`
        : "X CLI returned no text";
    const nitterNote =
      nitterUrls.length > 0
        ? nitterError
          ? `Nitter failed: ${nitterError instanceof Error ? nitterError.message : String(nitterError)}`
          : "Nitter returned no text"
        : "Nitter not available";
    throw new Error(`Unable to fetch tweet content from X. ${birdNote}. ${nitterNote}.`);
  }
  return htmlExtracted;
}

export type { ExtractedLinkContent, FetchLinkContentOptions } from "./types.js";
