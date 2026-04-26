import { describe, expect, it } from "vitest";
import { parseRequestedModelId, resolveOpenAiFastModelId } from "../src/model-spec.js";

describe("model spec parsing", () => {
  it("rejects empty model ids", () => {
    expect(() => parseRequestedModelId("   ")).toThrow(/Missing model id/);
  });

  it("rejects unknown keyword-like model ids", () => {
    expect(() => parseRequestedModelId("free")).toThrow(/Unknown model/);
    expect(() => parseRequestedModelId("foobar")).toThrow(/Unknown model/);
  });

  it("parses cli model ids", () => {
    const parsed = parseRequestedModelId("cli/claude/sonnet");
    expect(parsed.kind).toBe("fixed");
    expect(parsed.transport).toBe("cli");
    expect(parsed.cliProvider).toBe("claude");
    expect(parsed.cliModel).toBe("sonnet");
  });

  it("defaults cli models when missing", () => {
    const parsed = parseRequestedModelId("cli/codex");
    expect(parsed.kind).toBe("fixed");
    expect(parsed.transport).toBe("cli");
    expect(parsed.cliProvider).toBe("codex");
    expect(parsed.cliModel).toBeNull();
    expect(parsed.userModelId).toBe("cli/codex");
    expect(parsed.requiredEnv).toBe("CLI_CODEX");
  });

  it("defaults agent cli models when missing", () => {
    const parsed = parseRequestedModelId("cli/agent");
    expect(parsed.kind).toBe("fixed");
    expect(parsed.transport).toBe("cli");
    expect(parsed.cliProvider).toBe("agent");
    expect(parsed.cliModel).toBe("auto");
    expect(parsed.requiredEnv).toBe("CLI_AGENT");
  });

  it("defaults gemini cli models when missing", () => {
    const parsed = parseRequestedModelId("cli/gemini");
    expect(parsed.kind).toBe("fixed");
    expect(parsed.transport).toBe("cli");
    expect(parsed.cliProvider).toBe("gemini");
    expect(parsed.cliModel).toBe("flash");
    expect(parsed.requiredEnv).toBe("CLI_GEMINI");
  });

  it("rejects invalid cli providers", () => {
    expect(() => parseRequestedModelId("cli/unknown/model")).toThrow(/Invalid CLI model id/);
  });

  it("parses openrouter model ids", () => {
    const parsed = parseRequestedModelId("openrouter/openai/gpt-5-nano");
    expect(parsed.kind).toBe("fixed");
    expect(parsed.transport).toBe("openrouter");
    expect(parsed.openrouterModelId).toBe("openai/gpt-5-nano");
    expect(parsed.requiredEnv).toBe("OPENROUTER_API_KEY");
  });

  it("rejects invalid openrouter model ids", () => {
    expect(() => parseRequestedModelId("openrouter/")).toThrow(/missing the OpenRouter model id/);
    expect(() => parseRequestedModelId("openrouter/openai")).toThrow('Expected "author/slug"');
  });

  it("parses native model ids and providers", () => {
    const parsed = parseRequestedModelId("xai/grok-4-fast-non-reasoning");
    expect(parsed.kind).toBe("fixed");
    expect(parsed.transport).toBe("native");
    expect(parsed.provider).toBe("xai");
    expect(parsed.requiredEnv).toBe("XAI_API_KEY");
  });

  it("maps native providers to required env", () => {
    const google = parseRequestedModelId("google/gemini-3-flash-preview");
    expect(google.kind).toBe("fixed");
    expect(google.transport).toBe("native");
    expect(google.requiredEnv).toBe("GEMINI_API_KEY");

    const anthropic = parseRequestedModelId("anthropic/claude-sonnet-4-5");
    expect(anthropic.kind).toBe("fixed");
    expect(anthropic.transport).toBe("native");
    expect(anthropic.requiredEnv).toBe("ANTHROPIC_API_KEY");

    const zai = parseRequestedModelId("zai/glm-4.7");
    expect(zai.kind).toBe("fixed");
    expect(zai.transport).toBe("native");
    expect(zai.requiredEnv).toBe("Z_AI_API_KEY");
    expect(zai.llmModelId).toBe("zai/glm-4.7");

    const nvidia = parseRequestedModelId("nvidia/z-ai/glm5");
    expect(nvidia.kind).toBe("fixed");
    expect(nvidia.transport).toBe("native");
    expect(nvidia.provider).toBe("nvidia");
    expect(nvidia.requiredEnv).toBe("NVIDIA_API_KEY");
    expect(nvidia.llmModelId).toBe("nvidia/z-ai/glm5");
  });

  describe("OpenAI fast-tier model id", () => {
    it("recognises bare <model>-fast aliases", () => {
      const fast = resolveOpenAiFastModelId("gpt-5.5-fast");
      expect(fast).toEqual({ modelId: "gpt-5.5", options: { serviceTier: "fast" } });
    });

    it("matches case-insensitively and ignores whitespace", () => {
      expect(resolveOpenAiFastModelId("  GPT-5.4-FAST  ")).toEqual({
        modelId: "GPT-5.4",
        options: { serviceTier: "fast" },
      });
    });

    it("returns null for non-fast model ids", () => {
      expect(resolveOpenAiFastModelId("gpt-5.5")).toBeNull();
      expect(resolveOpenAiFastModelId("gpt-5.6-fast")).toBeNull();
      expect(resolveOpenAiFastModelId("openai/gpt-5.5-fast")).toBeNull();
    });

    it("resolves bare top-level fast aliases via parseRequestedModelId", () => {
      const parsed = parseRequestedModelId("gpt-5.5-fast");
      expect(parsed.kind).toBe("fixed");
      expect(parsed.transport).toBe("native");
      expect(parsed.provider).toBe("openai");
      expect(parsed.userModelId).toBe("gpt-5.5-fast");
      expect(parsed.llmModelId).toBe("openai/gpt-5.5");
      expect(parsed.requestOptions).toEqual({ serviceTier: "fast" });
    });

    it("resolves provider-prefixed fast aliases via parseRequestedModelId", () => {
      const parsed = parseRequestedModelId("openai/gpt-5.4-fast");
      expect(parsed.kind).toBe("fixed");
      expect(parsed.provider).toBe("openai");
      expect(parsed.llmModelId).toBe("openai/gpt-5.4");
      expect(parsed.requestOptions).toEqual({ serviceTier: "fast" });
    });
  });
});
