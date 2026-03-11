export type Attachment = {
  kind: "text" | "image" | "document";
  mediaType: string;
  bytes: Uint8Array;
  filename: string | null;
};
