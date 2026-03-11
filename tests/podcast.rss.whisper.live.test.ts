import { describe, expect, it } from "vitest";
import { createLinkPreviewClient } from "../src/content/index.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? null;
const LIVE = process.env.SUMMARIZE_LIVE_TESTS === "1" && Boolean(OPENAI_API_KEY);

describe("live podcast RSS transcript (whisper)", () => {
  const run = LIVE ? it : it.skip;

  run(
    "transcribes latest episode from an RSS feed enclosure",
    async () => {
      const url = "https://feeds.npr.org/500005/podcast.xml";

      const client = createLinkPreviewClient({
        openaiApiKey: OPENAI_API_KEY,
      });
      const result = await client.fetchLinkContent(url, {
        timeoutMs: 120_000,
        cacheMode: "bypass",
      });

      expect(result.transcriptSource).toBe("whisper");
      expect(result.transcriptCharacters ?? 0).toBeGreaterThan(20);
      expect(result.content.trim().length).toBeGreaterThan(20);
    },
    240_000,
  );
});
