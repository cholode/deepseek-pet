import { z } from 'zod';
import { tutoringSchema } from './teaching';

const id = z.string().min(1).max(100);
const title = z.string().trim().min(1).max(200);
export const sourcePageSchema = z.object({ page: z.number().int().positive(), text: z.string().max(60000) }).strict();
export const sourceSchema = z.object({ id, courseId: id, title, location: z.string().max(3000), kind: z.enum(['web', 'file', 'note']), at: z.number(), hash: z.string(), pages: z.array(sourcePageSchema).max(1000), warning: z.string().optional() }).strict();
export type StudySource = z.infer<typeof sourceSchema>;
export const referenceSchema = z.object({ sourceId: id, page: z.number().int().positive(), quote: z.string().trim().min(2).max(300) }).strict();
export const exerciseSchema = z.object({ id, skill: title, question: z.string().min(1).max(2000), answer: z.string().min(1).max(2000), explanation: z.string().max(2000).default(''), hint: z.string().max(500).default(''), references: z.array(referenceSchema).max(8).default([]) }).strict();
export const vocabularySchema = z.object({ expression: z.string().min(1).max(200), reading: z.string().max(200), meaning: z.string().min(1).max(500), example: z.string().max(500) }).strict();
export const lessonContentSchema = z.object({ title, objectives: z.array(title).min(1).max(8), introduction: z.string().min(1).max(5000), sections: z.array(z.object({ title, body: z.string().min(1).max(5000), references: z.array(referenceSchema).max(8).default([]) }).strict()).min(1).max(10), exercises: z.array(exerciseSchema).min(1).max(20), vocabulary: z.array(vocabularySchema).max(30).default([]) }).strict();
export type LessonContent = z.infer<typeof lessonContentSchema>;
export const lessonSchema = lessonContentSchema.extend({ id, courseId: id, workflowId: id, outlineIndex: z.number().int().nonnegative().default(0), version: z.number().int().positive(), at: z.number(), status: z.enum(['draft', 'checked', 'published']), check: z.string(), artifact: z.string() }).strict();
export type Lesson = z.infer<typeof lessonSchema>;
export const outlineSchema = z.array(z.object({ title, objectives: z.array(title).min(1).max(8), references: z.array(referenceSchema).max(8).default([]) }).strict()).min(1).max(60);
export const courseSchema = z.object({ id, title, edition: z.string().max(200), goal: z.string().min(1).max(1500), level: z.string().max(100), minutes: z.number().int().min(5).max(120), sourceIds: z.array(id).max(100), outline: outlineSchema.or(z.tuple([])), nextLesson: z.number().int().min(0), createdAt: z.number(), strategies: z.array(z.string().max(600)).max(20), reviewTarget: z.string().max(100), autoPrepare: z.boolean(), studyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), studyDays: z.array(z.number().int().min(0).max(6)).min(1).max(7), reminders: z.boolean(), lastReminder: z.string() }).strict();
export type Course = z.infer<typeof courseSchema>;
export const stepKinds = ['search', 'read', 'outline', 'lesson', 'check', 'publish', 'reflect', 'review-export'] as const;
export const planStepSchema = z.object({ id, label: title, kind: z.enum(stepKinds), dependsOn: z.array(id).max(20) }).strict();
export const planSchema = z.object({ name: title, steps: z.array(planStepSchema).min(1).max(20) }).strict();
export type WorkflowPlan = z.infer<typeof planSchema>;
export const workflowSchema = z.object({ id, courseId: id, goal: z.string().min(1).max(1500), templateId: z.string(), createdAt: z.number(), scheduledAt: z.number(), status: z.enum(['queued', 'running', 'paused', 'failed', 'completed', 'cancelled', 'needs-review']), sessionId: z.string(), lessonId: z.string(), plan: planSchema, steps: z.array(z.object({ id, status: z.enum(['pending', 'running', 'completed', 'failed']), attempts: z.number().int().nonnegative(), result: z.string().max(6000), error: z.string().max(1000), startedAt: z.number(), completedAt: z.number() }).strict()).max(20), warnings: z.array(z.string().max(1000)).max(50).default([]), searchResults: z.array(z.object({ title, url: z.string().max(3000), snippet: z.string().max(1500) })).max(20), error: z.string(), calls: z.number().int().nonnegative() }).strict();
export type Workflow = z.infer<typeof workflowSchema>;
export const attemptSchema = z.object({ id, questionId: id, at: z.number(), answer: z.string().min(1).max(4000), hintUsed: z.boolean(), elapsedMs: z.number().nonnegative(), score: z.number().int().min(0).max(2), feedback: z.string().min(1).max(2500), correction: z.string().max(2000), skill: title }).strict();
export type StudyAttempt = z.infer<typeof attemptSchema>;
export const evaluationSchema = attemptSchema.pick({ score: true, feedback: true, correction: true });
export const sessionSchema = z.object({ tutoring: tutoringSchema.optional(), id, courseId: id, lessonId: id, at: z.number(), updatedAt: z.number(), questionAt: z.number(), index: z.number().int().nonnegative(), hintUsed: z.boolean(), status: z.enum(['active', 'paused', 'completed']), attempts: z.array(attemptSchema).max(300), feedback: z.array(z.object({ at: z.number(), text: z.string().max(1500) })).max(30), reflection: z.string().max(6000), exportState: z.enum(['none', 'pending', 'completed', 'unknown']), exportResult: z.string().max(3000) }).strict();
export type StudySession = z.infer<typeof sessionSchema>;
export const studioSchema = z.object({ version: z.literal(1), courses: z.array(courseSchema).max(100), sources: z.array(sourceSchema).max(500), lessons: z.array(lessonSchema).max(500), workflows: z.array(workflowSchema).max(500), templates: z.array(z.object({ id, version: z.number().int().positive(), at: z.number(), plan: planSchema })).max(100), sessions: z.array(sessionSchema).max(1000), activeSession: z.string(), settings: z.object({ webSearch: z.boolean(), background: z.boolean(), maxModelCalls: z.number().int().min(4).max(100) }).strict() }).strict();
export type StudioData = z.infer<typeof studioSchema>;
export const studioDefaults: StudioData = { version: 1, courses: [], sources: [], lessons: [], workflows: [], templates: [], sessions: [], activeSession: '', settings: { webSearch: true, background: true, maxModelCalls: 20 } };
export const createCourseSchema = courseSchema.pick({ title: true, edition: true, goal: true, level: true, minutes: true });
export const studioRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state') }).strict(),
  z.object({ type: z.literal('create-course'), course: createCourseSchema }).strict(),
  z.object({ type: z.literal('course-settings'), courseId: id, settings: courseSchema.pick({ reviewTarget: true, autoPrepare: true, studyTime: true, studyDays: true, reminders: true }) }).strict(),
  z.object({ type: z.literal('import-source'), courseId: id }).strict(),
  z.object({ type: z.literal('add-source'), courseId: id, url: z.string().url().max(3000) }).strict(),
  z.object({ type: z.literal('add-note'), courseId: id, title, text: z.string().trim().min(20).max(100000) }).strict(),
  z.object({ type: z.literal('delete-source'), id }).strict(),
  z.object({ type: z.literal('prepare'), courseId: id, goal: z.string().min(1).max(1500), templateId: z.string().max(100), scheduledAt: z.number().nonnegative() }).strict(),
  z.object({ type: z.literal('workflow'), id, action: z.enum(['pause', 'resume', 'cancel', 'retry', 'save-template']) }).strict(),
  z.object({ type: z.literal('start-lesson'), lessonId: id }).strict(),
  z.object({ type: z.literal('start-teaching'), lessonId: id }).strict(),
  z.object({ type: z.literal('answer'), sessionId: id, answer: z.string().trim().min(1).max(4000), requestId: id }).strict(),
  z.object({ type: z.literal('session'), id, action: z.enum(['pause', 'resume', 'hint', 'export-review', 'reflect', 'finish']) }).strict(),
  z.object({ type: z.literal('feedback'), sessionId: id, text: z.string().trim().min(1).max(1500) }).strict(),
  z.object({ type: z.literal('open-artifact'), lessonId: id }).strict(),
  z.object({ type: z.literal('settings'), settings: studioSchema.shape.settings }).strict()
]);
export type StudioRequest = z.infer<typeof studioRequestSchema>;
export interface StudioView { data: StudioData; working: boolean; error?: string; reviewTargets: { id: string; name: string }[] }
export interface StudioResponse { ok: boolean; state: StudioView; message?: string; result?: unknown }
export interface StudioBridge { studio(request: StudioRequest): Promise<StudioResponse>; onStudio(fn: (state: StudioView) => void): () => void }
