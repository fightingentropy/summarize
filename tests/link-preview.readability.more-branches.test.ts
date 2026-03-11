import { describe, expect, it } from "vitest";
import {
  extractReadabilityFromHtml,
  toReadabilityHtml,
} from "../packages/core/src/content/link-preview/content/readability.js";

describe("readability helpers", () => {
  it("returns null for unreadable html and import-safe failures", async () => {
    await expect(extractReadabilityFromHtml("<html><body></body></html>")).resolves.toBeNull();
  });

  it("falls back to escaped article html when only text exists", () => {
    expect(
      toReadabilityHtml({
        text: `<Hello & "world">`,
        html: null,
        title: null,
        excerpt: null,
      }),
    ).toBe("<article><p>&lt;Hello &amp; &quot;world&quot;&gt;</p></article>");
    expect(toReadabilityHtml({ text: "", html: null, title: null, excerpt: null })).toBeNull();
    expect(toReadabilityHtml(null)).toBeNull();
  });
});
