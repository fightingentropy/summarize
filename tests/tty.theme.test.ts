import { describe, expect, it } from "vitest";
import type { CliThemeName } from "../src/tty/theme.js";
import {
  createThemeRenderer,
  parseCliThemeName,
  resolveThemeNameFromSources,
  resolveThemePalette,
  resolveTrueColor,
} from "../src/tty/theme.js";

describe("cli theme helpers", () => {
  it("parses theme names and rejects invalid values", () => {
    expect(parseCliThemeName("", "test")).toBeNull();
    expect(parseCliThemeName("moss", "test")).toBe("moss");
    expect(() => parseCliThemeName(123 as unknown as string, "test")).toThrow(/Unsupported/);
    expect(() => parseCliThemeName("nope", "test")).toThrow(/Unsupported/);
  });

  it("resolves theme names by precedence", () => {
    expect(
      resolveThemeNameFromSources({
        cli: "moss",
        env: "ember",
        config: "mono",
        fallback: "aurora",
      }),
    ).toBe("moss");
    expect(
      resolveThemeNameFromSources({
        cli: null,
        env: "ember",
        config: "mono",
        fallback: "aurora",
      }),
    ).toBe("ember");
    expect(
      resolveThemeNameFromSources({
        cli: null,
        env: null,
        config: "mono",
        fallback: "aurora",
      }),
    ).toBe("mono");
    expect(
      resolveThemeNameFromSources({
        cli: null,
        env: null,
        config: null,
        fallback: "ember",
      }),
    ).toBe("ember");
  });

  it("resolves truecolor preferences", () => {
    expect(resolveTrueColor({ SUMMARIZE_TRUECOLOR: "1" })).toBe(true);
    expect(resolveTrueColor({ SUMMARIZE_NO_TRUECOLOR: "1" })).toBe(false);
    expect(resolveTrueColor({ COLORTERM: "truecolor" })).toBe(true);
    expect(resolveTrueColor({ TERM_PROGRAM: "iTerm.app" })).toBe(true);
    expect(resolveTrueColor({ TERM: "xterm-256color" })).toBe(true);
  });

  it("renders ANSI colors when enabled", () => {
    const trueColor = createThemeRenderer({ themeName: "moss", enabled: true, trueColor: true });
    const ansi = createThemeRenderer({ themeName: "mono", enabled: true, trueColor: false });
    const off = createThemeRenderer({ themeName: "mono", enabled: false, trueColor: false });

    expect(trueColor.heading("Hi")).toContain("\u001b[1;38;2;");
    expect(trueColor.muted("Hi")).toContain("\u001b[");
    expect(trueColor.warning("Hi")).toContain("\u001b[");
    expect(trueColor.error("Hi")).toContain("\u001b[");
    expect(ansi.heading("Hi")).toContain("\u001b[");
    expect(ansi.accent("Hi")).toContain("\u001b[");
    expect(off.heading("Hi")).toBe("Hi");
  });

  it("resolves theme palettes with fallback", () => {
    expect(resolveThemePalette("moss").name).toBe("moss");
    expect(resolveThemePalette("nope" as unknown as CliThemeName).name).toBe("aurora");
  });

  it("falls back to the default theme renderer", () => {
    const renderer = createThemeRenderer({
      themeName: "nope" as CliThemeName,
      enabled: true,
      trueColor: false,
    });
    expect(renderer.name).toBe("aurora");
  });
});
