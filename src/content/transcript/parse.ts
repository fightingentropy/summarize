import type { TranscriptSegment } from "../link-preview/types.js";
import { parseTimestampStringToMs, parseTimestampToMs } from "./timestamps.js";

export type TranscriptParseResult = {
  text: string | null;
  segments: TranscriptSegment[] | null;
};

export function vttToSegments(raw: string): TranscriptSegment[] | null {
  const normalized = raw.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const segments: TranscriptSegment[] = [];

  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx]?.trim() ?? "";
    if (!line || line.toUpperCase() === "WEBVTT" || /^(NOTE|STYLE|REGION)\b/i.test(line)) {
      idx += 1;
      continue;
    }
    if (!line.includes("-->")) {
      idx += 1;
      continue;
    }

    const [startRaw, rest] = line.split("-->");
    const endRaw = rest?.trim().split(/\s+/)[0] ?? "";
    const startMs = parseTimestampStringToMs(startRaw?.trim() ?? "");
    const endMs = parseTimestampStringToMs(endRaw);
    idx += 1;

    const textLines: string[] = [];
    while (idx < lines.length) {
      const cueLine = lines[idx];
      if (!cueLine || cueLine.trim().length === 0) break;
      if (!/^(NOTE|STYLE|REGION)\b/i.test(cueLine.trim())) {
        textLines.push(cueLine.trim());
      }
      idx += 1;
    }
    idx += 1;

    if (startMs == null) continue;
    const text = textLines.join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    segments.push({
      startMs,
      endMs: endMs ?? null,
      text,
    });
  }

  return segments.length > 0 ? segments : null;
}

export function vttToPlainText(raw: string): string {
  const segments = vttToSegments(raw);
  if (segments) {
    return segments
      .map((segment) => segment.text)
      .join("\n")
      .trim();
  }

  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => line.toUpperCase() !== "WEBVTT")
    .filter((line) => !/^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/.test(line))
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !/^(NOTE|STYLE|REGION)\b/i.test(line));
  return lines.join("\n").trim();
}

function parseSegmentsFromJsonArray(items: unknown[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const text =
      typeof record.text === "string"
        ? record.text
        : typeof record.utf8 === "string"
          ? record.utf8
          : null;
    if (!text) continue;
    const startMs = parseTimestampToMs(record.startMs, false);
    const endMs = parseTimestampToMs(record.endMs, false);
    const startSeconds = parseTimestampToMs(record.start, true);
    const endSeconds = parseTimestampToMs(record.end, true);
    const start = startMs ?? startSeconds;
    const end = endMs ?? endSeconds;
    if (start == null) continue;
    segments.push({
      startMs: start,
      endMs: end ?? null,
      text: text.replace(/\s+/g, " ").trim(),
    });
  }
  return segments;
}

export function jsonTranscriptToSegments(payload: unknown): TranscriptSegment[] | null {
  if (Array.isArray(payload)) {
    const segments = parseSegmentsFromJsonArray(payload);
    return segments.length > 0 ? segments : null;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const segmentsPayload = record.segments;
    if (Array.isArray(segmentsPayload)) {
      const segments = parseSegmentsFromJsonArray(segmentsPayload);
      return segments.length > 0 ? segments : null;
    }
  }

  return null;
}

export function jsonTranscriptToPlainText(payload: unknown): string | null {
  if (Array.isArray(payload)) {
    const segments = jsonTranscriptToSegments(payload);
    if (segments) {
      const text = segments
        .map((segment) => segment.text)
        .join("\n")
        .trim();
      return text.length > 0 ? text : null;
    }
    const parts = payload
      .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>).text : null))
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean);
    const text = parts.join("\n").trim();
    return text.length > 0 ? text : null;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.transcript === "string" && record.transcript.trim())
      return record.transcript.trim();
    if (typeof record.text === "string" && record.text.trim()) return record.text.trim();
    const segments = record.segments;
    if (Array.isArray(segments)) {
      const segmentText = jsonTranscriptToSegments(record);
      if (segmentText) {
        const text = segmentText
          .map((segment) => segment.text)
          .join("\n")
          .trim();
        return text.length > 0 ? text : null;
      }
      const parts = segments
        .map((row) =>
          row && typeof row === "object" ? (row as Record<string, unknown>).text : null,
        )
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter(Boolean);
      const text = parts.join("\n").trim();
      return text.length > 0 ? text : null;
    }
  }

  return null;
}
