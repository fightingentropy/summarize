import { countTokens } from "gpt-tokenizer";
import { describe, expect, it } from "vitest";
import { fitUserTextToInputTokenBudget } from "../src/run/summary-engine.js";

describe("fitUserTextToInputTokenBudget", () => {
  it("returns text unchanged when within the token budget", () => {
    const text = "A short prompt that fits comfortably.";
    expect(fitUserTextToInputTokenBudget(text, 1000)).toBe(text);
  });

  it("clips oversized text to fit the budget while keeping head and tail", () => {
    const text = `HEAD_START ${"word ".repeat(20000)}TAIL_END`;
    const budget = 500;
    expect(countTokens(text)).toBeGreaterThan(budget);

    const out = fitUserTextToInputTokenBudget(text, budget);

    expect(countTokens(out)).toBeLessThanOrEqual(budget);
    expect(out).toContain("HEAD_START");
    expect(out).toContain("TAIL_END");
  });
});
