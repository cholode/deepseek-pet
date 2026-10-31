import { planSchema, type Course, type Lesson, type LessonContent, type StudySource, type StudySession, type WorkflowPlan } from '../shared/studio';

export const preparationPlan: WorkflowPlan = { name: '资料到课堂', steps: [
  { id: 'search', label: '寻找课程资料', kind: 'search', dependsOn: [] },
  { id: 'read', label: '读取与整理资料', kind: 'read', dependsOn: ['search'] },
  { id: 'outline', label: '组织课程目录', kind: 'outline', dependsOn: ['read'] },
  { id: 'lesson', label: '准备本次教案', kind: 'lesson', dependsOn: ['outline'] },
  { id: 'check', label: '核对引用与练习', kind: 'check', dependsOn: ['lesson'] },
  { id: 'publish', label: '保存课件', kind: 'publish', dependsOn: ['check'] }
] };
export function validatePlan(raw: unknown): WorkflowPlan {
  const plan = planSchema.parse(raw); const seen = new Set<string>(); const ids = new Set(plan.steps.map(s => s.id));
  if (ids.size !== plan.steps.length) throw new Error('工作流步骤 ID 重复');
  // 模型只能组合已有步骤。先校验 DAG，执行器依赖依赖关系而非模型输出的数组顺序。
  while (seen.size < ids.size) {
    const ready = plan.steps.filter(s => !seen.has(s.id) && s.dependsOn.every(d => seen.has(d)));
    if (!ready.length) throw new Error('工作流包含循环依赖或不存在的步骤');
    for (const step of ready) seen.add(step.id);
  }
  const ancestors = (id: string): string[] => { const visited = new Set<string>(); const visit = (current: string) => { for (const d of plan.steps.find(s => s.id === current)!.dependsOn) if (!visited.has(d)) { visited.add(d); visit(d); } }; visit(id); return [...visited]; };
  const prerequisites: Record<string, string[]> = { outline: ['read'], lesson: ['outline'], check: ['lesson'], publish: ['lesson', 'check'] };
  for (const step of plan.steps) {
    const kinds: string[] = ancestors(step.id).map(id => plan.steps.find(s => s.id === id)!.kind);
    if ((prerequisites[step.kind] ?? []).some(kind => !kinds.includes(kind))) throw new Error('工作流必须按读取、目录、备课、检查、发布的依赖顺序执行');
  }
  return plan;
}
function terms(text: string): Set<string> {
  const result = new Set(text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []);
  for (const part of text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? []) {
    for (let i = 0; i < part.length - 1; i++) result.add(part.slice(i, i + 2));
  }
  return result;
}
export function evidenceFor(sources: StudySource[], query: string) {
  const tokens = terms(query);
  const chunks = sources.flatMap(source => source.pages.flatMap(page => {
    const out = []; for (let i = 0; i < page.text.length; i += 1800) { const text = page.text.slice(i, i + 2000); const set = terms(text); out.push({ sourceId: source.id, title: source.title, page: page.page, text, score: [...tokens].filter(t => set.has(t)).length }); } return out;
  }));
  return chunks.sort((a, b) => b.score - a.score).slice(0, 10).map(({ sourceId, title, page, text }) => ({ sourceId, title, page, text }));
}
export function referenceMatches(reference: LessonContent['sections'][number]['references'][number], sources: StudySource[]) {
  // 空格、全角字符和引号变化不应阻断备课。只做字面定位，不把语义相近当成原文。
  const normalize = (text: string) => text.normalize('NFKC').replace(/[\s\p{P}]/gu, '');
  const page = sources.find(s => s.id === reference.sourceId)?.pages.find(p => p.page === reference.page);
  const quote = normalize(reference.quote);
  return Boolean(page && quote && normalize(page.text).includes(quote));
}
export function referenceWarnings(content: Pick<LessonContent, 'sections' | 'exercises'>, sources: StudySource[]) {
  const warnings: string[] = [];
  for (const reference of [...content.sections.flatMap(s => s.references), ...content.exercises.flatMap(e => e.references)]) {
    if (!referenceMatches(reference, sources)) warnings.push(`引用待核对：${sources.find(s => s.id === reference.sourceId)?.title ?? reference.sourceId} 第 ${reference.page} 页/段（原文未定位）`);
  }
  if ([...content.sections, ...content.exercises].some(s => !s.references.length)) warnings.push('部分内容没有原文引用，属于模型补充讲解。');
  return [...new Set(warnings)];
}
export function learnerSummary(course: Course, sessions: StudySession[]) {
  const attempts = sessions.filter(s => s.courseId === course.id).flatMap(s => s.attempts);
  const skills = [...new Set(attempts.map(a => a.skill))].map(skill => {
    const records = attempts.filter(a => a.skill === skill); const recent = records.slice(-10);
    return { skill, attempts: records.length, independentCorrect: records.filter(a => a.score === 2 && !a.hintUsed).length, recentScore: recent.reduce((sum, a) => sum + a.score, 0) / (recent.length * 2), mistakes: recent.filter(a => a.score < 2 || a.hintUsed).slice(-3).map(a => ({ answer: a.answer, correction: a.correction, hintUsed: a.hintUsed, at: a.at })) };
  });
  // 这些是答题表现，不是“长期掌握率”。保留时间和提示信息，后续复习才有可比较的依据。
  return { skills, actualAnswers: attempts.length, feedback: sessions.filter(s => s.courseId === course.id).flatMap(s => s.feedback).slice(-10), strategies: course.strategies };
}
export function lessonPresentation(lesson: Lesson, session: StudySession) {
  if (session.tutoring) return { sessionId: session.id, lessonId: lesson.id, title: lesson.title, status: session.status, methodId: session.tutoring.methodId, reply: session.tutoring.current?.reply ?? '', question: session.tutoring.current?.question ?? '', phase: session.tutoring.current?.phase ?? '', answered: session.attempts.length, summary: session.reflection };
  // 课堂展示只返回公开话语；教师内部参考答案不进入聊天上下文。
  const exercise = lesson.exercises[session.index];
  return { sessionId: session.id, lessonId: lesson.id, title: lesson.title, preparationNotes: lesson.check, status: session.status, progress: { answered: session.attempts.length, total: lesson.exercises.length }, ...(exercise && session.status !== 'completed' ? { questionId: exercise.id, skill: exercise.skill, question: exercise.question, introduction: session.index === 0 ? lesson.introduction : '', hint: session.hintUsed ? exercise.hint : undefined } : { summary: session.reflection || '本课练习结束，已保存真实作答，正在整理课后复盘。' }) };
}
export function lessonMarkdown(lesson: Lesson, sources: StudySource[]) {
  const refs = (items: LessonContent['sections'][number]['references']) => items.map(r => { const s = sources.find(s => s.id === r.sourceId); return `> ${referenceMatches(r, sources) ? '原文摘录' : '模型引用（原文待核对）'}：${s?.title ?? r.sourceId} · 第 ${r.page} 页/段 · ${s?.location ?? ''}\n> 摘录：${r.quote}`; }).join('\n\n');
  return `# ${lesson.title}\n\n版本 ${lesson.version} · ${new Date(lesson.at).toISOString()}\n\n## 学习目标\n\n${lesson.objectives.map(o => `- ${o}`).join('\n')}\n\n${lesson.introduction}\n\n${lesson.sections.map(s => `## ${s.title}\n\n${s.body}\n\n${refs(s.references)}`).join('\n\n')}\n\n## 练习\n\n${lesson.exercises.map((e, i) => `### ${i + 1}. ${e.skill}\n\n${e.question}\n\n<details><summary>提示与参考答案</summary>\n\n${e.hint}\n\n${e.answer}\n\n${e.explanation}\n\n</details>\n\n${refs(e.references)}`).join('\n\n')}\n\n## 备课检查\n\n${lesson.check}\n`;
}
