import type { ProcessHandle } from "../processes.js";
import { spawnTracked } from "../processes.js";
import { prepareResourceLimitedCommand } from "../subprocess-limits.js";

export const MAX_SUBPROCESS_TEXT_BYTES = 16 * 1024 * 1024;
export const MAX_SUBPROCESS_BINARY_BYTES = 64 * 1024 * 1024;

export async function runProcess({
  command,
  args,
  timeoutMs,
  errorLabel,
  onStderrLine,
  onStdoutLine,
}: {
  command: string;
  args: string[];
  timeoutMs: number;
  errorLabel: string;
  onStderrLine?: (line: string, handle: ProcessHandle | null) => void;
  onStdoutLine?: (line: string, handle: ProcessHandle | null) => void;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const launch = prepareResourceLimitedCommand({ command, args, timeoutMs });
    const { proc, handle } = spawnTracked(launch.command, launch.args, {
      stdio: ["ignore", "pipe", "pipe"],
      label: errorLabel,
      kind: errorLabel,
      captureOutput: false,
    });
    let stderr = "";
    let stderrBuffer = "";
    let stdoutBuffer = "";
    let outputBytes = 0;
    const enforceOutputLimit = (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes <= MAX_SUBPROCESS_TEXT_BYTES) return true;
      proc.kill("SIGKILL");
      reject(new Error(`${errorLabel} exceeded output limit`));
      return false;
    };

    const flushLine = (line: string) => {
      onStderrLine?.(line, handle);
      handle?.appendOutput("stderr", line);
      if (stderr.length < 8192) {
        stderr += line;
        if (!line.endsWith("\n")) stderr += "\n";
      }
    };

    if (proc.stderr) {
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk: string) => {
        if (!enforceOutputLimit(chunk)) return;
        stderrBuffer += chunk;
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line) flushLine(line);
        }
      });
    }

    if (proc.stdout) {
      const handleStdoutLine = onStdoutLine ?? onStderrLine;
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        if (!enforceOutputLimit(chunk)) return;
        if (handleStdoutLine) {
          stdoutBuffer += chunk;
          const lines = stdoutBuffer.split(/\r?\n/);
          stdoutBuffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line) continue;
            handleStdoutLine(line, handle);
            handle?.appendOutput("stdout", line);
          }
        }
      });
    }

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${errorLabel} timed out`));
    }, timeoutMs);

    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (stderrBuffer.trim().length > 0) flushLine(stderrBuffer.trim());
      if (stdoutBuffer.trim().length > 0) {
        const handleStdoutLine = onStdoutLine ?? onStderrLine;
        if (handleStdoutLine) handleStdoutLine(stdoutBuffer.trim(), handle);
        handle?.appendOutput("stdout", stdoutBuffer.trim());
      }
      if (code === 0) {
        resolve();
        return;
      }
      const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
      reject(new Error(`${errorLabel} exited with code ${code}${suffix}`));
    });
  });
}

export async function runProcessCapture({
  command,
  args,
  timeoutMs,
  errorLabel,
}: {
  command: string;
  args: string[];
  timeoutMs: number;
  errorLabel: string;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const launch = prepareResourceLimitedCommand({ command, args, timeoutMs });
    const { proc, handle } = spawnTracked(launch.command, launch.args, {
      stdio: ["ignore", "pipe", "pipe"],
      label: errorLabel,
      kind: errorLabel,
      captureOutput: false,
    });
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let outputBytes = 0;
    const enforceOutputLimit = (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes <= MAX_SUBPROCESS_TEXT_BYTES) return true;
      proc.kill("SIGKILL");
      reject(new Error(`${errorLabel} exceeded output limit`));
      return false;
    };

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${errorLabel} timed out`));
    }, timeoutMs);

    if (proc.stdout) {
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        if (!enforceOutputLimit(chunk)) return;
        stdout += chunk;
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line) handle?.appendOutput("stdout", line);
        }
      });
    }

    if (proc.stderr) {
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk: string) => {
        if (!enforceOutputLimit(chunk)) return;
        if (stderr.length < 8192) stderr += chunk;
        stderrBuffer += chunk;
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line) handle?.appendOutput("stderr", line);
        }
      });
    }

    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (stdoutBuffer.trim()) handle?.appendOutput("stdout", stdoutBuffer.trim());
      if (stderrBuffer.trim()) handle?.appendOutput("stderr", stderrBuffer.trim());
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
      reject(new Error(`${errorLabel} exited with code ${code}${suffix}`));
    });
  });
}

export async function runProcessCaptureBuffer({
  command,
  args,
  timeoutMs,
  errorLabel,
}: {
  command: string;
  args: string[];
  timeoutMs: number;
  errorLabel: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const launch = prepareResourceLimitedCommand({ command, args, timeoutMs });
    const { proc, handle } = spawnTracked(launch.command, launch.args, {
      stdio: ["ignore", "pipe", "pipe"],
      label: errorLabel,
      kind: errorLabel,
      captureOutput: false,
    });
    const chunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let stderrBuffer = "";
    let stderrBytes = 0;

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${errorLabel} timed out`));
    }, timeoutMs);

    if (proc.stdout) {
      proc.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > MAX_SUBPROCESS_BINARY_BYTES) {
          proc.kill("SIGKILL");
          reject(new Error(`${errorLabel} exceeded binary output limit`));
          return;
        }
        chunks.push(chunk);
      });
    }

    if (proc.stderr) {
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk: string) => {
        stderrBytes += Buffer.byteLength(chunk);
        if (stderrBytes > MAX_SUBPROCESS_TEXT_BYTES) {
          proc.kill("SIGKILL");
          reject(new Error(`${errorLabel} exceeded stderr output limit`));
          return;
        }
        if (stderr.length < 8192) stderr += chunk;
        stderrBuffer += chunk;
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line) handle?.appendOutput("stderr", line);
        }
      });
    }

    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (stderrBuffer.trim()) handle?.appendOutput("stderr", stderrBuffer.trim());
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
      reject(new Error(`${errorLabel} exited with code ${code}${suffix}`));
    });
  });
}

export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  workers: number,
  onProgress?: ((completed: number, total: number) => void) | null,
): Promise<T[]> {
  if (tasks.length === 0) return [];
  const concurrency = Math.max(1, Math.min(16, Math.round(workers)));
  const results: T[] = new Array(tasks.length);
  const total = tasks.length;
  let completed = 0;
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const current = nextIndex;
      if (current >= tasks.length) return;
      nextIndex += 1;
      try {
        results[current] = await tasks[current]();
      } finally {
        completed += 1;
        onProgress?.(completed, total);
      }
    }
  };

  const runners = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(runners);
  return results;
}
