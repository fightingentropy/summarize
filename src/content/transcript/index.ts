import type { LinkPreviewDeps } from "../link-preview/deps.js";
import { measureAsyncProfile } from "../link-preview/profiling.js";
import type {
  CacheMode,
  TranscriptDiagnostics,
  TranscriptResolution,
} from "../link-preview/types.js";
import {
  canonicalizeYouTubeVideoUrl,
  isDirectMediaUrl,
  isTwitterBroadcastUrl,
  isTwitterStatusUrl,
  isYouTubeUrl,
} from "../url.js";
import { mapCachedSource, readTranscriptCache, writeTranscriptCache } from "./cache.js";
import {
  canHandle as canHandleGeneric,
  fetchTranscript as fetchGeneric,
} from "./providers/generic.js";
import {
  canHandle as canHandlePodcast,
  fetchTranscript as fetchPodcast,
} from "./providers/podcast.js";
import {
  canHandle as canHandleYoutube,
  fetchTranscript as fetchYoutube,
} from "./providers/youtube.js";
import { resolveTranscriptionConfig } from "./transcription-config.js";
import type {
  ProviderContext,
  ProviderFetchOptions,
  ProviderModule,
  ProviderResult,
} from "./types.js";
import {
  extractEmbeddedYouTubeUrlFromHtml,
  extractYouTubeVideoId as extractYouTubeVideoIdInternal,
  isYouTubeUrl as isYouTubeUrlInternal,
} from "./utils.js";

interface ResolveTranscriptOptions {
  youtubeTranscriptMode?: ProviderFetchOptions["youtubeTranscriptMode"];
  mediaTranscriptMode?: ProviderFetchOptions["mediaTranscriptMode"];
  mediaKindHint?: ProviderFetchOptions["mediaKindHint"];
  transcriptTimestamps?: ProviderFetchOptions["transcriptTimestamps"];
  cacheMode?: CacheMode;
  fileMtime?: number | null;
  skipNegativeCacheWrite?: boolean;
}

const PROVIDERS: ProviderModule[] = [
  { id: "youtube", canHandle: canHandleYoutube, fetchTranscript: fetchYoutube },
  { id: "podcast", canHandle: canHandlePodcast, fetchTranscript: fetchPodcast },
  { id: "generic", canHandle: canHandleGeneric, fetchTranscript: fetchGeneric },
];
const GENERIC_PROVIDER_ID = "generic";
const GENERIC_PROVIDER_MEDIA_MARKERS = [
  "<video",
  "<audio",
  "<track",
  '<meta property="og:video',
  '<meta property="og:audio',
  '<meta name="og:video',
  '<meta name="og:audio',
] as const;

export const resolveTranscriptForLink = async (
  url: string,
  html: string | null,
  deps: LinkPreviewDeps,
  {
    youtubeTranscriptMode,
    mediaTranscriptMode,
    mediaKindHint,
    transcriptTimestamps,
    cacheMode: providedCacheMode,
    fileMtime,
    skipNegativeCacheWrite,
  }: ResolveTranscriptOptions = {},
): Promise<TranscriptResolution> => {
  const normalizedUrl = url.trim();
  const cacheUrl = normalizeTranscriptCacheUrl(normalizedUrl);
  return await measureAsyncProfile(
    {
      sink: deps.onProfile,
      name: "transcript.total",
      url: normalizedUrl,
      details: {
        cacheMode: providedCacheMode ?? "default",
        transcriptTimestamps: Boolean(transcriptTimestamps),
      },
      onSuccessDetails: (result) => ({
        source: result.source ?? null,
        textProvided: Boolean(result.text),
        segments: result.segments?.length ?? 0,
        cacheStatus: result.diagnostics?.cacheStatus ?? null,
      }),
    },
    async () => {
      const embeddedYoutubeUrl =
        !isYouTubeUrlInternal(normalizedUrl) && html
          ? await extractEmbeddedYouTubeUrlFromHtml(html)
          : null;
      const effectiveUrl = embeddedYoutubeUrl ?? normalizedUrl;
      const providerUrl = normalizeTranscriptProviderUrl(effectiveUrl);
      const resourceKey = extractResourceKey(effectiveUrl);
      const baseContext: ProviderContext = { url: providerUrl, html, resourceKey };
      const provider: ProviderModule = selectProvider(baseContext);
      const cacheMode: CacheMode = providedCacheMode ?? "default";

      const cacheOutcome = await measureAsyncProfile(
        {
          sink: deps.onProfile,
          name: "transcript.cache.read",
          url: normalizedUrl,
          details: {
            cacheMode,
            provider: provider.id,
            transcriptTimestamps: Boolean(transcriptTimestamps),
          },
          onSuccessDetails: (result) => ({
            cacheStatus: result.diagnostics.cacheStatus,
            hit: Boolean(result.resolution),
            hasCachedFallback: Boolean(result.cached?.content),
          }),
        },
        () =>
          readTranscriptCache({
            url: cacheUrl,
            cacheMode,
            transcriptCache: deps.transcriptCache,
            transcriptTimestamps: Boolean(transcriptTimestamps),
            fileMtime: fileMtime ?? null,
          }),
      );

      const diagnostics: TranscriptDiagnostics = {
        cacheMode,
        cacheStatus: cacheOutcome.diagnostics.cacheStatus,
        textProvided: cacheOutcome.diagnostics.textProvided,
        provider: cacheOutcome.diagnostics.provider,
        attemptedProviders: [],
        notes: cacheOutcome.diagnostics.notes ?? null,
      };

      if (cacheOutcome.resolution) {
        return {
          ...cacheOutcome.resolution,
          diagnostics,
        };
      }

      if (
        provider.id === GENERIC_PROVIDER_ID &&
        shouldSkipGenericTranscriptProbe({
          url: normalizedUrl,
          html,
          mediaTranscriptMode: mediaTranscriptMode ?? "auto",
        })
      ) {
        diagnostics.notes = appendNote(
          diagnostics.notes,
          "Skipped generic transcript probe (no obvious media markers)",
        );
        return {
          text: null,
          source: null,
          diagnostics,
          segments: null,
        };
      }

      const shouldReportProgress = provider.id === "youtube" || provider.id === "podcast";
      if (shouldReportProgress) {
        deps.onProgress?.({
          kind: "transcript-start",
          url: normalizedUrl,
          service: provider.id,
          hint:
            provider.id === "youtube"
              ? "YouTube: resolving transcript"
              : "Podcast: resolving transcript",
        });
      }

      const transcription = resolveTranscriptionConfig({
        env: deps.env,
        transcription: deps.transcription ?? null,
        falApiKey: deps.falApiKey,
        groqApiKey: deps.groqApiKey,
        assemblyaiApiKey: deps.assemblyaiApiKey,
        geminiApiKey: deps.geminiApiKey,
        openaiApiKey: deps.openaiApiKey,
      });

      const providerResult = await measureAsyncProfile(
        {
          sink: deps.onProfile,
          name: "transcript.provider.fetch",
          url: normalizedUrl,
          details: {
            provider: provider.id,
            youtubeTranscriptMode: youtubeTranscriptMode ?? "auto",
            mediaTranscriptMode: mediaTranscriptMode ?? "auto",
            transcriptTimestamps: Boolean(transcriptTimestamps),
          },
          onSuccessDetails: (result) => ({
            source: result.source ?? null,
            textProvided: Boolean(result.text),
            attemptedProviders: result.attemptedProviders.length,
            segments: result.segments?.length ?? 0,
          }),
        },
        () =>
          executeProvider(provider, baseContext, {
            fetch: deps.fetch,
            env: deps.env,
            scrapeWebsite: deps.scrapeWebsite,
            apifyApiToken: deps.apifyApiToken,
            ytDlpPath: deps.ytDlpPath,
            transcription,
            falApiKey: transcription.falApiKey,
            groqApiKey: transcription.groqApiKey,
            assemblyaiApiKey: transcription.assemblyaiApiKey,
            geminiApiKey: transcription.geminiApiKey,
            openaiApiKey: transcription.openaiApiKey,
            mediaCache: deps.mediaCache ?? null,
            resolveTwitterCookies: deps.resolveTwitterCookies ?? null,
            onProgress: deps.onProgress ?? null,
            youtubeTranscriptMode: youtubeTranscriptMode ?? "auto",
            mediaTranscriptMode: mediaTranscriptMode ?? "auto",
            mediaKindHint: mediaKindHint ?? null,
            transcriptTimestamps: transcriptTimestamps ?? false,
          }),
      );

      if (shouldReportProgress) {
        deps.onProgress?.({
          kind: "transcript-done",
          url: normalizedUrl,
          ok: Boolean(providerResult.text && providerResult.text.length > 0),
          service: provider.id,
          source: providerResult.source,
          hint: providerResult.source ? `${provider.id}/${providerResult.source}` : provider.id,
        });
      }

      diagnostics.provider = providerResult.source;
      diagnostics.attemptedProviders = providerResult.attemptedProviders;
      diagnostics.textProvided = Boolean(providerResult.text && providerResult.text.length > 0);
      if (providerResult.notes) {
        diagnostics.notes = appendNote(diagnostics.notes, providerResult.notes);
      }

      if (providerResult.source !== null || providerResult.text !== null) {
        if (transcriptTimestamps) {
          const nextMeta = { ...(providerResult.metadata ?? {}) };
          if (providerResult.segments && providerResult.segments.length > 0) {
            nextMeta.timestamps = true;
            nextMeta.segments = providerResult.segments;
          } else if (nextMeta.timestamps == null) {
            nextMeta.timestamps = false;
          }
          providerResult.metadata = nextMeta;
        } else if (providerResult.segments && providerResult.segments.length > 0) {
          providerResult.metadata = {
            ...(providerResult.metadata ?? {}),
            segments: providerResult.segments,
          };
        }
        if (
          !(
            !providerResult.text &&
            (skipNegativeCacheWrite || shouldSkipNegativeCacheWriteForResult(providerResult))
          )
        ) {
          await measureAsyncProfile(
            {
              sink: deps.onProfile,
              name: "transcript.cache.write",
              url: normalizedUrl,
              details: {
                provider: provider.id,
                source: providerResult.source ?? null,
                hasText: Boolean(providerResult.text),
              },
            },
            () =>
              writeTranscriptCache({
                url: cacheUrl,
                service: provider.id,
                resourceKey,
                result: providerResult,
                transcriptCache: deps.transcriptCache,
                fileMtime,
              }),
          );
        }
      }

      if (!providerResult.text && cacheOutcome.cached?.content && cacheMode !== "bypass") {
        diagnostics.cacheStatus = "fallback";
        diagnostics.provider = mapCachedSource(cacheOutcome.cached.source);
        diagnostics.textProvided = Boolean(
          cacheOutcome.cached.content && cacheOutcome.cached.content.length > 0,
        );
        diagnostics.notes = appendNote(
          diagnostics.notes,
          "Falling back to cached transcript content after provider miss",
        );

        return {
          text: cacheOutcome.cached.content,
          source: diagnostics.provider,
          metadata: cacheOutcome.cached.metadata ?? null,
          diagnostics,
          segments: transcriptTimestamps
            ? resolveSegmentsFromMetadata(cacheOutcome.cached.metadata)
            : null,
        };
      }

      return {
        text: providerResult.text,
        source: providerResult.source,
        metadata: providerResult.metadata ?? null,
        diagnostics,
        segments: transcriptTimestamps ? (providerResult.segments ?? null) : null,
      };
    },
  );
};

const extractResourceKey = (url: string): string | null => {
  if (isYouTubeUrlInternal(url)) {
    return extractYouTubeVideoIdInternal(url);
  }
  return null;
};

const normalizeTranscriptCacheUrl = (url: string): string => {
  if (!isYouTubeUrl(url)) {
    return url;
  }
  return canonicalizeYouTubeVideoUrl(url) ?? url;
};

const normalizeTranscriptProviderUrl = (url: string): string => {
  if (!isYouTubeUrlInternal(url)) {
    return url;
  }
  return canonicalizeYouTubeVideoUrl(url) ?? url;
};

const shouldSkipNegativeCacheWriteForResult = (result: ProviderResult): boolean => {
  if (result.text) {
    return false;
  }

  const metadata = result.metadata as Record<string, unknown> | null | undefined;
  return metadata?.cacheable === false || metadata?.transient === true;
};

const shouldSkipGenericTranscriptProbe = ({
  url,
  html,
  mediaTranscriptMode,
}: {
  url: string;
  html: string | null;
  mediaTranscriptMode: NonNullable<ResolveTranscriptOptions["mediaTranscriptMode"]>;
}): boolean => {
  if (mediaTranscriptMode === "prefer" || !html) {
    return false;
  }

  if (isDirectMediaUrl(url) || isTwitterStatusUrl(url) || isTwitterBroadcastUrl(url)) {
    return false;
  }

  const normalizedHtml = html.toLowerCase();
  return !GENERIC_PROVIDER_MEDIA_MARKERS.some((marker) => normalizedHtml.includes(marker));
};

const selectProvider = (context: ProviderContext): ProviderModule => {
  const genericProviderModule = PROVIDERS.find((provider) => provider.id === GENERIC_PROVIDER_ID);

  const specializedProvider = PROVIDERS.find(
    (provider) => provider.id !== GENERIC_PROVIDER_ID && provider.canHandle(context),
  );
  if (specializedProvider) {
    return specializedProvider;
  }

  if (genericProviderModule) {
    return genericProviderModule;
  }

  throw new Error("Generic transcript provider is not registered");
};

const executeProvider = async (
  provider: ProviderModule,
  context: ProviderContext,
  options: ProviderFetchOptions,
): Promise<ProviderResult> => provider.fetchTranscript(context, options);

const appendNote = (existing: string | null | undefined, next: string): string => {
  if (!existing) {
    return next;
  }
  return `${existing}; ${next}`;
};

const resolveSegmentsFromMetadata = (metadata?: Record<string, unknown> | null) => {
  if (!metadata) return null;
  const segments = (metadata as { segments?: unknown }).segments;
  return Array.isArray(segments) && segments.length > 0
    ? (segments as TranscriptResolution["segments"])
    : null;
};
