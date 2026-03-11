export type TranscriptSource =
  | "youtubei"
  | "captionTracks"
  | "embedded"
  | "yt-dlp"
  | "podcastTranscript"
  | "whisper"
  | "apify"
  | "html"
  | "unavailable"
  | "unknown";

export type TranscriptSegment = {
  startMs: number;
  endMs?: number | null;
  text: string;
};

export const CACHE_MODES = ["default", "bypass"] as const;
export type CacheMode = (typeof CACHE_MODES)[number];

export type CacheStatus = "hit" | "miss" | "expired" | "bypassed" | "fallback" | "unknown";

export interface TranscriptDiagnostics {
  cacheMode: CacheMode;
  cacheStatus: CacheStatus;
  textProvided: boolean;
  provider: TranscriptSource | null;
  attemptedProviders: TranscriptSource[];
  notes?: string | null;
}

export interface WebsiteScrapeDiagnostics {
  attempted: boolean;
  used: boolean;
  cacheMode: CacheMode;
  cacheStatus: CacheStatus;
  provider?: "firecrawl" | "exa" | "cloudflare" | null;
  notes?: string | null;
}

export interface MarkdownDiagnostics {
  requested: boolean;
  used: boolean;
  provider: "firecrawl" | "exa" | "cloudflare" | "llm" | null;
  notes?: string | null;
}

export interface ContentFetchDiagnostics {
  strategy: "bird" | "xurl" | "firecrawl" | "exa" | "cloudflare" | "html" | "nitter";
  websiteScrape: WebsiteScrapeDiagnostics;
  markdown: MarkdownDiagnostics;
  transcript: TranscriptDiagnostics;
}

export interface TranscriptResolution {
  text: string | null;
  source: TranscriptSource | null;
  metadata?: Record<string, unknown> | null;
  diagnostics?: TranscriptDiagnostics;
  segments?: TranscriptSegment[] | null;
}
