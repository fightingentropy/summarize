import { compact } from "es-toolkit";

const WORD_SPLIT_PATTERN = /\s+/g;

export interface ContentBudgetResult {
  content: string;
  truncated: boolean;
  totalCharacters: number;
  wordCount: number;
}

export function normalizeForPrompt(input: string): string {
  return stripInvisibleUnicode(input)
    .replaceAll("\u00A0", " ")
    .replaceAll(/[\t ]+/g, " ")
    .replaceAll(/\s*\n\s*/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeWhitespace(input: string): string {
  return stripInvisibleUnicode(input)
    .replaceAll("\u00A0", " ")
    .replaceAll(/[\t ]+/g, " ")
    .replaceAll(/\s*\n\s*/g, "\n")
    .trim();
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&nbsp;", " ");
}

export function stripInvisibleUnicode(input: string): string {
  return input.replaceAll(
    /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu,
    "",
  );
}

export function normalizeCandidate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.replaceAll(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function clipAtSentenceBoundary(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  const slice = input.slice(0, maxLength);
  const lastSentenceBreak = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("\n\n"),
  );
  if (lastSentenceBreak > maxLength * 0.5) {
    return slice.slice(0, lastSentenceBreak + 1);
  }
  return slice;
}

// Marker left where the middle of an over-budget document is dropped. Kept
// short so it costs little of the budget, and explicit so the model — and
// anyone reading --json output — can tell the input was clipped, not complete.
const HEAD_TAIL_OMISSION_MARKER = "\n\n[… middle truncated to fit length budget …]\n\n";

// Below this budget a head+tail split leaves windows too small to be useful, so
// a single head-only clip reads better. Sized to comfortably clear the marker.
const MIN_HEAD_TAIL_BUDGET = HEAD_TAIL_OMISSION_MARKER.length + 400;

/**
 * Clip `input` to at most `maxLength` characters while keeping BOTH a head and
 * a tail window, dropping the middle. For summarization the closing material —
 * conclusions, results, recommendations — is often the highest-value part of a
 * document, so removing the middle preserves more signal than a head-only cut.
 *
 * - Returns `input` unchanged when it already fits.
 * - The result never exceeds `maxLength` characters (omission marker included).
 * - Head and tail cuts snap to a nearby sentence/line boundary when one is
 *   close, so windows don't begin or end mid-sentence.
 * - Falls back to a head-only {@link clipAtSentenceBoundary} when `maxLength` is
 *   too small to hold a meaningful head + marker + tail.
 */
export function clipHeadAndTail(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  if (maxLength <= MIN_HEAD_TAIL_BUDGET) {
    return clipAtSentenceBoundary(input, maxLength);
  }

  const windowBudget = maxLength - HEAD_TAIL_OMISSION_MARKER.length;
  const headBudget = Math.floor(windowBudget * 0.75);
  const tailBudget = windowBudget - headBudget;

  let head = input.slice(0, headBudget);
  const headBreak = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
    head.lastIndexOf("\n"),
  );
  if (headBreak > headBudget * 0.5) {
    head = head.slice(0, headBreak + 1);
  }

  let tail = input.slice(input.length - tailBudget);
  const tailBreak = Math.min(
    ...[tail.indexOf("\n"), tail.indexOf(". "), tail.indexOf("! "), tail.indexOf("? ")]
      .filter((index) => index >= 0)
      .concat(tailBudget),
  );
  if (tailBreak < tailBudget * 0.5) {
    tail = tail.slice(tailBreak + 1);
  }

  return `${head.trimEnd()}${HEAD_TAIL_OMISSION_MARKER}${tail.trimStart()}`;
}

export function applyContentBudget(
  baseContent: string,
  maxCharacters: number,
): ContentBudgetResult {
  const totalCharacters = baseContent.length;
  const truncated = totalCharacters > maxCharacters;
  const clipped = truncated ? clipHeadAndTail(baseContent, maxCharacters) : baseContent;
  const content = clipped.trim();
  const wordCount = content.length > 0 ? compact(content.split(WORD_SPLIT_PATTERN)).length : 0;
  return { content, truncated, totalCharacters, wordCount };
}
