import { describe, expect, it, vi } from "vitest";

const runCliMainMock = vi.fn(async () => {});

vi.mock("../src/cli-main.js", () => ({
  runCliMain: runCliMainMock,
}));

describe("cli entrypoint", () => {
  it("calls runCliMain with process streams", async () => {
    runCliMainMock.mockClear();
    vi.resetModules();
    const previousExitCode = process.exitCode;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);

    runCliMainMock.mockImplementationOnce(
      async (args: { exit: (code: number) => void; setExitCode: (code: number) => void }) => {
        args.setExitCode(123);
        expect(() => args.exit(0)).toThrow("process.exit(0)");
      },
    );

    await import("../src/cli.js");

    expect(runCliMainMock).toHaveBeenCalledTimes(1);
    const args = runCliMainMock.mock.calls[0]?.[0] as {
      argv: string[];
      stdout: unknown;
      stderr: unknown;
      env: Record<string, string | undefined>;
    };
    expect(Array.isArray(args.argv)).toBe(true);
    expect(args.env).toBe(process.env);
    expect(args.stdout).toBe(process.stdout);
    expect(args.stderr).toBe(process.stderr);
    expect(process.exitCode).toBe(123);
    process.exitCode = previousExitCode;
    exitSpy.mockRestore();
  });

  it("prints a last-resort error when runCliMain rejects", async () => {
    runCliMainMock.mockClear();
    vi.resetModules();

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const previousExitCode = process.exitCode;

    runCliMainMock.mockRejectedValueOnce(new Error("boom"));
    await import("../src/cli.js?reject=1");

    await new Promise((resolve) => setTimeout(resolve, 0));

    const text = stderrWrite.mock.calls.map((args) => String(args[0])).join("");
    expect(text).toContain("boom");
    expect(process.exitCode).toBe(1);

    process.exitCode = previousExitCode;
    stderrWrite.mockRestore();
  });

  it("prints string rejections as-is", async () => {
    runCliMainMock.mockClear();
    vi.resetModules();

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const previousExitCode = process.exitCode;

    runCliMainMock.mockRejectedValueOnce("boom-string");
    await import("../src/cli.js?reject=string");

    await new Promise((resolve) => setTimeout(resolve, 0));

    const text = stderrWrite.mock.calls.map((args) => String(args[0])).join("");
    expect(text).toContain("boom-string");
    expect(process.exitCode).toBe(1);

    process.exitCode = previousExitCode;
    stderrWrite.mockRestore();
  });

  it("prints fallback text for falsy rejections", async () => {
    runCliMainMock.mockClear();
    vi.resetModules();

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const previousExitCode = process.exitCode;

    runCliMainMock.mockRejectedValueOnce(null);
    await import("../src/cli.js?reject=null");

    await new Promise((resolve) => setTimeout(resolve, 0));

    const text = stderrWrite.mock.calls.map((args) => String(args[0])).join("");
    expect(text).toContain("Unknown error");
    expect(process.exitCode).toBe(1);

    process.exitCode = previousExitCode;
    stderrWrite.mockRestore();
  });
});
