import { z } from 'zod';

export const sightSingingResultSubmissionSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  score: z.number().int().min(0).max(100),
  voiceId: z.string().max(64).regex(/^\d+:\d+:\d+$/),
  voiceName: z.string().trim().min(1).max(240),
}).strict();

const publishedSightSingingResultSchema = sightSingingResultSubmissionSchema.extend({
  questionId: z.uuid(),
  displayName: z.string(),
  own: z.boolean(),
});

export const sightSingingResultResponseSchema = z.object({ result: publishedSightSingingResultSchema });
export const sightSingingResultsResponseSchema = z.object({ results: z.array(publishedSightSingingResultSchema) });
export type SightSingingResultSubmission = z.infer<typeof sightSingingResultSubmissionSchema>;
export type PublishedSightSingingResult = z.infer<typeof publishedSightSingingResultSchema>;
