import { z } from 'zod';

export const tutorTurnSchema = z.object({
  reply: z.string().trim().min(1).max(4000), phase: z.string().max(100).default('互动'),
  move: z.enum(['teach', 'practice', 'hint', 'pause', 'finish']).default('teach'),
  score: z.number().int().min(0).max(2).nullable().default(null), feedback: z.string().max(2000).default(''),
  question: z.string().max(2000).default(''), referenceAnswer: z.string().max(2000).default(''), skill: z.string().max(200).default(''),
  usedHint: z.boolean().default(false)
});
export type TutorTurn = z.infer<typeof tutorTurnSchema>;
export const tutoringSchema = z.object({
  methodId: z.string().max(100),
  turns: z.array(z.object({ id: z.string().max(100), at: z.number(), user: z.string().max(4000), reply: z.string().max(4000), phase: z.string().max(100) })).max(300),
  current: tutorTurnSchema.optional()
});
