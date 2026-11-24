import { z } from 'zod';
import { ATTACHMENT_LIMITS, attachmentNameSchema } from './attachments';

export const SIGHT_SINGING_SCORE_MAX_BYTES = ATTACHMENT_LIMITS.musicxml;
export const SIGHT_SINGING_PROTOCOL_HEADER = 'X-Same-Page-Sight-Singing';

const rangeFields = z.object({
  title: z.string().trim().min(1).max(80),
  first: z.number().int().nonnegative(), last: z.number().int().nonnegative(),
});
const attachmentFields = z.object({
  scoreId: z.string().min(1).max(128), attachmentId: z.string().min(1).max(128), revision: z.number().int().positive(),
});
export const questionFields = rangeFields.extend(attachmentFields.shape);
const publicationKind = z.enum(['official', 'member']);
export type QuestionPublication = z.infer<typeof publicationKind>;
const publication = rangeFields.extend({ expectedVersion: z.number().int().positive().nullable(),
  expectedEditToken: z.uuid().optional(), publication: publicationKind.optional() });
const validRange = ({ first, last }: { first: number; last: number }) => first <= last;
export const publishQuestionSchema = publication.extend(attachmentFields.shape).strict().refine(validRange);
export const uploadQuestionSchema = publication.strict().refine(validRange);
export const reuseQuestionSnapshotSchema = publication.extend({ expectedVersion: z.number().int().positive(), expectedEditToken: z.uuid(), reuseSnapshot: z.literal(true) })
  .strict().refine(validRange);
const publisher = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('official') }),
  z.object({ kind: z.literal('member'), name: z.string(), own: z.boolean() }),
]);
const publishedFields = rangeFields.extend({ id: z.uuid(), version: z.number().int().positive(),
  publisher: publisher.optional(), canEdit: z.boolean().optional() });
const snapshotFields = z.object({ name: attachmentNameSchema, editToken: z.uuid() });
export const publishedQuestionSchema = z.union([
  publishedFields.extend({ ...attachmentFields.shape, snapshot: snapshotFields.optional() }),
  publishedFields.extend({ scoreId: z.null(), attachmentId: z.null(), revision: z.null(), snapshot: snapshotFields }),
]);
export const publishedQuestionResponseSchema = z.object({ question: publishedQuestionSchema });
export const publishedQuestionsSchema = z.object({ questions: z.array(publishedQuestionSchema) });
export type PublishedQuestion = z.infer<typeof publishedQuestionSchema>;
