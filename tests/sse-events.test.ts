import { describe, expect, it } from "vitest";
import { encodeSseEvent, parseSseEvent, type SseEvent } from "../src/shared/sse-events.js";

describe("sse events", () => {
  it("encodes and parses known events", () => {
    const events: SseEvent[] = [
      {
        event: "meta",
        data: {
          model: "openai/gpt-5.2",
          modelLabel: "gpt-5.2",
          inputSummary: "Example",
          summaryFromCache: false,
        },
      },
      { event: "status", data: { text: "Working…" } },
      { event: "chunk", data: { text: "Hello" } },
      {
        event: "slides",
        data: {
          sourceUrl: "https://example.com/video",
          sourceId: "video-1",
          sourceKind: "video",
          ocrAvailable: true,
          slides: [
            {
              index: 0,
              timestamp: 12,
              imageUrl: "https://example.com/slide-1.jpg",
              ocrText: "Intro",
              ocrConfidence: 0.99,
            },
          ],
        },
      },
      {
        event: "assistant",
        data: {
          role: "assistant",
          content: [{ type: "text", text: "Hi" }],
          api: "openai-completions",
          provider: "openai",
          model: "gpt-5.2",
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 1,
        },
      },
      {
        event: "metrics",
        data: {
          elapsedMs: 1200,
          summary: "7.5s · example.com",
          details: null,
          summaryDetailed: "7.5s · example.com · ↑1.2k ↓300",
          detailsDetailed: null,
        },
      },
      { event: "done", data: {} },
      { event: "error", data: { message: "Boom" } },
    ];

    for (const event of events) {
      const encoded = encodeSseEvent(event);
      expect(encoded).toBe(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);

      const parsed = parseSseEvent({
        event: event.event,
        data: JSON.stringify(event.data),
      });
      expect(parsed).toEqual(event);
    }
  });

  it("ignores unknown events", () => {
    expect(parseSseEvent({ event: "unknown", data: "{}" })).toBeNull();
  });
});
