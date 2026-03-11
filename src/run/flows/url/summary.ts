import { render as renderMarkdownAnsi } from "markdansi";
import type { ExtractedLinkContent } from "../../../content/index.js";
import { isTwitterStatusUrl, isYouTubeUrl } from "../../../content/url.js";
import { buildExtractFinishLabel, writeFinishLine } from "../../finish-line.js";
import { writeVerbose } from "../../logging.js";
import { prepareMarkdownForTerminal } from "../../markdown.js";
import { isRichTty, markdownRenderWidth, supportsColor } from "../../terminal.js";
import type { UrlExtractionUi } from "./extract.js";
import type { SlidesTerminalOutput } from "./slides-output.js";
import {
  coerceSummaryWithSlides,
  interleaveSlidesIntoTranscript,
  normalizeSummarySlideHeadings,
} from "./slides-text.js";
import {
  buildFinishExtras,
  buildModelMetaFromAttempt,
  pickModelForFinishLine,
} from "./summary-finish.js";
import { buildUrlJsonEnv, buildUrlJsonInput } from "./summary-json.js";
import {
  buildUrlPrompt as buildSummaryPrompt,
  shouldBypassShortContentSummary,
} from "./summary-prompt.js";
import { resolveUrlSummaryExecution } from "./summary-resolution.js";
import { buildSummaryTimestampLimitInstruction } from "./summary-timestamps.js";
import type { UrlFlowContext } from "./types.js";

type SlidesResult = Awaited<
  ReturnType<typeof import("../../../slides/index.js").extractSlidesForSource>
>;

export function buildUrlPrompt({
  extracted,
  outputLanguage,
  lengthArg,
  promptOverride,
  lengthInstruction,
  languageInstruction,
  slides,
}: {
  extracted: ExtractedLinkContent;
  outputLanguage: UrlFlowContext["flags"]["outputLanguage"];
  lengthArg: UrlFlowContext["flags"]["lengthArg"];
  promptOverride?: string | null;
  lengthInstruction?: string | null;
  languageInstruction?: string | null;
  slides?: SlidesResult | null;
}): string {
  return buildSummaryPrompt({
    extracted,
    outputLanguage,
    lengthArg,
    promptOverride,
    lengthInstruction,
    languageInstruction,
    slides,
    buildSummaryTimestampLimitInstruction,
  });
}

async function outputSummaryFromExtractedContent({
  ctx,
  url,
  extracted,
  extractionUi,
  prompt,
  effectiveMarkdownMode,
  transcriptionCostLabel,
  slides,
  footerLabel,
  verboseMessage,
}: {
  ctx: UrlFlowContext;
  url: string;
  extracted: ExtractedLinkContent;
  extractionUi: UrlExtractionUi;
  prompt: string;
  effectiveMarkdownMode: "off" | "auto" | "llm" | "readability";
  transcriptionCostLabel: string | null;
  slides?: Awaited<
    ReturnType<typeof import("../../../slides/index.js").extractSlidesForSource>
  > | null;
  footerLabel?: string | null;
  verboseMessage?: string | null;
}) {
  const { io, flags, model, hooks } = ctx;

  hooks.clearProgressForStdout();
  const finishModel = pickModelForFinishLine(model.llmCalls, null);

  if (flags.json) {
    const finishReport = flags.shouldComputeReport ? await hooks.buildReport() : null;
    const payload = {
      input: {
        ...buildUrlJsonInput({
          flags,
          url,
          effectiveMarkdownMode,
          modelLabel: model.requestedModelLabel,
        }),
      },
      env: buildUrlJsonEnv(model.apiStatus),
      extracted,
      slides,
      prompt,
      llm: null,
      metrics: flags.metricsEnabled ? finishReport : null,
      summary: extracted.content,
    };
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (flags.metricsEnabled && finishReport) {
      const costUsd = await hooks.estimateCostUsd();
      hooks.clearProgressForStdout();
      writeFinishLine({
        stderr: io.stderr,
        env: io.envForRun,
        elapsedMs: Date.now() - flags.runStartedAtMs,
        label: extractionUi.finishSourceLabel,
        model: finishModel,
        report: finishReport,
        costUsd,
        detailed: flags.metricsDetailed,
        extraParts: buildFinishExtras({
          extracted,
          metricsDetailed: flags.metricsDetailed,
          transcriptionCostLabel,
        }),
        color: flags.verboseColor,
      });
    }
    return;
  }

  io.stdout.write(`${extracted.content}\n`);
  hooks.restoreProgressAfterStdout?.();
  if (extractionUi.footerParts.length > 0) {
    const footer = footerLabel
      ? [...extractionUi.footerParts, footerLabel]
      : extractionUi.footerParts;
    hooks.writeViaFooter(footer);
  }
  if (verboseMessage && flags.verbose) {
    writeVerbose(io.stderr, flags.verbose, verboseMessage, flags.verboseColor, io.envForRun);
  }
}

export async function outputExtractedUrl({
  ctx,
  url,
  extracted,
  extractionUi,
  prompt,
  effectiveMarkdownMode,
  transcriptionCostLabel,
  slides,
  slidesOutput,
}: {
  ctx: UrlFlowContext;
  url: string;
  extracted: ExtractedLinkContent;
  extractionUi: UrlExtractionUi;
  prompt: string;
  effectiveMarkdownMode: "off" | "auto" | "llm" | "readability";
  transcriptionCostLabel: string | null;
  slides?: Awaited<
    ReturnType<typeof import("../../../slides/index.js").extractSlidesForSource>
  > | null;
  slidesOutput?: SlidesTerminalOutput | null;
}) {
  const { io, flags, model, hooks } = ctx;

  hooks.clearProgressForStdout();
  const finishLabel = buildExtractFinishLabel({
    extracted: { diagnostics: extracted.diagnostics },
    format: flags.format,
    markdownMode: effectiveMarkdownMode,
    hasMarkdownLlmCall: model.llmCalls.some((call) => call.purpose === "markdown"),
  });
  const finishModel = pickModelForFinishLine(model.llmCalls, null);

  if (flags.json) {
    const finishReport = flags.shouldComputeReport ? await hooks.buildReport() : null;
    const payload = {
      input: {
        ...buildUrlJsonInput({
          flags,
          url,
          effectiveMarkdownMode,
          modelLabel: model.requestedModelLabel,
        }),
      },
      env: buildUrlJsonEnv(model.apiStatus),
      extracted,
      slides,
      prompt,
      llm: null,
      metrics: flags.metricsEnabled ? finishReport : null,
      summary: null,
    };
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    hooks.restoreProgressAfterStdout?.();
    hooks.restoreProgressAfterStdout?.();
    if (flags.metricsEnabled && finishReport) {
      const costUsd = await hooks.estimateCostUsd();
      writeFinishLine({
        stderr: io.stderr,
        env: io.envForRun,
        elapsedMs: Date.now() - flags.runStartedAtMs,
        label: finishLabel,
        model: finishModel,
        report: finishReport,
        costUsd,
        detailed: flags.metricsDetailed,
        extraParts: buildFinishExtras({
          extracted,
          metricsDetailed: flags.metricsDetailed,
          transcriptionCostLabel,
        }),
        color: flags.verboseColor,
      });
    }
    return;
  }

  const extractCandidate =
    flags.transcriptTimestamps &&
    extracted.transcriptTimedText &&
    extracted.transcriptSource &&
    extracted.content.toLowerCase().startsWith("transcript:")
      ? `Transcript:\n${extracted.transcriptTimedText}`
      : extracted.content;

  const slideTags =
    slides?.slides && slides.slides.length > 0
      ? slides.slides.map((slide) => `[slide:${slide.index}]`).join("\n")
      : "";

  if (slidesOutput && slides?.slides && slides.slides.length > 0) {
    const transcriptText = extracted.transcriptTimedText
      ? `Transcript:\n${extracted.transcriptTimedText}`
      : null;
    const interleaved = transcriptText
      ? interleaveSlidesIntoTranscript({
          transcriptTimedText: transcriptText,
          slides: slides.slides.map((slide) => ({
            index: slide.index,
            timestamp: slide.timestamp,
          })),
        })
      : `${extractCandidate.trimEnd()}\n\n${slideTags}`;
    await slidesOutput.renderFromText(interleaved);
    hooks.restoreProgressAfterStdout?.();
    const slideFooter = slides ? [`slides ${slides.slides.length}`] : [];
    hooks.writeViaFooter([...extractionUi.footerParts, ...slideFooter]);
    const report = flags.shouldComputeReport ? await hooks.buildReport() : null;
    if (flags.metricsEnabled && report) {
      const costUsd = await hooks.estimateCostUsd();
      writeFinishLine({
        stderr: io.stderr,
        env: io.envForRun,
        elapsedMs: Date.now() - flags.runStartedAtMs,
        label: finishLabel,
        model: finishModel,
        report,
        costUsd,
        detailed: flags.metricsDetailed,
        extraParts: buildFinishExtras({
          extracted,
          metricsDetailed: flags.metricsDetailed,
          transcriptionCostLabel,
        }),
        color: flags.verboseColor,
      });
    }
    return;
  }

  const renderedExtract =
    flags.format === "markdown" && !flags.plain && isRichTty(io.stdout)
      ? renderMarkdownAnsi(prepareMarkdownForTerminal(extractCandidate), {
          width: markdownRenderWidth(io.stdout, io.env),
          wrap: true,
          color: supportsColor(io.stdout, io.envForRun),
          hyperlinks: true,
        })
      : extractCandidate;

  if (flags.format === "markdown" && !flags.plain && isRichTty(io.stdout)) {
    io.stdout.write(`\n${renderedExtract.replace(/^\n+/, "")}`);
  } else {
    io.stdout.write(renderedExtract);
  }
  if (!renderedExtract.endsWith("\n")) {
    io.stdout.write("\n");
  }
  hooks.restoreProgressAfterStdout?.();
  const slideFooter = slides ? [`slides ${slides.slides.length}`] : [];
  hooks.writeViaFooter([...extractionUi.footerParts, ...slideFooter]);
  const report = flags.shouldComputeReport ? await hooks.buildReport() : null;
  if (flags.metricsEnabled && report) {
    const costUsd = await hooks.estimateCostUsd();
    hooks.clearProgressForStdout();
    writeFinishLine({
      stderr: io.stderr,
      env: io.envForRun,
      elapsedMs: Date.now() - flags.runStartedAtMs,
      label: finishLabel,
      model: finishModel,
      report,
      costUsd,
      detailed: flags.metricsDetailed,
      extraParts: buildFinishExtras({
        extracted,
        metricsDetailed: flags.metricsDetailed,
        transcriptionCostLabel,
      }),
      color: flags.verboseColor,
    });
  }
}

export async function summarizeExtractedUrl({
  ctx,
  url,
  extracted,
  extractionUi,
  prompt,
  effectiveMarkdownMode,
  transcriptionCostLabel,
  onModelChosen,
  slides,
  slidesOutput,
}: {
  ctx: UrlFlowContext;
  url: string;
  extracted: ExtractedLinkContent;
  extractionUi: UrlExtractionUi;
  prompt: string;
  effectiveMarkdownMode: "off" | "auto" | "llm" | "readability";
  transcriptionCostLabel: string | null;
  onModelChosen?: ((modelId: string) => void) | null;
  slides?: Awaited<
    ReturnType<typeof import("../../../slides/index.js").extractSlidesForSource>
  > | null;
  slidesOutput?: SlidesTerminalOutput | null;
}) {
  const { io, flags, model, cache: cacheState, hooks } = ctx;
  const resolution = await resolveUrlSummaryExecution({
    ctx,
    url,
    extracted,
    prompt,
    onModelChosen,
    slides,
    slidesOutput,
  });

  if (resolution.kind === "use-extracted") {
    await outputSummaryFromExtractedContent({
      ctx,
      url,
      extracted,
      extractionUi,
      prompt,
      effectiveMarkdownMode,
      transcriptionCostLabel,
      slides,
      footerLabel: resolution.footerLabel,
      verboseMessage: resolution.verboseMessage,
    });
    return;
  }
  const {
    normalizedSummary,
    summaryAlreadyPrinted,
    summaryFromCache,
    usedAttempt,
    modelMeta,
    maxOutputTokensForCall,
  } = resolution;

  if (flags.json) {
    const finishReport = flags.shouldComputeReport ? await hooks.buildReport() : null;
    const payload = {
      input: {
        ...buildUrlJsonInput({
          flags,
          url,
          effectiveMarkdownMode,
          modelLabel: model.requestedModelLabel,
        }),
      },
      env: buildUrlJsonEnv(model.apiStatus),
      extracted,
      slides,
      prompt,
      llm: {
        provider: modelMeta.provider,
        model: usedAttempt.userModelId,
        maxCompletionTokens: maxOutputTokensForCall,
        strategy: "single" as const,
      },
      metrics: flags.metricsEnabled ? finishReport : null,
      summary: normalizedSummary,
    };
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (flags.metricsEnabled && finishReport) {
      const costUsd = await hooks.estimateCostUsd();
      writeFinishLine({
        stderr: io.stderr,
        env: io.envForRun,
        elapsedMs: Date.now() - flags.runStartedAtMs,
        elapsedLabel: summaryFromCache ? "Cached" : null,
        label: extractionUi.finishSourceLabel,
        model: usedAttempt.userModelId,
        report: finishReport,
        costUsd,
        detailed: flags.metricsDetailed,
        extraParts: buildFinishExtras({
          extracted,
          metricsDetailed: flags.metricsDetailed,
          transcriptionCostLabel,
        }),
        color: flags.verboseColor,
      });
    }
    return;
  }

  if (slidesOutput) {
    if (!summaryAlreadyPrinted) {
      const summaryForSlides =
        slides && slides.slides.length > 0
          ? coerceSummaryWithSlides({
              markdown: normalizedSummary,
              slides: slides.slides.map((slide) => ({
                index: slide.index,
                timestamp: slide.timestamp,
              })),
              transcriptTimedText: extracted.transcriptTimedText ?? null,
              lengthArg: flags.lengthArg,
            })
          : normalizedSummary;
      await slidesOutput.renderFromText(summaryForSlides);
    }
  } else if (!summaryAlreadyPrinted) {
    hooks.clearProgressForStdout();
    const rendered =
      !flags.plain && isRichTty(io.stdout)
        ? renderMarkdownAnsi(prepareMarkdownForTerminal(normalizedSummary), {
            width: markdownRenderWidth(io.stdout, io.env),
            wrap: true,
            color: supportsColor(io.stdout, io.envForRun),
            hyperlinks: true,
          })
        : normalizedSummary;

    if (!flags.plain && isRichTty(io.stdout)) {
      io.stdout.write(`\n${rendered.replace(/^\n+/, "")}`);
    } else {
      if (isRichTty(io.stdout)) io.stdout.write("\n");
      io.stdout.write(rendered.replace(/^\n+/, ""));
    }
    if (!rendered.endsWith("\n")) {
      io.stdout.write("\n");
    }
    hooks.restoreProgressAfterStdout?.();
  }

  const report = flags.shouldComputeReport ? await hooks.buildReport() : null;
  if (flags.metricsEnabled && report) {
    const costUsd = await hooks.estimateCostUsd();
    writeFinishLine({
      stderr: io.stderr,
      env: io.envForRun,
      elapsedMs: Date.now() - flags.runStartedAtMs,
      elapsedLabel: summaryFromCache ? "Cached" : null,
      label: extractionUi.finishSourceLabel,
      model: modelMeta.canonical,
      report,
      costUsd,
      detailed: flags.metricsDetailed,
      extraParts: buildFinishExtras({
        extracted,
        metricsDetailed: flags.metricsDetailed,
        transcriptionCostLabel,
      }),
      color: flags.verboseColor,
    });
  }
}
