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
// Levels 2 and 3 are already represented by the original perfect/register flags.
const extraBadgeSchema = z.literal([1, 4, 5]);
export type SightSingingExtraBadge = z.infer<typeof extraBadgeSchema>;
export const sightSingingResultSubmissionSchema = sightSingingResultFields.extend({ perfect: z.boolean(), writtenOctave: z.boolean(), badge: extraBadgeSchema.optional() })
  .refine(({ score, perfect, writtenOctave, badge }) => (!perfect || score > 0) && (!writtenOctave || perfect) &&
    (badge === undefined || (badge === 1 ? !perfect && score >= 47.5 : perfect && score === 100 && (badge === 5) === writtenOctave)));

const publishedSightSingingResultSchema = sightSingingResultFields.extend({
  questionId: z.uuid(),
  displayName: z.string(),
  own: z.boolean(),
  perfect: z.literal(true).optional(),
  writtenOctave: z.literal(true).optional(),
  badge: extraBadgeSchema.optional(),
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
  id: true, questionId: true, version: true, score: true, voiceName: true, displayName: true, speed: true, perfect: true, writtenOctave: true, badge: true,
});
export const sightSingingLeaderboardSchema = z.object({
  results: z.array(leaderboardEntry),
  participants: z.array(z.object({ questionId: z.uuid(), count: z.number().int().nonnegative() })),
});
export type SightSingingLeaderboard = z.infer<typeof sightSingingLeaderboardSchema>;
export type SightSingingResultSubmission = z.infer<typeof sightSingingResultSubmissionSchema>;
export type PublishedSightSingingResult = z.infer<typeof publishedSightSingingResultSchema>;
