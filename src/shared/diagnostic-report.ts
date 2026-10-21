import { pdfRenderFactsSchema } from "./pdf-render-facts";
import { readerOpeningSchema } from "./reader-opening";
import { z } from "zod";
import { applicationShellBudgetBytes, applicationShellReleaseLimitBytes, updateFailureReasons } from "./update-diagnostics";
import { diagnosticErrorCodes, diagnosticCategories, diagnosticOperations, diagnosticStages, diagnosticSteps, diagnosticErrorTypes } from "./diagnostics";

export const diagnosticReportMaxBytes = 64 * 1024;
export const diagnosticReportRetentionDays = 180;
export const diagnosticReportRetentionMs = diagnosticReportRetentionDays * 24 * 60 * 60_000;
const build = z.string().regex(/^(?:[0-9a-f]{7,40}|development)$/).nullable();
const version = z.string().regex(/^\d{1,4}(?:\.\d{1,6}){0,3}$/).nullable();
const count = z.number().int().min(0).max(9999);
export const diagnosticReaderSchema = z.object({
  opening: readerOpeningSchema.optional(),
  interactionMode: z.enum(["reading", "editing"]),
  pendingCount: count.nullable(),
  conflictCount: count.nullable(),
}).strict();
export type DiagnosticReader = z.infer<typeof diagnosticReaderSchema>;
const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const probe = z.enum(["ok", "timeout", "unavailable", "failed", "missing"]);
export const updateDiagnosticsSchema = z.object({
  serverBuild: build,
  registration: probe,
  activeBuild: build,
  waitingBuild: build,
  installingState: z.enum(["parsed", "installing", "installed", "activating", "activated", "redundant"]).nullable(),
  locksSupported: z.boolean(),
  cacheStatus: probe,
  shellCount: z.number().int().min(0).max(9999).nullable(),
  shellBytes: bytes,
  // Null means this installer has no cross-release aggregate admission cap.
  shellBudgetBytes: z.union([z.literal(applicationShellBudgetBytes), z.null()]),
  shellPolicy: z.literal("references-v2"),
  shellReleaseLimitBytes: z.literal(applicationShellReleaseLimitBytes),
  shellsTruncated: z.boolean(),
  shells: z.array(z.object({ buildId: build, bytes, complete: z.boolean(), ageHours: z.number().nonnegative().max(1_000_000).nullable() }).strict()).max(16),
  storage: z.object({ status: probe, usage: bytes, quota: bytes }).strict(),
  database: z.object({ status: probe, version: z.number().int().min(0).max(1_000_000).nullable() }).strict(),
  failure: z.object({ reason: z.enum(updateFailureReasons), buildId: build }).strict().nullable(),
}).partial().strict();

export const diagnosticReportSchema = z.object({
  id: z.uuidv4(),
  version: z.literal(1),
  clientBuild: build,
  clientVersion: z.string().regex(/^v\d{2}\.\d{2}\.\d{2}\.\d{4}$/).optional(),
  retentionDays: z.literal(180).optional(),
  description: z.string().max(1000),
  environment: z.object({
    browser: z.enum(["edge", "firefox", "chrome", "safari", "unknown"]),
    browserVersion: version,
    system: z.enum(["ios", "android", "macos", "windows", "linux", "unknown"]),
    systemVersion: version,
    viewportWidth: z.number().int().min(0).max(32768),
    viewportHeight: z.number().int().min(0).max(32768),
    standalone: z.boolean(),
    serviceWorkerControlled: z.boolean(),
    onlineHint: z.boolean(),
  }).strict(),
  reader: diagnosticReaderSchema.nullable(),
  update: updateDiagnosticsSchema.optional(),
  records: z.array(z.object({
    render: pdfRenderFactsSchema.optional(),
    opening: readerOpeningSchema.optional(),
    id: z.uuidv4(),
    time: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    operation: z.enum(diagnosticOperations),
    category: z.enum(diagnosticCategories),
    stage: z.enum(diagnosticStages),
    step: z.enum(diagnosticSteps).optional(),
    errorType: z.enum(diagnosticErrorTypes).optional(),
    causeType: z.enum(diagnosticErrorTypes).optional(),
    errorCode: z.enum(diagnosticErrorCodes).optional(),
    serverBuild: build,
    requestId: z.uuidv4().nullable(),
    retryable: z.boolean(),
    count: count.min(1),
    engineVersion: z.string().regex(/^pdfjs-[0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?$/).max(64).optional(),
    pdfReason: z.enum(["encrypted", "corrupt-pdf", "engine-unavailable", "version-mismatch", "timeout", "render-failed", "document-failed"]).optional(),
  }).strict()).max(50),
}).strict();
export type DiagnosticReport = z.infer<typeof diagnosticReportSchema>;
export const diagnosticReceiptSchema = z.object({ id: z.uuidv4() }).strict();
