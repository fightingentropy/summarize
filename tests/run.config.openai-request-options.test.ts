import { describe, expect, it } from "vitest";
import { resolveConfigState } from "../src/run/run-config.js";

describe("resolveConfigState — OpenAI request options", () => {
  const baseArgs = {
    envForRun: {} as Record<string, string | undefined>,
    languageExplicitlySet: false,
    videoModeExplicitlySet: false,
    cliFlagPresent: false,
    cliProviderArg: null,
  };

  it("returns no overrides when no flags are set", () => {
    const state = resolveConfigState({
      ...baseArgs,
      programOpts: { videoMode: "auto" },
    });
    expect(state.openaiRequestOptionsOverride).toBeUndefined();
    expect(state.openaiRequestOptions).toBeUndefined();
  });

  it("captures --fast as serviceTier=fast", () => {
    const state = resolveConfigState({
      ...baseArgs,
      programOpts: { videoMode: "auto", fast: true },
    });
    expect(state.openaiRequestOptionsOverride).toEqual({ serviceTier: "fast" });
  });

  it("captures --service-tier alone", () => {
    const state = resolveConfigState({
      ...baseArgs,
      programOpts: { videoMode: "auto", serviceTier: "priority" },
    });
    expect(state.openaiRequestOptionsOverride).toEqual({ serviceTier: "priority" });
  });

  it("accepts matching --fast and --service-tier", () => {
    const state = resolveConfigState({
      ...baseArgs,
      programOpts: { videoMode: "auto", fast: true, serviceTier: "fast" },
    });
    expect(state.openaiRequestOptionsOverride).toEqual({ serviceTier: "fast" });
  });

  it("rejects conflicting --fast and --service-tier", () => {
    expect(() =>
      resolveConfigState({
        ...baseArgs,
        programOpts: { videoMode: "auto", fast: true, serviceTier: "flex" },
      }),
    ).toThrow(/either --fast or --service-tier/);
  });

  it("captures --thinking", () => {
    const state = resolveConfigState({
      ...baseArgs,
      programOpts: { videoMode: "auto", thinking: "high" },
    });
    expect(state.openaiRequestOptionsOverride).toEqual({ reasoningEffort: "high" });
  });

  it("merges --fast and --thinking", () => {
    const state = resolveConfigState({
      ...baseArgs,
      programOpts: { videoMode: "auto", fast: true, thinking: "low" },
    });
    expect(state.openaiRequestOptionsOverride).toEqual({
      serviceTier: "fast",
      reasoningEffort: "low",
    });
  });

  it("rejects unknown --service-tier", () => {
    expect(() =>
      resolveConfigState({
        ...baseArgs,
        programOpts: { videoMode: "auto", serviceTier: "turbo" },
      }),
    ).toThrow(/Unsupported --service-tier/);
  });

  it("rejects unknown --thinking", () => {
    expect(() =>
      resolveConfigState({
        ...baseArgs,
        programOpts: { videoMode: "auto", thinking: "bogus" },
      }),
    ).toThrow(/Unsupported --thinking/);
  });
});
