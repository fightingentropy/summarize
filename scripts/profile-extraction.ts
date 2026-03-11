import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import {
  createLinkPreviewClient,
  type ExtractedLinkContent,
  type FetchLinkContentOptions,
  type LinkPreviewProfileEvent,
} from "../packages/core/src/content/index.js";

type CliOptions = {
  input: string;
  htmlFile: boolean;
  baseUrl: string | null;
  iterations: number;
  warmup: number;
  json: boolean;
  timeoutMs: number;
  fetchOptions: FetchLinkContentOptions;
};

type RunSummary = {
  run: number;
  wallTimeMs: number;
  result: Pick<
    ExtractedLinkContent,
    | "content"
    | "truncated"
    | "transcriptSource"
    | "transcriptCharacters"
    | "transcriptWordCount"
    | "mediaDurationSeconds"
    | "isVideoOnly"
    | "diagnostics"
  >;
  profileEvents: LinkPreviewProfileEvent[];
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv: string[]): CliOptions {
  let input = "";
  let htmlFile = false;
  let baseUrl: string | null = null;
  let iterations = 3;
  let warmup = 1;
  let json = false;
  let timeoutMs = 120_000;
  const fetchOptions: FetchLinkContentOptions = {
    format: "text",
    firecrawl: "off",
    markdownMode: "auto",
    youtubeTranscript: "auto",
    mediaTranscript: "auto",
    transcriptTimestamps: false,
    cacheMode: "default",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    switch (arg) {
      case "--html-file":
        htmlFile = true;
        input = argv[i + 1] ?? "";
        i += 1;
        break;
      case "--url":
        baseUrl = argv[i + 1] ?? "";
        i += 1;
        break;
      case "--iterations":
      case "-n": {
        const parsed = Number(argv[i + 1] ?? "");
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`Invalid --iterations value: ${argv[i + 1] ?? ""}`);
        }
        iterations = Math.floor(parsed);
        i += 1;
        break;
      }
      case "--warmup": {
        const parsed = Number(argv[i + 1] ?? "");
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`Invalid --warmup value: ${argv[i + 1] ?? ""}`);
        }
        warmup = Math.floor(parsed);
        i += 1;
        break;
      }
      case "--timeout-ms": {
        const parsed = Number(argv[i + 1] ?? "");
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`Invalid --timeout-ms value: ${argv[i + 1] ?? ""}`);
        }
        timeoutMs = Math.floor(parsed);
        i += 1;
        break;
      }
      case "--format":
        fetchOptions.format = (argv[i + 1] as FetchLinkContentOptions["format"]) ?? "text";
        i += 1;
        break;
      case "--markdown-mode":
        fetchOptions.markdownMode =
          (argv[i + 1] as FetchLinkContentOptions["markdownMode"]) ?? "auto";
        i += 1;
        break;
      case "--firecrawl":
        fetchOptions.firecrawl = (argv[i + 1] as FetchLinkContentOptions["firecrawl"]) ?? "off";
        i += 1;
        break;
      case "--youtube-transcript":
        fetchOptions.youtubeTranscript =
          (argv[i + 1] as FetchLinkContentOptions["youtubeTranscript"]) ?? "auto";
        i += 1;
        break;
      case "--media-transcript":
        fetchOptions.mediaTranscript =
          (argv[i + 1] as FetchLinkContentOptions["mediaTranscript"]) ?? "auto";
        i += 1;
        break;
      case "--cache-mode":
        fetchOptions.cacheMode = (argv[i + 1] as FetchLinkContentOptions["cacheMode"]) ?? "default";
        i += 1;
        break;
      case "--transcript-timestamps":
        fetchOptions.transcriptTimestamps = true;
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        if (!arg.startsWith("-") && !input) {
          input = arg;
          break;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!input) {
    throw new Error("Missing input URL or --html-file path");
  }

  return {
    input,
    htmlFile,
    baseUrl,
    iterations,
    warmup,
    json,
    timeoutMs,
    fetchOptions,
  };
}

function printUsage() {
  console.error(
    [
      "Usage: bun x tsx scripts/profile-extraction.ts <url>",
      "   or: bun x tsx scripts/profile-extraction.ts --html-file <file> [--url https://example.com]",
      "",
      "Options:",
      "  --iterations, -n <n>        Measured runs (default: 3)",
      "  --warmup <n>                Warmup runs excluded from output (default: 1)",
      "  --timeout-ms <ms>           Extraction timeout in milliseconds (default: 120000)",
      "  --format <text|markdown>    Extraction format (default: text)",
      "  --markdown-mode <mode>      off|auto|llm|readability (default: auto)",
      "  --firecrawl <mode>          off|auto|always (default: off)",
      "  --youtube-transcript <mode> auto|web|apify|yt-dlp|no-auto (default: auto)",
      "  --media-transcript <mode>   auto|prefer (default: auto)",
      "  --cache-mode <mode>         default|bypass (default: default)",
      "  --transcript-timestamps     Include timed transcript segments",
      "  --json                      Emit JSON instead of a text table",
    ].join("\n"),
  );
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

function formatDetails(details: LinkPreviewProfileEvent["details"]): string {
  if (!details) return "";
  return Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function summarizeRunResult(result: RunSummary["result"]) {
  return {
    strategy: result.diagnostics.strategy,
    contentChars: result.content.length,
    truncated: result.truncated,
    transcriptSource: result.transcriptSource ?? null,
    transcriptChars: result.transcriptCharacters ?? null,
    transcriptWords: result.transcriptWordCount ?? null,
    mediaDurationSeconds: result.mediaDurationSeconds ?? null,
    isVideoOnly: result.isVideoOnly,
  };
}

function aggregateProfileEvents(runs: RunSummary[]) {
  const map = new Map<
    string,
    {
      name: string;
      calls: number;
      okCalls: number;
      durations: number[];
      lastDetails: string;
    }
  >();

  for (const run of runs) {
    for (const event of run.profileEvents) {
      const current = map.get(event.name) ?? {
        name: event.name,
        calls: 0,
        okCalls: 0,
        durations: [],
        lastDetails: "",
      };
      current.calls += 1;
      current.okCalls += event.ok ? 1 : 0;
      current.durations.push(event.durationMs);
      current.lastDetails = formatDetails(event.details);
      map.set(event.name, current);
    }
  }

  return [...map.values()]
    .map((entry) => {
      const total = entry.durations.reduce((sum, value) => sum + value, 0);
      const avg = total / entry.durations.length;
      return {
        ...entry,
        avgMs: avg,
        minMs: Math.min(...entry.durations),
        maxMs: Math.max(...entry.durations),
      };
    })
    .sort((a, b) => b.avgMs - a.avgMs);
}

async function buildFetchAndInput(options: CliOptions): Promise<{
  inputUrl: string;
  fetchImpl: typeof fetch;
  sourceLabel: string;
}> {
  if (!options.htmlFile && isHttpUrl(options.input)) {
    return {
      inputUrl: options.input,
      fetchImpl: globalThis.fetch.bind(globalThis),
      sourceLabel: options.input,
    };
  }

  const fallbackToFile = options.htmlFile || (await fileExists(options.input));
  if (!fallbackToFile) {
    throw new Error(`Input is neither a URL nor a readable file: ${options.input}`);
  }

  const htmlPath = path.resolve(options.input);
  const html = await readFile(htmlPath, "utf8");
  const inputUrl = options.baseUrl?.trim() || "https://local.profile.test/";
  const fetchImpl: typeof fetch = async (input) => {
    const requestedUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (requestedUrl !== inputUrl) {
      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
  return {
    inputUrl,
    fetchImpl,
    sourceLabel: htmlPath,
  };
}

async function runProfile(options: CliOptions): Promise<{
  source: string;
  inputUrl: string;
  warmupRuns: number;
  measuredRuns: RunSummary[];
}> {
  const { inputUrl, fetchImpl, sourceLabel } = await buildFetchAndInput(options);
  const runs: RunSummary[] = [];
  const totalRuns = options.warmup + options.iterations;

  for (let i = 0; i < totalRuns; i += 1) {
    const profileEvents: LinkPreviewProfileEvent[] = [];
    const client = createLinkPreviewClient({
      fetch: fetchImpl,
      env: process.env,
      apifyApiToken: process.env.APIFY_API_TOKEN ?? process.env.APIFY_TOKEN ?? null,
      ytDlpPath: process.env.YT_DLP_PATH ?? null,
      onProfile: (event) => profileEvents.push(event),
    });

    const startedAt = performance.now();
    const result = await client.fetchLinkContent(inputUrl, {
      ...options.fetchOptions,
      timeoutMs: options.timeoutMs,
    });
    const wallTimeMs = performance.now() - startedAt;

    if (i >= options.warmup) {
      runs.push({
        run: i - options.warmup + 1,
        wallTimeMs,
        result: {
          content: result.content,
          truncated: result.truncated,
          transcriptSource: result.transcriptSource,
          transcriptCharacters: result.transcriptCharacters,
          transcriptWordCount: result.transcriptWordCount,
          mediaDurationSeconds: result.mediaDurationSeconds,
          isVideoOnly: result.isVideoOnly,
          diagnostics: result.diagnostics,
        },
        profileEvents,
      });
    }
  }

  return {
    source: sourceLabel,
    inputUrl,
    warmupRuns: options.warmup,
    measuredRuns: runs,
  };
}

function printTextReport(report: Awaited<ReturnType<typeof runProfile>>, options: CliOptions) {
  console.log(`source=${report.source}`);
  console.log(`inputUrl=${report.inputUrl}`);
  console.log(`warmupRuns=${report.warmupRuns}`);
  console.log(`iterations=${options.iterations}`);
  console.log(
    `options=${JSON.stringify({
      ...options.fetchOptions,
      timeoutMs: options.timeoutMs,
    })}`,
  );
  console.log("");

  console.log("Run summary");
  for (const run of report.measuredRuns) {
    const summary = summarizeRunResult(run.result);
    console.log(
      [
        `run=${run.run}`,
        `wall=${formatMs(run.wallTimeMs)}`,
        `strategy=${summary.strategy}`,
        `contentChars=${summary.contentChars}`,
        `transcriptSource=${summary.transcriptSource}`,
        `transcriptChars=${summary.transcriptChars}`,
        `videoOnly=${summary.isVideoOnly}`,
      ].join(" "),
    );
  }

  console.log("");
  console.log("Phase summary");
  for (const phase of aggregateProfileEvents(report.measuredRuns)) {
    console.log(
      [
        phase.name.padEnd(30),
        `calls=${String(phase.calls).padStart(2)}`,
        `ok=${phase.okCalls}/${phase.calls}`,
        `avg=${formatMs(phase.avgMs).padStart(9)}`,
        `min=${formatMs(phase.minMs).padStart(9)}`,
        `max=${formatMs(phase.maxMs).padStart(9)}`,
        phase.lastDetails ? `details=${phase.lastDetails}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}

const options = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exit(1);
  }
})();

const report = await runProfile(options);
if (options.json) {
  console.log(
    JSON.stringify(
      {
        source: report.source,
        inputUrl: report.inputUrl,
        warmupRuns: report.warmupRuns,
        iterations: options.iterations,
        options: {
          ...options.fetchOptions,
          timeoutMs: options.timeoutMs,
        },
        runs: report.measuredRuns.map((run) => ({
          run: run.run,
          wallTimeMs: run.wallTimeMs,
          summary: summarizeRunResult(run.result),
          profileEvents: run.profileEvents,
        })),
        phases: aggregateProfileEvents(report.measuredRuns),
      },
      null,
      2,
    ),
  );
} else {
  printTextReport(report, options);
}
