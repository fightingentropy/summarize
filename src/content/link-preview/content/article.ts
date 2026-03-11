import { type CheerioAPI, load } from "cheerio";
import sanitizeHtml from "sanitize-html";
import { decodeHtmlEntities, normalizeWhitespace } from "./cleaner.js";
import { stripHiddenHtml } from "./visibility.js";

const MIN_SEGMENT_LENGTH = 30;
const PRIMARY_ARTICLE_MIN_TEXT_LENGTH = 60;
const PRIMARY_ARTICLE_STRIP_SELECTOR = "nav,aside,footer,form,menu";

type HtmlPreprocessingOptions = {
  inputIsVisibleHtml?: boolean;
};

export function sanitizeHtmlForMarkdownConversion(
  html: string,
  options: HtmlPreprocessingOptions = {},
): string {
  return sanitizeHtml(resolveVisibleHtml(html, options), {
    allowedTags: [
      "article",
      "section",
      "div",
      "p",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ol",
      "ul",
      "li",
      "blockquote",
      "pre",
      "code",
      "span",
      "strong",
      "em",
      "br",
      "a",
    ],
    allowedAttributes: {
      a: ["href"],
    },
    nonTextTags: [
      "style",
      "script",
      "noscript",
      "template",
      "svg",
      "canvas",
      "iframe",
      "object",
      "embed",
    ],
    textFilter(text: string) {
      return decodeHtmlEntities(text);
    },
  });
}

export function extractArticleContent(
  html: string,
  options: HtmlPreprocessingOptions = {},
): string {
  const segments = collectSegmentsFromHtml(html, options);
  if (segments.length > 0) {
    return segments.join("\n");
  }
  const fallback = normalizeWhitespace(extractPlainText(html, options));
  return fallback ?? "";
}

export function extractPrimaryArticleHtml(
  html: string | CheerioAPI,
  options: HtmlPreprocessingOptions = {},
): string | null {
  const $ = typeof html === "string" ? load(resolveVisibleHtml(html, options)) : html;
  const articles = $("article").toArray();
  if (articles.length !== 1) {
    return null;
  }

  const article = $(articles[0]).clone();
  article.find(PRIMARY_ARTICLE_STRIP_SELECTOR).remove();
  const text = normalizeWhitespace(article.text());
  if (!text || text.length < PRIMARY_ARTICLE_MIN_TEXT_LENGTH) {
    return null;
  }

  return $.html(article) || null;
}

export function collectSegmentsFromHtml(
  html: string,
  options: HtmlPreprocessingOptions = {},
): string[] {
  const visibleHtml = resolveVisibleHtml(html, options);
  const $ = load(visibleHtml);
  const segments: string[] = [];

  $("h1,h2,h3,h4,h5,h6,li,p,blockquote,pre").each((_, element) => {
    if (!("tagName" in element) || typeof element.tagName !== "string") {
      return;
    }

    const tag = element.tagName.toLowerCase();

    const raw = $(element).text();
    const text = normalizeWhitespace(raw).replaceAll(/\n+/g, " ");
    if (!text || text.length === 0) {
      return;
    }

    if (tag.startsWith("h")) {
      if (text.length >= 10) {
        segments.push(text);
      }
      return;
    }

    if (tag === "li") {
      if (text.length >= 20) {
        segments.push(`• ${text}`);
      }
      return;
    }

    if (text.length < MIN_SEGMENT_LENGTH) {
      return;
    }

    segments.push(text);
  });

  if (segments.length === 0) {
    const fallback = normalizeWhitespace(extractDocumentText($));
    return fallback ? [fallback] : [];
  }

  return mergeConsecutiveSegments(segments);
}

export function extractPlainText(html: string, options: HtmlPreprocessingOptions = {}): string {
  const $ = load(resolveVisibleHtml(html, options));
  return decodeHtmlEntities(extractDocumentText($));
}

function mergeConsecutiveSegments(segments: string[]): string[] {
  // Keep headings as separate segments; merging short segments mostly collapses headings into the
  // previous paragraph ("... Conclusion"), which reads worse than a standalone heading line.
  return segments.filter(Boolean);
}

function resolveVisibleHtml(html: string, options: HtmlPreprocessingOptions): string {
  return options.inputIsVisibleHtml ? html : stripHiddenHtml(html);
}

function extractDocumentText($: ReturnType<typeof load>): string {
  return $("body").text() || $.root().text() || "";
}
