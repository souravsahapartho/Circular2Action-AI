import { z } from 'zod';

/** Extraction field object (plan B-05). The server assigns confidence and verification_state; the model never does. */
export const evidenceSchema = z.object({
  page: z.number().int().positive(),
  quote: z.string().min(1).max(1000),
});

export const fieldObjectSchema = z
  .object({
    value: z.unknown().nullable(),
    raw_text: z.string().max(1000).optional(),
    evidence: evidenceSchema.optional(),
    stated: z.boolean(),
  })
  .superRefine((f, ctx) => {
    if (f.stated && (f.value === null || f.value === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'stated=true requires a value' });
    }
    if (f.stated && !f.evidence) {
      ctx.addIssue({ code: 'custom', message: 'stated=true requires evidence (page and quote)' });
    }
    if (!f.stated && f.value !== null && f.value !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'stated=false requires value=null (never invent values)',
      });
    }
  });
export type FieldObject = z.infer<typeof fieldObjectSchema>;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(512).optional(),
});

export const idSchema = z.string().regex(/^\d{1,20}$/, 'IDs are numeric strings');

export const eligibilityStatusSchema = z.enum([
  'eligible',
  'not_eligible',
  'needs_verification',
  'insufficient_information',
]);
