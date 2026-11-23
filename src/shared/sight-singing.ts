import { z } from 'zod';

export const questionFields = z.object({
  title: z.string().trim().min(1).max(80),
  scoreId: z.string().min(1).max(128), attachmentId: z.string().min(1).max(128),
  revision: z.number().int().positive(), first: z.number().int().nonnegative(), last: z.number().int().nonnegative(),
});
export const publishedQuestionSchema = questionFields.extend({ id: z.uuid(), version: z.number().int().positive() });
export const publishedQuestionResponseSchema = z.object({ question: publishedQuestionSchema });
export const publishedQuestionsSchema = z.object({ questions: z.array(publishedQuestionSchema) });
export const publishQuestionSchema = questionFields.extend({ expectedVersion: z.number().int().positive().nullable() })
  .strict().refine(question => question.first <= question.last);
export type PublishedQuestion = z.infer<typeof publishedQuestionSchema>;
