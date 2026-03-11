# firecrawl

---

summary: "External website scraper chain and provider requirements."
read_when:

- "When changing website scraper fallback behavior."

---

# External website scrapers

When HTML extraction is blocked, too thin, or `--website-scrape always` is set, `summarize` can use
an external website scraper chain.

Configured provider order:

1. Exa (`EXA_API_KEY`)
2. Cloudflare Browser Rendering Markdown (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`)
3. Firecrawl (`FIRECRAWL_API_KEY`)

The first provider that returns non-empty Markdown wins.

## `--website-scrape off|auto|always`

- `off`: never use external website scrapers.
- `auto` (default): use external website scrapers only when HTML extraction looks blocked/thin.
- `always`: try external website scrapers first (falls back to HTML if the scraper chain is unavailable/empty).

## Extract default

When `--extract --format md` is used for non-YouTube URLs and an external website scraper is configured, the CLI defaults to `--website-scrape always` to return Markdown.

## API key

- `EXA_API_KEY` for Exa contents API
- `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` for Cloudflare Browser Rendering Markdown
- `FIRECRAWL_API_KEY` for Firecrawl

`--website-scrape always` requires at least one of the providers above.
