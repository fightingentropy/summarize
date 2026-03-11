import { describe, expect, it, vi } from "vitest";
import { resolveGoogleModelForUsage } from "../src/llm/google-models.js";

describe("google model resolution (Gemini API ListModels)", () => {
  it("skips ListModels for stable model ids", async () => {
    const fetchMock = vi.fn();

    const result = await resolveGoogleModelForUsage({
      requestedModelId: "gemini-1.5-pro",
      apiKey: "test",
      fetchImpl: fetchMock as unknown as typeof fetch,
      timeoutMs: 2000,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ resolvedModelId: "gemini-1.5-pro", supportedMethods: [], note: null });
  });

  it("resolves -preview suffix when the non-preview model exists", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toContain("generativelanguage.googleapis.com/v1beta/models");
      return new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-3.0-flash",
              supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await resolveGoogleModelForUsage({
      requestedModelId: "gemini-3.0-flash-preview",
      apiKey: "test",
      fetchImpl: fetchMock as unknown as typeof fetch,
      timeoutMs: 2000,
    });

    expect(result.resolvedModelId).toBe("gemini-3.0-flash");
    expect(result.note).toMatch(/Resolved/i);
    expect(result.supportedMethods).toContain("streamGenerateContent");
  });

  it("keeps exact preview ids when present", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-3.0-flash-preview",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await resolveGoogleModelForUsage({
      requestedModelId: "gemini-3.0-flash-preview",
      apiKey: "test",
      fetchImpl: fetchMock as unknown as typeof fetch,
      timeoutMs: 2000,
    });

    expect(result.resolvedModelId).toBe("gemini-3.0-flash-preview");
    expect(result.supportedMethods).toEqual([]);
    expect(result.note).toBeNull();
  });

  it("throws a helpful error with suggestions when model is missing", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-2.0-flash",
              supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
            },
            {
              name: "models/gemini-2.0-pro",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/gemini-3.0-pro-preview",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await expect(
      resolveGoogleModelForUsage({
        requestedModelId: "gemini-3.0-flash-preview",
        apiKey: "test",
        fetchImpl: fetchMock as unknown as typeof fetch,
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/Try one of:/);
  });

  it("returns a generic hint when ListModels is empty", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      resolveGoogleModelForUsage({
        requestedModelId: "gemini-3.0-flash-preview",
        apiKey: "test",
        fetchImpl: fetchMock as unknown as typeof fetch,
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/Run ListModels/);
  });

  it("surfaces ListModels failures as actionable key/config errors", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('{"error":{"message":"bad key"}}', {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      resolveGoogleModelForUsage({
        requestedModelId: "gemini-3.0-flash-preview",
        apiKey: "bad",
        fetchImpl: fetchMock as unknown as typeof fetch,
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/GOOGLE_GENERATIVE_AI_API_KEY/i);
  });
});
