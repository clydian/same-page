import { z } from "zod";
import { diagnosticCategories } from "./diagnostics";

export const diagnosticStatuses = ["new", "investigating", "resolved"] as const;
export const diagnosticStatusSchema = z.enum(diagnosticStatuses);
export const diagnosticStatusLabels = { new: "新反馈", investigating: "调查中", resolved: "已解决" } as const;
const reportCursor = z.string().max(100).regex(/^\d{1,16}_[0-9a-f-]{36}$/);
export const diagnosticInboxQuerySchema = z.object({
  id: z.union([z.literal(""), z.uuidv4()]).default(""),
  status: z.union([z.literal(""), diagnosticStatusSchema]).default(""),
  build: z.string().max(40).regex(/^(?:[0-9a-f]{7,40}|development|v\d{2}\.\d{2}\.\d{2}\.\d{4})?$/).default(""),
  category: z.union([z.literal(""), z.enum(diagnosticCategories)]).default(""),
  from: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  until: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  before: reportCursor.optional(),
});
export const diagnosticInboxItemSchema = z.object({
  id: z.uuidv4(), clientBuild: z.string().nullable(), clientVersion: z.string().nullable(),
  status: diagnosticStatusSchema, createdAt: z.number(), expiresAt: z.number(),
  description: z.string(), categories: z.array(z.enum(diagnosticCategories)),
});
export const diagnosticInboxListSchema = z.object({ reports: z.array(diagnosticInboxItemSchema), next: z.string().nullable() });
export type DiagnosticInboxItem = z.infer<typeof diagnosticInboxItemSchema>;
