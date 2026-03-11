import type { SummarizeConfig } from "../config.js";
import { resolveSlideSettings, type SlideSettings } from "../slides/index.js";

export function resolveRunnerSlidesSettings(options: {
  normalizedArgv: string[];
  programOpts: Record<string, unknown>;
  config: SummarizeConfig | null;
  inputKind: "url" | "file" | "stdin";
}): SlideSettings | null {
  const { normalizedArgv, programOpts, config, inputKind } = options;

  const slidesExplicitlySet = normalizedArgv.some(
    (arg) => arg === "--slides" || arg === "--no-slides" || arg.startsWith("--slides="),
  );
  const slidesOcrExplicitlySet = normalizedArgv.some(
    (arg) => arg === "--slides-ocr" || arg === "--no-slides-ocr" || arg.startsWith("--slides-ocr="),
  );
  const slidesDirExplicitlySet = normalizedArgv.some(
    (arg) => arg === "--slides-dir" || arg.startsWith("--slides-dir="),
  );
  const slidesSceneThresholdExplicitlySet = normalizedArgv.some(
    (arg) => arg === "--slides-scene-threshold" || arg.startsWith("--slides-scene-threshold="),
  );
  const slidesMaxExplicitlySet = normalizedArgv.some(
    (arg) => arg === "--slides-max" || arg.startsWith("--slides-max="),
  );
  const slidesMinDurationExplicitlySet = normalizedArgv.some(
    (arg) => arg === "--slides-min-duration" || arg.startsWith("--slides-min-duration="),
  );
  const slidesConfig = config?.slides;
  const slidesSettings = resolveSlideSettings({
    slides: slidesExplicitlySet
      ? programOpts.slides
      : (slidesConfig?.enabled ?? programOpts.slides),
    slidesOcr: slidesOcrExplicitlySet
      ? programOpts.slidesOcr
      : (slidesConfig?.ocr ?? programOpts.slidesOcr),
    slidesOcrMode: slidesConfig?.ocrMode,
    slidesOcrLanguageCorrection: slidesConfig?.ocrLanguageCorrection,
    slidesDir: slidesDirExplicitlySet
      ? programOpts.slidesDir
      : (slidesConfig?.dir ?? programOpts.slidesDir),
    slidesSceneThreshold: slidesSceneThresholdExplicitlySet
      ? programOpts.slidesSceneThreshold
      : (slidesConfig?.sceneThreshold ?? programOpts.slidesSceneThreshold),
    slidesSceneThresholdExplicit:
      slidesSceneThresholdExplicitlySet || typeof slidesConfig?.sceneThreshold === "number",
    slidesMax: slidesMaxExplicitlySet
      ? programOpts.slidesMax
      : (slidesConfig?.max ?? programOpts.slidesMax),
    slidesMinDuration: slidesMinDurationExplicitlySet
      ? programOpts.slidesMinDuration
      : (slidesConfig?.minDuration ?? programOpts.slidesMinDuration),
    cwd: process.cwd(),
  });

  if (slidesSettings && inputKind !== "url") {
    throw new Error("--slides is only supported for URL inputs");
  }

  return slidesSettings;
}
