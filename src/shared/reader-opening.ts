import { z } from "zod";

export const readerOpeningPhases = ["source", "local-read", "engine", "file", "document", "local-check", "score", "page", "ready"] as const;
export type ReaderOpeningPhase = typeof readerOpeningPhases[number];
const duration = z.number().int().min(0).max(86_400_000);
const bytes = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
// Only phases, provenance, counters and durations; no file identifiers or URLs.
export const readerOpeningSchema = z.object({
  phase: z.enum(readerOpeningPhases),
  source: z.enum(["unknown", "cloud", "offline"]),
  loadedBytes: bytes,
  totalBytes: bytes,
  elapsedMs: duration,
  phaseElapsedMs: duration,
  lastProgressAgoMs: duration,
  durations: z.partialRecord(z.enum(readerOpeningPhases), duration),
}).strict();
export type ReaderOpeningFacts = z.infer<typeof readerOpeningSchema>;
