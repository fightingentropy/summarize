import {
  collapseExtraBlankLines,
  inlineReferenceStyleLinks,
  materializeInlineMarkdownLinks,
} from "./markdown-transforms.js";

export function prepareMarkdownLineForTerminal(line: string): string {
  return line.replace(/(?<!!)\[([^\]]+)\]\((\S+?)\)/g, (_full, label, url) => {
    const safeLabel = String(label ?? "").trim();
    const safeUrl = String(url ?? "").trim();
    if (!safeLabel || !safeUrl) return _full;
    return `${safeLabel}: ${safeUrl}`;
  });
}

export function prepareMarkdownForTerminalStreaming(markdown: string): string {
  // Streaming is append-only; never rewrite earlier content (e.g. reference-style links).
  // Only apply local, fence-aware transformations.
  return collapseExtraBlankLines(materializeInlineMarkdownLinks(markdown));
}

export function prepareMarkdownForTerminal(markdown: string): string {
  return collapseExtraBlankLines(
    materializeInlineMarkdownLinks(inlineReferenceStyleLinks(markdown)),
  );
}
