export type LinkPreviewProfileValue = string | number | boolean | null;

export type LinkPreviewProfileDetails = Record<string, LinkPreviewProfileValue>;

export interface LinkPreviewProfileEvent {
  name: string;
  durationMs: number;
  ok: boolean;
  url?: string | null;
  details?: LinkPreviewProfileDetails | null;
}

export type LinkPreviewProfileSink = (event: LinkPreviewProfileEvent) => void;

interface MeasureProfileOptions<T> {
  sink: LinkPreviewProfileSink | null | undefined;
  name: string;
  url?: string | null;
  details?: LinkPreviewProfileDetails | null;
  onSuccessDetails?: ((value: T) => LinkPreviewProfileDetails | null | undefined) | null;
  onErrorDetails?: ((error: unknown) => LinkPreviewProfileDetails | null | undefined) | null;
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function mergeDetails(
  ...parts: Array<LinkPreviewProfileDetails | null | undefined>
): LinkPreviewProfileDetails | undefined {
  const merged: LinkPreviewProfileDetails = {};
  for (const part of parts) {
    if (!part) continue;
    for (const [key, value] of Object.entries(part)) {
      merged[key] = value;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function emitProfileEvent(
  sink: LinkPreviewProfileSink | null | undefined,
  event: LinkPreviewProfileEvent,
) {
  if (!sink) return;
  sink(event);
}

export function measureSyncProfile<T>(options: MeasureProfileOptions<T>, fn: () => T): T {
  const startedAt = nowMs();
  try {
    const value = fn();
    emitProfileEvent(options.sink, {
      name: options.name,
      durationMs: nowMs() - startedAt,
      ok: true,
      url: options.url ?? null,
      details: mergeDetails(options.details, options.onSuccessDetails?.(value)),
    });
    return value;
  } catch (error) {
    emitProfileEvent(options.sink, {
      name: options.name,
      durationMs: nowMs() - startedAt,
      ok: false,
      url: options.url ?? null,
      details: mergeDetails(options.details, options.onErrorDetails?.(error)),
    });
    throw error;
  }
}

export async function measureAsyncProfile<T>(
  options: MeasureProfileOptions<T>,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = nowMs();
  try {
    const value = await fn();
    emitProfileEvent(options.sink, {
      name: options.name,
      durationMs: nowMs() - startedAt,
      ok: true,
      url: options.url ?? null,
      details: mergeDetails(options.details, options.onSuccessDetails?.(value)),
    });
    return value;
  } catch (error) {
    emitProfileEvent(options.sink, {
      name: options.name,
      durationMs: nowMs() - startedAt,
      ok: false,
      url: options.url ?? null,
      details: mergeDetails(options.details, options.onErrorDetails?.(error)),
    });
    throw error;
  }
}
