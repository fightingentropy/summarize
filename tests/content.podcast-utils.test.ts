import { describe, expect, it } from "vitest";
import {
  extractApplePodcastIds,
  extractSpotifyEpisodeId,
  isPodcastHost,
  isPodcastLikeJsonLdType,
} from "../packages/core/src/content/link-preview/content/podcast-utils.js";

describe("podcast utils", () => {
  it("extracts spotify episode ids only from valid spotify urls", () => {
    expect(extractSpotifyEpisodeId("https://open.spotify.com/episode/abc123")).toBe("abc123");
    expect(extractSpotifyEpisodeId("https://open.spotify.com/show/abc123")).toBeNull();
    expect(extractSpotifyEpisodeId("https://example.com/episode/abc123")).toBeNull();
    expect(extractSpotifyEpisodeId("bad url")).toBeNull();
  });

  it("extracts apple podcast ids and validates the episode query", () => {
    expect(
      extractApplePodcastIds("https://podcasts.apple.com/us/podcast/foo/id12345?i=678"),
    ).toEqual({ showId: "12345", episodeId: "678" });
    expect(
      extractApplePodcastIds("https://podcasts.apple.com/us/podcast/foo/id12345?i=abc"),
    ).toEqual({
      showId: "12345",
      episodeId: null,
    });
    expect(extractApplePodcastIds("https://example.com/us/podcast/foo/id12345?i=678")).toBeNull();
  });

  it("recognizes podcast-like json ld types and hostnames", () => {
    expect(isPodcastLikeJsonLdType("PodcastEpisode")).toBe(true);
    expect(isPodcastLikeJsonLdType("AudioObject")).toBe(true);
    expect(isPodcastLikeJsonLdType("Article")).toBe(false);
    expect(isPodcastLikeJsonLdType(null)).toBe(false);

    expect(isPodcastHost("https://subdomain.simplecast.com/episodes/foo")).toBe(true);
    expect(isPodcastHost("https://music.amazon.co.uk/podcasts/foo")).toBe(true);
    expect(isPodcastHost("https://music.amazon.co.uk/music/foo")).toBe(false);
    expect(isPodcastHost("bad url")).toBe(false);
  });
});
