import type { AutoRule, AutoRuleKind, SummarizeConfig } from "./config.js";

export const DEFAULT_RULES: AutoRule[] = [
  {
    when: ["video"],
    candidates: ["google/gemini-3-flash", "google/gemini-2.5-flash-lite-preview-09-2025"],
  },
  {
    when: ["image"],
    candidates: ["openai/gpt-5-mini", "google/gemini-3-flash", "anthropic/claude-sonnet-4-5"],
  },
  {
    when: ["website", "youtube", "text"],
    bands: [
      {
        token: { max: 50_000 },
        candidates: ["openai/gpt-5-mini", "google/gemini-3-flash", "anthropic/claude-sonnet-4-5"],
      },
      {
        token: { max: 200_000 },
        candidates: ["openai/gpt-5-mini", "google/gemini-3-flash", "anthropic/claude-sonnet-4-5"],
      },
      {
        candidates: [
          "openai/gpt-5-mini",
          "xai/grok-4-fast-non-reasoning",
          "google/gemini-3-flash",
          "anthropic/claude-sonnet-4-5",
        ],
      },
    ],
  },
  {
    when: ["file"],
    candidates: ["openai/gpt-5-mini", "google/gemini-3-flash", "anthropic/claude-sonnet-4-5"],
  },
  {
    candidates: [
      "openai/gpt-5-mini",
      "google/gemini-3-flash",
      "anthropic/claude-sonnet-4-5",
      "xai/grok-4-fast-non-reasoning",
    ],
  },
];

function tokenMatchesBand({
  promptTokens,
  band,
}: {
  promptTokens: number | null;
  band: NonNullable<AutoRule["bands"]>[number];
}): boolean {
  const token = band.token;
  if (!token) return true;
  if (typeof promptTokens !== "number" || !Number.isFinite(promptTokens)) {
    return typeof token.min !== "number" && typeof token.max !== "number";
  }
  const min = typeof token.min === "number" ? token.min : 0;
  const max = typeof token.max === "number" ? token.max : Number.POSITIVE_INFINITY;
  return promptTokens >= min && promptTokens <= max;
}

export function resolveRuleCandidates({
  kind,
  promptTokens,
  config,
}: {
  kind: AutoRuleKind;
  promptTokens: number | null;
  config: SummarizeConfig | null;
}): string[] {
  const rules = (() => {
    const model = config?.model;
    if (
      model &&
      "mode" in model &&
      model.mode === "auto" &&
      Array.isArray(model.rules) &&
      model.rules.length > 0
    ) {
      return model.rules;
    }
    return DEFAULT_RULES;
  })();

  for (const rule of rules) {
    const when = rule.when;
    if (Array.isArray(when) && when.length > 0 && !when.includes(kind)) continue;

    if (Array.isArray(rule.candidates) && rule.candidates.length > 0) {
      return rule.candidates;
    }

    const bands = rule.bands;
    if (!Array.isArray(bands) || bands.length === 0) continue;
    for (const band of bands) {
      if (tokenMatchesBand({ promptTokens, band })) {
        return band.candidates;
      }
    }
  }

  const fallback = rules[rules.length - 1];
  return fallback?.candidates ?? [];
}
