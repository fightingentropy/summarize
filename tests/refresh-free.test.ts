import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const llmMocks = vi.hoisted(() => ({
  generateTextWithModelId: vi.fn(),
}));

vi.mock("../src/llm/generate-text.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/generate-text.js")>();
  return {
    ...actual,
    generateTextWithModelId: llmMocks.generateTextWithModelId,
  };
});

function createCaptureStream() {
  let out = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  return { stream, read: () => out };
}

function buildModelsPayload(ids: string[]) {
  return {
    data: ids.map((id, index) => ({
      id,
      name: id,
      context_length: 8192,
      created: Math.floor((Date.now() - index * 24 * 60 * 60 * 1000) / 1000),
      top_provider: { max_completion_tokens: 1024 },
      supported_parameters: ["temperature", "max_tokens"],
      architecture: { modality: "text" },
    })),
  };
}

describe("refresh-free", () => {
  it("throws when OPENROUTER_API_KEY is missing", async () => {
    const { refreshFree } = await import("../src/refresh-free.js");
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();
    await expect(
      refreshFree({
        env: {},
        fetchImpl: vi.fn() as unknown as typeof fetch,
        stdout,
        stderr,
      }),
    ).rejects.toThrow(/Missing OPENROUTER_API_KEY/);
  });

  it("throws when OpenRouter /models returns non-OK", async () => {
    llmMocks.generateTextWithModelId.mockReset();

    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-free-"));
    const { refreshFree } = await import("../src/refresh-free.js");
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();

    const fetchImpl = vi.fn(async () => {
      return new Response("nope", { status: 500, headers: { "content-type": "text/plain" } });
    });

    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout,
        stderr,
      }),
    ).rejects.toThrow("OpenRouter /models failed: HTTP 500");
  });

  it("writes models.free and optionally sets model=free", async () => {
    llmMocks.generateTextWithModelId.mockReset().mockResolvedValue({ text: "OK" });

    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-free-"));
    const { refreshFree } = await import("../src/refresh-free.js");
    const { stream: stdout, read: readStdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://openrouter.ai/api/v1/models") {
        return new Response(JSON.stringify(buildModelsPayload(["a/model:free", "b/model:free"])), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await refreshFree({
      env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      stdout,
      stderr,
      options: { runs: 0, smart: 1, maxCandidates: 1, setDefault: true },
    });

    expect(readStdout()).toContain("Wrote");
    const configPath = join(home, ".summarize", "config.json");
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown as {
      model?: string;
      models?: {
        free?: { rules?: Array<{ candidates?: string[] }> };
      };
    };
    expect(parsed.model).toBe("free");
    expect(parsed.models?.free?.rules?.[0]?.candidates?.[0]).toMatch(/^openrouter\//);
  });

  it("fails when /models returns no :free models (with and without age filter)", async () => {
    llmMocks.generateTextWithModelId.mockReset();
    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-free-"));
    const { refreshFree } = await import("../src/refresh-free.js");
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();

    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(buildModelsPayload(["a/model:paid"])), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout,
        stderr,
        options: { maxAgeDays: 180 },
      }),
    ).rejects.toThrow(/no :free models from the last 180 days/i);

    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout,
        stderr,
        options: { maxAgeDays: 0 },
      }),
    ).rejects.toThrow(/returned no :free models$/i);
  });

  it("surfaces invalid config comments and models shape errors", async () => {
    llmMocks.generateTextWithModelId.mockReset().mockResolvedValue({ text: "OK" });

    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-free-"));
    const configPath = join(home, ".summarize", "config.json");
    await mkdir(join(home, ".summarize"), { recursive: true });
    await writeFile(configPath, "{\n// nope\n}\n", "utf8");

    const { refreshFree } = await import("../src/refresh-free.js");
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();

    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(buildModelsPayload(["a/model:free"])), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout,
        stderr,
        options: { runs: 0, maxCandidates: 1 },
      }),
    ).rejects.toThrow(/comments are not allowed/i);

    await writeFile(configPath, JSON.stringify({ models: "nope" }), "utf8");
    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout,
        stderr,
        options: { runs: 0, maxCandidates: 1 },
      }),
    ).rejects.toThrow(/"models" must be an object/i);
  });

  it("filters old + small models and prints verbose skip lines", async () => {
    llmMocks.generateTextWithModelId.mockReset().mockResolvedValue({ text: "OK" });

    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-free-"));
    const { refreshFree } = await import("../src/refresh-free.js");
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr, read: readStderr } = createCaptureStream();

    const nowSec = Math.floor(Date.now() / 1000);
    const tooOldSec = nowSec - 400 * 24 * 60 * 60;

    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [
            { id: "a/model-70b:free", name: "A 70B", created: nowSec },
            { id: "b/model-1b:free", name: "B 1B", created: nowSec },
            { id: "c/model-70b:free", name: "C 70B old", created: tooOldSec },
            { id: "d/model-70b:free", name: "D 70B missing created" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await refreshFree({
      env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      stdout,
      stderr,
      verbose: true,
      options: { runs: 0, maxCandidates: 1, smart: 1, maxAgeDays: 180, minParamB: 27 },
    });

    const out = readStderr();
    expect(out).toContain("filtered");
    expect(out).toContain("skip");
  });

  it("classifies common failure types and prints per-day quota note", async () => {
    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-free-"));
    const { refreshFree } = await import("../src/refresh-free.js");
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr, read: readStderr } = createCaptureStream();

    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify(buildModelsPayload(["a/model:free", "b/model:free", "c/model:free"])),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    llmMocks.generateTextWithModelId
      .mockReset()
      .mockImplementation(async ({ modelId }: { modelId: string }) => {
        if (modelId.includes("a/model:free"))
          throw new Error("Rate limit exceeded: per-day free-models-per-day");
        if (modelId.includes("b/model:free")) throw new Error("No allowed providers are available");
        if (modelId.includes("c/model:free")) return { text: "OK" };
        throw new Error("unexpected");
      });

    await refreshFree({
      env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      stdout,
      stderr,
      options: { runs: 0, maxCandidates: 1, smart: 1, concurrency: 1 },
    });

    const out = readStderr();
    expect(out).toContain("results");
    expect(out).toContain("per-day");
  });

  it("handles TTY progress rendering without throwing", async () => {
    llmMocks.generateTextWithModelId.mockReset().mockResolvedValue({ text: "OK" });

    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-free-"));
    const { refreshFree } = await import("../src/refresh-free.js");
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();
    (stderr as unknown as { isTTY?: boolean }).isTTY = true;

    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(buildModelsPayload(["a/model:free"])), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await refreshFree({
      env: { HOME: home, OPENROUTER_API_KEY: "KEY", FORCE_COLOR: "1" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      stdout,
      stderr,
      options: { runs: 0, maxCandidates: 1, smart: 1, concurrency: 1 },
    });
  });

  it("refines candidates over extra runs", async () => {
    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-free-"));
    const { refreshFree } = await import("../src/refresh-free.js");
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();

    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(buildModelsPayload(["a/model:free", "b/model:free"])), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    let seen = 0;
    llmMocks.generateTextWithModelId
      .mockReset()
      .mockImplementation(async ({ modelId }: { modelId: string }) => {
        seen += 1;
        // Fail one of the refine runs for b/model.
        if (modelId.includes("b/model:free") && seen > 2) throw new Error("provider error");
        return { text: "OK" };
      });

    await refreshFree({
      env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      stdout,
      stderr,
      options: { runs: 1, maxCandidates: 2, smart: 1, concurrency: 1 },
    });
  });

  it("rejects a config file that is not a top-level object", async () => {
    llmMocks.generateTextWithModelId.mockReset().mockResolvedValue({ text: "OK" });

    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-free-"));
    const configPath = join(home, ".summarize", "config.json");
    await mkdir(join(home, ".summarize"), { recursive: true });
    await writeFile(configPath, "[]", "utf8");

    const { refreshFree } = await import("../src/refresh-free.js");
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(buildModelsPayload(["a/model:free"])), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout,
        stderr,
        options: { runs: 0, maxCandidates: 1 },
      }),
    ).rejects.toThrow(/expected an object at the top level/i);
  });

  it("retries once after per-minute rate limit and uses a global cooldown", async () => {
    vi.useFakeTimers();
    try {
      llmMocks.generateTextWithModelId.mockReset();

      const home = await mkdtemp(join(tmpdir(), "summarize-refresh-free-"));
      const { refreshFree } = await import("../src/refresh-free.js");
      const { stream: stdout } = createCaptureStream();
      const { stream: stderr, read: readStderr } = createCaptureStream();

      const fetchImpl = vi.fn(async () => {
        return new Response(JSON.stringify(buildModelsPayload(["a/model:free"])), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      let calls = 0;
      llmMocks.generateTextWithModelId.mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("Rate limit exceeded: free-models-per-min");
        }
        return { text: "OK" };
      });

      const promise = refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout,
        stderr,
        options: { runs: 0, maxCandidates: 1, concurrency: 1, timeoutMs: 10 },
      });

      await vi.advanceTimersByTimeAsync(70_000);
      await promise;

      expect(calls).toBe(2);
      expect(readStderr()).toContain("rate limit hit; sleeping");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects /* */ comments in the config file", async () => {
    llmMocks.generateTextWithModelId.mockReset().mockResolvedValue({ text: "OK" });

    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-free-"));
    const configPath = join(home, ".summarize", "config.json");
    await mkdir(join(home, ".summarize"), { recursive: true });
    await writeFile(configPath, "{\n/* nope */\n}\n", "utf8");

    const { refreshFree } = await import("../src/refresh-free.js");
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(buildModelsPayload(["a/model:free"])), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout,
        stderr,
        options: { runs: 0, maxCandidates: 1, concurrency: 1 },
      }),
    ).rejects.toThrow(/comments are not allowed/i);
  });

  it("fails when no candidate works (all attempts error)", async () => {
    llmMocks.generateTextWithModelId.mockReset().mockImplementation(async () => {
      throw new Error("provider error");
    });

    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-free-"));
    const { refreshFree } = await import("../src/refresh-free.js");
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(buildModelsPayload(["a/model:free", "b/model:free"])), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout,
        stderr,
        options: { runs: 0, maxCandidates: 2, smart: 1, concurrency: 1 },
      }),
    ).rejects.toThrow(/No working :free models found/i);
  });

  it("defaults unknown OpenRouter rate limits to per-minute and retries once", async () => {
    vi.useFakeTimers();
    try {
      llmMocks.generateTextWithModelId.mockReset();

      const home = await mkdtemp(join(tmpdir(), "summarize-refresh-free-"));
      const { refreshFree } = await import("../src/refresh-free.js");
      const { stream: stdout } = createCaptureStream();
      const { stream: stderr, read: readStderr } = createCaptureStream();

      const fetchImpl = vi.fn(async () => {
        return new Response(JSON.stringify(buildModelsPayload(["a/model:free"])), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      let calls = 0;
      llmMocks.generateTextWithModelId.mockImplementation(async () => {
        calls += 1;
        if (calls === 1) throw new Error("Rate limit exceeded");
        return { text: "OK" };
      });

      const promise = refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout,
        stderr,
        options: { runs: 0, maxCandidates: 1, concurrency: 1, timeoutMs: 10 },
      });
      await vi.advanceTimersByTimeAsync(70_000);
      await promise;

      expect(calls).toBe(2);
      expect(readStderr()).toContain("rate limit hit; sleeping");
    } finally {
      vi.useRealTimers();
    }
  });

  it("infers param size from model IDs (e2b, decimals) and filters by minParamB", async () => {
    llmMocks.generateTextWithModelId.mockReset().mockResolvedValue({ text: "OK" });

    const home = await mkdtemp(join(tmpdir(), "summarize-refresh-free-"));
    const { refreshFree } = await import("../src/refresh-free.js");
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();

    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify(
          buildModelsPayload(["x/model-e2b:free", "y/model-1.5b:free", "z/model-3b:free"]),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await refreshFree({
      env: { HOME: home, OPENROUTER_API_KEY: "KEY" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      stdout,
      stderr,
      options: {
        runs: 0,
        maxCandidates: 10,
        smart: 10,
        concurrency: 1,
        minParamB: 2,
        maxAgeDays: 0,
      },
    });

    const configPath = join(home, ".summarize", "config.json");
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown as {
      models?: {
        free?: { rules?: Array<{ candidates?: string[] }> };
      };
    };
    const candidates = parsed.models?.free?.rules?.[0]?.candidates ?? [];
    expect(candidates.some((c: string) => c.includes("y/model-1.5b:free"))).toBe(false);
    expect(candidates.some((c: string) => c.includes("x/model-e2b:free"))).toBe(true);
  });
});
