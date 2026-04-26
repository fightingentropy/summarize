import { describe, expect, it } from "vitest";
import {
  mergeModelRequestOptions,
  parseOpenAiReasoningEffort,
  parseOpenAiServiceTier,
  parseOpenAiTextVerbosity,
  toOpenAiServiceTierParam,
} from "../src/llm/model-options.js";

describe("model-options", () => {
  describe("parseOpenAiReasoningEffort", () => {
    it("normalizes canonical values", () => {
      expect(parseOpenAiReasoningEffort("none")).toBe("none");
      expect(parseOpenAiReasoningEffort("low")).toBe("low");
      expect(parseOpenAiReasoningEffort("medium")).toBe("medium");
      expect(parseOpenAiReasoningEffort("high")).toBe("high");
      expect(parseOpenAiReasoningEffort("xhigh")).toBe("xhigh");
    });

    it("accepts case and whitespace variants", () => {
      expect(parseOpenAiReasoningEffort("  HIGH  ")).toBe("high");
      expect(parseOpenAiReasoningEffort("Medium")).toBe("medium");
    });

    it("maps friendly aliases", () => {
      expect(parseOpenAiReasoningEffort("off")).toBe("none");
      expect(parseOpenAiReasoningEffort("min")).toBe("low");
      expect(parseOpenAiReasoningEffort("mid")).toBe("medium");
      expect(parseOpenAiReasoningEffort("med")).toBe("medium");
      expect(parseOpenAiReasoningEffort("x-high")).toBe("xhigh");
      expect(parseOpenAiReasoningEffort("extra-high")).toBe("xhigh");
    });

    it("rejects unknown values", () => {
      expect(() => parseOpenAiReasoningEffort("bogus")).toThrow(/Unsupported reasoning effort/);
      expect(() => parseOpenAiReasoningEffort("ultra", "--thinking")).toThrow(
        /Unsupported --thinking/,
      );
    });
  });

  describe("parseOpenAiTextVerbosity", () => {
    it("accepts low/medium/high", () => {
      expect(parseOpenAiTextVerbosity("low")).toBe("low");
      expect(parseOpenAiTextVerbosity("MEDIUM")).toBe("medium");
      expect(parseOpenAiTextVerbosity(" high ")).toBe("high");
    });

    it("rejects other values", () => {
      expect(() => parseOpenAiTextVerbosity("verbose")).toThrow(/Unsupported text verbosity/);
      expect(() => parseOpenAiTextVerbosity("none", "openai.textVerbosity")).toThrow(
        /Unsupported openai\.textVerbosity/,
      );
    });
  });

  describe("parseOpenAiServiceTier", () => {
    it("accepts known tiers", () => {
      expect(parseOpenAiServiceTier("default")).toBe("default");
      expect(parseOpenAiServiceTier("FAST")).toBe("fast");
      expect(parseOpenAiServiceTier(" priority ")).toBe("priority");
      expect(parseOpenAiServiceTier("flex")).toBe("flex");
    });

    it("rejects other values", () => {
      expect(() => parseOpenAiServiceTier("turbo")).toThrow(/Unsupported service tier/);
    });
  });

  describe("mergeModelRequestOptions", () => {
    it("returns undefined when no entries are provided", () => {
      expect(mergeModelRequestOptions()).toBeUndefined();
      expect(mergeModelRequestOptions(null, undefined)).toBeUndefined();
      expect(mergeModelRequestOptions({})).toBeUndefined();
    });

    it("merges later entries on top of earlier ones", () => {
      const merged = mergeModelRequestOptions(
        { serviceTier: "fast", reasoningEffort: "low" },
        { reasoningEffort: "medium", textVerbosity: "high" },
      );
      expect(merged).toEqual({
        serviceTier: "fast",
        reasoningEffort: "medium",
        textVerbosity: "high",
      });
    });

    it("treats `thinking` as an alias for reasoningEffort", () => {
      const merged = mergeModelRequestOptions({ thinking: "high" });
      expect(merged).toEqual({ reasoningEffort: "high" });
    });

    it("ignores blank serviceTier strings", () => {
      const merged = mergeModelRequestOptions({ serviceTier: "   " });
      expect(merged).toBeUndefined();
    });

    it("trims serviceTier whitespace", () => {
      const merged = mergeModelRequestOptions({ serviceTier: "  fast  " });
      expect(merged).toEqual({ serviceTier: "fast" });
    });
  });

  describe("toOpenAiServiceTierParam", () => {
    it("maps fast to priority and drops default", () => {
      expect(toOpenAiServiceTierParam("fast")).toBe("priority");
      expect(toOpenAiServiceTierParam("FAST")).toBe("priority");
      expect(toOpenAiServiceTierParam("default")).toBeUndefined();
    });

    it("preserves other tiers as-is", () => {
      expect(toOpenAiServiceTierParam("priority")).toBe("priority");
      expect(toOpenAiServiceTierParam("flex")).toBe("flex");
    });

    it("returns undefined for empty/blank input", () => {
      expect(toOpenAiServiceTierParam(undefined)).toBeUndefined();
      expect(toOpenAiServiceTierParam("")).toBeUndefined();
      expect(toOpenAiServiceTierParam("   ")).toBeUndefined();
    });
  });
});
