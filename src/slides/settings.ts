import path from "node:path";

export type SlideOcrMode = "accurate" | "fast";

export type SlideSettings = {
  enabled: boolean;
  ocr: boolean;
  ocrMode: SlideOcrMode;
  ocrLanguageCorrection: boolean;
  outputDir: string;
  sceneThreshold: number;
  autoTuneThreshold: boolean;
  maxSlides: number;
  minDurationSeconds: number;
};

export type SlideSettingsInput = {
  slides?: unknown;
  slidesOcr?: unknown;
  slidesOcrMode?: unknown;
  slidesOcrLanguageCorrection?: unknown;
  slidesDir?: unknown;
  slidesSceneThreshold?: unknown;
  slidesSceneThresholdExplicit?: boolean;
  slidesMax?: unknown;
  slidesMinDuration?: unknown;
  cwd: string;
};

const DEFAULT_OUTPUT_DIR = "slides";
const DEFAULT_SCENE_THRESHOLD = 0.3;
const DEFAULT_MAX_SLIDES = 6;
const DEFAULT_MIN_DURATION_SECONDS = 2;
const DEFAULT_OCR_MODE: SlideOcrMode = "fast";
const DEFAULT_OCR_LANGUAGE_CORRECTION = false;

const parseBoolean = (raw: unknown): boolean | null => {
  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
};

const parseOcrMode = (raw: unknown): SlideOcrMode | null => {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "fast" || normalized === "accurate") return normalized as SlideOcrMode;
  throw new Error(`Unsupported --slides-ocr-mode: ${String(raw)}`);
};

const parsePositiveInt = (raw: unknown, label: string, min = 1): number | null => {
  if (raw == null) return null;
  const value = typeof raw === "string" ? raw.trim() : raw;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    throw new Error(`Unsupported ${label}: ${String(raw)}`);
  }
  if (numeric < min) {
    throw new Error(`Unsupported ${label}: ${String(raw)} (minimum ${min})`);
  }
  return numeric;
};

const parseNumberInRange = (
  raw: unknown,
  label: string,
  { min, max }: { min: number; max: number },
): number | null => {
  if (raw == null) return null;
  const value = typeof raw === "string" ? raw.trim() : raw;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Unsupported ${label}: ${String(raw)}`);
  }
  if (numeric < min || numeric > max) {
    throw new Error(`Unsupported ${label}: ${String(raw)} (range ${min}-${max})`);
  }
  return numeric;
};

export function resolveSlideSettings(input: SlideSettingsInput): SlideSettings | null {
  const slidesFlag = parseBoolean(input.slides);
  const ocrFlag = parseBoolean(input.slidesOcr);
  const enabled = Boolean((slidesFlag ?? false) || (ocrFlag ?? false));
  if (!enabled) return null;

  const dirRaw = typeof input.slidesDir === "string" ? input.slidesDir.trim() : DEFAULT_OUTPUT_DIR;
  const outputDir = path.resolve(input.cwd, dirRaw || DEFAULT_OUTPUT_DIR);

  const sceneThreshold =
    parseNumberInRange(input.slidesSceneThreshold, "--slides-scene-threshold", {
      min: 0.1,
      max: 1,
    }) ?? DEFAULT_SCENE_THRESHOLD;
  const maxSlides = parsePositiveInt(input.slidesMax, "--slides-max") ?? DEFAULT_MAX_SLIDES;
  const minDurationSeconds =
    parseNumberInRange(input.slidesMinDuration, "--slides-min-duration", {
      min: 0,
      max: 86_400,
    }) ?? DEFAULT_MIN_DURATION_SECONDS;
  const ocrMode = parseOcrMode(input.slidesOcrMode) ?? DEFAULT_OCR_MODE;
  const ocrLanguageCorrection =
    parseBoolean(input.slidesOcrLanguageCorrection) ?? DEFAULT_OCR_LANGUAGE_CORRECTION;
  return {
    enabled,
    ocr: Boolean(ocrFlag ?? false),
    ocrMode,
    ocrLanguageCorrection,
    outputDir,
    sceneThreshold,
    autoTuneThreshold: true,
    maxSlides,
    minDurationSeconds,
  };
}
