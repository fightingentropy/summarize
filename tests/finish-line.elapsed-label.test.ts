import { describe, expect, it } from "vitest";
import { buildFinishLineText } from "../src/run/finish-line.js";

const baseReport = {
  llm: [{ promptTokens: 1, completionTokens: 1, totalTokens: 2, calls: 1 }],
  services: { firecrawl: { requests: 0 }, apify: { requests: 0 } },
};

describe("finish line elapsed label", () => {
  it("uses custom elapsed label when provided", () => {
    const text = buildFinishLineText({
      elapsedMs: 0,
      elapsedLabel: "Cached",
      label: "Example",
      model: "openrouter/xiaomi/mimo-v2-flash:free",
      report: baseReport,
      costUsd: null,
      detailed: false,
      extraParts: null,
    });

    expect(text.line.split(" · ")[0]).toBe("Cached");
  });

  it("falls back to formatted time when elapsed label is blank", () => {
    const text = buildFinishLineText({
      elapsedMs: 1050,
      elapsedLabel: "   ",
      label: null,
      model: null,
      report: baseReport,
      costUsd: null,
      detailed: false,
      extraParts: null,
    });

    expect(text.line.startsWith("1.1s")).toBe(true);
  });
});
