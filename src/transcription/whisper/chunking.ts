import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpegSegment } from "./ffmpeg.js";
import type {
  TranscriptionProvider,
  WhisperProgressEvent,
  WhisperTranscriptionResult,
} from "./types.js";

const DEFAULT_CHUNK_CONCURRENCY = 4;

export async function transcribeChunkedFile({
  filePath,
  segmentSeconds,
  totalDurationSeconds,
  onProgress,
  transcribeSegment,
  concurrency,
}: {
  filePath: string;
  segmentSeconds: number;
  totalDurationSeconds: number | null;
  onProgress?: ((event: WhisperProgressEvent) => void) | null;
  transcribeSegment: (args: {
    bytes: Uint8Array;
    filename: string;
  }) => Promise<WhisperTranscriptionResult>;
  concurrency?: number;
}): Promise<WhisperTranscriptionResult> {
  const notes: string[] = [];
  const dir = await fs.mkdtemp(join(tmpdir(), "summarize-whisper-segments-"));
  try {
    const pattern = join(dir, "part-%03d.mp3");
    await runFfmpegSegment({
      inputPath: filePath,
      outputPattern: pattern,
      segmentSeconds,
    });
    const files = (await fs.readdir(dir))
      .filter((name) => name.startsWith("part-") && name.endsWith(".mp3"))
      .sort((a, b) => a.localeCompare(b));
    if (files.length === 0) {
      return {
        text: null,
        provider: null,
        error: new Error("ffmpeg produced no audio segments"),
        notes,
      };
    }

    notes.push(`ffmpeg chunked media into ${files.length} parts (${segmentSeconds}s each)`);
    onProgress?.({
      partIndex: null,
      parts: files.length,
      processedDurationSeconds: null,
      totalDurationSeconds,
    });

    const parts: Array<string | null> = new Array(files.length).fill(null);
    let usedProvider: TranscriptionProvider | null = null;
    let firstError: Error | null = null;
    let completed = 0;
    let nextIndex = 0;

    const workerCount = Math.max(
      1,
      Math.min(files.length, concurrency ?? DEFAULT_CHUNK_CONCURRENCY),
    );

    const runWorker = async () => {
      while (true) {
        if (firstError) return;
        const index = nextIndex++;
        if (index >= files.length) return;
        const name = files[index]!;
        let result: WhisperTranscriptionResult;
        try {
          const segmentBytes = new Uint8Array(await fs.readFile(join(dir, name)));
          result = await transcribeSegment({ bytes: segmentBytes, filename: name });
        } catch (error) {
          if (!firstError) {
            firstError = error instanceof Error ? error : new Error(String(error));
          }
          return;
        }
        if (!usedProvider && result.provider) usedProvider = result.provider;
        if (result.error && !result.text) {
          if (!firstError) firstError = result.error;
          return;
        }
        if (result.text) parts[index] = result.text;

        completed += 1;
        const processedSeconds = Math.max(0, completed * segmentSeconds);
        onProgress?.({
          partIndex: completed,
          parts: files.length,
          processedDurationSeconds:
            typeof totalDurationSeconds === "number" && totalDurationSeconds > 0
              ? Math.min(processedSeconds, totalDurationSeconds)
              : null,
          totalDurationSeconds,
        });
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    if (firstError) {
      return { text: null, provider: usedProvider, error: firstError, notes };
    }

    const text = parts.filter((part): part is string => part !== null).join("\n\n");
    return { text, provider: usedProvider, error: null, notes };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
