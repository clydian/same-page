import type { Context } from 'hono';
export const supportsMusicXml = (context: Context) => context.req.header('X-Same-Page-Attachments') === '2';
