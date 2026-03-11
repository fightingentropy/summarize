const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const NON_JSONLD_SCRIPT_PATTERN =
  /<script\b(?![^>]*type\s*=\s*["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script\s*>/gi;
const INERT_STRUCTURED_BLOCK_PATTERN =
  /<(style|noscript|template|svg|canvas|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

export function prepareHtmlForStructuredParsing(html: string): string {
  return html
    .replace(HTML_COMMENT_PATTERN, "")
    .replace(NON_JSONLD_SCRIPT_PATTERN, "")
    .replace(INERT_STRUCTURED_BLOCK_PATTERN, "");
}
