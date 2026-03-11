import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpegSegment } from "./ffmpeg.js";
import type {
  TranscriptionProvider,
  WhisperProgressEvent,
  WhisperTranscriptionResult,
} from "./types.js";

export async function transcribeChunkedFile({
  filePath,
  segmentSeconds,
  totalDurationSeconds,
  onProgress,
  transcribeSegment,
}: {
  filePath: string;
  segmentSeconds: number;
  totalDurationSeconds: number | null;
  onProgress?: ((event: WhisperProgressEvent) => void) | null;
  transcribeSegment: (args: {
    bytes: Uint8Array;
    filename: string;
  }) => Promise<WhisperTranscriptionResult>;
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

    const parts: string[] = [];
    let usedProvider: TranscriptionProvider | null = null;
    for (const [index, name] of files.entries()) {
      const segmentBytes = new Uint8Array(await fs.readFile(join(dir, name)));
      const result = await transcribeSegment({
        bytes: segmentBytes,
        filename: name,
      });
      if (!usedProvider && result.provider) usedProvider = result.provider;
      if (result.error && !result.text) {
        return { text: null, provider: usedProvider, error: result.error, notes };
      }
      if (result.text) parts.push(result.text);

      const processedSeconds = Math.max(0, (index + 1) * segmentSeconds);
      onProgress?.({
        partIndex: index + 1,
        parts: files.length,
        processedDurationSeconds:
          typeof totalDurationSeconds === "number" && totalDurationSeconds > 0
            ? Math.min(processedSeconds, totalDurationSeconds)
            : null,
        totalDurationSeconds,
      });
    }

    return { text: parts.join("\n\n"), provider: usedProvider, error: null, notes };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
