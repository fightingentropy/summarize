import { beforeEach, describe, expect, it, vi } from "vitest";

const extractAssetContent = vi.hoisted(() => vi.fn());
const handleFileInput = vi.hoisted(() => vi.fn());
const withUrlAsset = vi.hoisted(() => vi.fn());
const outputExtractedAsset = vi.hoisted(() => vi.fn());
const runUrlFlow = vi.hoisted(() => vi.fn());
const createTempFileFromStdin = vi.hoisted(() => vi.fn());

vi.mock("../src/run/flows/asset/extract", () => ({
  extractAssetContent,
}));
vi.mock("../src/run/flows/asset/input", () => ({
  handleFileInput,
  withUrlAsset,
}));
vi.mock("../src/run/flows/asset/output", () => ({
  outputExtractedAsset,
}));
vi.mock("../src/run/flows/url/flow", () => ({
  runUrlFlow,
}));
vi.mock("../src/run/stdin-temp-file", () => ({
  createTempFileFromStdin,
}));

import { executeRunnerInput } from "../src/run/runner-execution";

function buildOptions(overrides?: Partial<Parameters<typeof executeRunnerInput>[0]>) {
  return {
    inputTarget: { kind: "url", url: "https://example.com" } as never,
    stdin: process.stdin,
    handleFileInputContext: {},
    url: "https://example.com",
    isYoutubeUrl: false,
    withUrlAssetContext: {},
    extractMode: false,
    progressEnabled: true,
    renderSpinnerStatus: (label: string) => label,
    renderSpinnerStatusWithModel: (label: string, modelId: string) => `${label}:${modelId}`,
    extractAssetContext: {
      env: {},
      envForRun: {},
      execFileImpl: vi.fn() as never,
      timeoutMs: 1_000,
      preprocessMode: "auto" as const,
    },
    outputExtractedAssetContext: {
      io: { env: {}, envForRun: {}, stdout: process.stdout, stderr: process.stderr },
      flags: {
        timeoutMs: 1_000,
        preprocessMode: "auto" as const,
        format: "markdown" as const,
        plain: false,
        json: false,
        metricsEnabled: false,
        metricsDetailed: false,
        shouldComputeReport: false,
        runStartedAtMs: 0,
        verboseColor: false,
      },
      hooks: {
        clearProgressForStdout: vi.fn(),
        restoreProgressAfterStdout: null,
        buildReport: vi.fn(async () => ({}) as never),
        estimateCostUsd: vi.fn(async () => 0),
      },
      apiStatus: {
        xaiApiKey: null,
        apiKey: null,
        openrouterApiKey: null,
        apifyToken: null,
        firecrawlConfigured: false,
        googleConfigured: false,
        anthropicConfigured: false,
      },
    },
    summarizeAsset: vi.fn(async ({ onModelChosen }) => {
      onModelChosen("openai/gpt-5.4");
    }),
    runUrlFlowContext: {},
    ...overrides,
  };
}

describe("runner execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles stdin via a temp file and cleans up", async () => {
    const cleanup = vi.fn(async () => {});
    createTempFileFromStdin.mockResolvedValue({ filePath: "/tmp/stdin.txt", cleanup });
    handleFileInput.mockResolvedValueOnce(true);

    await executeRunnerInput(buildOptions({ inputTarget: { kind: "stdin" } as never }));

    expect(handleFileInput).toHaveBeenCalledWith({}, { kind: "file", filePath: "/tmp/stdin.txt" });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("throws when stdin conversion still cannot be handled", async () => {
    const cleanup = vi.fn(async () => {});
    createTempFileFromStdin.mockResolvedValue({ filePath: "/tmp/stdin.txt", cleanup });
    handleFileInput.mockResolvedValueOnce(false);

    await expect(
      executeRunnerInput(buildOptions({ inputTarget: { kind: "stdin" } as never })),
    ).rejects.toThrow("Failed to process stdin input");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("extracts asset urls through outputExtractedAsset", async () => {
    handleFileInput.mockResolvedValue(false);
    extractAssetContent.mockResolvedValue({ content: "body", diagnostics: {} });
    withUrlAsset.mockImplementation(async (_ctx, _url, _isYoutube, fn) => {
      await fn({
        loaded: {
          attachment: { kind: "file", mediaType: "text/html", filename: "index.html" },
          sourceLabel: "Example",
        },
        spinner: { setText: vi.fn() },
      });
      return true;
    });

    await executeRunnerInput(buildOptions({ extractMode: true }));

    expect(extractAssetContent).toHaveBeenCalledTimes(1);
    expect(outputExtractedAsset).toHaveBeenCalledTimes(1);
    expect(runUrlFlow).not.toHaveBeenCalled();
  });

  it("summarizes asset urls and updates spinner with model name", async () => {
    const spinner = { setText: vi.fn() };
    handleFileInput.mockResolvedValue(false);
    withUrlAsset.mockImplementation(async (_ctx, _url, _isYoutube, fn) => {
      await fn({
        loaded: {
          attachment: { kind: "file", mediaType: "text/html", filename: "index.html" },
          sourceLabel: "Example",
        },
        spinner,
      });
      return true;
    });

    await executeRunnerInput(buildOptions());

    expect(spinner.setText).toHaveBeenCalledWith("Summarizing");
    expect(spinner.setText).toHaveBeenCalledWith("Summarizing:openai/gpt-5.4");
    expect(runUrlFlow).not.toHaveBeenCalled();
  });

  it("falls through to URL flow or throws for missing url", async () => {
    handleFileInput.mockResolvedValue(false);
    withUrlAsset.mockResolvedValue(false);

    await executeRunnerInput(buildOptions());
    expect(runUrlFlow).toHaveBeenCalledWith({
      ctx: {},
      url: "https://example.com",
      isYoutubeUrl: false,
    });

    await expect(executeRunnerInput(buildOptions({ url: null }))).rejects.toThrow(
      "Only HTTP and HTTPS URLs can be summarized",
    );
  });
});
