import { z } from 'zod';
import { ATTACHMENT_LIMITS, attachmentNameSchema } from './attachments';

export const SIGHT_SINGING_SCORE_MAX_BYTES = ATTACHMENT_LIMITS.musicxml;
export const SIGHT_SINGING_QUESTION_NAME_MAX_LENGTH = 80;

const rangeFields = z.object({
  title: z.string().trim().min(1).max(SIGHT_SINGING_QUESTION_NAME_MAX_LENGTH),
  first: z.number().int().nonnegative(), last: z.number().int().nonnegative(),
});
const beatNumber = z.number().int().positive();
/** One-based beats in the endpoint visits. The last beat is included. */
export type QuestionBeats = { firstBeat?: number | null; lastBeat?: number | null };
const attachmentFields = z.object({
  scoreId: z.string().min(1).max(128), attachmentId: z.string().min(1).max(128), revision: z.number().int().positive(),
});
export type PracticeQuestionType = 'sight-singing' | 'rhythm';
const publicationKind = z.enum(['official', 'member']);
export type QuestionPublication = z.infer<typeof publicationKind>;
const publication = rangeFields.extend({ expectedVersion: z.number().int().positive().nullable(),
  expectedEditToken: z.uuid().optional(), publication: publicationKind.optional(),
  firstBeat: beatNumber.nullish(), lastBeat: beatNumber.nullish() });
const validRange = ({ first, last, firstBeat, lastBeat }: { first: number; last: number } & QuestionBeats) =>
  first < last || first === last && (lastBeat == null || (firstBeat ?? 1) <= lastBeat);
export const publishQuestionSchema = publication.extend(attachmentFields.shape).strict().refine(validRange);
export const uploadQuestionSchema = publication.strict().refine(validRange);
export const reuseQuestionSnapshotSchema = publication.extend({ expectedVersion: z.number().int().positive(), expectedEditToken: z.uuid(), reuseSnapshot: z.literal(true) })
  .strict().refine(validRange);
const publisher = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('official') }),
  z.object({ kind: z.literal('member'), name: z.string(), own: z.boolean() }),
]);
const publishedFields = rangeFields.extend({ id: z.uuid(), version: z.number().int().positive(),
  firstBeat: beatNumber.optional(), lastBeat: beatNumber.optional(),
  exerciseType: z.literal('rhythm').optional(), publisher, canEdit: z.boolean() });
const snapshotFields = z.object({ name: attachmentNameSchema, editToken: z.uuid() });
export const publishedQuestionSchema = z.union([
  publishedFields.extend({ ...attachmentFields.shape, snapshot: snapshotFields }),
  publishedFields.extend({ scoreId: z.null(), attachmentId: z.null(), revision: z.null(), snapshot: snapshotFields }),
]);
export const publishedQuestionResponseSchema = z.object({ question: publishedQuestionSchema });
export const publishedQuestionsSchema = z.object({ questions: z.array(publishedQuestionSchema) });
export type PublishedQuestion = z.infer<typeof publishedQuestionSchema>;
