import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTranscriptCacheKey, createCacheStore } from "../src/cache.js";

describe("cache store", () => {
  it("round-trips text entries", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    store.setText("summary", "key", "value", null);
    expect(store.getText("summary", "key")).toBe("value");

    store.close();
  });

  it("round-trips json entries and returns null for invalid json", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    store.setJson("summary", "good", { ok: true }, null);
    expect(store.getJson<{ ok: boolean }>("summary", "good")).toEqual({ ok: true });

    store.setText("summary", "bad", "{", null);
    expect(store.getJson("summary", "bad")).toBeNull();

    store.close();
  });

  it("expires entries based on ttl", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    store.setText("summary", "soon", "value", -10);
    expect(store.getText("summary", "soon")).toBeNull();

    store.close();
  });

  it("evicts oldest entries when size cap exceeded", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 60 });

    store.setText("summary", "old", "a".repeat(50), null);
    store.setText("summary", "new", "b".repeat(50), null);

    expect(store.getText("summary", "old")).toBeNull();
    expect(store.getText("summary", "new")).toBe("b".repeat(50));

    store.close();
  });

  it("namespaces transcript cache by namespace", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({
      path,
      maxBytes: 1024 * 1024,
      transcriptNamespace: "yt:web",
    });

    await store.transcriptCache.set({
      url: "https://example.com/video",
      service: "youtube",
      resourceKey: "abc123",
      ttlMs: 1000,
      content: "hello",
      source: "youtubei",
      metadata: null,
    });

    const hit = await store.transcriptCache.get({ url: "https://example.com/video" });
    store.close();

    const otherStore = await createCacheStore({
      path,
      maxBytes: 1024 * 1024,
      transcriptNamespace: "yt:yt-dlp",
    });
    const miss = await otherStore.transcriptCache.get({ url: "https://example.com/video" });

    expect(hit?.content).toBe("hello");
    expect(miss).toBeNull();

    otherStore.close();
  });

  it("transcript cache normalizes unknown sources and handles bad payloads", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({
      path,
      maxBytes: 1024 * 1024,
      transcriptNamespace: "yt:web",
    });

    const url = "https://example.com/video";
    const key = buildTranscriptCacheKey({ url, namespace: "yt:web" });

    store.setJson(
      "transcript",
      key,
      {
        content: "hello",
        source: "definitely-not-a-real-source",
        metadata: null,
      },
      null,
    );

    const normalized = await store.transcriptCache.get({ url });
    expect(normalized?.content).toBe("hello");
    expect(normalized?.source).toBeNull();
    expect(normalized?.expired).toBe(false);

    store.setText("transcript", key, "{", null);
    const badPayload = await store.transcriptCache.get({ url });
    expect(badPayload?.content).toBeNull();
    expect(badPayload?.source).toBeNull();

    store.clear();
    expect(await store.transcriptCache.get({ url })).toBeNull();

    store.close();
  });
});
