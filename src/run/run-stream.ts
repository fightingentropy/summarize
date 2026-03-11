import type { StreamMode } from "../flags.js";
import { isRichTty } from "./terminal.js";

export type StreamSettings = {
  effectiveStreamMode: "on" | "off";
  streamingEnabled: boolean;
};

export function resolveStreamSettings({
  streamMode,
  stdout,
  json,
  extractMode,
}: {
  streamMode: StreamMode;
  stdout: NodeJS.WritableStream;
  json: boolean;
  extractMode: boolean;
}): StreamSettings {
  const effectiveStreamMode = (() => {
    if (streamMode !== "auto") return streamMode;
    return isRichTty(stdout) ? "on" : "off";
  })();
  const streamingEnabled = effectiveStreamMode === "on" && !json && !extractMode;

  return { effectiveStreamMode, streamingEnabled };
}
