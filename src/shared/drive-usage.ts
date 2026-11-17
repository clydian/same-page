import { z } from "zod";

export const VISIT_INTERVAL_MS = 5 * 60_000;
export const VISIT_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const driveUsageSchema = z.object({
  id: z.string(), name: z.string(), plan: z.enum(["free", "configured"]),
  createdAt: z.number(), isPreviewEntry: z.number(),
  usedBytes: z.number(), limitBytes: z.number(),
  scoreCount: z.number(), scoreLimit: z.number().nullable(),
  memberCount: z.number(), memberLimit: z.number().nullable(),
  lastMemberVisitAt: z.number().nullable(),
  visitors7d: z.number(), visitors30d: z.number(),
});
export const driveUsageListSchema = z.object({
  drives: z.array(driveUsageSchema), next: z.string().nullable(),
  collectionStartedAt: z.number(), asOf: z.number(),
});
export type DriveUsage = z.infer<typeof driveUsageSchema>;
