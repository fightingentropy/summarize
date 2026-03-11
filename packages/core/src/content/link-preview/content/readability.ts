import type { LinkPreviewProfileSink } from "../profiling.js";
import { measureAsyncProfile, measureSyncProfile } from "../profiling.js";
import { stripHiddenHtml } from "./visibility.js";

export type ReadabilityResult = {
  text: string;
  html: string | null;
  title: string | null;
  excerpt: string | null;
};

export async function extractReadabilityFromHtml(
  html: string,
  url?: string,
  options: {
    onProfile?: LinkPreviewProfileSink | null;
    phasePrefix?: string;
    visibleHtml?: string | null;
  } = {},
): Promise<ReadabilityResult | null> {
  const onProfile = typeof options.onProfile === "function" ? options.onProfile : null;
  const phasePrefix = options.phasePrefix?.trim() || "readability";
  const visibleHtml = options.visibleHtml ?? null;

  try {
    return await measureAsyncProfile(
      {
        sink: onProfile,
        name: `${phasePrefix}.total`,
        url,
        details: { htmlChars: html.length },
        onSuccessDetails: (result) => ({
          hasArticle: Boolean(result),
          textChars: result?.text.length ?? 0,
        }),
      },
      async () => {
        const cleanedHtml = measureSyncProfile(
          {
            sink: onProfile,
            name: `${phasePrefix}.prepare`,
            url,
            details: {
              htmlChars: html.length,
              usedVisibleHtml: visibleHtml !== null,
              visibleHtmlChars: visibleHtml?.length ?? null,
            },
            onSuccessDetails: (value) => ({ cleanedHtmlChars: value.length }),
          },
          () => stripCssFromHtml(visibleHtml ?? stripHiddenHtml(html)),
        );

        const { JSDOM, Readability, VirtualConsole } = await measureAsyncProfile(
          {
            sink: onProfile,
            name: `${phasePrefix}.load`,
            url,
          },
          async () => {
            const [{ Readability }, { JSDOM, VirtualConsole }] = await Promise.all([
              import("@mozilla/readability"),
              import("jsdom"),
            ]);
            return { JSDOM, Readability, VirtualConsole };
          },
        );

        const article = measureSyncProfile(
          {
            sink: onProfile,
            name: `${phasePrefix}.parse`,
            url,
            details: { cleanedHtmlChars: cleanedHtml.length },
            onSuccessDetails: (value) => ({
              hasArticle: Boolean(value),
              textChars: value?.textContent?.length ?? 0,
            }),
          },
          () => {
            const virtualConsole = new VirtualConsole();
            virtualConsole.on("jsdomError", (err) => {
              const message =
                err && typeof err === "object" && "message" in err
                  ? String((err as { message?: unknown }).message ?? "")
                  : "";
              if (message.includes("Could not parse CSS stylesheet")) return;
              console.error(err);
            });

            const dom = new JSDOM(cleanedHtml, { ...(url ? { url } : undefined), virtualConsole });
            const reader = new Readability(dom.window.document);
            return reader.parse();
          },
        );
        if (!article) return null;

        const text = (article.textContent ?? "").replace(/\s+/g, " ").trim();
        return {
          text,
          html: article.content ?? null,
          title: article.title ?? null,
          excerpt: article.excerpt ?? null,
        };
      },
    );
  } catch {
    return null;
  }
}

export function toReadabilityHtml(result: ReadabilityResult | null): string | null {
  if (!result) return null;
  if (result.html) return result.html;
  if (!result.text) return null;
  return `<article><p>${escapeHtml(result.text)}</p></article>`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripCssFromHtml(html: string): string {
  // Readability doesn't need CSS; jsdom's CSS parsing can be extremely slow on some pages.
  return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}
