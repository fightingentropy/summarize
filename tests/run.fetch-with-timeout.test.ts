import { describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "../src/run/fetch-with-timeout.js";

describe("run/fetch-with-timeout", () => {
  it("passes through when init.signal is set", async () => {
    const res = new Response("ok");
    const fetchImpl = vi.fn(async () => res);
    const controller = new AbortController();

    const out = await fetchWithTimeout(
      fetchImpl as unknown as typeof fetch,
      "https://example.com",
      {
        signal: controller.signal,
      },
    );

    expect(out).toBe(res);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws FetchTimeoutError on AbortError (DOMException reason)", async () => {
    const fetchImpl = vi.fn((_: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject((init.signal as AbortSignal).reason);
        });
      });
    });

    await expect(
      fetchWithTimeout(fetchImpl as unknown as typeof fetch, "https://example.com", {}, 10),
    ).rejects.toMatchObject({ name: "FetchTimeoutError" });
  });

  it("throws FetchTimeoutError when DOMException is unavailable", async () => {
    const original = (globalThis as unknown as { DOMException?: unknown }).DOMException;
    (globalThis as unknown as { DOMException?: unknown }).DOMException = undefined;

    try {
      const fetchImpl = vi.fn((_: unknown, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      });

      await expect(
        fetchWithTimeout(fetchImpl as unknown as typeof fetch, "https://example.com", {}, 5),
      ).rejects.toMatchObject({ name: "FetchTimeoutError" });
    } finally {
      (globalThis as unknown as { DOMException?: unknown }).DOMException = original;
    }
  });

  it("rethrows non-abort errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(
      fetchWithTimeout(fetchImpl as unknown as typeof fetch, "https://example.com", {}, 1000),
    ).rejects.toMatchObject({ message: "boom" });
  });
});
