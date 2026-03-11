import type { ExtractedLinkContent } from "../../../content/index.js";
import { parseGatewayStyleModelId } from "../../../llm/model-id.js";
import { buildLengthPartsForFinishLine } from "../../finish-line.js";
import type { ModelAttempt } from "../../types.js";
import type { UrlFlowContext } from "./types.js";

export function buildFinishExtras({
  extracted,
  metricsDetailed,
  transcriptionCostLabel,
}: {
  extracted: ExtractedLinkContent;
  metricsDetailed: boolean;
  transcriptionCostLabel: string | null;
}) {
  const parts = [
    ...(buildLengthPartsForFinishLine(extracted, metricsDetailed) ?? []),
    ...(transcriptionCostLabel ? [transcriptionCostLabel] : []),
  ];
  return parts.length > 0 ? parts : null;
}

export function pickModelForFinishLine(
  llmCalls: UrlFlowContext["model"]["llmCalls"],
  fallback: string | null,
) {
  const findLastModel = (purpose: (typeof llmCalls)[number]["purpose"]): string | null => {
    for (let i = llmCalls.length - 1; i >= 0; i -= 1) {
      const call = llmCalls[i];
      if (call && call.purpose === purpose) return call.model;
    }
    return null;
  };

  return (
    findLastModel("summary") ??
    findLastModel("markdown") ??
    (llmCalls.length > 0 ? (llmCalls[llmCalls.length - 1]?.model ?? null) : null) ??
    fallback
  );
}

export function buildModelMetaFromAttempt(attempt: ModelAttempt) {
  if (attempt.transport === "cli") {
    return { provider: "cli" as const, canonical: attempt.userModelId };
  }
  const parsed = parseGatewayStyleModelId(attempt.llmModelId ?? attempt.userModelId);
  const canonical = attempt.userModelId.toLowerCase().startsWith("openrouter/")
    ? attempt.userModelId
    : parsed.canonical;
  return { provider: parsed.provider, canonical };
}
