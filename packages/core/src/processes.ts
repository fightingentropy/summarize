import { AsyncLocalStorage } from "node:async_hooks";
import type {
  ChildProcess,
  ExecFileException,
  ExecFileOptions,
  SpawnOptions,
} from "node:child_process";
import { execFile, spawn } from "node:child_process";

export type ProcessContext = {
  runId?: string | null;
  source?: string | null;
};

type ExecFileCallback = (
  error: ExecFileException | null,
  stdout: string | Buffer,
  stderr: string | Buffer,
) => void;

export type ProcessRegistration = {
  command: string;
  args: string[];
  label?: string | null;
  kind?: string | null;
  cwd?: string | null;
  env?: Record<string, string | undefined> | null;
  runId?: string | null;
  source?: string | null;
};

export type ProcessHandle = {
  id: string;
  setPid: (pid: number | null) => void;
  appendOutput: (stream: "stdout" | "stderr", line: string) => void;
  setProgress: (progress: number | null, detail?: string | null) => void;
  setStatus: (text: string | null) => void;
  finish: (result: {
    exitCode: number | null;
    signal: string | null;
    error?: string | null;
  }) => void;
};

export type ProcessObserver = {
  register: (info: ProcessRegistration) => ProcessHandle;
};

export type SpawnTrackedOptions = SpawnOptions & {
  label?: string | null;
  kind?: string | null;
  runId?: string | null;
  source?: string | null;
  captureOutput?: boolean;
};

const processContext = new AsyncLocalStorage<ProcessContext>();
let processObserver: ProcessObserver | null = null;

export function setProcessObserver(next: ProcessObserver | null): void {
  processObserver = next;
}

export function getProcessContext(): ProcessContext {
  return processContext.getStore() ?? {};
}

export function runWithProcessContext<T>(ctx: ProcessContext, fn: () => T): T {
  return processContext.run(ctx, fn);
}

function registerProcess(info: ProcessRegistration): ProcessHandle | null {
  if (!processObserver) return null;
  const ctx = getProcessContext();
  return processObserver.register({
    ...info,
    runId: info.runId ?? ctx.runId ?? null,
    source: info.source ?? ctx.source ?? null,
  });
}

type LineListener = (line: string) => void;

function attachLineReader(stream: NodeJS.ReadableStream | null | undefined, onLine: LineListener) {
  if (!stream) return;
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") continue;
      onLine(line);
    }
  });
  stream.on("end", () => {
    const line = buffer.trim();
    if (line) onLine(line);
    buffer = "";
  });
}

export function trackChildProcess(
  proc: ChildProcess,
  info: ProcessRegistration,
  options?: { captureOutput?: boolean },
): ProcessHandle | null {
  const handle = registerProcess(info);
  if (!handle) return null;
  handle.setPid(proc.pid ?? null);

  const captureOutput = options?.captureOutput !== false;
  if (captureOutput) {
    attachLineReader(proc.stdout, (line) => handle.appendOutput("stdout", line));
    attachLineReader(proc.stderr, (line) => handle.appendOutput("stderr", line));
  }

  let finished = false;
  const finishOnce = (result: {
    exitCode: number | null;
    signal: string | null;
    error?: string | null;
  }) => {
    if (finished) return;
    finished = true;
    handle.finish(result);
  };

  proc.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    finishOnce({ exitCode: null, signal: null, error: message });
  });
  proc.on("close", (code, signal) => {
    finishOnce({ exitCode: code ?? null, signal: signal ?? null });
  });
  return handle;
}

export function spawnTracked(
  command: string,
  args: string[],
  options: SpawnTrackedOptions = {},
): { proc: ChildProcess; handle: ProcessHandle | null } {
  const { label, kind, runId, source, captureOutput, ...spawnOptions } = options;
  const proc = spawn(command, args, spawnOptions);
  const handle = trackChildProcess(
    proc,
    {
      command,
      args,
      label,
      kind,
      runId,
      source,
      cwd: spawnOptions.cwd ? String(spawnOptions.cwd) : null,
      env: spawnOptions.env ?? null,
    },
    { captureOutput },
  );
  return { proc, handle };
}

export function execFileTracked(
  file: string,
  args?: readonly string[] | ExecFileOptions | ExecFileCallback,
  options?: ExecFileOptions | ExecFileCallback,
  callback?: ExecFileCallback,
): ChildProcess {
  let resolvedArgs: readonly string[] = [];
  let resolvedOptions: ExecFileOptions = {};
  let resolvedCallback: ExecFileCallback | undefined;

  if (Array.isArray(args)) {
    resolvedArgs = args;
    if (typeof options === "function") {
      resolvedCallback = options;
    } else {
      resolvedOptions = options ?? {};
      resolvedCallback = callback;
    }
  } else if (typeof args === "function") {
    resolvedCallback = args;
  } else {
    resolvedOptions = (args ?? {}) as ExecFileOptions;
    if (typeof options === "function") {
      resolvedCallback = options;
    }
  }

  const proc = execFile(file, resolvedArgs, resolvedOptions, resolvedCallback as ExecFileCallback);
  trackChildProcess(
    proc,
    {
      command: file,
      args: Array.from(resolvedArgs),
      label: file,
      kind: file,
      cwd: resolvedOptions.cwd ? String(resolvedOptions.cwd) : null,
      env: resolvedOptions.env ?? null,
    },
    { captureOutput: true },
  );
  return proc;
}
