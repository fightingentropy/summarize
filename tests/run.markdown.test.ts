import { describe, expect, it } from "vitest";
import {
  prepareMarkdownForTerminal,
  prepareMarkdownForTerminalStreaming,
  prepareMarkdownLineForTerminal,
} from "../src/run/markdown.js";

describe("run/markdown", () => {
  it("materializes inline links outside fences", () => {
    const input = [
      "See [Docs](https://example.com/docs).",
      "```md",
      "[Literal](https://example.com/literal)",
      "```",
    ].join("\n");

    expect(prepareMarkdownForTerminalStreaming(input)).toContain("Docs: https://example.com/docs");
    expect(prepareMarkdownForTerminalStreaming(input)).toContain(
      "[Literal](https://example.com/literal)",
    );
  });

  it("collapses extra blank lines outside fences only", () => {
    const input = ["one", "", "", "```", "", "", "```", "", "", "two"].join("\n");
    expect(prepareMarkdownForTerminalStreaming(input)).toBe(
      ["one", "", "```", "", "", "```", "", "two"].join("\n"),
    );
  });

  it("inlines used reference-style links and leaves unused definitions alone", () => {
    const input = [
      "Read [Guide][g] and [Missing][m].",
      "",
      "[g]: https://example.com/guide",
      "[unused]: https://example.com/unused",
    ].join("\n");

    expect(prepareMarkdownForTerminal(input)).toContain("Guide: https://example.com/guide");
    expect(prepareMarkdownForTerminal(input)).toContain("[Missing][m]");
    expect(prepareMarkdownForTerminal(input)).toContain("[unused]: https://example.com/unused");
  });

  it("rewrites a single markdown line only when label and url are present", () => {
    expect(prepareMarkdownLineForTerminal("[Docs](https://example.com)")).toBe(
      "Docs: https://example.com",
    );
    expect(prepareMarkdownLineForTerminal("![Alt](https://example.com/image.png)")).toBe(
      "![Alt](https://example.com/image.png)",
    );
  });
});
