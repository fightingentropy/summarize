import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatBytesPerSecond,
  formatCompactCount,
  formatDurationSecondsSmart,
  formatElapsedMs,
} from "../src/tty/format.js";

describe("tty format", () => {
  describe("formatElapsedMs", () => {
    it("returns unknown for invalid values", () => {
      expect(formatElapsedMs(Number.NaN)).toBe("unknown");
      expect(formatElapsedMs(Number.POSITIVE_INFINITY)).toBe("unknown");
      expect(formatElapsedMs(-1)).toBe("unknown");
    });

    it("formats sub-10s with 1 decimal", () => {
      expect(formatElapsedMs(9500)).toBe("9.5s");
      expect(formatElapsedMs(1000)).toBe("1.0s");
    });

    it("formats seconds and minutes/hours smartly", () => {
      expect(formatElapsedMs(12_345)).toBe("12s");
      expect(formatElapsedMs(59_999)).toBe("59s");
      expect(formatElapsedMs(60_000)).toBe("1m 0s");
      expect(formatElapsedMs(3_661_000)).toBe("1h 1m 1s");
    });
  });

  describe("formatBytes", () => {
    it("returns unknown for invalid values", () => {
      expect(formatBytes(Number.NaN)).toBe("unknown");
      expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("unknown");
      expect(formatBytes(-1)).toBe("unknown");
    });

    it("formats bytes and larger units", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(999)).toBe("999 B");
      expect(formatBytes(1024)).toBe("1.0 KB");
      expect(formatBytes(10 * 1024)).toBe("10 KB");
      expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
      expect(formatBytes(988.2154524260012)).toBe("988 B");
    });
  });

  describe("formatBytesPerSecond", () => {
    it("returns unknown for invalid values", () => {
      expect(formatBytesPerSecond(Number.NaN)).toBe("unknown");
      expect(formatBytesPerSecond(-1)).toBe("unknown");
    });

    it("rounds and appends /s", () => {
      expect(formatBytesPerSecond(988.215)).toBe("988 B/s");
      expect(formatBytesPerSecond(1024)).toBe("1.0 KB/s");
    });
  });

  describe("formatCompactCount", () => {
    it("returns unknown for invalid values", () => {
      expect(formatCompactCount(Number.NaN)).toBe("unknown");
      expect(formatCompactCount(Number.POSITIVE_INFINITY)).toBe("unknown");
    });

    it("formats k/M/B compactly", () => {
      expect(formatCompactCount(999)).toBe("999");
      expect(formatCompactCount(1_234)).toBe("1.2k");
      expect(formatCompactCount(12_345)).toBe("12k");
      expect(formatCompactCount(1_234_567)).toBe("1.2M");
      expect(formatCompactCount(1_234_567_890)).toBe("1.2B");
      expect(formatCompactCount(-12_345)).toBe("-12.3k");
    });
  });

  describe("formatDurationSecondsSmart", () => {
    it("returns unknown for invalid values", () => {
      expect(formatDurationSecondsSmart(Number.NaN)).toBe("unknown");
      expect(formatDurationSecondsSmart(Number.POSITIVE_INFINITY)).toBe("unknown");
    });

    it("formats durations with omitted zero seconds", () => {
      expect(formatDurationSecondsSmart(0)).toBe("0s");
      expect(formatDurationSecondsSmart(44)).toBe("44s");
      expect(formatDurationSecondsSmart(60)).toBe("1m");
      expect(formatDurationSecondsSmart(3600)).toBe("1h 0m");
      expect(formatDurationSecondsSmart(1.6)).toBe("2s");
    });
  });
});
