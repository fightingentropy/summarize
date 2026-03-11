import type { Prompt } from "../../src/llm/prompt.js";

export function buildDocumentPrompt({
  text,
  bytes,
  mediaType = "application/pdf",
  filename = "document.pdf",
}: {
  text: string;
  bytes: Uint8Array;
  mediaType?: string;
  filename?: string;
}): Prompt {
  return {
    userText: text,
    attachments: [
      {
        kind: "document",
        bytes,
        mediaType,
        filename,
      },
    ],
  };
}
