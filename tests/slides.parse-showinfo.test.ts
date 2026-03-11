import { describe, expect, it } from "vitest";
import { parseShowinfoTimestamp } from "../src/slides/index.js";

describe("parseShowinfoTimestamp", () => {
  it("parses pts_time from showinfo lines", () => {
    const line = "[Parsed_showinfo_0] n:34 pts:12345 pts_time:12.345";
    expect(parseShowinfoTimestamp(line)).toBeCloseTo(12.345, 6);
  });

  it("returns null for unrelated lines", () => {
    expect(parseShowinfoTimestamp("frame=  12")).toBeNull();
  });

  it("returns null for invalid numbers", () => {
    const line = "[Parsed_showinfo_0] pts_time:abc";
    expect(parseShowinfoTimestamp(line)).toBeNull();
  });
});
