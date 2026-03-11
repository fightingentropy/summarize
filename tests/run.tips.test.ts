import { describe, expect, it } from "vitest";
import { UVX_TIP } from "../src/run/constants.js";
import { withUvxTip } from "../src/run/tips.js";

describe("run/tips", () => {
  it("keeps original error when uvx is available", () => {
    const err = withUvxTip("boom", { UVX_PATH: "/usr/local/bin/uvx" });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("boom");
  });

  it("returns the same Error instance when uvx is available", () => {
    const original = new Error("boom");
    const err = withUvxTip(original, { UVX_PATH: "/usr/local/bin/uvx" });
    expect(err).toBe(original);
  });

  it("adds uvx tip when uvx is missing", () => {
    const original = new Error("no uvx");
    const err = withUvxTip(original, { PATH: "" });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("no uvx");
    expect(err.message).toContain(UVX_TIP);
    expect((err as { cause?: unknown }).cause).toBe(original);
  });

  it("adds uvx tip for string errors when uvx is missing", () => {
    const err = withUvxTip("no uvx", { PATH: "" });
    expect(err.message).toContain("no uvx");
    expect(err.message).toContain(UVX_TIP);
    expect((err as { cause?: unknown }).cause).toBeUndefined();
  });
});
