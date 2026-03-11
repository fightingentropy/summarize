import { describe, expect, it } from "vitest";
import { resolveAutoDaemonMode } from "../src/daemon/auto-mode.js";

describe("daemon/auto-mode", () => {
  it("prefers url for media urls", () => {
    expect(
      resolveAutoDaemonMode({
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        hasText: true,
      }),
    ).toEqual({ primary: "url", fallback: "page" });

    expect(
      resolveAutoDaemonMode({
        url: "https://example.com/video.mp4",
        hasText: true,
      }),
    ).toEqual({ primary: "url", fallback: "page" });
  });

  it("prefers page when text is present and url is not media-like", () => {
    expect(
      resolveAutoDaemonMode({
        url: "https://example.com/article",
        hasText: true,
      }),
    ).toEqual({ primary: "page", fallback: "url" });
  });

  it("prefers url when no text is present", () => {
    expect(
      resolveAutoDaemonMode({
        url: "https://example.com/article",
        hasText: false,
      }),
    ).toEqual({ primary: "url", fallback: null });
  });
});
