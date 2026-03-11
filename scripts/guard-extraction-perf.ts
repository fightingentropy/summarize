import { performance } from "node:perf_hooks";
import process from "node:process";
import {
  createLinkPreviewClient,
  type FetchLinkContentOptions,
  type LinkPreviewProfileEvent,
} from "../packages/core/src/content/index.js";

type PerfScenario = {
  name: string;
  url: string;
  warmup: number;
  iterations: number;
  options: FetchLinkContentOptions;
  createFetch: () => typeof fetch;
  budgets: {
    wallTimeMs: number;
    phases?: Record<string, number>;
    absentPhases?: string[];
  };
};

type ScenarioRun = {
  wallTimeMs: number;
  phaseDurations: Map<string, number>;
};

const LARGE_ARTICLE_URL = "https://local.perf/article";
const YOUTUBE_URL = "https://www.youtube.com/watch?v=abcdefghijk";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  }
  return sorted[middle] ?? 0;
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

function collectPhaseDurations(events: LinkPreviewProfileEvent[]): Map<string, number> {
  const durations = new Map<string, number>();
  for (const event of events) {
    durations.set(event.name, (durations.get(event.name) ?? 0) + event.durationMs);
  }
  return durations;
}

function buildLargeArticleHtml(): string {
  const cssRule =
    '@font-face{font-family:Space Grotesk;font-style:normal;font-weight:300 700;font-display:swap;src:url(/a.woff2)format("woff2");unicode-range:U+100-2BA,U+2BD-2C5,U+2C7-2CC,U+2CE-2D7,U+2DD-2FF,U+304,U+308,U+329;}';
  const css = cssRule.repeat(900);
  const hiddenBlocks = Array.from(
    { length: 300 },
    (_, index) => `<div class="promo-${index}" style="display:none">Hidden promo ${index}</div>`,
  ).join("");
  const paragraphs = Array.from(
    { length: 700 },
    (_, index) =>
      `<p>Paragraph ${index} about extraction performance, HTML parsing, cleanup, and readability quality.</p>`,
  ).join("");

  return `<!doctype html><html><head>
    <title>Large Article Fixture</title>
    <meta name="description" content="Synthetic article fixture for extraction performance checks." />
    <style>${css}</style>
    <script>console.log("ignore me")</script>
    <noscript>fallback</noscript>
  </head><body>
    <header><nav><a href="/one">One</a><a href="/two">Two</a></nav></header>
    ${hiddenBlocks}
    <main>
      <article>
        <h1>Large Article Fixture</h1>
        ${paragraphs}
      </article>
    </main>
    <footer>Footer links and metadata</footer>
  </body></html>`;
}

function createLargeArticleFetch(): typeof fetch {
  const html = buildLargeArticleHtml();
  return async (input) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url !== LARGE_ARTICLE_URL) {
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    }
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
}

function createYouTubeEmbedFetch(): typeof fetch {
  const embedHtml =
    "<!doctype html><html><head><title>YouTube</title>" +
    '<script>ytcfg.set({"INNERTUBE_API_KEY":"TEST_KEY","INNERTUBE_CONTEXT":{"client":{"clientName":"WEB_EMBEDDED_PLAYER","clientVersion":"1.0"}}});</script>' +
    "</head><body></body></html>";

  return async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("youtube.com/oembed")) {
      return Response.json(
        {
          title: "Perf Fixture",
          author_name: "Summarize",
        },
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("youtube.com/embed/")) {
      return new Response(embedHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.includes("youtubei/v1/player")) {
      const requestedVideoId = (() => {
        try {
          const body =
            init && typeof init === "object" && "body" in init && typeof init.body === "string"
              ? JSON.parse(init.body)
              : {};
          return typeof body.videoId === "string" ? body.videoId : null;
        } catch {
          return null;
        }
      })();
      if (requestedVideoId !== "abcdefghijk") {
        return Response.json({}, { status: 404 });
      }
      return Response.json(
        {
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{ baseUrl: "https://local.perf/captions", languageCode: "en" }],
            },
          },
        },
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.startsWith("https://local.perf/captions")) {
      return new Response(
        JSON.stringify({
          events: [
            { segs: [{ utf8: "Hello from the local YouTube perf fixture." }] },
            { segs: [{ utf8: "This should stay on the embed-first path." }] },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("youtube.com/watch") || url.includes("youtu.be/")) {
      throw new Error(`Watch HTML fetch should not happen in perf guard: ${url}`);
    }
    throw new Error(`Unexpected fetch in perf guard: ${url}`);
  };
}

const scenarios: PerfScenario[] = [
  {
    name: "large-article-local",
    url: LARGE_ARTICLE_URL,
    warmup: 1,
    iterations: 4,
    options: {
      format: "text",
      firecrawl: "off",
      markdownMode: "auto",
      cacheMode: "bypass",
      mediaTranscript: "auto",
      youtubeTranscript: "auto",
      timeoutMs: 15_000,
    },
    createFetch: createLargeArticleFetch,
    budgets: {
      wallTimeMs: 450,
      phases: {
        "html.total": 260,
        "html.visible.prepare": 160,
        "html.document.load": 60,
      },
    },
  },
  {
    name: "youtube-embed-local",
    url: YOUTUBE_URL,
    warmup: 1,
    iterations: 4,
    options: {
      format: "text",
      firecrawl: "off",
      markdownMode: "auto",
      cacheMode: "bypass",
      mediaTranscript: "auto",
      youtubeTranscript: "auto",
      timeoutMs: 15_000,
    },
    createFetch: createYouTubeEmbedFetch,
    budgets: {
      wallTimeMs: 180,
      phases: {
        "fetch.html.total": 80,
        "transcript.provider.fetch": 120,
      },
      absentPhases: ["html.total", "readability.total", "html.article.extract.raw"],
    },
  },
];

async function runScenario(scenario: PerfScenario): Promise<{
  name: string;
  runs: ScenarioRun[];
}> {
  const totalRuns = scenario.warmup + scenario.iterations;
  const fetchImpl = scenario.createFetch();
  const runs: ScenarioRun[] = [];

  for (let index = 0; index < totalRuns; index += 1) {
    const profileEvents: LinkPreviewProfileEvent[] = [];
    const client = createLinkPreviewClient({
      fetch: fetchImpl,
      env: process.env,
      onProfile: (event) => profileEvents.push(event),
    });

    const startedAt = performance.now();
    await client.fetchLinkContent(scenario.url, scenario.options);
    const wallTimeMs = performance.now() - startedAt;

    if (index >= scenario.warmup) {
      runs.push({
        wallTimeMs,
        phaseDurations: collectPhaseDurations(profileEvents),
      });
    }
  }

  return { name: scenario.name, runs };
}

function evaluateScenario(
  scenario: PerfScenario,
  result: Awaited<ReturnType<typeof runScenario>>,
): string[] {
  const failures: string[] = [];
  const wallMedian = median(result.runs.map((run) => run.wallTimeMs));
  if (wallMedian > scenario.budgets.wallTimeMs) {
    failures.push(
      `${scenario.name}: median wall time ${formatMs(wallMedian)} exceeded ${formatMs(
        scenario.budgets.wallTimeMs,
      )}`,
    );
  }

  for (const phaseName of scenario.budgets.absentPhases ?? []) {
    const appeared = result.runs.some((run) => run.phaseDurations.has(phaseName));
    if (appeared) {
      failures.push(`${scenario.name}: phase ${phaseName} appeared but should stay absent`);
    }
  }

  for (const [phaseName, budgetMs] of Object.entries(scenario.budgets.phases ?? {})) {
    const values = result.runs.map((run) => run.phaseDurations.get(phaseName) ?? NaN);
    if (values.some((value) => Number.isNaN(value))) {
      failures.push(`${scenario.name}: phase ${phaseName} did not appear in every measured run`);
      continue;
    }
    const phaseMedian = median(values);
    if (phaseMedian > budgetMs) {
      failures.push(
        `${scenario.name}: median ${phaseName} ${formatMs(phaseMedian)} exceeded ${formatMs(
          budgetMs,
        )}`,
      );
    }
  }

  return failures;
}

function printScenarioReport(
  scenario: PerfScenario,
  result: Awaited<ReturnType<typeof runScenario>>,
) {
  const wallMedian = median(result.runs.map((run) => run.wallTimeMs));
  console.log(`${scenario.name}`);
  console.log(
    `  median wall: ${formatMs(wallMedian)} (budget ${formatMs(scenario.budgets.wallTimeMs)})`,
  );
  for (const [phaseName, budgetMs] of Object.entries(scenario.budgets.phases ?? {})) {
    const phaseMedian = median(
      result.runs.map((run) => run.phaseDurations.get(phaseName) ?? Number.NaN),
    );
    console.log(`  median ${phaseName}: ${formatMs(phaseMedian)} (budget ${formatMs(budgetMs)})`);
  }
  for (const phaseName of scenario.budgets.absentPhases ?? []) {
    const appeared = result.runs.some((run) => run.phaseDurations.has(phaseName));
    console.log(`  absent ${phaseName}: ${appeared ? "FAILED" : "ok"}`);
  }
}

async function main() {
  const failures: string[] = [];

  for (const scenario of scenarios) {
    const result = await runScenario(scenario);
    printScenarioReport(scenario, result);
    failures.push(...evaluateScenario(scenario, result));
    console.log("");
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`FAIL ${failure}`);
    }
    process.exit(1);
  }

  console.log("Perf guard passed.");
}

await main();
