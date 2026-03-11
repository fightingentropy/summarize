import { describe, expect, it } from "vitest";
import { createLinkPreviewClient } from "../src/content/index.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? null;
const LIVE = process.env.SUMMARIZE_LIVE_TESTS === "1" && Boolean(OPENAI_API_KEY);

describe("live Spotify episode transcript (iTunes RSS + whisper)", () => {
  const run = LIVE ? it : it.skip;

  run(
    "transcribes a full episode from open.spotify.com",
    async () => {
      const url = "https://open.spotify.com/episode/5auotqWAXhhKyb9ymCuBJY";

      const client = createLinkPreviewClient({
        openaiApiKey: OPENAI_API_KEY,
      });
      const result = await client.fetchLinkContent(url, {
        timeoutMs: 300_000,
        cacheMode: "bypass",
      });

      expect(result.transcriptSource).toBe("whisper");
      expect(result.transcriptCharacters ?? 0).toBeGreaterThan(800);
      expect(result.diagnostics.transcript.notes ?? "").toContain("iTunes");
      expect(result.diagnostics.transcript.notes ?? "").not.toContain("preview");
      expect(result.content.toLowerCase()).toContain("transcript:");
    },
    600_000,
  );
});
