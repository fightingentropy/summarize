import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildCliEnvironment,
  CLI_MAX_OUTPUT_BYTES,
  createCliSandbox,
  prepareSandboxedLaunch,
  safeCliAttachmentFilename,
} from "../src/llm/cli-sandbox.js";

const execFileAsync = promisify(execFile);

describe("CLI sandbox", () => {
  it("uses private directories and a provider-specific environment allowlist", async () => {
    const sandbox = await createCliSandbox();
    try {
      const stat = await fs.stat(sandbox.rootDir);
      expect(stat.mode & 0o777).toBe(0o700);

      const env = buildCliEnvironment({
        provider: "codex",
        sourceEnv: {
          PATH: "/usr/bin:/bin",
          OPENAI_API_KEY: "allowed",
          ANTHROPIC_API_KEY: "wrong-provider",
          AWS_SECRET_ACCESS_KEY: "canary-secret",
          HOME: "/private/original-home",
        },
        sandbox,
      });

      expect(env.OPENAI_API_KEY).toBe("allowed");
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(env.HOME).toBe(sandbox.homeDir);
      expect(env.HOME).not.toBe("/private/original-home");
      expect(CLI_MAX_OUTPUT_BYTES).toBe(8 * 1024 * 1024);
    } finally {
      await sandbox.cleanup();
    }
  });

  it("keeps only each provider's credentials and normalizes staged filenames", async () => {
    const sandbox = await createCliSandbox();
    try {
      const sourceEnv = {
        PATH: "/usr/bin:/bin",
        LANG: "en_GB.UTF-8",
        ANTHROPIC_API_KEY: "anthropic",
        GEMINI_API_KEY: "gemini",
        CURSOR_API_KEY: "cursor",
        EMPTY_VALUE: "",
      };
      expect(
        buildCliEnvironment({ provider: "claude", sourceEnv, sandbox }).ANTHROPIC_API_KEY,
      ).toBe("anthropic");
      const geminiEnv = buildCliEnvironment({ provider: "gemini", sourceEnv, sandbox });
      expect(geminiEnv.GEMINI_API_KEY).toBe("gemini");
      expect(geminiEnv.GEMINI_CLI_NO_RELAUNCH).toBe("true");
      expect(buildCliEnvironment({ provider: "agent", sourceEnv, sandbox }).CURSOR_API_KEY).toBe(
        "cursor",
      );
      expect(geminiEnv.EMPTY_VALUE).toBeUndefined();

      expect(safeCliAttachmentFilename("../../unsafe name?.pdf", ".bin")).toBe("unsafe-name-.pdf");
      expect(safeCliAttachmentFilename(null, ".png")).toBe("asset.png");
      expect(safeCliAttachmentFilename("...", ".txt")).toBe("asset.txt");
      expect(safeCliAttachmentFilename("x".repeat(200), ".txt")).toHaveLength(120);
    } finally {
      await sandbox.cleanup();
    }
  });

  it("constructs a fail-closed Linux bubblewrap launch", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const sandbox = await createCliSandbox();
    Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
    try {
      const systemLaunch = await prepareSandboxedLaunch({
        binary: "/bin/sh",
        args: ["-c", "true"],
        env: { PATH: "/usr/bin:/bin" },
        sandbox,
        timeoutMs: 12_000,
      });
      expect(systemLaunch.cmd).toBe("bwrap");
      expect(systemLaunch.args).toContain("--unshare-all");
      expect(systemLaunch.args).toContain("--share-net");
      expect(systemLaunch.args).toContain(sandbox.rootDir);

      const customLaunch = await prepareSandboxedLaunch({
        binary: "/private/provider/bin/tool",
        args: [],
        env: { PATH: "" },
        sandbox,
      });
      expect(customLaunch.args).toContain("/private/provider/bin");

      await expect(
        prepareSandboxedLaunch({
          binary: "missing-provider",
          args: [],
          env: { PATH: "" },
          sandbox,
        }),
      ).rejects.toThrow(/Could not resolve CLI provider binary/);
    } finally {
      if (descriptor) Object.defineProperty(process, "platform", descriptor);
      await sandbox.cleanup();
    }
  });

  it("rejects platforms without a supported operating-system sandbox", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const sandbox = await createCliSandbox();
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
    try {
      await expect(
        prepareSandboxedLaunch({ binary: "provider", args: [], env: {}, sandbox }),
      ).rejects.toThrow(/win32 is unsupported/);
    } finally {
      if (descriptor) Object.defineProperty(process, "platform", descriptor);
      await sandbox.cleanup();
    }
  });

  it.skipIf(
    process.platform !== "darwin" &&
      !(process.platform === "linux" && existsSync("/usr/bin/bwrap")),
  )("allows staged input but blocks a canary outside the OS sandbox", async () => {
    const sandbox = await createCliSandbox();
    const outsideDir = await fs.mkdtemp(path.join(tmpdir(), "summarize-canary-"));
    const insidePath = path.join(sandbox.workDir, "inside.txt");
    const outsidePath = path.join(outsideDir, "outside.txt");
    await fs.writeFile(insidePath, "inside", { mode: 0o600 });
    await fs.writeFile(outsidePath, "outside-canary", { mode: 0o600 });

    try {
      const insideLaunch = await prepareSandboxedLaunch({
        binary: "/bin/sh",
        args: ["-c", 'cat "$1"', "sh", insidePath],
        env: { PATH: "/usr/bin:/bin" },
        sandbox,
      });
      const inside = await execFileAsync(insideLaunch.cmd, insideLaunch.args, {
        cwd: sandbox.workDir,
        env: buildCliEnvironment({
          provider: "codex",
          sourceEnv: { PATH: "/usr/bin:/bin" },
          sandbox,
        }),
        maxBuffer: CLI_MAX_OUTPUT_BYTES,
      });
      expect(inside.stdout.trim()).toBe("inside");

      const outsideLaunch = await prepareSandboxedLaunch({
        binary: "/bin/sh",
        args: ["-c", 'cat "$1"', "sh", outsidePath],
        env: { PATH: "/usr/bin:/bin" },
        sandbox,
      });
      await expect(
        execFileAsync(outsideLaunch.cmd, outsideLaunch.args, {
          cwd: sandbox.workDir,
          env: buildCliEnvironment({
            provider: "codex",
            sourceEnv: { PATH: "/usr/bin:/bin" },
            sandbox,
          }),
          maxBuffer: CLI_MAX_OUTPUT_BYTES,
        }),
      ).rejects.toThrow();
    } finally {
      await sandbox.cleanup();
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
