import { describe, expect, it, vi } from "vitest";
import {
  MAX_SUBPROCESS_TEXT_BYTES,
  runProcess,
  runProcessCapture,
  runProcessCaptureBuffer,
  runWithConcurrency,
} from "../src/slides/process.js";

describe("slides process helpers", () => {
  it("returns early for empty task lists", async () => {
    await expect(runWithConcurrency([], 4)).resolves.toEqual([]);
  });

  it("preserves order, clamps workers, and reports progress", async () => {
    const progress = vi.fn();
    const results = await runWithConcurrency(
      [async () => "a", async () => "b", async () => "c"],
      99,
      progress,
    );

    expect(results).toEqual(["a", "b", "c"]);
    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
  });

  it("drains line-oriented stdout and stderr and flushes trailing text", async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    await runProcess({
      command: process.execPath,
      args: [
        "-e",
        'process.stdout.write("out-one\\nout-tail"); process.stderr.write("err-one\\nerr-tail")',
      ],
      timeoutMs: 5_000,
      errorLabel: "line-worker",
      onStdoutLine: (line) => stdoutLines.push(line),
      onStderrLine: (line) => stderrLines.push(line),
    });

    expect(stdoutLines).toEqual(["out-one", "out-tail"]);
    expect(stderrLines).toEqual(["err-one", "err-tail"]);
  });

  it("captures text and binary output and reports command failures", async () => {
    await expect(
      runProcessCapture({
        command: process.execPath,
        args: ["-e", 'process.stdout.write("captured"); process.stderr.write("diagnostic")'],
        timeoutMs: 5_000,
        errorLabel: "capture-worker",
      }),
    ).resolves.toBe("captured");

    await expect(
      runProcessCaptureBuffer({
        command: process.execPath,
        args: ["-e", 'process.stdout.write(Buffer.from([0, 1, 2])); process.stderr.write("note")'],
        timeoutMs: 5_000,
        errorLabel: "binary-worker",
      }),
    ).resolves.toEqual(Buffer.from([0, 1, 2]));

    await expect(
      runProcess({
        command: process.execPath,
        args: ["-e", 'process.stderr.write("bad input"); process.exit(7)'],
        timeoutMs: 5_000,
        errorLabel: "failed-worker",
      }),
    ).rejects.toThrow("failed-worker exited with code 7: bad input");
  });

  it("kills text subprocesses that exceed their output budget", async () => {
    await expect(
      runProcessCapture({
        command: process.execPath,
        args: ["-e", `process.stdout.write("x".repeat(${MAX_SUBPROCESS_TEXT_BYTES + 1}))`],
        timeoutMs: 20_000,
        errorLabel: "noisy-worker",
      }),
    ).rejects.toThrow("noisy-worker exceeded output limit");
  });

  it("kills subprocesses that exceed their elapsed-time budget", async () => {
    await expect(
      runProcessCapture({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1_000)"],
        timeoutMs: 20,
        errorLabel: "slow-worker",
      }),
    ).rejects.toThrow("slow-worker timed out");
  });
});
