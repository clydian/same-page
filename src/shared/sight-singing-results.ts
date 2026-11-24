import { z } from 'zod';

export const sightSingingSpeeds = [.5, .75, 1, 1.25, 1.5] as const;
export const sightSingingSpeedSchema = z.literal(sightSingingSpeeds);
export const legacySingingScoringRule = 1;
export const currentSingingScoringRule = 2;
export const sightSingingScoringRuleSchema = z.literal([legacySingingScoringRule, currentSingingScoringRule]);
export type SightSingingScoringRule = z.infer<typeof sightSingingScoringRuleSchema>;

export const sightSingingResultSubmissionSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  score: z.number().int().min(0).max(100),
  voiceId: z.string().max(64).regex(/^\d+:\d+:\d+$/),
  voiceName: z.string().trim().min(1).max(240),
  speed: sightSingingSpeedSchema.optional(),
  scoringRule: sightSingingScoringRuleSchema.optional(),
}).strict();

const publishedSightSingingResultSchema = sightSingingResultSubmissionSchema.extend({
  questionId: z.uuid(),
  displayName: z.string(),
  own: z.boolean(),
});

export const sightSingingResultResponseSchema = z.object({ result: publishedSightSingingResultSchema, published: z.boolean().optional() });
export const sightSingingResultsResponseSchema = z.object({
  results: z.array(publishedSightSingingResultSchema), versions: z.array(z.number().int().positive()).optional(),
  hasLegacyScores: z.boolean().optional(),
});
export type SightSingingResultSubmission = z.infer<typeof sightSingingResultSubmissionSchema>;
export type PublishedSightSingingResult = z.infer<typeof publishedSightSingingResultSchema>;
