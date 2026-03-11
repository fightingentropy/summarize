import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareRunEnvironment } from "../src/run/runner-setup.js";

describe("prepareRunEnvironment", () => {
  it("loads ~/.summarize/.env as a fallback source", () => {
    const home = mkdtempSync(join(tmpdir(), "summarize-runner-setup-"));
    const summarizeDir = join(home, ".summarize");
    mkdirSync(summarizeDir, { recursive: true });
    writeFileSync(join(summarizeDir, ".env"), "OPENAI_API_KEY=from-home\n", "utf8");

    const { envForRun } = prepareRunEnvironment([], { HOME: home });
    expect(envForRun.OPENAI_API_KEY).toBe("from-home");
  });

  it("prefers the incoming environment over ~/.summarize/.env", () => {
    const home = mkdtempSync(join(tmpdir(), "summarize-runner-setup-"));
    const summarizeDir = join(home, ".summarize");
    mkdirSync(summarizeDir, { recursive: true });
    writeFileSync(join(summarizeDir, ".env"), "OPENAI_API_KEY=from-home\n", "utf8");

    const { envForRun } = prepareRunEnvironment([], {
      HOME: home,
      OPENAI_API_KEY: "from-shell",
    });
    expect(envForRun.OPENAI_API_KEY).toBe("from-shell");
  });
});
