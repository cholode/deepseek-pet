import { z } from 'zod';

export const traitNames = ['warmth', 'playfulness', 'initiative', 'verbosity'] as const;
export const traitSchema = z.enum(traitNames);
export type Trait = z.infer<typeof traitSchema>;
export const traitLabels: Record<Trait, string> = { warmth: '温柔表达', playfulness: '俏皮程度', initiative: '主动提议', verbosity: '解释详细度' };
const values = z.object({ warmth: z.number().min(0).max(100), playfulness: z.number().min(0).max(100), initiative: z.number().min(0).max(100), verbosity: z.number().min(0).max(100) }).strict();
export const growthObservationSchema = z.object({ trait: traitSchema, direction: z.union([z.literal(-1), z.literal(1)]), evidence: z.string().min(2).max(500), reason: z.string().min(1).max(200) }).strict();
export const growthSchema = z.object({
  enabled: z.boolean(), locked: z.array(traitSchema), values,
  observations: z.array(growthObservationSchema.extend({ eventId: z.string(), at: z.number() })).max(100),
  history: z.array(z.object({ id: z.string(), at: z.number(), before: values, after: values, reason: z.string(), evidence: z.array(z.string()).max(10), trait: traitSchema.optional() })).max(100),
  processed: z.array(z.string()).max(1000)
}).strict();
export type Growth = z.infer<typeof growthSchema>;
export type GrowthObservation = z.infer<typeof growthObservationSchema>;
export const growthDefaults: Growth = { enabled: true, locked: [], values: { warmth: 60, playfulness: 55, initiative: 40, verbosity: 40 }, observations: [], history: [], processed: [] };
