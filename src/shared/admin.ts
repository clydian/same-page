import { z } from "zod";
export const adminCapabilitiesSchema = z.object({
  viewScores: z.number(),
  reviewXml: z.number(),
  publishXml: z.number(),
});
export const adminScoreSchema = z.object({
  id: z.string(),
  choirId: z.string(),
  driveName: z.string(),
  fileName: z.string(),
  versionId: z.string(),
  sha256: z.string(),
  pageCount: z.number(),
  disabled: z.number(),
  attachmentId: z.string().nullable(),
  attachmentRevision: z.number().nullable(),
  publishedSource: z.string().nullable(),
  candidateState: z.string().nullable(),
  candidateReview: z.string().nullable(),
  candidateSource: z.string().nullable(),
});
export type AdminScore = z.infer<typeof adminScoreSchema>;
export const xmlCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  sourceVersionId: z.string(),
  sourceSha256: z.string(),
  sizeBytes: z.number(),
  sha256: z.string(),
  state: z.enum(["pending", "ready", "failed"]),
  tool: z.string(),
  parameters: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  review: z.enum(["pending", "approved", "rejected"]),
  reviewRevision: z.number(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.number().nullable(),
  reviewNote: z.string(),
  technicalPassed: z.number(),
});
export type XmlCandidate = z.infer<typeof xmlCandidateSchema>;
export const adminDetailSchema = z.object({
  score: adminScoreSchema,
  candidates: z.array(xmlCandidateSchema),
  nextBefore: z.string().nullable(),
});
export const xmlReviewSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  decision: z.enum(["pending", "approved", "rejected"]),
  technicalPassed: z.boolean(),
  note: z.string().max(2000),
});
export const xmlPublicationSchema = z.object({
  id: z.uuid(),
  expectedReviewRevision: z.number().int().positive(),
  expectedAttachmentRevision: z.number().int().nonnegative(),
  attachmentId: z.uuid(),
});
export const adminAuditSchema = z.object({
  id: z.string(),
  operatorId: z.string(),
  choirId: z.string().nullable(),
  scoreId: z.string().nullable(),
  candidateId: z.string().nullable(),
  action: z.string(),
  createdAt: z.number(),
});
