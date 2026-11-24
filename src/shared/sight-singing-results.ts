import { z } from 'zod';

export const sightSingingSpeeds = [.5, .75, 1, 1.25, 1.5] as const;
export const sightSingingSpeedSchema = z.literal(sightSingingSpeeds);
export const currentSingingScoringRule = 3;
export const sightSingingScoringRuleSchema = z.literal(currentSingingScoringRule);

export const sightSingingScoreSchema = z.number().min(0).max(100)
  .refine(score => Math.round(score * 100) / 100 === score, { message: 'Use at most two decimal places' });
export const sightSingingVoiceNameSchema = z.string().trim().min(1).max(240);
export const sightSingingResultSubmissionSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  score: sightSingingScoreSchema,
  voiceId: z.string().max(64).regex(/^\d+:\d+:\d+$/),
  voiceName: sightSingingVoiceNameSchema,
  speed: sightSingingSpeedSchema.optional(),
  scoringRule: sightSingingScoringRuleSchema.optional(),
}).strict();

const publishedSightSingingResultSchema = sightSingingResultSubmissionSchema.extend({
  questionId: z.uuid(),
  displayName: z.string(),
  own: z.boolean(),
  perfect: z.literal(true).optional(),
  writtenOctave: z.literal(true).optional(),
});

export const sightSingingResultResponseSchema = z.object({ result: publishedSightSingingResultSchema, published: z.boolean().optional() });
export const sightSingingResultsResponseSchema = z.object({
  results: z.array(publishedSightSingingResultSchema), versions: z.array(z.number().int().positive()).optional(),
  voices: z.array(sightSingingVoiceNameSchema).optional(),
});
export const sightSingingVersionFilterSchema = z.enum(['all', 'latest']);
export type SightSingingVersionFilter = z.infer<typeof sightSingingVersionFilterSchema>;
const leaderboardEntry = publishedSightSingingResultSchema.pick({
  id: true, questionId: true, version: true, score: true, voiceName: true, displayName: true, speed: true, perfect: true, writtenOctave: true,
});
export const sightSingingLeaderboardSchema = z.object({
  results: z.array(leaderboardEntry), voices: z.array(sightSingingVoiceNameSchema),
  participants: z.array(z.object({ questionId: z.uuid(), count: z.number().int().nonnegative() })).optional(),
});
export type SightSingingLeaderboard = z.infer<typeof sightSingingLeaderboardSchema>;
export type SightSingingResultSubmission = z.infer<typeof sightSingingResultSubmissionSchema>;
export type PublishedSightSingingResult = z.infer<typeof publishedSightSingingResultSchema>;
