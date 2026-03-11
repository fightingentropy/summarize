import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSummarizeUserFiles, loadSummarizeLocalEnv } from "../src/config.js";

function createHomeDir(): string {
  return mkdtempSync(join(tmpdir(), "summarize-config-bootstrap-"));
}

describe("config bootstrap", () => {
  it("creates a default config file with explicit defaults", () => {
    const home = createHomeDir();

    ensureSummarizeUserFiles({ env: { HOME: home } });

    const configPath = join(home, ".summarize", "config.json");
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    expect(parsed.model).toBe("auto");
    expect(parsed.output).toEqual({ language: "auto" });
    expect(parsed.ui).toEqual({ theme: "aurora" });
    expect(parsed.slides).toEqual({
      enabled: false,
      ocr: false,
      ocrMode: "fast",
      ocrLanguageCorrection: false,
      dir: "slides",
      sceneThreshold: 0.3,
      max: 6,
      minDuration: 2,
    });
    expect(parsed.env).toMatchObject({
      OPENAI_API_KEY: "",
      EXA_API_KEY: "",
      CLOUDFLARE_API_TOKEN: "",
      CLOUDFLARE_ACCOUNT_ID: "",
      FIRECRAWL_API_KEY: "",
    });
  });

  it("migrates secret values out of config.json into ~/.summarize/.env", () => {
    const home = createHomeDir();
    const summarizeDir = join(home, ".summarize");
    mkdirSync(summarizeDir, { recursive: true });
    writeFileSync(
      join(summarizeDir, "config.json"),
      JSON.stringify({
        env: {
          OPENAI_API_KEY: "sk-openai",
          CLOUDFLARE_ACCOUNT_ID: "acct-123",
          CUSTOM_FLAG: "enabled",
        },
        apiKeys: {
          anthropic: "sk-ant",
        },
      }),
      "utf8",
    );

    ensureSummarizeUserFiles({ env: { HOME: home } });

    const config = JSON.parse(readFileSync(join(summarizeDir, "config.json"), "utf8")) as {
      env?: Record<string, string>;
      apiKeys?: Record<string, string>;
    };
    expect(config.apiKeys).toBeUndefined();
    expect(config.env).toMatchObject({
      OPENAI_API_KEY: "",
      CLOUDFLARE_ACCOUNT_ID: "",
      CUSTOM_FLAG: "enabled",
    });

    expect(loadSummarizeLocalEnv({ env: { HOME: home } })).toMatchObject({
      OPENAI_API_KEY: "sk-openai",
      ANTHROPIC_API_KEY: "sk-ant",
      CLOUDFLARE_ACCOUNT_ID: "acct-123",
    });
  });

  it("migrates legacy top-level language into output.language", () => {
    const home = createHomeDir();
    const summarizeDir = join(home, ".summarize");
    mkdirSync(summarizeDir, { recursive: true });
    writeFileSync(
      join(summarizeDir, "config.json"),
      JSON.stringify({
        language: "de",
      }),
      "utf8",
    );

    ensureSummarizeUserFiles({ env: { HOME: home } });

    const config = JSON.parse(readFileSync(join(summarizeDir, "config.json"), "utf8")) as {
      language?: string;
      output?: { language?: string };
    };
    expect(config.language).toBeUndefined();
    expect(config.output?.language).toBe("de");
  });
});
