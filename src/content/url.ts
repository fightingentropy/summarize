import { isPodcastHost } from "./link-preview/content/podcast-utils.js";
import { isTwitterBroadcastUrl, isTwitterStatusUrl } from "./link-preview/content/twitter-utils.js";

export const isYouTubeUrl = (rawUrl: string): boolean => {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return (
      hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be"
    );
  } catch {
    const lower = rawUrl.toLowerCase();
    return lower.includes("youtube.com") || lower.includes("youtu.be");
  }
};

const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
export const DIRECT_MEDIA_EXTENSIONS = [
  "mp4",
  "mov",
  "m4v",
  "mkv",
  "webm",
  "mpeg",
  "mpg",
  "avi",
  "wmv",
  "flv",
  "mp3",
  "m4a",
  "wav",
  "flac",
  "aac",
  "ogg",
  "opus",
  "aiff",
  "wma",
] as const;
const DIRECT_MEDIA_EXTENSION_SET = new Set<string>(DIRECT_MEDIA_EXTENSIONS);
const DIRECT_MEDIA_URL_PATTERN = new RegExp(
  `\\.(${DIRECT_MEDIA_EXTENSIONS.join("|")})(\\?|#|$)`,
  "i",
);

export function isYouTubeVideoUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();

    if (hostname === "youtu.be") {
      return Boolean(url.pathname.split("/").filter(Boolean)[0]);
    }

    if (hostname !== "youtube.com" && !hostname.endsWith(".youtube.com")) {
      return false;
    }

    if (url.pathname === "/watch") {
      return Boolean(url.searchParams.get("v")?.trim());
    }

    return (
      url.pathname.startsWith("/shorts/") ||
      url.pathname.startsWith("/live/") ||
      url.pathname.startsWith("/embed/") ||
      url.pathname.startsWith("/v/")
    );
  } catch {
    return false;
  }
}

function normalizeYouTubeVideoId(candidate: string | null | undefined): string | null {
  const trimmed = candidate?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  return YOUTUBE_VIDEO_ID_PATTERN.test(trimmed) ? trimmed : null;
}

function extractNestedYouTubeUrl(url: URL): URL | null {
  for (const paramName of ["u", "url", "q"] as const) {
    const raw = url.searchParams.get(paramName)?.trim();
    if (!raw) {
      continue;
    }

    try {
      return new URL(raw, `${url.protocol}//${url.host}`);
    } catch {
      continue;
    }
  }

  return null;
}

function extractYouTubeVideoIdFromParsedUrl(url: URL, depth = 0): string | null {
  if (depth > 2) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "youtu.be") {
    return normalizeYouTubeVideoId(url.pathname.split("/").filter(Boolean)[0] ?? null);
  }

  if (hostname !== "youtube.com" && !hostname.endsWith(".youtube.com")) {
    return null;
  }

  if (url.pathname.startsWith("/watch")) {
    return (
      normalizeYouTubeVideoId(url.searchParams.get("v")) ??
      normalizeYouTubeVideoId(url.searchParams.get("vi"))
    );
  }

  if (
    url.pathname.startsWith("/shorts/") ||
    url.pathname.startsWith("/live/") ||
    url.pathname.startsWith("/embed/") ||
    url.pathname.startsWith("/v/")
  ) {
    return normalizeYouTubeVideoId(url.pathname.split("/").filter(Boolean)[1] ?? null);
  }

  if (url.pathname.startsWith("/attribution_link") || url.pathname.startsWith("/redirect")) {
    const nestedUrl = extractNestedYouTubeUrl(url);
    if (nestedUrl) {
      return extractYouTubeVideoIdFromParsedUrl(nestedUrl, depth + 1);
    }
  }

  return null;
}

export function extractYouTubeVideoId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    return extractYouTubeVideoIdFromParsedUrl(url);
  } catch {
    // ignore parsing errors
  }
  return null;
}

export function canonicalizeYouTubeVideoUrl(rawUrl: string): string | null {
  const videoId = extractYouTubeVideoId(rawUrl);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

export function isDirectMediaUrl(url: string): boolean {
  return DIRECT_MEDIA_URL_PATTERN.test(url);
}

export function isDirectMediaExtension(ext: string): boolean {
  const normalized = ext.trim().replace(/^\./, "").toLowerCase();
  return DIRECT_MEDIA_EXTENSION_SET.has(normalized);
}

export function shouldPreferUrlMode(url: string): boolean {
  return (
    isYouTubeVideoUrl(url) ||
    isTwitterStatusUrl(url) ||
    isTwitterBroadcastUrl(url) ||
    isDirectMediaUrl(url) ||
    isPodcastHost(url)
  );
}

export { isTwitterBroadcastUrl, isTwitterStatusUrl, isPodcastHost };
