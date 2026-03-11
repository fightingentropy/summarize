# slides

---

summary: "Plan for CLI slide output without model usage."
read_when:

- "When changing CLI slide summaries, slide rendering, or slide/seek behavior."

---

# Slides plan (no model)

## Goals

- Render slides inline near the top of the output.
- Slide timestamps should seek the target video when possible.
- Descriptions scale with length setting.
- Always show all slides (even if text missing).
- No model call for slide descriptions.

## Data sources

- Primary: transcript timed text (already available with timestamps).
- Secondary: OCR text from slides (truncate, selectable).
- Tertiary: empty description (still render card).

## Description generation (no model)

- For each slide timestamp `t`:
  - Pull transcript segments within a time window around `t`.
  - Concatenate into plain text (no bullets).
  - If no transcript: use OCR text (trim).
  - If neither: empty string.
- Always render all slide cards; missing text → show slide only.

## Length scaling

- Map summary length to per-slide target chars.
- Use existing length presets (short/medium/long/xl/xxl + custom):
  - `short`: ~120 chars/slide
  - `medium`: ~200 chars/slide
  - `long`: ~320 chars/slide
  - `xl`: ~480 chars/slide
  - `xxl`: ~700 chars/slide
  - custom: derive from maxCharacters (e.g. `maxChars / min(slideCount, 10)`, clamp).
- Clamp per-slide text: `[80, 900]` chars.
- Window size should expand with length (e.g. 20s → 90s).

## Output behavior

- CLI slide mode is slide-first:
  - inline slide image
  - timestamp
  - transcript/OCR text
- No separate giant summary block under the slide timeline.
- Timestamp links should seek when the target player supports it.
- OCR text should only appear when it adds value over transcript context.

## CLI

- `summarize <url> --slides` streams a short intro paragraph and then a continuous narrative with slide images inserted inline where `[slide:N]` markers appear.
  - The model is responsible for inserting every slide marker in order; text length is still governed by `--length`.
  - If inline images are unsupported, the CLI prints text-only output and notes how to export slides to disk.
  - Timestamp links use OSC-8 when supported (YouTube/Vimeo/Loom/Dropbox).
  - Progress line reports slide extraction steps (includes slide counts when available).
- `summarize <url> --slides --extract` prints the full timed transcript and inserts slide images inline at matching timestamps.
- `summarize slides <url>` extracts slides without summarizing (use `--render auto|kitty|iterm` for inline thumbnails).
- Defaults to writing images under `./slides/<sourceId>/` (override via `--slides-dir` / `--output`).

## Implementation notes

- Build `slideDescriptions` from extracted transcript timed text when available.
- Split transcript into segments with timestamps before rendering slide output.
- Keep slide text generation model-free.
- Ensure summary cache keys stay untouched; this is output-only rendering.
- Slide extraction downloads the media once for detect+extract; set `SLIDES_EXTRACT_STREAM=1` to allow stream fallback (lower accuracy).

## Steps

1. Add slide-description builder using transcript timed text + OCR fallback.
2. Add length-based per-slide char budget and window sizing.
3. Render inline slide timeline with timestamps + text.
4. Keep slide interactions seek-first where the target supports it.
5. Add tests for slide description + fallback.
