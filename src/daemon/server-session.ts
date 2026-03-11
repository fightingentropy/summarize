import http from "node:http";
import { encodeSseEvent, type SseEvent, type SseSlidesData } from "../shared/sse-events.js";
import type { SlideExtractionResult } from "../slides/index.js";

export type SessionEvent = SseEvent;

export type Session = {
  id: string;
  createdAtMs: number;
  buffer: Array<{ event: SessionEvent; bytes: number }>;
  bufferBytes: number;
  done: boolean;
  clients: Set<http.ServerResponse>;
  slidesBuffer: Array<{ event: SessionEvent; bytes: number }>;
  slidesBufferBytes: number;
  slidesClients: Set<http.ServerResponse>;
  slidesDone: boolean;
  slidesRequested: boolean;
  slidesLastStatus: string | null;
  lastMeta: {
    model: string | null;
    modelLabel: string | null;
    inputSummary: string | null;
    summaryFromCache: boolean | null;
    wordCount: number | null;
    totalCharacters: number | null;
    transcriptSource: string | null;
    transcriptionProvider: string | null;
    transcriptCharacters: number | null;
    transcriptWordCount: number | null;
    transcriptLines: number | null;
    transcriptTimedText: string | null;
    mediaDurationSeconds: number | null;
  };
  slides: SlideExtractionResult | null;
};

const MAX_SESSION_BUFFER_BYTES = 1_000_000;
const SESSION_TTL_MS = 15 * 60 * 1000;

export function createSession(idFactory: () => string): Session {
  return {
    id: idFactory(),
    createdAtMs: Date.now(),
    buffer: [],
    bufferBytes: 0,
    done: false,
    clients: new Set(),
    slidesBuffer: [],
    slidesBufferBytes: 0,
    slidesClients: new Set(),
    slidesDone: false,
    slidesRequested: false,
    slidesLastStatus: null,
    lastMeta: {
      model: null,
      modelLabel: null,
      inputSummary: null,
      summaryFromCache: null,
      wordCount: null,
      totalCharacters: null,
      transcriptSource: null,
      transcriptionProvider: null,
      transcriptCharacters: null,
      transcriptWordCount: null,
      transcriptLines: null,
      transcriptTimedText: null,
      mediaDurationSeconds: null,
    },
    slides: null,
  };
}

function pushBuffered(
  target: Array<{ event: SessionEvent; bytes: number }>,
  sessionBytes: { current: number },
  event: SessionEvent,
) {
  const encoded = encodeSseEvent(event);
  const entry = { event, bytes: Buffer.byteLength(encoded) };
  target.push(entry);
  sessionBytes.current += entry.bytes;
  while (sessionBytes.current > MAX_SESSION_BUFFER_BYTES && target.length > 0) {
    const removed = target.shift();
    if (!removed) break;
    sessionBytes.current -= removed.bytes;
  }
}

export function pushToSession(
  session: Session,
  event: SessionEvent,
  onSessionEvent?: ((event: SessionEvent, sessionId: string) => void) | null,
) {
  if (session.done) return;
  pushBuffered(
    session.buffer,
    {
      get current() {
        return session.bufferBytes;
      },
      set current(v) {
        session.bufferBytes = v;
      },
    },
    event,
  );
  const encoded = encodeSseEvent(event);
  for (const client of Array.from(session.clients)) client.write(encoded);
  onSessionEvent?.(event, session.id);
  if (event.event === "done" || event.event === "error") session.done = true;
}

export function pushSlidesToSession(
  session: Session,
  event: SessionEvent,
  onSessionEvent?: ((event: SessionEvent, sessionId: string) => void) | null,
) {
  pushBuffered(
    session.slidesBuffer,
    {
      get current() {
        return session.slidesBufferBytes;
      },
      set current(v) {
        session.slidesBufferBytes = v;
      },
    },
    event,
  );
  const encoded = encodeSseEvent(event);
  for (const client of Array.from(session.slidesClients)) client.write(encoded);
  onSessionEvent?.(event, session.id);
  if (event.event === "done" || event.event === "error") session.slidesDone = true;
  if (event.event === "status") session.slidesLastStatus = event.data.text;
}

export function emitMeta(
  session: Session,
  data: {
    model?: string | null;
    modelLabel?: string | null;
    inputSummary?: string | null;
    summaryFromCache?: boolean | null;
    wordCount?: number | null;
    totalCharacters?: number | null;
    transcriptSource?: string | null;
    transcriptionProvider?: string | null;
    transcriptCharacters?: number | null;
    transcriptWordCount?: number | null;
    transcriptLines?: number | null;
    transcriptTimedText?: string | null;
    mediaDurationSeconds?: number | null;
  },
  onSessionEvent?: ((event: SessionEvent, sessionId: string) => void) | null,
) {
  session.lastMeta = {
    model: typeof data.model === "string" ? data.model : session.lastMeta.model,
    modelLabel: typeof data.modelLabel === "string" ? data.modelLabel : session.lastMeta.modelLabel,
    inputSummary:
      typeof data.inputSummary === "string" ? data.inputSummary : session.lastMeta.inputSummary,
    summaryFromCache:
      typeof data.summaryFromCache === "boolean"
        ? data.summaryFromCache
        : session.lastMeta.summaryFromCache,
    wordCount: typeof data.wordCount === "number" ? data.wordCount : session.lastMeta.wordCount,
    totalCharacters:
      typeof data.totalCharacters === "number"
        ? data.totalCharacters
        : session.lastMeta.totalCharacters,
    transcriptSource:
      typeof data.transcriptSource === "string"
        ? data.transcriptSource
        : session.lastMeta.transcriptSource,
    transcriptionProvider:
      typeof data.transcriptionProvider === "string"
        ? data.transcriptionProvider
        : session.lastMeta.transcriptionProvider,
    transcriptCharacters:
      typeof data.transcriptCharacters === "number"
        ? data.transcriptCharacters
        : session.lastMeta.transcriptCharacters,
    transcriptWordCount:
      typeof data.transcriptWordCount === "number"
        ? data.transcriptWordCount
        : session.lastMeta.transcriptWordCount,
    transcriptLines:
      typeof data.transcriptLines === "number"
        ? data.transcriptLines
        : session.lastMeta.transcriptLines,
    transcriptTimedText:
      typeof data.transcriptTimedText === "string"
        ? data.transcriptTimedText
        : session.lastMeta.transcriptTimedText,
    mediaDurationSeconds:
      typeof data.mediaDurationSeconds === "number"
        ? data.mediaDurationSeconds
        : session.lastMeta.mediaDurationSeconds,
  };
  pushToSession(session, { event: "meta", data: session.lastMeta }, onSessionEvent);
}

export function emitSlides(
  session: Session,
  data: SseSlidesData,
  onSessionEvent?: ((event: SessionEvent, sessionId: string) => void) | null,
) {
  pushToSession(session, { event: "slides", data }, onSessionEvent);
  pushSlidesToSession(session, { event: "slides", data }, onSessionEvent);
}

export function emitSlidesStatus(
  session: Session,
  text: string,
  onSessionEvent?: ((event: SessionEvent, sessionId: string) => void) | null,
) {
  const trimmed = text.trim();
  if (!trimmed) return;
  pushSlidesToSession(session, { event: "status", data: { text: trimmed } }, onSessionEvent);
}

export function emitSlidesDone(
  session: Session,
  result: { ok: boolean; error?: string | null },
  onSessionEvent?: ((event: SessionEvent, sessionId: string) => void) | null,
) {
  if (!result.ok) {
    const message = result.error?.trim() || "Slides failed.";
    pushSlidesToSession(session, { event: "error", data: { message } }, onSessionEvent);
  }
  pushSlidesToSession(session, { event: "done", data: {} }, onSessionEvent);
}

export function endSession(session: Session) {
  for (const client of Array.from(session.clients)) client.end();
  for (const client of Array.from(session.slidesClients)) client.end();
  session.clients.clear();
  session.slidesClients.clear();
}

export function scheduleSessionCleanup({
  sessions,
  refreshSessions,
  session,
}: {
  sessions: Map<string, Session>;
  refreshSessions: Map<string, Session>;
  session: Session;
}) {
  setTimeout(() => {
    sessions.delete(session.id);
    refreshSessions.delete(session.id);
    endSession(session);
  }, SESSION_TTL_MS).unref();
}
