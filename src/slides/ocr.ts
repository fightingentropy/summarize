import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { spawnTracked } from "../processes.js";
import { resolveExecutableInPath } from "../run/env.js";
import { prepareResourceLimitedCommand } from "../subprocess-limits.js";
import { runWithConcurrency } from "./process.js";
import type { SlideImage } from "./types.js";

const OCR_TIMEOUT_MS = 120_000;
const SWIFTC_TIMEOUT_MS = 120_000;
const OCR_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const VISION_HELPER_ENV = "SUMMARIZE_VISION_OCR_HELPER";
const SWIFTC_ENV = "SUMMARIZE_SWIFTC_PATH";
const BUNDLED_HELPER_PREFIX = "vision-ocr-helper";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type SlidesOcrAvailability = {
  available: boolean;
  engine: "vision" | null;
  path: string | null;
};

export type VisionOcrRuntimeOptions = {
  recognitionLevel: "accurate" | "fast";
  useLanguageCorrection: boolean;
};

const compileLocks = new Map<string, Promise<string | null>>();

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveVisionHelperOverride(env: Record<string, string | undefined>): string | null {
  const explicit = typeof env[VISION_HELPER_ENV] === "string" ? env[VISION_HELPER_ENV].trim() : "";
  if (!explicit) return null;
  return resolveExecutableInPath(explicit, env);
}

function resolveSwiftcPath(env: Record<string, string | undefined>): string | null {
  const explicit = typeof env[SWIFTC_ENV] === "string" ? env[SWIFTC_ENV].trim() : "";
  if (explicit) return resolveExecutableInPath(explicit, env);
  return resolveExecutableInPath("swiftc", env);
}

function resolveVisionHelperSourcePath(): string {
  return path.join(__dirname, "vision-ocr-helper.swift");
}

function resolveBundledVisionHelperPath(): string {
  return path.join(__dirname, `${BUNDLED_HELPER_PREFIX}-${process.arch}`);
}

function resolveBundledVisionHelper(): string | null {
  const bundledPath = resolveBundledVisionHelperPath();
  return isExecutable(bundledPath) ? bundledPath : null;
}

function resolveVisionHelperCachePath(env: Record<string, string | undefined>): string {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  const baseDir = home
    ? path.join(home, ".summarize", "bin")
    : path.join(tmpdir(), "summarize-bin");
  return path.join(baseDir, `vision-ocr-helper-${process.arch}`);
}

export function getSlidesOcrAvailability(
  env: Record<string, string | undefined>,
): SlidesOcrAvailability {
  if (process.platform !== "darwin") {
    return { available: false, engine: null, path: null };
  }
  const helperOverride = resolveVisionHelperOverride(env);
  if (helperOverride) {
    return { available: true, engine: "vision", path: helperOverride };
  }
  const bundledHelper = resolveBundledVisionHelper();
  if (bundledHelper) {
    return { available: true, engine: "vision", path: bundledHelper };
  }
  const cachePath = resolveVisionHelperCachePath(env);
  if (isExecutable(cachePath)) {
    return { available: true, engine: "vision", path: cachePath };
  }
  const sourcePath = resolveVisionHelperSourcePath();
  if (!existsSync(sourcePath)) {
    return { available: false, engine: null, path: null };
  }
  const swiftcPath = resolveSwiftcPath(env);
  if (!swiftcPath) {
    return { available: false, engine: null, path: null };
  }
  return { available: true, engine: "vision", path: sourcePath };
}

export async function resolveSlidesOcrPath(
  env: Record<string, string | undefined>,
): Promise<string | null> {
  if (process.platform !== "darwin") return null;

  const helperOverride = resolveVisionHelperOverride(env);
  if (helperOverride) return helperOverride;

  const bundledHelper = resolveBundledVisionHelper();
  if (bundledHelper) return bundledHelper;

  const outputPath = resolveVisionHelperCachePath(env);
  if (isExecutable(outputPath)) return outputPath;

  const sourcePath = resolveVisionHelperSourcePath();
  if (!existsSync(sourcePath)) return null;

  const swiftcPath = resolveSwiftcPath(env);
  if (!swiftcPath) {
    throw new Error(
      "Missing swiftc for slide OCR (install Xcode Command Line Tools or set SUMMARIZE_SWIFTC_PATH).",
    );
  }
  const existingLock = compileLocks.get(outputPath);
  if (existingLock) return await existingLock;

  const compilePromise = (async () => {
    const sourceStat = await stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) return null;

    const outputStat = await stat(outputPath).catch(() => null);
    if (
      outputStat?.isFile() &&
      outputStat.mtimeMs >= sourceStat.mtimeMs &&
      isExecutable(outputPath)
    ) {
      return outputPath;
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    try {
      const launch = prepareResourceLimitedCommand({
        command: swiftcPath,
        args: [sourcePath, "-O", "-o", outputPath],
        timeoutMs: SWIFTC_TIMEOUT_MS,
        memoryLimitMb: 4096,
      });
      await execFileAsync(launch.command, launch.args, {
        timeout: SWIFTC_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to build Vision OCR helper: ${message}`);
    }

    if (!isExecutable(outputPath)) {
      throw new Error("Failed to build Vision OCR helper: output binary was not created.");
    }
    return outputPath;
  })();

  compileLocks.set(outputPath, compilePromise);
  try {
    return await compilePromise;
  } finally {
    compileLocks.delete(outputPath);
  }
}

export function cleanOcrText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 2)
    .filter((line) => !(line.length > 20 && !line.includes(" ")))
    .filter((line) => /[a-z0-9]/i.test(line));
  return lines.join("\n");
}

export function estimateOcrConfidence(text: string): number {
  if (!text) return 0;
  const total = text.length;
  if (total === 0) return 0;
  const alnum = Array.from(text).filter((char) => /[a-z0-9]/i.test(char)).length;
  return Math.min(1, alnum / total);
}

export function resolveVisionOcrRuntimeOptions({
  platform = process.platform,
  arch = process.arch,
  recognitionLevel,
  useLanguageCorrection,
}: {
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  recognitionLevel?: VisionOcrRuntimeOptions["recognitionLevel"] | null;
  useLanguageCorrection?: boolean | null;
} = {}): VisionOcrRuntimeOptions {
  const defaults: VisionOcrRuntimeOptions =
    platform === "darwin" && arch === "arm64"
      ? { recognitionLevel: "fast", useLanguageCorrection: false }
      : { recognitionLevel: "accurate", useLanguageCorrection: true };
  return {
    recognitionLevel:
      recognitionLevel === "fast" || recognitionLevel === "accurate"
        ? recognitionLevel
        : defaults.recognitionLevel,
    useLanguageCorrection:
      typeof useLanguageCorrection === "boolean"
        ? useLanguageCorrection
        : defaults.useLanguageCorrection,
  };
}

export function buildVisionOcrArgs(
  imagePath: string,
  options: VisionOcrRuntimeOptions = resolveVisionOcrRuntimeOptions(),
): string[] {
  const args = ["--image-path", imagePath];
  if (options.recognitionLevel === "fast") {
    args.push("--recognition-level", "fast");
  }
  if (!options.useLanguageCorrection) {
    args.push("--disable-language-correction");
  }
  return args;
}

export async function runVisionOcr(
  helperPath: string,
  imagePath: string,
  options?: VisionOcrRuntimeOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const launch = prepareResourceLimitedCommand({
      command: helperPath,
      args: buildVisionOcrArgs(imagePath, options),
      timeoutMs: OCR_TIMEOUT_MS,
      memoryLimitMb: 2048,
    });
    const { proc, handle } = spawnTracked(launch.command, launch.args, {
      stdio: ["ignore", "pipe", "pipe"],
      label: "vision-ocr",
      kind: "vision-ocr",
      captureOutput: false,
    });
    let stdout = "";
    let stderr = "";
    let stderrBuffer = "";
    let outputBytes = 0;

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Vision OCR timed out"));
    }, OCR_TIMEOUT_MS);

    if (proc.stdout) {
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > OCR_MAX_OUTPUT_BYTES) {
          proc.kill("SIGKILL");
          reject(new Error("Vision OCR exceeded output limit"));
          return;
        }
        stdout += chunk;
      });
    }

    if (proc.stderr) {
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk: string) => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > OCR_MAX_OUTPUT_BYTES) {
          proc.kill("SIGKILL");
          reject(new Error("Vision OCR exceeded output limit"));
          return;
        }
        if (stderr.length < 8192) stderr += chunk;
        stderrBuffer += chunk;
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line) handle?.appendOutput("stderr", line);
        }
      });
    }

    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (stderrBuffer.trim()) handle?.appendOutput("stderr", stderrBuffer.trim());
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
      reject(new Error(`Vision OCR exited with code ${code}${suffix}`));
    });
  });
}

export async function runOcrOnSlides(
  slides: SlideImage[],
  ocrPath: string,
  workers: number,
  onProgress?: ((completed: number, total: number) => void) | null,
  options?: VisionOcrRuntimeOptions,
): Promise<SlideImage[]> {
  const tasks = slides.map((slide) => async () => {
    try {
      const cleaned = cleanOcrText(await runVisionOcr(ocrPath, slide.imagePath, options));
      return {
        ...slide,
        ocrText: cleaned,
        ocrConfidence: estimateOcrConfidence(cleaned),
      };
    } catch {
      return { ...slide, ocrText: "", ocrConfidence: 0 };
    }
  });
  const results = await runWithConcurrency(tasks, Math.min(4, workers), onProgress ?? undefined);
  return results.sort((a, b) => a.index - b.index);
}
