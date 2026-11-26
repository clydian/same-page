import { z } from 'zod';

export const sightSingingSpeeds = [.5, .75, 1, 1.25, 1.5] as const;
export const sightSingingSpeedSchema = z.literal(sightSingingSpeeds);

export const sightSingingScoreSchema = z.number().min(0).max(100)
  .refine(score => Math.round(score * 100) / 100 === score, { message: 'Use at most two decimal places' });
export const sightSingingVoiceNameSchema = z.string().trim().min(1).max(240);
const sightSingingResultFields = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  score: sightSingingScoreSchema,
  voiceId: z.string().max(64).regex(/^\d+:\d+:\d+$/),
  voiceName: sightSingingVoiceNameSchema,
  speed: sightSingingSpeedSchema,
}).strict();
export const sightSingingResultSubmissionSchema = sightSingingResultFields.extend({ perfect: z.boolean(), writtenOctave: z.boolean() })
  .refine(({ score, perfect, writtenOctave }) => (!perfect || score > 0) && (!writtenOctave || perfect));

const publishedSightSingingResultSchema = sightSingingResultFields.extend({
  questionId: z.uuid(),
  displayName: z.string(),
  own: z.boolean(),
  perfect: z.literal(true).optional(),
  writtenOctave: z.literal(true).optional(),
});

const standingPlace = z.number().int().positive();
const standingNeighbor = z.object({
  id: z.uuid(), displayName: z.string(), score: sightSingingScoreSchema,
  position: standingPlace, place: standingPlace, tied: z.boolean(),
});
export type SightSingingStandingNeighbor = z.infer<typeof standingNeighbor>;
const sightSingingStandingSchema = z.object({
  place: standingPlace, tied: z.boolean(), participants: standingPlace,
  previous: z.object({ place: standingPlace, score: sightSingingScoreSchema }).optional(),
  nearby: z.array(standingNeighbor).max(8),
});
export type SightSingingStanding = z.infer<typeof sightSingingStandingSchema>;

export const sightSingingResultResponseSchema = z.object({
  result: publishedSightSingingResultSchema, published: z.boolean(), standing: sightSingingStandingSchema,
});
export const sightSingingResultsResponseSchema = z.object({
  results: z.array(publishedSightSingingResultSchema),
  voices: z.array(sightSingingVoiceNameSchema),
});
const leaderboardEntry = publishedSightSingingResultSchema.pick({
  id: true, questionId: true, version: true, score: true, voiceName: true, displayName: true, speed: true, perfect: true, writtenOctave: true,
});
export const sightSingingLeaderboardSchema = z.object({
  results: z.array(leaderboardEntry),
  participants: z.array(z.object({ questionId: z.uuid(), count: z.number().int().nonnegative() })),
});
export type SightSingingLeaderboard = z.infer<typeof sightSingingLeaderboardSchema>;
export type SightSingingResultSubmission = z.infer<typeof sightSingingResultSubmissionSchema>;
export type PublishedSightSingingResult = z.infer<typeof publishedSightSingingResultSchema>;
