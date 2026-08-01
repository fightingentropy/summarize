import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CliProvider } from "../config.js";
import { prepareResourceLimitedCommand } from "../subprocess-limits.js";

export const CLI_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export type CliSandbox = {
  rootDir: string;
  workDir: string;
  homeDir: string;
  tempDir: string;
  profilePath: string | null;
  cleanup: () => Promise<void>;
};

const COMMON_ENV_KEYS = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "FORCE_COLOR",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

const PROVIDER_ENV_KEYS: Record<CliProvider, readonly string[]> = {
  claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"],
  codex: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
  gemini: [
    "GEMINI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_BASE_URL",
    "GEMINI_BASE_URL",
  ],
  agent: ["CURSOR_API_KEY", "CURSOR_API_ENDPOINT"],
};

function copyNonEmpty(
  target: Record<string, string>,
  source: Record<string, string | undefined>,
  keys: readonly string[],
) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) target[key] = value;
  }
}

export function buildCliEnvironment({
  provider,
  sourceEnv,
  sandbox,
}: {
  provider: CliProvider;
  sourceEnv: Record<string, string | undefined>;
  sandbox: CliSandbox;
}): Record<string, string> {
  const env: Record<string, string> = {};
  copyNonEmpty(env, sourceEnv, COMMON_ENV_KEYS);
  copyNonEmpty(env, sourceEnv, PROVIDER_ENV_KEYS[provider]);
  env.HOME = sandbox.homeDir;
  env.USERPROFILE = sandbox.homeDir;
  env.TMPDIR = sandbox.tempDir;
  env.TMP = sandbox.tempDir;
  env.TEMP = sandbox.tempDir;
  env.XDG_CONFIG_HOME = path.join(sandbox.homeDir, ".config");
  env.XDG_CACHE_HOME = path.join(sandbox.homeDir, ".cache");
  env.XDG_DATA_HOME = path.join(sandbox.homeDir, ".local", "share");
  if (provider === "gemini") env.GEMINI_CLI_NO_RELAUNCH = "true";
  return env;
}

function quoteSeatbeltPath(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function resolveExecutablePath(binary: string, env: Record<string, string | undefined>) {
  if (path.isAbsolute(binary)) {
    try {
      return await fs.realpath(binary);
    } catch {
      return binary;
    }
  }
  const pathEntries = (env.PATH ?? process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, binary);
    if (!existsSync(candidate)) continue;
    try {
      return await fs.realpath(candidate);
    } catch {
      return candidate;
    }
  }
  return binary;
}

async function writeMacSandboxProfile({
  sandbox,
  binary,
  env,
}: {
  sandbox: CliSandbox;
  binary: string;
  env: Record<string, string | undefined>;
}): Promise<string | null> {
  if (process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec")) return null;
  const executablePath = await resolveExecutablePath(binary, env);
  const executableDir = path.isAbsolute(executablePath) ? path.dirname(executablePath) : null;
  const allowReadPaths = [
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/Library",
    "/private/etc",
    "/etc",
    "/opt/homebrew",
    "/usr/local",
    sandbox.rootDir,
    ...(executableDir ? [executableDir] : []),
  ];
  const readRules = allowReadPaths
    .map((entry) => `  (subpath "${quoteSeatbeltPath(entry)}")`)
    .join("\n");
  const profile = `(version 1)
(deny default)
(import "system.sb")
(allow process*)
(allow network*)
(allow sysctl-read)
(allow mach-lookup)
(allow file-read-metadata)
(allow file-read*
${readRules})
(allow file-write*
  (subpath "${quoteSeatbeltPath(sandbox.rootDir)}"))
`;
  const profilePath = path.join(sandbox.rootDir, "sandbox.sb");
  await fs.writeFile(profilePath, profile, { mode: 0o600, flag: "w" });
  sandbox.profilePath = profilePath;
  return profilePath;
}

export async function createCliSandbox(): Promise<CliSandbox> {
  const createdRootDir = await fs.mkdtemp(path.join(tmpdir(), "summarize-cli-"));
  const rootDir = await fs.realpath(createdRootDir).catch(() => createdRootDir);
  await fs.chmod(rootDir, 0o700);
  const workDir = path.join(rootDir, "work");
  const homeDir = path.join(rootDir, "home");
  const tempDir = path.join(rootDir, "tmp");
  await Promise.all(
    [workDir, homeDir, tempDir].map((directory) =>
      fs.mkdir(directory, { recursive: true, mode: 0o700 }),
    ),
  );
  const sandbox: CliSandbox = {
    rootDir,
    workDir,
    homeDir,
    tempDir,
    profilePath: null,
    cleanup: async () => {
      await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
    },
  };
  return sandbox;
}

export async function prepareSandboxedLaunch({
  binary,
  args,
  env,
  sandbox,
  timeoutMs = 600_000,
}: {
  binary: string;
  args: string[];
  env: Record<string, string | undefined>;
  sandbox: CliSandbox;
  timeoutMs?: number;
}): Promise<{ cmd: string; args: string[] }> {
  if (process.platform === "darwin") {
    const profilePath = await writeMacSandboxProfile({ sandbox, binary, env });
    if (!profilePath) {
      throw new Error("Agentic CLI providers require macOS sandbox-exec on this platform.");
    }
    // Apply resource limits before entering Seatbelt. The macOS memory-growth
    // calculation needs `ps`, which the final provider sandbox intentionally denies.
    const limited = prepareResourceLimitedCommand({
      command: "/usr/bin/sandbox-exec",
      args: ["-f", profilePath, binary, ...args],
      timeoutMs,
      memoryLimitMb: 6144,
      fileSizeLimitMb: 128,
    });
    return {
      cmd: limited.command,
      args: limited.args,
    };
  }

  if (process.platform === "linux") {
    const executablePath = await resolveExecutablePath(binary, env);
    if (!path.isAbsolute(executablePath)) {
      throw new Error(`Could not resolve CLI provider binary for sandboxing: ${binary}`);
    }
    const executableDir = path.dirname(executablePath);
    const systemPaths = ["/usr", "/bin", "/lib", "/lib64", "/etc", "/opt"].filter((entry) =>
      existsSync(entry),
    );
    const executableCovered = systemPaths.some(
      (entry) => executableDir === entry || executableDir.startsWith(`${entry}/`),
    );
    const mounts = systemPaths.flatMap((entry) => ["--ro-bind", entry, entry]);
    if (!executableCovered) mounts.push("--ro-bind", executableDir, executableDir);
    const limited = prepareResourceLimitedCommand({
      command: executablePath,
      args,
      timeoutMs,
      memoryLimitMb: 6144,
      fileSizeLimitMb: 128,
    });
    return {
      cmd: "bwrap",
      args: [
        "--die-with-parent",
        "--new-session",
        "--unshare-all",
        "--share-net",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--tmpfs",
        "/tmp",
        ...mounts,
        "--bind",
        sandbox.rootDir,
        sandbox.rootDir,
        "--chdir",
        sandbox.workDir,
        limited.command,
        ...limited.args,
      ],
    };
  }

  throw new Error(
    `Agentic CLI providers require a supported OS sandbox (macOS sandbox-exec or Linux bubblewrap); ${process.platform} is unsupported.`,
  );
}

export function safeCliAttachmentFilename(filename: string | null, extension: string): string {
  const raw = filename ? path.basename(filename) : `asset${extension}`;
  const sanitized = raw
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return sanitized || `asset${extension}`;
}
