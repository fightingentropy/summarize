import type { EnvSnapshot } from "./env-snapshot.js";

export function mergeDaemonEnv({
  envForRun,
  snapshot,
}: {
  envForRun: Record<string, string | undefined>;
  snapshot: EnvSnapshot;
}): Record<string, string | undefined> {
  return { ...envForRun, ...snapshot };
}
