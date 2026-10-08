import { z } from "zod";

// Binary uploads stream to R2; these limits do not change the main PDF limits.
export const ATTACHMENT_LIMITS = { audio: 50 * 1024 * 1024, pdf: 20 * 1024 * 1024, markdown: 1024 * 1024, musicxml: 20 * 1024 * 1024 } as const;
export const MAX_SCORE_ATTACHMENTS = 100;
export const ATTACHMENT_ACCEPT = ".mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.pdf,.md,.musicxml,.xml,.mxl";
export const attachmentNameSchema = z.string().trim().min(1).max(255).refine(value => !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "/" || character === "\\") && value !== "." && value !== "..");
export const attachmentUrlSchema = z.url().max(4096).refine(value => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
});
export function safeAttachmentUrl(value: string) {
  return attachmentUrlSchema.safeParse(value).success ? value : "";
}

const formats = {
  musicxml: ["musicxml", "application/vnd.recordare.musicxml+xml"], xml: ["musicxml", "application/vnd.recordare.musicxml+xml"], mxl: ["musicxml", "application/vnd.recordare.musicxml"],
  mp3: ["audio", "audio/mpeg"], m4a: ["audio", "audio/mp4"], aac: ["audio", "audio/aac"],
  wav: ["audio", "audio/wav"], flac: ["audio", "audio/flac"], ogg: ["audio", "audio/ogg"], opus: ["audio", "audio/ogg"],
  pdf: ["pdf", "application/pdf"], md: ["markdown", "text/markdown; charset=utf-8"],
} as const;
export function attachmentAccept(kind: "audio" | "pdf" | "markdown" | "musicxml") {
  return Object.entries(formats).filter(([, format]) => format[0] === kind).map(([extension]) => `.${extension}`).join(",");
}
export function attachmentFormat(name: string) {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  if (!Object.hasOwn(formats, extension)) return null;
  const [kind, contentType] = formats[extension as keyof typeof formats];
  return { kind, contentType, extension, maxBytes: ATTACHMENT_LIMITS[kind] };
}

export const attachmentSchema = z.object({
  id: z.string(), scoreId: z.string(), name: z.string(), kind: z.enum(["link", "audio", "pdf", "markdown", "musicxml"]),
  url: z.string().nullable(), sizeBytes: z.number().int().nonnegative(), revision: z.number().int().positive(),
  updatedAt: z.number(), trashExpiresAt: z.number().nullable(), scoreName: z.string().optional(),
});
export type ScoreAttachment = z.infer<typeof attachmentSchema>;
export const attachmentListSchema = z.object({ attachments: z.array(attachmentSchema) });
export const attachmentRecoveryOperationSchema = z.enum(["create", "modify", "trash"]);
export const attachmentRecoverySchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available"), attachment: attachmentSchema }),
  z.object({ state: z.enum(["absent", "pending", "trashed"]) }),
]);
export const attachmentLinkRequestSchema = z.object({ id: z.uuid(), name: attachmentNameSchema.optional(), url: attachmentUrlSchema });
export const attachmentPatchSchema = z.object({ name: attachmentNameSchema, url: attachmentUrlSchema.optional(), expectedRevision: z.number().int().positive() });
