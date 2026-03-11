import { extractMediaFromBirdRaw, extractMediaFromXurlRaw } from "./media.js";
import type { BirdTweetPayload } from "./types.js";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

function resolveXurlArticleText(article: Record<string, unknown> | null): string | null {
  if (!article) return null;

  const title = asString(article.title)?.trim() ?? "";
  const body =
    asString(article.text)?.trim() ??
    asString(article.body)?.trim() ??
    asString(article.preview_text)?.trim() ??
    asString(article.excerpt)?.trim() ??
    "";

  if (title && body && !body.includes(title)) {
    return `${title}\n\n${body}`;
  }
  if (body) return body;
  if (title) return title;

  const articleResults = asRecord(article.article_results);
  const articleResult = asRecord(articleResults?.result);
  if (!articleResult) return null;
  return resolveXurlArticleText(articleResult);
}

function resolveXurlTweetText(data: Record<string, unknown>): string | null {
  const dataText = asString(data.text)?.trim() ?? "";
  const noteTweet = asRecord(data.note_tweet);
  const noteTweetText = asString(noteTweet?.text)?.trim() ?? "";
  const articleText = resolveXurlArticleText(asRecord(data.article)) ?? "";
  const candidates = [dataText, noteTweetText, articleText].filter((value) => value.length > 0);
  if (candidates.length === 0) return null;
  return candidates.sort((left, right) => right.length - left.length)[0] ?? null;
}

export function parseXurlTweetPayload(raw: unknown): BirdTweetPayload {
  const root = asRecord(raw);
  const errors = asArray(root?.errors);
  if (errors && errors.length > 0) {
    const first = asRecord(errors[0]);
    const message = asString(first?.message);
    if (message) throw new Error(`xurl API error: ${message}`);
  }

  const data = asRecord(root?.data);
  if (!data) {
    throw new Error("xurl read returned invalid payload");
  }

  const text = resolveXurlTweetText(data);
  if (!text) {
    throw new Error("xurl read returned invalid payload");
  }

  const includes = asRecord(root?.includes);
  const users = asArray(includes?.users) ?? [];
  const authorId = asString(data.author_id);
  const authorRecord =
    users.map((entry) => asRecord(entry)).find((entry) => asString(entry?.id) === authorId) ?? null;

  return {
    id: asString(data.id) ?? undefined,
    text,
    author:
      authorRecord && (asString(authorRecord.username) || asString(authorRecord.name))
        ? {
            username: asString(authorRecord.username) ?? undefined,
            name: asString(authorRecord.name) ?? undefined,
          }
        : undefined,
    createdAt: asString(data.created_at) ?? undefined,
    media: extractMediaFromXurlRaw(raw),
    client: "xurl",
  };
}

export function parseBirdTweetPayload(raw: unknown): BirdTweetPayload {
  const parsed = raw as
    | (BirdTweetPayload & { _raw?: unknown })
    | Array<BirdTweetPayload & { _raw?: unknown }>;
  const tweet = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!tweet || typeof tweet.text !== "string") {
    throw new Error("bird read returned invalid payload");
  }
  const { _raw, ...rest } = tweet as BirdTweetPayload & { _raw?: unknown };
  const media = extractMediaFromBirdRaw(_raw);
  return { ...rest, media, client: "bird" };
}
