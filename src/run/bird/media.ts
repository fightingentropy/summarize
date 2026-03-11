import type { BirdTweetMedia } from "./types.js";

const URL_PREFIX_PATTERN = /^https?:\/\//i;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asNumber = (value: unknown): number | null => (typeof value === "number" ? value : null);

const isLikelyVideoUrl = (url: string): boolean =>
  url.includes("video.twimg.com") || url.includes("/i/broadcasts/") || url.endsWith(".m3u8");

const addUrl = (set: Set<string>, value: string | null) => {
  if (!value) return;
  if (!URL_PREFIX_PATTERN.test(value)) return;
  set.add(value);
};

export function extractMediaFromBirdRaw(raw: unknown): BirdTweetMedia | null {
  const root = asRecord(raw);
  if (!root) return null;

  const legacy = asRecord(root.legacy);
  const extended = asRecord(legacy?.extended_entities);
  const mediaEntries = asArray(extended?.media);
  if (mediaEntries && mediaEntries.length > 0) {
    const urls = new Set<string>();
    let preferredUrl: string | null = null;
    let preferredBitrate = -1;
    let kind: BirdTweetMedia["kind"] = "video";

    for (const entry of mediaEntries) {
      const media = asRecord(entry);
      const mediaType = asString(media?.type);
      if (mediaType === "audio") {
        kind = "audio";
      }
      if (mediaType !== "video" && mediaType !== "animated_gif" && mediaType !== "audio") {
        continue;
      }
      const videoInfo = asRecord(media?.video_info);
      const variants = asArray(videoInfo?.variants);
      if (!variants) continue;
      for (const variant of variants) {
        const variantRecord = asRecord(variant);
        const url = asString(variantRecord?.url);
        if (!url) continue;
        addUrl(urls, url);
        const contentType = asString(variantRecord?.content_type) ?? "";
        const bitrate = asNumber(variantRecord?.bitrate) ?? -1;
        if (contentType.includes("video/mp4") && bitrate >= preferredBitrate) {
          preferredBitrate = bitrate;
          preferredUrl = url;
        } else if (!preferredUrl) {
          preferredUrl = url;
        }
      }
    }

    if (urls.size > 0) {
      return {
        kind,
        urls: Array.from(urls),
        preferredUrl,
        source: "extended_entities",
      };
    }
  }

  const card = asRecord(root.card);
  const cardLegacy = asRecord(card?.legacy);
  const bindings = asArray(cardLegacy?.binding_values);
  if (bindings) {
    const urls = new Set<string>();
    for (const binding of bindings) {
      const record = asRecord(binding);
      const key = asString(record?.key);
      if (key !== "broadcast_url") continue;
      const value = asRecord(record?.value);
      const url = asString(value?.string_value);
      addUrl(urls, url);
    }
    if (urls.size > 0) {
      const preferredUrl = urls.values().next().value ?? null;
      return {
        kind: "video",
        urls: Array.from(urls),
        preferredUrl,
        source: "card",
      };
    }
  }

  const entities = asRecord(legacy?.entities);
  const entityUrls = asArray(entities?.urls);
  if (entityUrls) {
    const urls = new Set<string>();
    for (const entity of entityUrls) {
      const record = asRecord(entity);
      const expanded = asString(record?.expanded_url);
      if (!expanded || !isLikelyVideoUrl(expanded)) continue;
      addUrl(urls, expanded);
    }
    if (urls.size > 0) {
      const preferredUrl = urls.values().next().value ?? null;
      return {
        kind: "video",
        urls: Array.from(urls),
        preferredUrl,
        source: "entities",
      };
    }
  }

  return null;
}

export function extractMediaFromXurlRaw(raw: unknown): BirdTweetMedia | null {
  const root = asRecord(raw);
  if (!root) return null;

  const data = asRecord(root.data);
  const includes = asRecord(root.includes);
  const attachments = asRecord(data?.attachments);
  const mediaKeys = new Set(
    (asArray(attachments?.media_keys) ?? [])
      .map((value) => asString(value))
      .filter((value): value is string => Boolean(value)),
  );
  const mediaEntries = asArray(includes?.media) ?? [];
  if (mediaEntries.length === 0) return null;

  const urls = new Set<string>();
  let preferredUrl: string | null = null;
  let preferredBitrate = -1;
  let kind: BirdTweetMedia["kind"] = "video";

  for (const entry of mediaEntries) {
    const media = asRecord(entry);
    const mediaKey = asString(media?.media_key);
    if (mediaKeys.size > 0 && mediaKey && !mediaKeys.has(mediaKey)) continue;

    const mediaType = asString(media?.type);
    if (mediaType !== "video" && mediaType !== "animated_gif" && mediaType !== "audio") continue;
    if (mediaType === "audio") kind = "audio";

    for (const variant of asArray(media?.variants) ?? []) {
      const record = asRecord(variant);
      const url = asString(record?.url);
      if (!url) continue;
      addUrl(urls, url);
      const contentType = asString(record?.content_type) ?? "";
      const bitrate = asNumber(record?.bit_rate) ?? -1;
      if (contentType.includes("video/mp4") && bitrate >= preferredBitrate) {
        preferredBitrate = bitrate;
        preferredUrl = url;
      } else if (!preferredUrl) {
        preferredUrl = url;
      }
    }

    const directUrl = asString(media?.url);
    if (directUrl) {
      addUrl(urls, directUrl);
      if (!preferredUrl) preferredUrl = directUrl;
    }
  }

  if (urls.size === 0) return null;
  return {
    kind,
    urls: Array.from(urls),
    preferredUrl,
    source: "xurl",
  };
}
