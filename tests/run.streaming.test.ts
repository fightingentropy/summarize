import { describe, expect, it } from "vitest";
import {
  canStream,
  isGoogleStreamingUnsupportedError,
  isStreamingTimeoutError,
} from "../src/run/streaming.js";

describe("run/streaming", () => {
  it("detects google streaming unsupported errors from url or body", () => {
    expect(
      isGoogleStreamingUnsupportedError({
        message: "Call ListModels for supported methods",
        url: "https://example.com/v1beta/models/foo:streamGenerateContent",
      }),
    ).toBe(true);
    expect(
      isGoogleStreamingUnsupportedError({
        message: "request failed",
        responseBody: "Model does not support streaming",
      }),
    ).toBe(false);
    expect(
      isGoogleStreamingUnsupportedError({
        message: "request failed",
        url: "https://example.com/v1beta/models/foo:streamGenerateContent",
        responseBody: "supported methods only",
      }),
    ).toBe(true);
    expect(isGoogleStreamingUnsupportedError("nope")).toBe(false);
  });

  it("detects timeout errors across shapes", () => {
    expect(isStreamingTimeoutError("request timed out")).toBe(true);
    expect(isStreamingTimeoutError(new Error("TIMED OUT waiting"))).toBe(true);
    expect(isStreamingTimeoutError({ message: "timed out after 10s" })).toBe(true);
    expect(isStreamingTimeoutError({ message: 5 })).toBe(false);
    expect(isStreamingTimeoutError(null)).toBe(false);
  });

  it("streams only for supported transports/providers without document attachments", () => {
    expect(
      canStream({
        provider: "openai",
        prompt: {},
        transport: "native",
      }),
    ).toBe(true);
    expect(
      canStream({
        provider: "openai",
        prompt: { attachments: [{ kind: "document" }] },
        transport: "native",
      }),
    ).toBe(false);
    expect(
      canStream({
        provider: "google",
        prompt: { attachments: [{ kind: "image" }] },
        transport: "cli",
      }),
    ).toBe(false);
  });
});
