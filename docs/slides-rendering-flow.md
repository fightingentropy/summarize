# slides-rendering-flow

---

summary: "Map of slide extraction terminal output and CLI rendering flow."
read_when:

- "When changing slide terminal output or streaming state."
- "When debugging slide rendering regressions in the CLI."

---

# Slides Rendering Flow

Two main paths.

## CLI / terminal

- `src/run/flows/url/slides-output.ts`
  Public construction + orchestration only.
- `slides-output-state.ts`
  Slide timeline state.
  Waiters.
  Finalization.
- `slides-output-render.ts`
  Terminal rendering.
  Inline-image policy.
  Debug path.
- `slides-output-stream.ts`
  Summary-stream parsing glue.

Rule: keep terminal I/O in render helpers; keep state mutations in the state store.

## When debugging

1. Check state transitions before DOM issues.
2. Check stream policy before transport retry logic.
3. Check cache/hydration helpers before blaming rendering.
