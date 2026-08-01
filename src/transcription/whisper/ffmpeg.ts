import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnTracked } from "../../processes.js";
import { prepareResourceLimitedCommand } from "../../subprocess-limits.js";

const FFMPEG_PROBE_TIMEOUT_MS = 10_000;
const FFMPEG_OPERATION_TIMEOUT_MS = 10 * 60_000;
const FFMPEG_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export async function isFfmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const launch = prepareResourceLimitedCommand({
      command: "ffmpeg",
      args: ["-version"],
      timeoutMs: FFMPEG_PROBE_TIMEOUT_MS,
      memoryLimitMb: 1024,
    });
    const { proc } = spawnTracked(launch.command, launch.args, {
      stdio: ["ignore", "ignore", "ignore"],
      label: "ffmpeg",
      kind: "ffmpeg",
      captureOutput: false,
    });
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve(false);
    }, FFMPEG_PROBE_TIMEOUT_MS);
    proc.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });
}

export async function probeMediaDurationSecondsWithFfprobe(
  filePath: string,
): Promise<number | null> {
  // ffprobe is part of the ffmpeg suite. We keep this optional (best-effort) so environments
  // without ffmpeg still work; it only powers nicer progress output.
  return new Promise((resolve) => {
    const args = [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ];
    const launch = prepareResourceLimitedCommand({
      command: "ffprobe",
      args,
      timeoutMs: FFMPEG_PROBE_TIMEOUT_MS,
      memoryLimitMb: 1024,
    });
    const { proc } = spawnTracked(launch.command, launch.args, {
      stdio: ["ignore", "pipe", "ignore"],
      label: "ffprobe",
      kind: "ffprobe",
    });
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve(null);
    }, FFMPEG_PROBE_TIMEOUT_MS);
    let stdout = "";
    let outputBytes = 0;
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > FFMPEG_MAX_OUTPUT_BYTES) {
        proc.kill("SIGKILL");
        resolve(null);
        return;
      }
      if (stdout.length > 2048) return;
      stdout += chunk;
    });
    proc.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve(null);
        return;
      }
      const trimmed = stdout.trim();
      const parsed = Number(trimmed);
      resolve(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
    });
  });
}

export async function runFfmpegSegment({
  inputPath,
  outputPattern,
  segmentSeconds,
}: {
  inputPath: string;
  outputPattern: string;
  segmentSeconds: number;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "32k",
      "-f",
      "segment",
      "-segment_time",
      String(segmentSeconds),
      "-reset_timestamps",
      "1",
      outputPattern,
    ];
    const launch = prepareResourceLimitedCommand({
      command: "ffmpeg",
      args,
      timeoutMs: FFMPEG_OPERATION_TIMEOUT_MS,
    });
    const { proc } = spawnTracked(launch.command, launch.args, {
      stdio: ["ignore", "ignore", "pipe"],
      label: "ffmpeg",
      kind: "ffmpeg",
    });
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("ffmpeg segment operation timed out"));
    }, FFMPEG_OPERATION_TIMEOUT_MS);
    let stderr = "";
    let outputBytes = 0;
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > FFMPEG_MAX_OUTPUT_BYTES) {
        proc.kill("SIGKILL");
        reject(new Error("ffmpeg segment operation exceeded output limit"));
        return;
      }
      if (stderr.length > 8192) return;
      stderr += chunk;
    });
    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      reject(new Error(`ffmpeg failed (${code ?? "unknown"}): ${detail || "unknown error"}`));
    });
  });
}

export async function runFfmpegTranscodeToMp3({
  inputPath,
  outputPath,
}: {
  inputPath: string;
  outputPath: string;
}): Promise<void> {
  await runFfmpegTranscode({
    inputPath,
    outputPath,
    mode: "strict",
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      outputPath,
    ],
  });
}

export async function runFfmpegTranscodeToWav({
  inputPath,
  outputPath,
}: {
  inputPath: string;
  outputPath: string;
}): Promise<void> {
  await runFfmpegTranscode({
    inputPath,
    outputPath,
    mode: "strict",
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-sample_fmt",
      "s16",
      outputPath,
    ],
  });
}

export async function runFfmpegTranscodeToMp3Lenient({
  inputPath,
  outputPath,
}: {
  inputPath: string;
  outputPath: string;
}): Promise<void> {
  await runFfmpegTranscode({
    inputPath,
    outputPath,
    mode: "lenient",
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-err_detect",
      "ignore_err",
      "-fflags",
      "+genpts",
      "-i",
      inputPath,
      "-vn",
      "-sn",
      "-dn",
      "-map",
      "0:a:0?",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      outputPath,
    ],
  });
}

export async function transcodeBytesToMp3(bytes: Uint8Array): Promise<Uint8Array> {
  const inputPath = join(tmpdir(), `summarize-whisper-input-${randomUUID()}.bin`);
  const outputPath = join(tmpdir(), `summarize-whisper-output-${randomUUID()}.mp3`);
  try {
    await fs.writeFile(inputPath, bytes);
    try {
      await runFfmpegTranscodeToMp3({ inputPath, outputPath });
    } catch (_error) {
      await runFfmpegTranscodeToMp3Lenient({ inputPath, outputPath });
    }
    return new Uint8Array(await fs.readFile(outputPath));
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

async function runFfmpegTranscode({
  inputPath,
  outputPath,
  mode,
  args,
}: {
  inputPath: string;
  outputPath: string;
  mode: "strict" | "lenient";
  args: string[];
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const launch = prepareResourceLimitedCommand({
      command: "ffmpeg",
      args,
      timeoutMs: FFMPEG_OPERATION_TIMEOUT_MS,
    });
    const { proc } = spawnTracked(launch.command, launch.args, {
      stdio: ["ignore", "ignore", "pipe"],
      label: "ffmpeg",
      kind: "ffmpeg",
    });
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`ffmpeg ${mode} transcode timed out`));
    }, FFMPEG_OPERATION_TIMEOUT_MS);
    let stderr = "";
    let outputBytes = 0;
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > FFMPEG_MAX_OUTPUT_BYTES) {
        proc.kill("SIGKILL");
        reject(new Error(`ffmpeg ${mode} transcode exceeded output limit`));
        return;
      }
      if (stderr.length > 8192) return;
      stderr += chunk;
    });
    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      reject(
        new Error(
          `ffmpeg ${mode} transcode failed (${code ?? "unknown"}) for ${inputPath} -> ${outputPath}: ${
            detail || "unknown error"
          }`,
        ),
      );
    });
  });
}

export async function transcodeBytesToWav(bytes: Uint8Array): Promise<Uint8Array> {
  const inputPath = join(tmpdir(), `summarize-whisper-input-${randomUUID()}.bin`);
  const outputPath = join(tmpdir(), `summarize-whisper-output-${randomUUID()}.wav`);
  try {
    await fs.writeFile(inputPath, bytes);
    await runFfmpegTranscodeToWav({ inputPath, outputPath });
    return new Uint8Array(await fs.readFile(outputPath));
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
