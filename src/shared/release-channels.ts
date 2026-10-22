import { z } from "zod";
export const releaseIdSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const releaseChannelSchema = z.enum(["stable", "beta"]);
export type ReleaseChannel = z.infer<typeof releaseChannelSchema>;
export const releaseContract = "same-page-storage-v15-sync-v1";
export const releasePrefix = (id: string) => `/_releases/${id}/`;
export const releaseTargetSchema = z.object({
  channel: releaseChannelSchema,
  intent: z.string().max(64),
  revision: z.number().int().nonnegative(),
  target: releaseIdSchema,
  backend: z.string(),
  contract: z.literal(releaseContract),
});
export type ReleaseTarget = z.infer<typeof releaseTargetSchema>;
export const releaseSelectionSchema = z.object({ channel: releaseChannelSchema, intent: z.uuid() });
export const releasePromotionSchema = z.object({ id: z.uuid(), expectedBeta: releaseIdSchema, expectedRevision: z.number().int().positive() });
export const releaseFileSchema = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative(), contentType: z.string().max(100) });
export const releaseManifestSchema = z.object({
  probeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  storageDigest: z.string().regex(/^[a-f0-9]{64}$/),
  buildId: releaseIdSchema, contract: z.literal(releaseContract),
  files: z.record(z.string().regex(/^(?!.*(?:^|\/)\.\.?\/)[a-zA-Z0-9_./@-]+$/), releaseFileSchema),
});
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;
