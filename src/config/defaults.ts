import { DEFAULT_CACHE_MAX_MB, DEFAULT_CACHE_TTL_DAYS } from "../cache.js";
import {
  DEFAULT_MEDIA_CACHE_MAX_MB,
  DEFAULT_MEDIA_CACHE_TTL_DAYS,
  DEFAULT_MEDIA_CACHE_VERIFY,
} from "../media-cache.js";
import { DEFAULT_CLI_THEME } from "../tty/theme.js";

export const DEFAULT_CONFIG_SECRET_ENV_KEYS = [
  "OPENAI_API_KEY",
  "NVIDIA_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "Z_AI_API_KEY",
  "ZAI_API_KEY",
  "APIFY_API_TOKEN",
  "EXA_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "FIRECRAWL_API_KEY",
  "FAL_KEY",
  "GROQ_API_KEY",
  "ASSEMBLYAI_API_KEY",
] as const;

const DEFAULT_AUTO_CLI_ORDER = ["codex", "gemini", "claude", "agent"] as const;

export function buildDefaultSummarizeConfig(): Record<string, unknown> {
  return {
    model: "auto",
    output: {
      language: "auto",
    },
    cache: {
      enabled: true,
      maxMb: DEFAULT_CACHE_MAX_MB,
      ttlDays: DEFAULT_CACHE_TTL_DAYS,
      media: {
        enabled: true,
        maxMb: DEFAULT_MEDIA_CACHE_MAX_MB,
        ttlDays: DEFAULT_MEDIA_CACHE_TTL_DAYS,
        verify: DEFAULT_MEDIA_CACHE_VERIFY,
      },
    },
    media: {
      videoMode: "auto",
    },
    slides: {
      enabled: false,
      ocr: false,
      ocrMode: "fast",
      ocrLanguageCorrection: false,
      dir: "slides",
      sceneThreshold: 0.3,
      max: 6,
      minDuration: 2,
    },
    ui: {
      theme: DEFAULT_CLI_THEME,
    },
    cli: {
      codex: {
        binary: "codex",
        model: "",
      },
      gemini: {
        binary: "gemini",
        model: "",
      },
      claude: {
        binary: "claude",
        model: "",
      },
      agent: {
        binary: "agent",
        model: "",
      },
      autoFallback: {
        enabled: false,
        onlyWhenNoApiKeys: true,
        order: [...DEFAULT_AUTO_CLI_ORDER],
      },
    },
    openai: {
      useChatCompletions: false,
      whisperUsdPerMinute: 0.006,
    },
    env: Object.fromEntries(DEFAULT_CONFIG_SECRET_ENV_KEYS.map((key) => [key, ""])),
  };
}
