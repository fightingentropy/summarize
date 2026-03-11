import { describe, expect, it } from "vitest";
import { resolveDesiredOutputTokens } from "../src/run/run-output.js";

describe("run-output", () => {
  it("returns the explicit max output tokens override", () => {
    expect(
      resolveDesiredOutputTokens({
        lengthArg: { kind: "preset", preset: "short" },
        maxOutputTokensArg: 512,
      }),
    ).toBe(512);
  });

  it("returns null when target characters are not positive", () => {
    expect(
      resolveDesiredOutputTokens({
        lengthArg: { kind: "chars", maxCharacters: 0 },
        maxOutputTokensArg: null,
      }),
    ).toBeNull();
  });

  it("returns null when target characters are infinite", () => {
    expect(
      resolveDesiredOutputTokens({
        lengthArg: { kind: "chars", maxCharacters: Number.POSITIVE_INFINITY },
        maxOutputTokensArg: null,
      }),
    ).toBeNull();
  });

  it("derives output tokens from target characters with a floor", () => {
    expect(
      resolveDesiredOutputTokens({
        lengthArg: { kind: "chars", maxCharacters: 8 },
        maxOutputTokensArg: null,
      }),
    ).toBe(16);

    expect(
      resolveDesiredOutputTokens({
        lengthArg: { kind: "chars", maxCharacters: 200 },
        maxOutputTokensArg: null,
      }),
    ).toBe(50);
  });
});
