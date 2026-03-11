type RequestHeaders = Record<string, string>;

export function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

export function withBunCompressionHeaders(headers: RequestHeaders): RequestHeaders {
  if (!isBunRuntime()) {
    return { ...headers };
  }
  return { ...headers, "Accept-Encoding": "gzip, deflate" };
}

export function withBunIdentityEncoding(headers: RequestHeaders): RequestHeaders {
  return { ...headers, "Accept-Encoding": "identity" };
}

export function isBunCompressedResponseError(error: unknown): boolean {
  if (!isBunRuntime() || !(error instanceof Error)) return false;
  const message = error.message;
  return (
    message.includes("ZlibError") ||
    message.includes("ShortRead") ||
    message.includes("Decompression error")
  );
}
