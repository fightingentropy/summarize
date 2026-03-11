import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/run.js";

function collectStream({ isTTY }: { isTTY: boolean }) {
  let text = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  (stream as unknown as { isTTY?: boolean }).isTTY = isTTY;
  (stream as unknown as { columns?: number }).columns = 120;
  return { stream, getText: () => text };
}

function stripOsc(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== "\u001b" || text[i + 1] !== "]") {
      out += ch;
      continue;
    }

    i += 2;
    while (i < text.length) {
      const c = text[i];
      if (c === "\u0007") break;
      if (c === "\u001b" && text[i + 1] === "\\") {
        i += 1;
        break;
      }
      i += 1;
    }
  }
  return out;
}

function stripCsi(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== "\u001b" || text[i + 1] !== "[") {
      out += ch;
      continue;
    }

    i += 2;
    while (i < text.length) {
      const c = text[i];
      if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) break;
      i += 1;
    }
  }
  return out;
}

// Deterministic spinner: write the initial text once; stop/clear are no-ops.
vi.mock("ora", () => {
  const ora = (opts: { text: string; stream: NodeJS.WritableStream }) => {
    let currentText = opts.text;
    const spinner = {
      isSpinning: true,
      get text() {
        return currentText;
      },
      set text(next: string) {
        currentText = next;
        opts.stream.write(`\r${currentText}`);
      },
      stop() {
        spinner.isSpinning = false;
      },
      clear() {},
      start() {
        opts.stream.write(`- ${spinner.text}`);
        return spinner;
      },
    };
    return spinner;
  };
  return { default: ora };
});

describe("cli X status line", () => {
  it("prefers xurl in the status line when both xurl and bird are installed", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-bird-"));
    const binDir = join(root, "bin");
    mkdirSync(binDir, { recursive: true });
    const xurlPath = join(binDir, "xurl");
    const birdPath = join(binDir, "bird");
    writeFileSync(
      xurlPath,
      '#!/bin/sh\necho \'{"data":{"id":"1","text":"Hello from xurl","author_id":"7"},"includes":{"users":[{"id":"7","username":"xurl-user","name":"Xurl"}]}}\'\n',
    );
    writeFileSync(
      birdPath,
      '#!/bin/sh\necho \'{"id":"1","text":"Hello from bird","author":{"username":"birdy","name":"Bird"}}\'\n',
    );
    chmodSync(xurlPath, 0o755);
    chmodSync(birdPath, 0o755);

    const stdout = collectStream({ isTTY: false });
    const stderr = collectStream({ isTTY: true });

    await runCli(["--extract-only", "https://x.com/user/status/123"], {
      env: { HOME: root, PATH: binDir, TERM: "xterm-256color" },
      fetch: vi.fn(async () => {
        throw new Error("unexpected fetch");
      }) as unknown as typeof fetch,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    const rawErr = stderr.getText();
    const plainErr = stripCsi(stripOsc(rawErr));
    expect(plainErr).toContain("Xurl:");
  });
});
