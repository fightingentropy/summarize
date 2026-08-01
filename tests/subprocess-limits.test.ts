import { describe, expect, it } from "vitest";
import { prepareResourceLimitedCommand } from "../src/subprocess-limits.js";

describe("subprocess resource limits", () => {
  it("keeps the command and hostile-looking arguments out of the shell program", () => {
    const hostile = '$(touch /tmp/should-not-run); "quoted"';
    const launch = prepareResourceLimitedCommand({
      command: "/usr/bin/example",
      args: ["--input", hostile],
      timeoutMs: 20_000,
      memoryLimitMb: 1024,
      fileSizeLimitMb: 64,
    });

    if (process.platform === "win32") {
      expect(launch).toEqual({ command: "/usr/bin/example", args: ["--input", hostile] });
      return;
    }

    expect(launch.command).toBe(process.platform === "linux" ? "/bin/bash" : "/bin/sh");
    expect(launch.args[1]).toContain("ulimit -t 25");
    if (process.platform === "darwin") {
      expect(launch.args[1]).toContain("memory_limit_kb=1048576");
      expect(launch.args[1]).toContain('/bin/ps -o rss= -p "$memory_watchdog_target"');
      expect(launch.args[1]).toContain('kill -KILL "$memory_watchdog_target"');
    } else {
      expect(launch.args[1]).toContain("ulimit -v 1048576");
    }
    expect(launch.args[1]).not.toMatch(/ulimit .*\|\| true/);
    expect(launch.args[1]).not.toContain(hostile);
    expect(launch.args.slice(-3)).toEqual(["/usr/bin/example", "--input", hostile]);
  });

  it("bounds extreme values and omits the optional file-size limit", () => {
    const launch = prepareResourceLimitedCommand({
      command: "/usr/bin/example",
      args: [],
      timeoutMs: Number.POSITIVE_INFINITY,
      memoryLimitMb: 1,
    });

    if (process.platform === "win32") return;
    expect(launch.args[1]).toContain("ulimit -t 10");
    if (process.platform === "darwin") {
      expect(launch.args[1]).toContain("memory_limit_kb=262144");
    } else {
      expect(launch.args[1]).toContain("ulimit -v 262144");
    }
    expect(launch.args[1]).not.toContain("ulimit -f");

    const capped = prepareResourceLimitedCommand({
      command: "/usr/bin/example",
      args: [],
      timeoutMs: 99_999_999,
      memoryLimitMb: 99_999,
      fileSizeLimitMb: 99_999,
    });
    expect(capped.args[1]).toContain("ulimit -t 600");
    if (process.platform === "darwin") {
      expect(capped.args[1]).toContain("memory_limit_kb=16777216");
    } else {
      expect(capped.args[1]).toContain("ulimit -v 16777216");
    }
    expect(capped.args[1]).toContain("ulimit -f 2097152");
  });

  it("leaves commands unchanged on Windows", () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
    try {
      expect(
        prepareResourceLimitedCommand({
          command: "example.exe",
          args: ["--input", "file"],
          timeoutMs: 1000,
        }),
      ).toEqual({ command: "example.exe", args: ["--input", "file"] });
    } finally {
      if (descriptor) Object.defineProperty(process, "platform", descriptor);
    }
  });

  it("uses an absolute memory ceiling on Linux", () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
    try {
      const launch = prepareResourceLimitedCommand({
        command: "/usr/bin/example",
        args: [],
        timeoutMs: 1000,
        memoryLimitMb: 512,
      });
      expect(launch.args[1]).toContain("ulimit -v 524288");
      expect(launch.args[1]).not.toContain("memory_watchdog_target");
    } finally {
      if (descriptor) Object.defineProperty(process, "platform", descriptor);
    }
  });
});
