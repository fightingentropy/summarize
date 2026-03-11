import { describe, expect, it } from "vitest";
import { prepareHtmlForStructuredParsing } from "../src/content/link-preview/content/structured-html.js";

describe("prepareHtmlForStructuredParsing", () => {
  it("keeps jsonld and video/embed markers while stripping inert blocks", () => {
    const html = `<!doctype html><html><head>
      <title>Sample</title>
      <script>window.__BIG_BOOTSTRAP__ = true;</script>
      <script type="application/ld+json">{"@type":"Article","headline":"Hello"}</script>
      <style>.hidden { display:none }</style>
    </head><body>
      <iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>
      <video src="https://cdn.example.com/video.mp4"></video>
      <noscript>Fallback</noscript>
    </body></html>`;

    const reduced = prepareHtmlForStructuredParsing(html);
    expect(reduced).toContain('type="application/ld+json"');
    expect(reduced).toContain("youtube.com/embed/abcdefghijk");
    expect(reduced).toContain("video.mp4");
    expect(reduced).not.toContain("__BIG_BOOTSTRAP__");
    expect(reduced).not.toContain(".hidden");
    expect(reduced).not.toContain("<noscript");
  });
});
