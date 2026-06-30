import { describe, expect, it } from "vitest";
import {
  applyContentBudget,
  clipAtSentenceBoundary,
  clipHeadAndTail,
  decodeHtmlEntities,
  normalizeCandidate,
  normalizeForPrompt,
  normalizeWhitespace,
  stripInvisibleUnicode,
} from "../src/content/link-preview/content/cleaner.js";

describe("content cleaner utilities", () => {
  it("normalizes whitespace for prompts", () => {
    const input = `Hello\u00A0\u00A0world\t\t\n\n  next \n\n\n line`;
    expect(normalizeForPrompt(input)).toBe("Hello world\nnext\nline");
    expect(normalizeWhitespace(input)).toBe("Hello world\nnext\nline");
  });

  it("strips invisible unicode characters", () => {
    const input = `Hello\u200B\u200Cworld\u202E!\uFEFF\u{E0000}`;
    expect(stripInvisibleUnicode(input)).toBe("Helloworld!");
    expect(normalizeForPrompt(input)).toBe("Helloworld!");
    expect(normalizeWhitespace(input)).toBe("Helloworld!");
  });

  it("decodes common HTML entities", () => {
    expect(decodeHtmlEntities("&lt;tag&gt; &amp; &#39;x&#39;")).toBe("<tag> & 'x'");
  });

  it("normalizes candidates", () => {
    expect(normalizeCandidate(null)).toBeNull();
    expect(normalizeCandidate("   ")).toBeNull();
    expect(normalizeCandidate("  A   B \n C  ")).toBe("A B C");
  });

  it("clips at sentence boundary when possible", () => {
    const input = "First sentence. Second sentence. Third sentence.";
    expect(clipAtSentenceBoundary(input, 22)).toBe("First sentence.");
    expect(clipAtSentenceBoundary(input, 3)).toBe("Fir");
    expect(clipAtSentenceBoundary(input, 200)).toBe(input);
  });

  it("applies a content budget and counts words", () => {
    const content = "Hello world. This is a test.";
    const result = applyContentBudget(content, 10);
    expect(result.truncated).toBe(true);
    expect(result.totalCharacters).toBe(content.length);
    expect(result.content.length).toBeLessThanOrEqual(10);
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it("keeps content when under budget and reports empty word count", () => {
    const content = "Short line.";
    const result = applyContentBudget(content, 100);
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(content);
    expect(result.wordCount).toBeGreaterThan(0);

    const empty = applyContentBudget("", 10);
    expect(empty.truncated).toBe(false);
    expect(empty.content).toBe("");
    expect(empty.wordCount).toBe(0);
  });

  it("drops the middle when applying a generous content budget", () => {
    const input = `HEAD_START ${"x".repeat(3000)} MIDDLE_MARKER ${"y".repeat(3000)} TAIL_END`;
    const result = applyContentBudget(input, 2000);
    expect(result.truncated).toBe(true);
    expect(result.totalCharacters).toBe(input.length);
    expect(result.content.length).toBeLessThanOrEqual(2000);
    expect(result.content).toContain("HEAD_START");
    expect(result.content).toContain("TAIL_END");
    expect(result.content).not.toContain("MIDDLE_MARKER");
  });
});

describe("clipHeadAndTail", () => {
  it("returns input unchanged when within budget", () => {
    expect(clipHeadAndTail("short content", 100)).toBe("short content");
  });

  it("keeps the head and tail and drops the middle for oversized input", () => {
    const input = `HEAD_START ${"x".repeat(3000)} MIDDLE_MARKER ${"y".repeat(3000)} TAIL_END`;
    const out = clipHeadAndTail(input, 2000);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out).toContain("HEAD_START");
    expect(out).toContain("TAIL_END");
    expect(out).toContain("truncated"); // omission marker is present
    expect(out).not.toContain("MIDDLE_MARKER");
  });

  it("falls back to a head-only clip when the budget is too small for a tail", () => {
    const input = "First sentence. Second sentence. Third sentence. Fourth sentence.";
    const out = clipHeadAndTail(input, 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out).not.toContain("truncated"); // no omission marker
    expect(input.startsWith(out)).toBe(true); // a pure head-only prefix
  });
});
