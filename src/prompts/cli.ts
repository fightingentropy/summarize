import type { OutputLanguage } from "../language.js";
import { formatOutputLanguageInstruction } from "../language.js";
import { buildInstructions, buildTaggedPrompt, type PromptOverrides } from "./format.js";
import { pickSummaryLengthForCharacters, type SummaryLengthTarget } from "./link-summary.js";
import { formatPresetLengthGuidance, resolveSummaryLengthSpec } from "./summary-lengths.js";

function formatTargetLength(summaryLength: SummaryLengthTarget): string {
  if (typeof summaryLength === "string") return formatPresetLengthGuidance(summaryLength);
  const max = summaryLength.maxCharacters;
  return `Target length: around ${max.toLocaleString()} characters total (including Markdown and whitespace). This is a soft guideline; prioritize clarity.`;
}

export function buildPathSummaryPrompt({
  kindLabel,
  filePath,
  filename,
  mediaType,
  outputLanguage,
  summaryLength,
  promptOverride,
  lengthInstruction,
  languageInstruction,
}: {
  kindLabel: "file" | "image";
  filePath: string;
  filename: string | null;
  mediaType: string | null;
  summaryLength: SummaryLengthTarget;
  outputLanguage?: OutputLanguage | null;
  promptOverride?: string | null;
  lengthInstruction?: string | null;
  languageInstruction?: string | null;
}): string {
  const preset =
    typeof summaryLength === "string"
      ? summaryLength
      : pickSummaryLengthForCharacters(summaryLength.maxCharacters);
  const directive = resolveSummaryLengthSpec(preset);
  const headerLines = [
    `Path: ${filePath}`,
    filename ? `Filename: ${filename}` : null,
    mediaType ? `Media type: ${mediaType}` : null,
  ].filter(Boolean);

  const maxCharactersLine = formatTargetLength(summaryLength);
  const baseInstructions = [
    `You summarize ${kindLabel === "image" ? "images" : "files"} for curious users.`,
    `Summarize the ${kindLabel} at the path below.`,
    "Be factual and do not invent details.",
    directive.guidance,
    directive.formatting,
    "Format the answer in Markdown.",
    "Use short paragraphs; use bullet lists only when they improve scanability; avoid rigid templates.",
    "Do not use emojis.",
    maxCharactersLine,
    formatOutputLanguageInstruction(outputLanguage ?? { kind: "auto" }),
    "Return only the summary.",
  ]
    .filter((line) => typeof line === "string" && line.trim().length > 0)
    .join("\n");

  const instructions = buildInstructions({
    base: baseInstructions,
    overrides: { promptOverride, lengthInstruction, languageInstruction } satisfies PromptOverrides,
  });
  const context = headerLines.join("\n");

  return buildTaggedPrompt({
    instructions,
    context,
    content: "",
  });
}
