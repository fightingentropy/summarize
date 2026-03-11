import { formatCompactCount } from "../tty/format.js";

export type ExtractDiagnosticsForFinishLine = {
  strategy: "bird" | "xurl" | "firecrawl" | "exa" | "cloudflare" | "html" | "nitter";
  websiteScrape: { used: boolean; provider?: "firecrawl" | "exa" | "cloudflare" | null };
  markdown: {
    used: boolean;
    provider: "firecrawl" | "exa" | "cloudflare" | "llm" | null;
    notes?: string | null;
  };
  transcript: { textProvided: boolean; provider: string | null };
};

function externalProviderLabel(
  provider: "firecrawl" | "exa" | "cloudflare" | null | undefined,
): string {
  return provider ?? "firecrawl";
}

export function buildExtractFinishLabel(args: {
  extracted: { diagnostics: ExtractDiagnosticsForFinishLine };
  format: "text" | "markdown";
  markdownMode: "off" | "auto" | "llm" | "readability";
  hasMarkdownLlmCall: boolean;
}): string {
  const base = args.format === "markdown" ? "markdown" : "text";

  const transcriptProvided = Boolean(args.extracted.diagnostics.transcript?.textProvided);
  if (transcriptProvided) {
    const provider = args.extracted.diagnostics.transcript?.provider;
    return provider ? `${base} via transcript/${provider}` : `${base} via transcript`;
  }

  if (args.format === "markdown") {
    const strategy = String(args.extracted.diagnostics.strategy ?? "");
    const firecrawlProvider = externalProviderLabel(
      args.extracted.diagnostics.websiteScrape?.provider,
    );
    const firecrawlUsed =
      strategy === "firecrawl" ||
      strategy === "exa" ||
      strategy === "cloudflare" ||
      Boolean(args.extracted.diagnostics.websiteScrape?.used);
    if (firecrawlUsed)
      return `${base} via ${strategy === "exa" || strategy === "cloudflare" ? strategy : firecrawlProvider}`;
    if (strategy === "html" && args.markdownMode === "readability") {
      return `${base} via readability`;
    }

    const mdUsed = Boolean(args.extracted.diagnostics.markdown?.used);
    const mdProvider = args.extracted.diagnostics.markdown.provider;
    const mdNotes = args.extracted.diagnostics.markdown.notes ?? null;

    if (
      mdUsed &&
      (mdProvider === "firecrawl" || mdProvider === "exa" || mdProvider === "cloudflare")
    ) {
      return `${base} via ${mdProvider}`;
    }
    if (mdUsed && mdNotes && mdNotes.toLowerCase().includes("readability html used")) {
      return `${base} via readability`;
    }
    if (mdUsed) {
      if (args.markdownMode === "readability") return `${base} via readability`;
      if (args.hasMarkdownLlmCall) return `${base} via llm`;
      return `${base} via markitdown`;
    }
  }

  const strategy = String(args.extracted.diagnostics.strategy ?? "");
  if (
    strategy === "firecrawl" ||
    strategy === "exa" ||
    strategy === "cloudflare" ||
    args.extracted.diagnostics.websiteScrape?.used
  ) {
    return `${base} via ${
      strategy === "exa" || strategy === "cloudflare"
        ? strategy
        : externalProviderLabel(args.extracted.diagnostics.websiteScrape?.provider)
    }`;
  }
  if (strategy === "xurl") return `${base} via xurl`;
  if (strategy === "bird") return `${base} via bird`;
  if (strategy === "nitter") return `${base} via nitter`;
  return base;
}

export function buildSummaryFinishLabel(args: {
  extracted: { diagnostics: ExtractDiagnosticsForFinishLine; wordCount: number };
}): string | null {
  const strategy = String(args.extracted.diagnostics.strategy ?? "");
  const sources: string[] = [];
  if (strategy === "xurl") sources.push("xurl");
  if (strategy === "bird") sources.push("bird");
  if (strategy === "nitter") sources.push("nitter");
  if (
    strategy === "firecrawl" ||
    strategy === "exa" ||
    strategy === "cloudflare" ||
    args.extracted.diagnostics.websiteScrape?.used
  ) {
    sources.push(
      strategy === "exa" || strategy === "cloudflare"
        ? strategy
        : externalProviderLabel(args.extracted.diagnostics.websiteScrape?.provider),
    );
  }
  const transcriptProvided = Boolean(args.extracted.diagnostics.transcript?.textProvided);
  const words =
    typeof args.extracted.wordCount === "number" && Number.isFinite(args.extracted.wordCount)
      ? args.extracted.wordCount
      : 0;
  const wordLabel = words > 0 ? `${formatCompactCount(words)} words` : null;
  if (transcriptProvided) {
    if (sources.length === 0) return null;
    return `via ${sources.join("+")}`;
  }
  if (sources.length === 0 && !wordLabel) return null;
  if (wordLabel && sources.length > 0) return `${wordLabel} via ${sources.join("+")}`;
  if (wordLabel) return wordLabel;
  return `via ${sources.join("+")}`;
}
