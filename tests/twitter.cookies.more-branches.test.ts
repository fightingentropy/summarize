import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTwitterCookies } from "../src/run/cookies/twitter.js";

function makeHome(): string {
  return mkdtempSync(path.join(tmpdir(), "summarize-twitter-cookies-more-"));
}

function touch(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "x");
}

describe("twitter cookies resolver more branches", () => {
  it("supports explicit chrome profile paths and windows roots", async () => {
    const home = makeHome();
    const profileDir = path.join(home, "Profiles", "Work");
    touch(path.join(profileDir, "Network", "Cookies"));

    const explicit = await resolveTwitterCookies({
      env: {},
      chromeProfile: profileDir,
      cookieSource: "chrome",
      platform: "darwin",
      homeDir: home,
    });
    expect(explicit.cookies.cookiesFromBrowser).toBe(`chrome:${profileDir}`);

    const localAppData = path.join(home, "LocalAppData");
    touch(path.join(localAppData, "Google", "Chrome", "User Data", "Default", "Cookies"));
    const windows = await resolveTwitterCookies({
      env: { LOCALAPPDATA: localAppData },
      cookieSource: "chrome",
      platform: "win32",
      homeDir: home,
    });
    expect(windows.cookies.cookiesFromBrowser).toBe("chrome");
  });

  it("supports firefox profile paths, env fallbacks, and first explicit fallback warnings", async () => {
    const home = makeHome();
    const firefoxDir = path.join(home, "FirefoxProfile");
    touch(path.join(firefoxDir, "cookies.sqlite"));

    const explicit = await resolveTwitterCookies({
      env: {},
      firefoxProfile: firefoxDir,
      cookieSource: "firefox",
      platform: "linux",
      homeDir: home,
    });
    expect(explicit.cookies.cookiesFromBrowser).toBe(`firefox:${firefoxDir}`);

    const warning = await resolveTwitterCookies({
      env: { TWITTER_COOKIE_SOURCE: "firefox,chrome", TWITTER_FIREFOX_PROFILE: "work" },
      platform: "linux",
      homeDir: home,
    });
    expect(warning.cookies.cookiesFromBrowser).toBe("firefox:work");
    expect(warning.warnings.join("\n")).toContain("yt-dlp will still attempt it");
  });

  it("finds safari stores and ignores empty env tokens", async () => {
    const home = makeHome();
    touch(
      path.join(
        home,
        "Library",
        "Containers",
        "com.apple.Safari",
        "Data",
        "Library",
        "Cookies",
        "Cookies.binarycookies",
      ),
    );

    const result = await resolveTwitterCookies({
      env: { TWITTER_COOKIE_SOURCE: "   " },
      platform: "darwin",
      homeDir: home,
    });
    expect(result.cookies.cookiesFromBrowser).toBe("safari");
    expect(result.cookies.source).toBe("Safari");
  });
});
