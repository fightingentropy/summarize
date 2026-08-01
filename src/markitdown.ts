import { execFile, type ExecFileOptions } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CLI_MAX_OUTPUT_BYTES } from "./llm/cli-sandbox.js";
import { prepareResourceLimitedCommand } from "./subprocess-limits.js";

export type ExecFileFn = typeof import("node:child_process").execFile;

function buildMarkitdownEnvironment(
  source: Record<string, string | undefined>,
  homeDir: string,
  tempDir: string,
): Record<string, string> {
  const allowed = [
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "COMSPEC",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "UV_INDEX_URL",
    "UV_DEFAULT_INDEX",
  ] as const;
  const env: Record<string, string> = {};
  for (const key of allowed) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }
  env.HOME = homeDir;
  env.USERPROFILE = homeDir;
  env.TMPDIR = tempDir;
  env.TMP = tempDir;
  env.TEMP = tempDir;
  env.XDG_CONFIG_HOME = path.join(homeDir, ".config");
  env.XDG_CACHE_HOME = path.join(homeDir, ".cache");
  return env;
}

function guessExtension({
  filenameHint,
  mediaType,
}: {
  filenameHint: string | null;
  mediaType: string | null;
}): string {
  const ext = filenameHint ? path.extname(filenameHint).toLowerCase() : "";
  if (ext) return ext;
  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") return ".html";
  if (mediaType === "application/pdf") return ".pdf";
  return ".bin";
}

async function execFileText(
  execFileImpl: ExecFileFn,
  cmd: string,
  args: string[],
  options: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    execFileImpl(cmd, args, options, (error, stdout, stderr) => {
      if (error) {
        const stderrText = typeof stderr === "string" ? stderr : stderr.toString("utf8");
        const message = stderrText.trim()
          ? `${error.message}: ${stderrText.trim()}`
          : error.message;
        reject(new Error(message, { cause: error }));
        return;
      }
      const stdoutText = typeof stdout === "string" ? stdout : stdout.toString("utf8");
      const stderrText = typeof stderr === "string" ? stderr : stderr.toString("utf8");
      resolve({ stdout: stdoutText, stderr: stderrText });
    });
  });
}

export async function convertToMarkdownWithMarkitdown({
  bytes,
  filenameHint,
  mediaTypeHint,
  uvxCommand,
  timeoutMs,
  env,
  execFileImpl,
}: {
  bytes: Uint8Array;
  filenameHint: string | null;
  mediaTypeHint: string | null;
  uvxCommand?: string | null;
  timeoutMs: number;
  env: Record<string, string | undefined>;
  execFileImpl: ExecFileFn;
}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "summarize-markitdown-"));
  await fs.chmod(dir, 0o700);
  const homeDir = path.join(dir, "home");
  const tempDir = path.join(dir, "tmp");
  await Promise.all([
    fs.mkdir(homeDir, { recursive: true, mode: 0o700 }),
    fs.mkdir(tempDir, { recursive: true, mode: 0o700 }),
  ]);
  const ext = guessExtension({ filenameHint, mediaType: mediaTypeHint });
  const base = (filenameHint ? path.basename(filenameHint, path.extname(filenameHint)) : "input")
    .replaceAll(/[^\w.-]+/g, "-")
    .slice(0, 64);
  const filePath = path.join(dir, `${base}${ext}`);

  try {
    await fs.writeFile(filePath, bytes, { mode: 0o600, flag: "wx" });
    const from = "markitdown[all]";
    const command = uvxCommand && uvxCommand.trim().length > 0 ? uvxCommand.trim() : "uvx";
    const commandArgs = ["--from", from, "markitdown", filePath];
    const launch =
      execFileImpl === execFile
        ? prepareResourceLimitedCommand({
            command,
            args: commandArgs,
            timeoutMs,
            memoryLimitMb: 4096,
            fileSizeLimitMb: 128,
          })
        : { command, args: commandArgs };
    const { stdout } = await execFileText(execFileImpl, launch.command, launch.args, {
      timeout: timeoutMs,
      cwd: dir,
      env: buildMarkitdownEnvironment(env, homeDir, tempDir),
      maxBuffer: CLI_MAX_OUTPUT_BYTES,
      killSignal: "SIGKILL",
      windowsHide: true,
    });
    const markdown = stdout.trim();
    if (!markdown) {
      throw new Error("markitdown returned empty output");
    }
    return markdown;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
