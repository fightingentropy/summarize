import { createHash } from "node:crypto";
import path from "node:path";

export function buildYoutubeSourceId(videoId: string): string {
  return `youtube-${videoId}`;
}

export function buildDirectSourceId(url: string): string {
  const parsed = (() => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  })();
  const hostSlug = resolveHostSlug(parsed);
  const rawName = parsed ? path.basename(parsed.pathname) : "video";
  const base = rawName.replace(/\.[a-z0-9]+$/i, "").trim() || "video";
  const slug = toSlug(base);
  const combined = [hostSlug, slug].filter(Boolean).join("-");
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 8);
  return combined ? `${combined}-${hash}` : `video-${hash}`;
}

function resolveHostSlug(parsed: URL | null): string | null {
  if (!parsed?.hostname) return null;
  const host = parsed.hostname.toLowerCase();
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") {
    return "youtube";
  }
  const slug = toSlug(host);
  return slug || null;
}

function toSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) return "";
  return normalized.length <= 64 ? normalized : normalized.slice(0, 64).replace(/-+$/g, "");
}
