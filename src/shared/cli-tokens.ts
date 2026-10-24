import { z } from "zod";

export const createCliTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  canUpload: z.boolean().default(false),
  driveIds: z.array(z.string().min(1).max(128)).min(1).max(100)
    .transform((ids) => [...new Set(ids)]),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const cliTokenCredentialSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  canUpload: z.boolean(),
  driveIds: z.array(z.string()),
  createdAt: z.number(),
  expiresAt: z.number(),
  revokedAt: z.number().nullable(),
  lastUsedAt: z.number().nullable(),
});
export type CliTokenCredential = z.infer<typeof cliTokenCredentialSchema>;
export const cliTokenListSchema = z.object({ tokens: z.array(cliTokenCredentialSchema) });
export const createdCliTokenSchema = z.object({ token: z.string(), credential: cliTokenCredentialSchema });
