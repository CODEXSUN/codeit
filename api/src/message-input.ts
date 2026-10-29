import { z } from "zod";
import { selectionSchema } from "./providers.js";

const maxTextBytes = 1024 * 1024;
const maxImageBytes = 5 * 1024 * 1024;
const maxOcrBytes = 100 * 1024;
const bytesWithin = (value: string, limit: number) => Buffer.byteLength(value, "utf8") <= limit;

const attachmentSchema = z.discriminatedUnion("kind", [
  z.object({ name: z.string().min(1).max(255), kind: z.literal("text"), content: z.string().refine((value) => bytesWithin(value, maxTextBytes), "Text file exceeds 1 MiB.") }),
  z.object({
    name: z.string().min(1).max(255),
    kind: z.literal("image"),
    content: z.string().refine(validImage, "Image must be a PNG, JPEG, GIF, or WebP data URL up to 5 MiB."),
    ocrText: z.string().refine((value) => bytesWithin(value, maxOcrBytes), "OCR text exceeds 100 KiB.").optional(),
  }),
]);

export const messageSchema = z.object({
  text: z.string().refine((value) => bytesWithin(value, maxTextBytes), "Message exceeds 1 MiB."),
  attachments: z.array(attachmentSchema).max(5, "Attach at most 5 files.").default([]),
  selection: selectionSchema,
}).refine((value) => value.text.trim().length > 0 || value.attachments.length > 0, "Enter a message or add an attachment.");

export type MessageInput = z.infer<typeof messageSchema>;

function validImage(value: string) {
  const match = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1].length % 4 !== 0) return false;
  const data = Buffer.from(match[1], "base64");
  return data.length > 0 && data.length <= maxImageBytes && data.toString("base64") === match[1];
}
