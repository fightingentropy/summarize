import { describe, expect, it } from "vitest";
import {
  jsonTranscriptToPlainText,
  jsonTranscriptToSegments,
  vttToPlainText,
  vttToSegments,
} from "../packages/core/src/content/transcript/parse.js";

describe("transcript parsing branches", () => {
  it("skips note/style blocks and ignores cues without valid starts", () => {
    const vtt = [
      "WEBVTT",
      "",
      "NOTE ignored",
      "00:00:00.000 --> 00:00:01.000",
      "",
      "STYLE",
      "::cue { color: red; }",
      "",
      "00:00:02.000 --> bad",
      " Hello ",
      "NOTE in cue",
      "world",
      "",
      "bad timestamp line",
      "ignored",
      "",
    ].join("\n");

    expect(vttToSegments(vtt)).toEqual([{ startMs: 2000, endMs: null, text: "Hello world" }]);
  });

  it("falls back to plain VTT text when there are no valid segments", () => {
    const vtt = [
      "WEBVTT",
      "",
      "1",
      "No timing here",
      "",
      "REGION",
      "ignored",
      "",
      "Second line",
    ].join("\n");

    expect(vttToSegments(vtt)).toBeNull();
    expect(vttToPlainText(vtt)).toBe("No timing here\nignored\nSecond line");
  });

  it("parses json segments from startMs/endMs and trims text", () => {
    expect(
      jsonTranscriptToSegments([
        { text: "  Hello   there  ", startMs: 1200, endMs: 2300 },
        { utf8: "world", startMs: "bad", endMs: 2400 },
        null,
      ]),
    ).toEqual([{ startMs: 1200, endMs: 2300, text: "Hello there" }]);
  });

  it("supports object transcripts and segment fallback text extraction", () => {
    expect(jsonTranscriptToPlainText({ transcript: " Full transcript " })).toBe("Full transcript");
    expect(jsonTranscriptToPlainText({ text: " Plain text " })).toBe("Plain text");
    expect(
      jsonTranscriptToPlainText({
        segments: [{ text: " first " }, { utf8: "second" }, { text: "   " }],
      }),
    ).toBe("first");
  });

  it("returns null for unsupported payloads", () => {
    expect(jsonTranscriptToSegments({ nope: true })).toBeNull();
    expect(jsonTranscriptToPlainText([{ nope: true }, { text: "   " }])).toBeNull();
    expect(jsonTranscriptToPlainText({ segments: [{ nope: true }] })).toBeNull();
  });
});
