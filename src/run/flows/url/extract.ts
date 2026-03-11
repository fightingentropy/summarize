import type { ExtractedLinkContent, FetchLinkContentOptions } from "../../../content/index.js";
import { formatBytes } from "../../../tty/format.js";
import { withBirdTip } from "../../bird.js";
import { buildSummaryFinishLabel } from "../../finish-line.js";
import { formatOptionalNumber, formatOptionalString } from "../../format.js";
import { writeVerbose } from "../../logging.js";

export type UrlExtractionUi = {
  contentSizeLabel: string;
  viaSourceLabel: string;
  footerParts: string[];
  finishSourceLabel: string | null;
};

type WebsiteScrapeDiagnostics = ExtractedLinkContent["diagnostics"]["websiteScrape"];

function resolveWebsiteScrapeDiagnostics(
  extracted: ExtractedLinkContent,
): WebsiteScrapeDiagnostics {
  const diagnostics = extracted.diagnostics as ExtractedLinkContent["diagnostics"] & {
    firecrawl?: {
      attempted?: boolean;
      used?: boolean;
      cacheMode?: WebsiteScrapeDiagnostics["cacheMode"];
      cacheStatus?: WebsiteScrapeDiagnostics["cacheStatus"];
      notes?: string | null;
    };
  };
  if (diagnostics.websiteScrape) {
    return diagnostics.websiteScrape;
  }
  const legacy = diagnostics.firecrawl;
  return {
    attempted: Boolean(legacy?.attempted),
    used: Boolean(legacy?.used),
    provider: legacy?.used ? "firecrawl" : null,
    cacheMode: legacy?.cacheMode ?? "bypass",
    cacheStatus: legacy?.cacheStatus ?? "bypassed",
    notes: legacy?.notes ?? null,
  };
}

function getExternalScrapeLabel(
  provider: "firecrawl" | "exa" | "cloudflare" | null,
): string | null {
  if (provider === "exa") return "Exa";
  if (provider === "cloudflare") return "Cloudflare";
  if (provider === "firecrawl") return "Firecrawl";
  return null;
}

export async function fetchLinkContentWithBirdTip({
  client,
  url,
  options,
  env,
}: {
  client: {
    fetchLinkContent: (
      url: string,
      options?: FetchLinkContentOptions,
    ) => Promise<ExtractedLinkContent>;
  };
  url: string;
  options: FetchLinkContentOptions;
  env: Record<string, string | undefined>;
}): Promise<ExtractedLinkContent> {
  try {
    return await client.fetchLinkContent(url, options);
  } catch (error) {
    throw withBirdTip(error, url, env);
  }
}

export function deriveExtractionUi(extracted: ExtractedLinkContent): UrlExtractionUi {
  const websiteScrape = resolveWebsiteScrapeDiagnostics(extracted);
  const extractedContentBytes = Buffer.byteLength(extracted.content, "utf8");
  const contentSizeLabel = formatBytes(extractedContentBytes);
  const twitterStrategy =
    extracted.diagnostics.strategy === "xurl" || extracted.diagnostics.strategy === "bird"
      ? extracted.diagnostics.strategy
      : null;

  const viaSources: string[] = [];
  if (twitterStrategy) {
    viaSources.push(twitterStrategy);
  }
  if (extracted.diagnostics.strategy === "nitter") {
    viaSources.push("Nitter");
  }
  if (websiteScrape.used) {
    viaSources.push(getExternalScrapeLabel(websiteScrape.provider ?? null) ?? "Firecrawl");
  }
  const viaSourceLabel = viaSources.length > 0 ? `, ${viaSources.join("+")}` : "";

  const footerParts: string[] = [];
  if (extracted.diagnostics.strategy === "html") footerParts.push("html");
  if (twitterStrategy) footerParts.push(twitterStrategy);
  if (extracted.diagnostics.strategy === "nitter") footerParts.push("nitter");
  if (websiteScrape.used) {
    footerParts.push(websiteScrape.provider ?? "firecrawl");
  }
  if (extracted.diagnostics.markdown.used) {
    if (extracted.diagnostics.markdown.provider === "llm") {
      footerParts.push(
        extracted.diagnostics.markdown.notes === "transcript" ? "transcript→md llm" : "html→md llm",
      );
    } else {
      footerParts.push("markdown");
    }
  }
  if (extracted.diagnostics.transcript.textProvided) {
    footerParts.push(`transcript ${extracted.diagnostics.transcript.provider ?? "unknown"}`);
  }
  if (extracted.isVideoOnly && extracted.video) {
    footerParts.push(extracted.video.kind === "youtube" ? "video youtube" : "video url");
  }

  const finishSourceLabel = buildSummaryFinishLabel({
    extracted: { diagnostics: extracted.diagnostics, wordCount: extracted.wordCount },
  });

  return {
    contentSizeLabel,
    viaSourceLabel,
    footerParts,
    finishSourceLabel,
  };
}

export function logExtractionDiagnostics({
  extracted,
  stderr,
  verbose,
  verboseColor,
  env,
}: {
  extracted: ExtractedLinkContent;
  stderr: NodeJS.WritableStream;
  verbose: boolean;
  verboseColor: boolean;
  env?: Record<string, string | undefined>;
}) {
  const websiteScrape = resolveWebsiteScrapeDiagnostics(extracted);
  writeVerbose(
    stderr,
    verbose,
    `extract done strategy=${extracted.diagnostics.strategy} siteName=${formatOptionalString(
      extracted.siteName,
    )} title=${formatOptionalString(extracted.title)} transcriptSource=${formatOptionalString(
      extracted.transcriptSource,
    )}`,
    verboseColor,
    env,
  );
  writeVerbose(
    stderr,
    verbose,
    `extract stats characters=${extracted.totalCharacters} words=${extracted.wordCount} transcriptCharacters=${formatOptionalNumber(
      extracted.transcriptCharacters,
    )} transcriptLines=${formatOptionalNumber(extracted.transcriptLines)}`,
    verboseColor,
    env,
  );
  writeVerbose(
    stderr,
    verbose,
    `extract websiteScrape attempted=${websiteScrape.attempted} used=${websiteScrape.used} provider=${formatOptionalString(
      websiteScrape.provider ?? null,
    )} notes=${formatOptionalString(websiteScrape.notes ?? null)}`,
    verboseColor,
    env,
  );
  writeVerbose(
    stderr,
    verbose,
    `extract markdown requested=${extracted.diagnostics.markdown.requested} used=${extracted.diagnostics.markdown.used} provider=${formatOptionalString(
      extracted.diagnostics.markdown.provider ?? null,
    )} notes=${formatOptionalString(extracted.diagnostics.markdown.notes ?? null)}`,
    verboseColor,
    env,
  );
  writeVerbose(
    stderr,
    verbose,
    `extract transcript textProvided=${extracted.diagnostics.transcript.textProvided} provider=${formatOptionalString(
      extracted.diagnostics.transcript.provider ?? null,
    )} attemptedProviders=${
      extracted.diagnostics.transcript.attemptedProviders.length > 0
        ? extracted.diagnostics.transcript.attemptedProviders.join(",")
        : "none"
    } notes=${formatOptionalString(extracted.diagnostics.transcript.notes ?? null)}`,
    verboseColor,
    env,
  );
}
