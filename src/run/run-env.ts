import type { CliProvider, SummarizeConfig } from "../config.js";
import { isOpenRouterBaseUrl, resolveConfiguredBaseUrl } from "../openai/base-url.js";
import { resolveCliAvailability, resolveExecutableInPath } from "./env.js";

export type EnvState = {
  apiKey: string | null;
  openrouterApiKey: string | null;
  openrouterConfigured: boolean;
  groqApiKey: string | null;
  assemblyaiApiKey: string | null;
  openaiTranscriptionKey: string | null;
  xaiApiKey: string | null;
  googleApiKey: string | null;
  anthropicApiKey: string | null;
  zaiApiKey: string | null;
  zaiBaseUrl: string;
  nvidiaApiKey: string | null;
  nvidiaBaseUrl: string;
  exaApiKey: string | null;
  exaConfigured: boolean;
  cloudflareApiToken: string | null;
  cloudflareAccountId: string | null;
  cloudflareConfigured: boolean;
  firecrawlApiKey: string | null;
  firecrawlConfigured: boolean;
  googleConfigured: boolean;
  anthropicConfigured: boolean;
  apifyToken: string | null;
  ytDlpPath: string | null;
  ytDlpCookiesFromBrowser: string | null;
  falApiKey: string | null;
  cliAvailability: Partial<Record<CliProvider, boolean>>;
  envForAuto: Record<string, string | undefined>;
  providerBaseUrls: {
    openai: string | null;
    nvidia: string | null;
    anthropic: string | null;
    google: string | null;
    xai: string | null;
  };
};

export function resolveEnvState({
  env,
  envForRun,
  configForCli,
}: {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  configForCli: SummarizeConfig | null;
}): EnvState {
  const firstNonBlank = (...values: Array<string | null | undefined>): string | null => {
    for (const value of values) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
    return null;
  };

  const xaiKeyRaw = typeof envForRun.XAI_API_KEY === "string" ? envForRun.XAI_API_KEY : null;
  const openaiBaseUrl = resolveConfiguredBaseUrl({
    envValue: envForRun.OPENAI_BASE_URL,
    configValue: configForCli?.openai?.baseUrl,
  });
  const nvidiaBaseUrl = resolveConfiguredBaseUrl({
    envValue: envForRun.NVIDIA_BASE_URL,
    configValue: configForCli?.nvidia?.baseUrl,
  });
  const anthropicBaseUrl = resolveConfiguredBaseUrl({
    envValue: envForRun.ANTHROPIC_BASE_URL,
    configValue: configForCli?.anthropic?.baseUrl,
  });
  const googleBaseUrl = resolveConfiguredBaseUrl({
    envValue: envForRun.GOOGLE_BASE_URL ?? envForRun.GEMINI_BASE_URL,
    configValue: configForCli?.google?.baseUrl,
  });
  const xaiBaseUrl = resolveConfiguredBaseUrl({
    envValue: envForRun.XAI_BASE_URL,
    configValue: configForCli?.xai?.baseUrl,
  });
  const zaiBaseUrl = resolveConfiguredBaseUrl({
    envValue:
      typeof envForRun.Z_AI_BASE_URL === "string"
        ? envForRun.Z_AI_BASE_URL
        : typeof envForRun.ZAI_BASE_URL === "string"
          ? envForRun.ZAI_BASE_URL
          : null,
    configValue: configForCli?.zai?.baseUrl,
  });
  const zaiKeyRaw =
    typeof envForRun.Z_AI_API_KEY === "string"
      ? envForRun.Z_AI_API_KEY
      : typeof envForRun.ZAI_API_KEY === "string"
        ? envForRun.ZAI_API_KEY
        : null;
  const openRouterKeyRaw =
    typeof envForRun.OPENROUTER_API_KEY === "string" ? envForRun.OPENROUTER_API_KEY : null;
  const openaiKeyRaw =
    typeof envForRun.OPENAI_API_KEY === "string" ? envForRun.OPENAI_API_KEY : null;
  const nvidiaKeyRaw =
    typeof envForRun.NVIDIA_API_KEY === "string"
      ? envForRun.NVIDIA_API_KEY
      : typeof envForRun.NGC_API_KEY === "string"
        ? envForRun.NGC_API_KEY
        : null;
  const apiKey =
    typeof openaiBaseUrl === "string" && isOpenRouterBaseUrl(openaiBaseUrl)
      ? firstNonBlank(openRouterKeyRaw, openaiKeyRaw)
      : firstNonBlank(openaiKeyRaw);
  const apifyToken =
    typeof envForRun.APIFY_API_TOKEN === "string" ? envForRun.APIFY_API_TOKEN : null;
  const ytDlpPath = (() => {
    const explicit = typeof envForRun.YT_DLP_PATH === "string" ? envForRun.YT_DLP_PATH.trim() : "";
    if (explicit.length > 0) return explicit;
    return resolveExecutableInPath("yt-dlp", envForRun);
  })();
  const ytDlpCookiesFromBrowser = (() => {
    const raw =
      typeof envForRun.SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER === "string"
        ? envForRun.SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER
        : typeof envForRun.YT_DLP_COOKIES_FROM_BROWSER === "string"
          ? envForRun.YT_DLP_COOKIES_FROM_BROWSER
          : "";
    const value = raw.trim();
    return value.length > 0 ? value : null;
  })();
  const groqApiKey =
    typeof envForRun.GROQ_API_KEY === "string" ? envForRun.GROQ_API_KEY.trim() || null : null;
  const assemblyaiApiKey =
    typeof envForRun.ASSEMBLYAI_API_KEY === "string"
      ? envForRun.ASSEMBLYAI_API_KEY.trim() || null
      : null;
  const falApiKey = typeof envForRun.FAL_KEY === "string" ? envForRun.FAL_KEY : null;
  const exaKey = typeof envForRun.EXA_API_KEY === "string" ? envForRun.EXA_API_KEY : null;
  const cloudflareToken =
    typeof envForRun.CLOUDFLARE_API_TOKEN === "string" ? envForRun.CLOUDFLARE_API_TOKEN : null;
  const cloudflareAccountId =
    typeof envForRun.CLOUDFLARE_ACCOUNT_ID === "string" ? envForRun.CLOUDFLARE_ACCOUNT_ID : null;
  const firecrawlKey =
    typeof envForRun.FIRECRAWL_API_KEY === "string" ? envForRun.FIRECRAWL_API_KEY : null;
  const anthropicKeyRaw =
    typeof envForRun.ANTHROPIC_API_KEY === "string" ? envForRun.ANTHROPIC_API_KEY : null;
  const googleKeyRaw = firstNonBlank(
    envForRun.GEMINI_API_KEY,
    envForRun.GOOGLE_GENERATIVE_AI_API_KEY,
    envForRun.GOOGLE_API_KEY,
  );

  const exaApiKey = firstNonBlank(exaKey);
  const exaConfigured = exaApiKey !== null;
  const cloudflareApiToken = firstNonBlank(cloudflareToken);
  const cloudflareAccountIdEffective = firstNonBlank(cloudflareAccountId);
  const cloudflareConfigured = cloudflareApiToken !== null && cloudflareAccountIdEffective !== null;
  const firecrawlApiKey = firstNonBlank(firecrawlKey);
  const firecrawlConfigured = firecrawlApiKey !== null;
  const xaiApiKey = firstNonBlank(xaiKeyRaw);
  const zaiApiKey = firstNonBlank(zaiKeyRaw);
  const zaiBaseUrlEffective = (zaiBaseUrl?.trim() ?? "") || "https://api.z.ai/api/paas/v4";
  const nvidiaApiKey = firstNonBlank(nvidiaKeyRaw);
  const nvidiaBaseUrlEffective =
    (nvidiaBaseUrl?.trim() ?? "") || "https://integrate.api.nvidia.com/v1";
  const googleApiKey = firstNonBlank(googleKeyRaw);
  const anthropicApiKey = firstNonBlank(anthropicKeyRaw);
  const openrouterApiKey = (() => {
    const explicit = firstNonBlank(openRouterKeyRaw) ?? "";
    if (explicit.length > 0) return explicit;
    const baseUrl = openaiBaseUrl ?? "";
    const openaiKey = firstNonBlank(openaiKeyRaw) ?? "";
    if (baseUrl.length > 0 && isOpenRouterBaseUrl(baseUrl) && openaiKey.length > 0) {
      return openaiKey;
    }
    return null;
  })();
  const openaiTranscriptionKey = firstNonBlank(openaiKeyRaw);
  const googleConfigured = typeof googleApiKey === "string" && googleApiKey.length > 0;
  const anthropicConfigured = typeof anthropicApiKey === "string" && anthropicApiKey.length > 0;
  const openrouterConfigured = typeof openrouterApiKey === "string" && openrouterApiKey.length > 0;
  const cliAvailability = resolveCliAvailability({ env, config: configForCli });
  const envForAuto = openrouterApiKey
    ? { ...envForRun, OPENROUTER_API_KEY: openrouterApiKey }
    : envForRun;
  const providerBaseUrls = {
    openai: openaiBaseUrl,
    nvidia: nvidiaBaseUrl,
    anthropic: anthropicBaseUrl,
    google: googleBaseUrl,
    xai: xaiBaseUrl,
  };

  return {
    apiKey: apiKey?.trim() ?? null,
    openrouterApiKey,
    openrouterConfigured,
    groqApiKey,
    assemblyaiApiKey,
    openaiTranscriptionKey,
    xaiApiKey,
    googleApiKey,
    anthropicApiKey,
    zaiApiKey,
    zaiBaseUrl: zaiBaseUrlEffective,
    nvidiaApiKey,
    nvidiaBaseUrl: nvidiaBaseUrlEffective,
    exaApiKey,
    exaConfigured,
    cloudflareApiToken,
    cloudflareAccountId: cloudflareAccountIdEffective,
    cloudflareConfigured,
    firecrawlApiKey,
    firecrawlConfigured,
    googleConfigured,
    anthropicConfigured,
    apifyToken,
    ytDlpPath,
    ytDlpCookiesFromBrowser,
    falApiKey,
    cliAvailability,
    envForAuto,
    providerBaseUrls,
  };
}
