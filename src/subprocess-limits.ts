export type LimitedSubprocessLaunch = {
  command: string;
  args: string[];
};

function boundedInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.ceil(value)));
}

export function prepareResourceLimitedCommand({
  command,
  args,
  timeoutMs,
  memoryLimitMb = 4096,
  fileSizeLimitMb = null,
}: {
  command: string;
  args: string[];
  timeoutMs: number;
  memoryLimitMb?: number;
  fileSizeLimitMb?: number | null;
}): LimitedSubprocessLaunch {
  if (process.platform === "win32") return { command, args };

  const cpuSeconds = boundedInteger(timeoutMs / 1000 + 5, 10, 600);
  const memoryKb = boundedInteger(memoryLimitMb * 1024, 256 * 1024, 16 * 1024 * 1024);
  // macOS processes reserve very large, runtime-dependent virtual address ranges, so
  // RLIMIT_AS cannot express a useful portable limit there. A static watchdog caps
  // resident memory for the exec-preserved PID instead. Linux can use RLIMIT_AS.
  const memoryLimitCommands =
    process.platform === "darwin"
      ? [
          `memory_limit_kb=${memoryKb}`,
          "memory_watchdog_target=$$",
          "(",
          '  while kill -0 "$memory_watchdog_target" 2>/dev/null; do',
          '    rss_kb=$(/bin/ps -o rss= -p "$memory_watchdog_target" 2>/dev/null) || exit 0',
          '    [ -n "$rss_kb" ] || exit 0',
          '    if [ "$rss_kb" -gt "$memory_limit_kb" ]; then',
          '      kill -KILL "$memory_watchdog_target" 2>/dev/null || true',
          "      exit 0",
          "    fi",
          "    /bin/sleep 0.1",
          "  done",
          ") </dev/null >/dev/null 2>&1 &",
        ]
      : [`ulimit -v ${memoryKb} 2>/dev/null || exit 125`];
  const script = [
    `ulimit -t ${cpuSeconds} 2>/dev/null || exit 125`,
    ...memoryLimitCommands,
    ...(typeof fileSizeLimitMb === "number"
      ? [
          `ulimit -f ${boundedInteger(fileSizeLimitMb * 2048, 2048, 2 * 1024 * 1024)} 2>/dev/null || exit 125`,
        ]
      : []),
    "ulimit -n 256 2>/dev/null || exit 125",
    "ulimit -u 128 2>/dev/null || exit 125",
    'exec "$@"',
  ].join("\n");
  return {
    command: "/bin/sh",
    args: ["-c", script, "summarize-subprocess-limit", command, ...args],
  };
}
