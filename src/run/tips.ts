import { UVX_TIP } from "./constants.js";
import { hasUvxCli } from "./env.js";

export function withUvxTip(error: unknown, env: Record<string, string | undefined>): Error {
  if (hasUvxCli(env)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const message = error instanceof Error ? error.message : String(error);
  const combined = `${message}\n${UVX_TIP}`;
  return error instanceof Error ? new Error(combined, { cause: error }) : new Error(combined);
}
