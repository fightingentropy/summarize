import { shouldPreferUrlMode } from "summarize-core/content/url";

export type DaemonRequestedMode = "auto" | "page" | "url";

export function resolveAutoDaemonMode({ url, hasText }: { url: string; hasText: boolean }): {
  primary: "page" | "url";
  fallback: "page" | "url" | null;
} {
  const preferUrl = shouldPreferUrlMode(url);
  const primary: "page" | "url" = preferUrl || !hasText ? "url" : "page";
  const fallback: "page" | "url" | null = primary === "url" ? (hasText ? "page" : null) : "url";
  return { primary, fallback };
}
