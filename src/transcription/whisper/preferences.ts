import { resolvePreferredOnnxModel } from "../onnx-cli.js";

type Env = Record<string, string | undefined>;

export function resolveTranscriberPreference(env: Env): "auto" | "whisper" | "parakeet" | "canary" {
  const raw = env.SUMMARIZE_TRANSCRIBER?.trim().toLowerCase();
  if (raw === "auto" || raw === "whisper" || raw === "parakeet" || raw === "canary") return raw;
  return "auto";
}

export function resolveOnnxModelPreference(env: Env): "parakeet" | "canary" | null {
  const preference = resolveTranscriberPreference(env);
  if (preference === "parakeet" || preference === "canary") return preference;
  if (preference === "auto") return resolvePreferredOnnxModel(env);
  return null;
}
