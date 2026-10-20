import { z } from 'zod';

// No exception text, document identity, URL, filename or annotation content.
export const pdfRenderFactsSchema = z.object({
  reason: z.enum(['budget', 'context-lost', 'canvas-unavailable', 'timeout', 'page-failed']),
  page: z.number().int().min(1).max(1000000),
  pageCount: z.number().int().min(1).max(1000000),
  mode: z.enum(['continuous', 'paged', 'thumbnail']),
  width: z.number().int().min(0).max(32768),
  devicePixelRatio: z.number().min(0).max(16),
  priority: z.number().int().min(0).max(2),
  maxPixels: z.number().int().min(0).max(24 * 1024 * 1024),
  residentPixels: z.number().int().min(0).max(24 * 1024 * 1024),
  residentCanvases: z.number().int().min(0).max(10000),
  automaticRetries: z.number().int().min(0).max(2),
}).strict();
export type PdfRenderFacts = z.infer<typeof pdfRenderFactsSchema>;
