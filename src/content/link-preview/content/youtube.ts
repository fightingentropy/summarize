import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { LinkPreviewProfileSink } from "../profiling.js";
import { measureAsyncProfile } from "../profiling.js";
import { normalizeWhitespace } from "./cleaner.js";

const INNERTUBE_API_KEY_REGEX =
  /"INNERTUBE_API_KEY":"([^"]+)"|INNERTUBE_API_KEY\\":\\"([^\\"]+)\\"/;
const YOUTUBE_OEMBED_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  Accept: "application/json",
};

export type YouTubeOEmbedMetadata = {
  title: string | null;
  authorName: string | null;
};

export type YouTubeAvailabilityIssueReason =
  | "consent_interstitial"
  | "bot_check"
  | "login_required"
  | "age_restricted"
  | "private_video"
  | "members_only"
  | "geo_restricted"
  | "video_unavailable";

export type YouTubeAvailabilityIssue = {
  reason: YouTubeAvailabilityIssueReason;
  message: string;
  transient: boolean;
  cacheable: boolean;
};

const YOUTUBE_CONSENT_MARKERS = [
  "before you continue to youtube",
  "consent.youtube.com",
  "consent.google.com",
  "consent bump",
  "consent to the use of cookies",
] as const;

const YOUTUBE_BOT_CHECK_MARKERS = [
  "unusual traffic from your computer network",
  "our systems have detected unusual traffic",
  "sorry/index",
  "g-recaptcha",
  "recaptcha",
  "detected unusual traffic",
] as const;

function extractBalancedJsonObject(source: string, startAt: number): string | null {
  const start = source.indexOf("{", startAt);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (!ch) {
      continue;
    }

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (quote && ch === quote) {
        inString = false;
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return null;
}

function normalizeYouTubeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeWhitespace(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeIssueMessage(value: string | null | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function getObjectProperty(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : null;
}

function extractRunsText(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const runs = (value as Record<string, unknown>).runs;
  if (!Array.isArray(runs)) {
    return null;
  }

  const text = runs
    .map((run) =>
      run && typeof run === "object" && typeof (run as Record<string, unknown>).text === "string"
        ? ((run as Record<string, unknown>).text as string)
        : "",
    )
    .join(" ");
  return normalizeYouTubeText(text);
}

function extractPlayabilityReasonText(playability: Record<string, unknown>): string | null {
  const directReason = normalizeYouTubeText(playability.reason);
  if (directReason) {
    return directReason;
  }

  const renderer =
    getObjectProperty(
      getObjectProperty(playability, "errorScreen"),
      "playerErrorMessageRenderer",
    ) ?? getObjectProperty(playability, "errorScreen");
  if (!renderer) {
    return null;
  }

  const simpleReason = normalizeYouTubeText(getObjectProperty(renderer, "reason")?.simpleText);
  if (simpleReason) {
    return simpleReason;
  }

  const runsReason = extractRunsText(getObjectProperty(renderer, "reason"));
  if (runsReason) {
    return runsReason;
  }

  const simpleSubreason = normalizeYouTubeText(
    getObjectProperty(renderer, "subreason")?.simpleText,
  );
  if (simpleSubreason) {
    return simpleSubreason;
  }

  return extractRunsText(getObjectProperty(renderer, "subreason"));
}

export function hasYouTubeBlockingInterstitial(html: string): boolean {
  const normalizedHtml = html.toLowerCase();
  return (
    YOUTUBE_CONSENT_MARKERS.some((marker) => normalizedHtml.includes(marker)) ||
    YOUTUBE_BOT_CHECK_MARKERS.some((marker) => normalizedHtml.includes(marker))
  );
}

export function extractYouTubeAvailabilityIssue(html: string): YouTubeAvailabilityIssue | null {
  const normalizedHtml = html.toLowerCase();

  if (YOUTUBE_BOT_CHECK_MARKERS.some((marker) => normalizedHtml.includes(marker))) {
    return {
      reason: "bot_check",
      message: "YouTube returned a bot-check or unusual-traffic page",
      transient: true,
      cacheable: false,
    };
  }

  if (YOUTUBE_CONSENT_MARKERS.some((marker) => normalizedHtml.includes(marker))) {
    return {
      reason: "consent_interstitial",
      message: "YouTube returned a consent interstitial instead of video data",
      transient: true,
      cacheable: false,
    };
  }

  const playerResponse = extractYouTubeInitialPlayerResponse(html);
  const playability = playerResponse
    ? getObjectProperty(playerResponse, "playabilityStatus")
    : null;
  if (!playability) {
    return null;
  }

  const status = normalizeYouTubeText(playability.status)?.toUpperCase() ?? null;
  if (!status || status === "OK") {
    return null;
  }

  const reason = extractPlayabilityReasonText(playability);
  const normalizedReason = reason?.toLowerCase() ?? "";

  if (
    status === "CONTENT_CHECK_REQUIRED" ||
    normalizedReason.includes("confirm your age") ||
    normalizedReason.includes("inappropriate for some users")
  ) {
    return {
      reason: "age_restricted",
      message: normalizeIssueMessage(reason, "YouTube requires sign-in to confirm age"),
      transient: false,
      cacheable: true,
    };
  }

  if (status === "LOGIN_REQUIRED") {
    return {
      reason: normalizedReason.includes("age") ? "age_restricted" : "login_required",
      message: normalizeIssueMessage(reason, "YouTube requires sign-in to view this video"),
      transient: false,
      cacheable: true,
    };
  }

  if (normalizedReason.includes("private")) {
    return {
      reason: "private_video",
      message: normalizeIssueMessage(reason, "This YouTube video is private"),
      transient: false,
      cacheable: true,
    };
  }

  if (normalizedReason.includes("member")) {
    return {
      reason: "members_only",
      message: normalizeIssueMessage(reason, "This YouTube video is members-only"),
      transient: false,
      cacheable: true,
    };
  }

  if (normalizedReason.includes("country") || normalizedReason.includes("region")) {
    return {
      reason: "geo_restricted",
      message: normalizeIssueMessage(reason, "This YouTube video is unavailable in your region"),
      transient: false,
      cacheable: true,
    };
  }

  if (status === "UNPLAYABLE" || status === "ERROR") {
    return {
      reason: "video_unavailable",
      message: normalizeIssueMessage(reason, "This YouTube video is unavailable"),
      transient: false,
      cacheable: true,
    };
  }

  return null;
}

export function extractYouTubeInitialPlayerResponse(html: string): Record<string, unknown> | null {
  const tokenIndex = html.indexOf("ytInitialPlayerResponse");
  if (tokenIndex < 0) {
    return null;
  }
  const assignmentIndex = html.indexOf("=", tokenIndex);
  if (assignmentIndex < 0) {
    return null;
  }
  const objectText = extractBalancedJsonObject(html, assignmentIndex);
  if (!objectText) {
    return null;
  }

  try {
    const parsed = JSON.parse(objectText) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function extractYouTubeInnertubeApiKey(html: string): string | null {
  const match = html.match(INNERTUBE_API_KEY_REGEX);
  const key = match?.[1] ?? match?.[2] ?? null;
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}

export function hasCompleteYouTubeWatchBootstrap(html: string): boolean {
  return (
    extractYouTubeInitialPlayerResponse(html) !== null &&
    extractYouTubeInnertubeApiKey(html) !== null
  );
}

export function extractYouTubeTitle(html: string): string | null {
  const parsed = extractYouTubeInitialPlayerResponse(html);
  if (!parsed) {
    return null;
  }

  const videoDetails = parsed.videoDetails;
  if (!videoDetails || typeof videoDetails !== "object") {
    return null;
  }

  return normalizeYouTubeText((videoDetails as Record<string, unknown>).title);
}

export function extractYouTubeShortDescription(html: string): string | null {
  const parsed = extractYouTubeInitialPlayerResponse(html);
  if (!parsed) {
    return null;
  }

  const videoDetails = parsed.videoDetails;
  if (!videoDetails || typeof videoDetails !== "object") {
    return null;
  }

  return normalizeYouTubeText((videoDetails as Record<string, unknown>).shortDescription);
}

export async function fetchYouTubeOEmbedMetadata(
  fetchImpl: typeof fetch,
  videoUrl: string,
  {
    timeoutMs,
    onProfile,
  }: {
    timeoutMs: number;
    onProfile?: LinkPreviewProfileSink | null;
  },
): Promise<YouTubeOEmbedMetadata | null> {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
  const effectiveTimeoutMs =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
      ? Math.max(250, Math.min(timeoutMs, 1_500))
      : 1_500;

  return await measureAsyncProfile(
    {
      sink: onProfile,
      name: "youtube.oembed",
      url: videoUrl,
      onSuccessDetails: (value) => ({
        hasMetadata: Boolean(value),
        hasTitle: Boolean(value?.title),
        hasAuthorName: Boolean(value?.authorName),
      }),
    },
    async () => {
      try {
        const response = await fetchWithTimeout(
          fetchImpl,
          endpoint,
          { headers: YOUTUBE_OEMBED_HEADERS },
          effectiveTimeoutMs,
        );
        if (!response.ok) {
          return null;
        }

        const payload = (await response.json()) as unknown;
        if (!payload || typeof payload !== "object") {
          return null;
        }

        const record = payload as Record<string, unknown>;
        const title = normalizeYouTubeText(record.title);
        const authorName = normalizeYouTubeText(record.author_name);
        return title || authorName ? { title, authorName } : null;
      } catch {
        return null;
      }
    },
  );
}
