import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { zipSync, strToU8 } from 'fflate';
import { StudioService, type StudioHost } from '../src/main/studio/service';
import { StudioStore } from '../src/main/studio/store';
import { SourceReader, publicAddress, htmlText } from '../src/main/studio/sources';
import { preparationPlan, validatePlan, referenceWarnings } from '../src/companion/study';
import { normalizeLessonDraft, parseModelOutput } from '../src/main/studio/model-output';
import { grow, rollbackGrowth } from '../src/companion/growth';
import { growthDefaults, type GrowthObservation } from '../src/shared/growth';
import { evaluationSchema, lessonContentSchema, type LessonContent } from '../src/shared/studio';
import { learningRecordResult } from '../src/main/software/service';

const roots: string[] = []; const services: StudioService[] = [];
afterEach(async () => { for (const s of services.splice(0)) await s.close(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function directory() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fish-studio-')); roots.push(root); return root; }
const original = '猫は動物です。猫の読み方は「ねこ」です。日本語の名詞を練習します。';
function content(sourceId: string): LessonContent { return { title: '猫的读音', objectives: ['能回忆猫的日语读音'], introduction: '先试着回忆读音。', sections: [{ title: '名词', body: '猫读作ねこ。', references: [{ sourceId, page: 1, quote: '猫の読み方は「ねこ」です。' }] }], exercises: [{ id: 'q1', skill: '名词读音', question: '猫怎么读？', answer: 'ねこ', explanation: '猫读作ねこ。', hint: '第一个音是ね。', references: [{ sourceId, page: 1, quote: '猫の読み方は「ねこ」です。' }] }], vocabulary: [{ expression: '猫', reading: 'ねこ', meaning: '猫', example: '猫は動物です。' }] }; }
async function fixture() {
  const root = await directory(); let now = new Date(2026, 9, 29, 20, 0).getTime(); let sourceId = ''; let available = true;
  const host: StudioHost = { ready: () => true, available: () => available, now: () => now, changed: vi.fn(), notify: vi.fn(), chooseSource: vi.fn(async () => undefined), openArtifact: vi.fn(async () => {}), reviewTargets: () => [{ id: 'anki', name: '学习插件' }], recordReview: vi.fn(async () => '记录成功'), generate: vi.fn(async messages => {
    const instruction = messages[0].content || '';
    if (instruction.includes('设计备课步骤图')) return JSON.stringify(preparationPlan);
    if (instruction.includes('组织渐进课程')) return JSON.stringify([{ title: '猫的读音', objectives: ['会读猫'], references: [{ sourceId, page: 1, quote: '猫は動物です。' }] }]);
    if (instruction.includes('准备一节')) return JSON.stringify(content(sourceId));
    if (instruction.includes('独立检查')) return JSON.stringify({ passed: true, explanation: '依据与题目已核对' });
    if (instruction.includes('判断实际读取')) return JSON.stringify({ passed: true, explanation: '可用于名词入门单元' });
    if (instruction.includes('评价学生')) return JSON.stringify({ score: 2, feedback: '读音正确。', correction: 'ねこ' });
    if (instruction.includes('真实作答和用户教学反馈复盘')) return JSON.stringify({ summary: '独立回答了一题；还需要间隔复习。', strategies: ['下次用句子测试迁移'] });
    throw new Error('unexpected prompt');
  }) };
  const service = new StudioService(root, host); services.push(service); await service.start();
  const result = await service.request({ type: 'create-course', course: { title: '日语课', edition: '', level: '入门', minutes: 20, goal: '学习名词' } });
  expect(result.ok).toBe(true); const course = service.store.data.courses[0];
  await service.request({ type: 'add-note', courseId: course.id, title: '测试资料', text: original }); sourceId = service.store.data.sources[0].id;
  async function prepare() { const r = await service.request({ type: 'prepare', courseId: course.id, goal: '名词课', templateId: '', scheduledAt: 0 }); expect(r.ok).toBe(true); await service.tick(); return service.store.data.lessons[0]; }
  return { service, host, root, course, prepare, advance: (ms: number) => { now += ms; }, available: (b: boolean) => { available = b; } };
}
describe('性格慢成长', () => {
  const observation: GrowthObservation = { trait: 'verbosity', direction: -1, evidence: '请说短一点', reason: '用户多次希望简短' };
  it('必须多次真实引用；去重、锁定、每日限幅与回退都有依据', () => {
    let data = structuredClone(growthDefaults); const now = Date.now();
    data = grow(data, [observation], 'fake', '你好', now); expect(data.observations).toHaveLength(0);
    for (let i = 0; i < 2; i++) data = grow(data, [observation], `a${i}`, observation.evidence, now);
    expect(data.values.verbosity).toBe(40);
    data = grow(data, [observation], 'a1', observation.evidence, now); expect(data.observations).toHaveLength(2);
    for (let i = 2; i < 30; i++) data = grow(data, [observation], `a${i}`, observation.evidence, now);
    expect(data.values.verbosity).toBe(38); expect(data.history).toHaveLength(2);
    data.locked = ['verbosity']; data = grow(data, [observation], 'locked', observation.evidence, now + 86400000); expect(data.values.verbosity).toBe(38);
    const restored = rollbackGrowth(data, data.history[0].id, now + 1); expect(restored.values.verbosity).toBe(40); expect(restored.observations).toHaveLength(0); expect(restored.history.at(-1)?.reason).toContain('回退');
  });
});
describe('资料和工作流边界', () => {
  it('容忍模型额外字段、代码围栏、数字字符串和缺少的辅助字段，题目 ID 由宿主产生', () => {
    const draft = content('source');
    const raw = { ...draft, extra: '可忽略', exercises: [{ ...draft.exercises[0], id: '', hint: undefined, explanation: undefined, references: undefined, extra: true }, { ...draft.exercises[0], id: '' }], vocabulary: undefined };
    const parsed = parseModelOutput(`这是课件：\n\`\`\`json\n${JSON.stringify(raw)}\n\`\`\`\n完成。`, lessonContentSchema, normalizeLessonDraft);
    expect(parsed.exercises.map(e => e.id)).toEqual(['q1', 'q2']); expect(parsed.exercises[0].references).toEqual([]); expect(parsed.vocabulary).toEqual([]);
    expect(parseModelOutput('{"score":"2","feedback":"正确","correction":"ねこ","extra":1}', evaluationSchema).score).toBe(2);
    expect(() => parseModelOutput('{"score":9,"feedback":"正确","correction":""}', evaluationSchema)).toThrow();
    expect(() => parseModelOutput('{"feedback":"正确","correction":""}', evaluationSchema)).toThrow();
  });
  it('引用排版差异可以匹配，改写内容只标为待核对', () => {
    const draft = content('source'); const source = { id: 'source', courseId: 'course', title: '资料', location: '', kind: 'note' as const, at: 0, hash: '', pages: [{ page: 1, text: original }] };
    draft.sections[0].references[0].quote = '猫の読み方は ねこ です';
    expect(referenceWarnings(draft, [source])).toEqual([]);
    draft.sections[0].references[0].quote = '猫の読み方は いぬ です';
    expect(referenceWarnings(draft, [source])[0]).toContain('原文未定位');
  });
  it('学习插件必须明确确认 recorded，不能把普通响应或失败结果记成同步成功', () => {
    const result = (value: unknown) => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }] });
    expect(learningRecordResult(result({ recorded: true, sessionId: 'one' }))).toContain('one');
    expect(() => learningRecordResult(result({ recorded: false }))).toThrow('没有确认');
    expect(() => learningRecordResult(result({ message: '正在处理' }))).toThrow('没有确认');
  });
  it('保留网络和执行依赖边界；引用无法定位时给出提示', () => {
    for (const ip of ['127.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', '2001:db8::1', '203.0.113.1']) expect(publicAddress(ip)).toBe(false);
    expect(publicAddress('8.8.8.8')).toBe(true); expect(publicAddress('192.124.249.1')).toBe(true);
    expect(() => validatePlan({ name: 'bad', steps: [{ id: 'a', label: 'a', kind: 'read', dependsOn: ['b'] }, { id: 'b', label: 'b', kind: 'read', dependsOn: ['a'] }] })).toThrow('循环');
    expect(() => validatePlan({ name: 'bad', steps: [{ id: 'p', label: 'p', kind: 'publish', dependsOn: [] }] })).toThrow('检查');
    expect(referenceWarnings(content('missing'), []).join('；')).toContain('引用待核对');
  });
  it('HTML 不执行脚本，EPUB 按 spine 阅读顺序导入；URL 检索保留来源', async () => {
    expect(htmlText('<html><body><nav>无关</nav><main><p>第一段</p><script>bad()</script><p>第二段</p></main></body></html>').text).toBe('第一段\n第二段');
    const root = await directory(); const file = path.join(root, 'book.epub');
    await fs.writeFile(file, zipSync({ 'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'), 'OEBPS/content.opf': strToU8('<package><manifest><item id="b" href="b.xhtml"/><item id="a" href="a.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>'), 'OEBPS/a.xhtml': strToU8(`<html><body><p>${original}</p></body></html>`), 'OEBPS/b.xhtml': strToU8(`<html><body><p>第二章${original}</p></body></html>`) }));
    const reader = new SourceReader(); const source = await reader.file('course', file, new AbortController().signal);
    expect(source.pages.map(p => p.page)).toEqual([1, 2]); expect(source.pages[0].text).toBe(original); expect(source.pages[1].text).toContain('第二章');
    const web = new SourceReader(async url => ({ bytes: strToU8('<rss><channel><item><title>日本語</title><link>https://example.com/lesson</link><description>公开教程</description></item></channel></rss>'), type: 'application/rss+xml', url }));
    expect(await web.search('日语', new AbortController().signal)).toEqual([{ title: '日本語', url: 'https://example.com/lesson', snippet: '公开教程' }]);
  });
  it('损坏工作区保留原文；重启恢复备课、暂停课堂、外部写入标为未知', async () => {
    const f = await fixture(); const lesson = await f.prepare(); await f.service.request({ type: 'start-lesson', lessonId: lesson.id });
    const workflow = f.service.store.data.workflows[0]; workflow.status = 'running'; workflow.steps[0].status = 'running';
    f.service.store.data.sessions[0].exportState = 'pending'; await f.service.store.save(); await f.service.close();
    const store = new StudioStore(f.root); await store.load(); expect(store.data.workflows[0].status).toBe('queued'); expect(store.data.workflows[0].steps[0].status).toBe('pending'); expect(store.data.sessions[0].status).toBe('paused'); expect(store.data.sessions[0].exportState).toBe('unknown');
    await fs.writeFile(path.join(f.root, 'studio.json'), '{broken'); await expect(new StudioStore(f.root).load()).rejects.toThrow('保留'); expect(await fs.readFile(path.join(f.root, 'studio.json'), 'utf8')).toBe('{broken');
  });
});
describe('真实课堂状态机（模型与网络使用协议夹具）', () => {
  it('教师判完最后一题后结束课堂仍保存答案，纯结束请求不伪造作答', async () => {
    const f = await fixture(); const lesson = await f.prepare(); const normal = f.host.generate;
    f.host.generate = async (messages, signal) => {
      if (!messages[0].content?.includes('TUTOR_TURN')) return normal(messages, signal);
      const user = JSON.parse(messages[1].content!).conversation.at(-1).content;
      return JSON.stringify(user.startsWith('开始本课')
        ? { reply: '猫怎么读？', question: '猫怎么读？', referenceAnswer: 'ねこ', skill: '读音' }
        : { reply: '本课到这里，之后再回忆。', move: 'finish', score: 2 });
    };
    await f.service.request({ type: 'start-teaching', lessonId: lesson.id });
    const first = f.service.store.data.sessions[0];
    await f.service.request({ type: 'answer', sessionId: first.id, answer: '结束本课', requestId: 'finish-control' });
    expect(first.attempts).toHaveLength(0); expect(first.status).toBe('paused');
    await f.service.request({ type: 'session', id: first.id, action: 'resume' });
    const result = await f.service.request({ type: 'answer', sessionId: first.id, answer: 'ねこ', requestId: 'final-answer' });
    expect(result.ok).toBe(true); expect(first.status).toBe('completed'); expect(first.attempts).toHaveLength(1);
    expect(first.attempts[0]).toMatchObject({ id: 'final-answer', answer: 'ねこ', score: 2 });
    expect(f.course.nextLesson).toBe(1);
  });
  it('带学只记真实作答，追问/提示可继续同题，参考答案不回传聊天，暂停与重启保留方法', async () => {
    const f = await fixture(); const lesson = await f.prepare(); const normal = f.host.generate;
    f.host.generate = async (messages, signal) => {
      if (messages[0].content?.includes('TUTOR_COACH')) return '一次只讲一个小点。';
      if (!messages[0].content?.includes('TUTOR_TURN')) return normal(messages, signal);
      const data = JSON.parse(messages[1].content!); const user = data.conversation.at(-1).content;
      if (user.includes('提示')) return JSON.stringify({ reply: '第一个音是ね。', move: 'hint', usedHint: true, score: null });
      if (user.includes('讲短')) return JSON.stringify({ reply: '好，只看一个音。', score: 2 });
      if (user === 'ねこ') return JSON.stringify({ reply: '这次答对了。', score: 2, feedback: '读音正确。' });
      if (user.includes('休息')) return JSON.stringify({ reply: '好，先休息。', move: 'pause', score: null });
      return JSON.stringify({ reply: '试着回忆：猫怎么读？', question: '猫怎么读？', referenceAnswer: 'ねこ', skill: '读音', move: 'practice' });
    };
    const opened = await f.service.request({ type: 'start-teaching', lessonId: lesson.id }); expect(opened.ok).toBe(true); expect(JSON.stringify(opened.result)).not.toContain('ねこ');
    const session = f.service.store.data.sessions[0]; expect(session.attempts).toHaveLength(0);
    await f.service.request({ type: 'answer', sessionId: session.id, answer: '请讲短一点', requestId: 'control-1' }); expect(session.attempts).toHaveLength(0);
    await f.service.request({ type: 'session', id: session.id, action: 'hint' }); expect(session.attempts).toHaveLength(0); expect(session.tutoring?.current?.question).toBe('猫怎么读？');
    await f.service.request({ type: 'answer', sessionId: session.id, answer: 'ねこ', requestId: 'actual-1' });
    await f.service.request({ type: 'answer', sessionId: session.id, answer: 'ねこ', requestId: 'actual-1' });
    expect(session.attempts).toHaveLength(1); expect(session.attempts[0]).toMatchObject({ answer: 'ねこ', hintUsed: true, score: 2 });
    await f.service.request({ type: 'answer', sessionId: session.id, answer: '我想休息', requestId: 'stop-1' }); expect(session.status).toBe('paused'); expect(session.attempts).toHaveLength(1);
    const loaded = new StudioStore(f.root); await loaded.load(); expect(loaded.data.sessions[0].tutoring?.methodId).toBe(session.tutoring?.methodId);
    await f.service.request({ type: 'session', id: session.id, action: 'finish' }); await f.service.tick(); expect(session.status).toBe('completed'); expect(session.reflection).toContain('间隔复习');
  });
  it('不完整的模型计划回退标准流程，资料不足与检查超时不丢失可用教案', async () => {
    const f = await fixture(); const originalGenerate = f.host.generate;
    f.host.generate = async (messages, signal) => {
      const instruction = messages[0].content ?? '';
      if (instruction.includes('设计备课步骤图')) return JSON.stringify({ name: '先发布', steps: [{ id: 'publish', label: '保存', kind: 'publish', dependsOn: [] }] });
      if (instruction.includes('判断实际读取')) return JSON.stringify({ passed: false, explanation: '资料只有一小段' });
      if (instruction.includes('独立检查')) throw new Error('检查接口超时');
      return originalGenerate(messages, signal);
    };
    const lesson = await f.prepare(); expect(lesson.status).toBe('published'); expect(lesson.check).toContain('标准备课流程'); expect(lesson.check).toContain('资料只有一小段'); expect(lesson.check).toContain('检查接口超时');
    expect(f.service.store.data.workflows[0].status).toBe('completed');
  });
  it('不可解析的教案只自动修复一次；鉴权失败保留错误，不虚构课件', async () => {
    const f = await fixture(); const originalGenerate = f.host.generate; let repairs = 0;
    f.host.generate = async (messages, signal) => {
      if (messages[0].content?.includes('准备一节') && repairs++ === 0) return '这次忘记输出 JSON';
      return originalGenerate(messages, signal);
    };
    const lesson = await f.prepare(); expect(lesson.status).toBe('published'); expect(repairs).toBe(2);
    const second = await fixture(); second.host.generate = async () => { throw new Error('HTTP 401'); };
    await second.prepare(); expect(second.service.store.data.workflows[0].error).toContain('401'); expect(second.service.store.data.lessons).toHaveLength(0);
  });
  it('从原文到可打开的课件、真实回答、复盘和幂等插件同步', async () => {
    const f = await fixture(); const lesson = await f.prepare();
    expect(f.service.store.data.workflows[0].status).toBe('completed'); expect(lesson.status).toBe('published'); expect(await fs.readFile(lesson.artifact, 'utf8')).toContain('猫の読み方は「ねこ」です。');
    const start = await f.service.request({ type: 'start-lesson', lessonId: lesson.id }); expect(JSON.stringify(start.result)).not.toContain('ねこ');
    const session = f.service.store.data.sessions[0]; f.advance(12000);
    f.service.beginTurn({ id: 'real-user-1', actor: 'user', source: 'desktop', conversationId: 'desktop', text: 'ねこ', at: Date.now() });
    await f.service.call('study_answer', {}, new AbortController().signal);
    expect(session.attempts[0]).toMatchObject({ answer: 'ねこ', elapsedMs: 12000, hintUsed: false }); expect(session.status).toBe('completed');
    await f.service.call('study_answer', {}, new AbortController().signal); expect(session.attempts).toHaveLength(1);
    await f.service.tick(); expect(session.reflection).toContain('间隔复习'); expect(f.course.strategies).toEqual(['下次用句子测试迁移']);
    f.course.reviewTarget = 'anki'; expect((await f.service.request({ type: 'session', id: session.id, action: 'export-review' })).ok).toBe(true);
    await f.service.request({ type: 'session', id: session.id, action: 'export-review' }); expect(f.host.recordReview).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.host.recordReview).mock.calls[0][1]).toMatchObject({ sessionId: session.id, turns: [{ user: 'ねこ', assistant: '读音正确。' }], minutes: 0 });
    await f.service.request({ type: 'start-lesson', lessonId: lesson.id }); expect(f.course.nextLesson).toBe(1); expect(f.service.store.data.sessions).toHaveLength(1);
  });
  it('提示、暂停和跨天继续不伪造独立回忆或整夜学习用时', async () => {
    const f = await fixture(); const lesson = await f.prepare(); await f.service.request({ type: 'start-lesson', lessonId: lesson.id }); const session = f.service.store.data.sessions[0];
    await f.service.request({ type: 'session', id: session.id, action: 'hint' }); await f.service.request({ type: 'session', id: session.id, action: 'pause' }); f.advance(86400000);
    expect((await f.service.request({ type: 'answer', sessionId: session.id, answer: 'ねこ', requestId: 'a' })).ok).toBe(false);
    await f.service.request({ type: 'session', id: session.id, action: 'resume' }); f.advance(5000);
    await f.service.request({ type: 'answer', sessionId: session.id, answer: 'ねこ', requestId: 'a' }); expect(session.attempts[0]).toMatchObject({ hintUsed: true, elapsedMs: 5000 });
  });
  it('模型检查建议不阻断发布；无资料时标明通用课且可以上课', async () => {
    const f = await fixture(); const originalGenerate = f.host.generate;
    f.host.generate = async (messages, signal) => messages[0].content?.includes('独立检查') ? JSON.stringify({ passed: false, explanation: '例句不够准确' }) : originalGenerate(messages, signal);
    const lesson = await f.prepare(); const workflow = f.service.store.data.workflows[0]; expect(workflow.status).toBe('completed'); expect(lesson.status).toBe('published');
    expect(lesson.check).toContain('建议复核：例句不够准确'); expect(await fs.readFile(lesson.artifact, 'utf8')).toContain('建议复核');
    expect((await f.service.request({ type: 'start-lesson', lessonId: lesson.id })).ok).toBe(true);
    const second = await fixture(); second.service.store.data.sources = []; second.course.sourceIds = []; second.service.store.data.settings.webSearch = false;
    const generic = await second.prepare(); expect(second.service.store.data.workflows[0].status).toBe('completed'); expect(generic.check).toContain('尚未取得教材正文');
    expect(await fs.readFile(generic.artifact, 'utf8')).toContain('模型引用（原文待核对）');
  });
  it('取消耗时步骤后不发布；保存的模板可重用；提醒每天只一次', async () => {
    const f = await fixture(); const lesson = await f.prepare(); const done = f.service.store.data.workflows[0]; await f.service.request({ type: 'workflow', id: done.id, action: 'save-template' });
    const template = f.service.store.data.templates[0]; f.host.generate = (_messages, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    await f.service.request({ type: 'prepare', courseId: f.course.id, goal: '再备课', templateId: template.id, scheduledAt: 0 }); const workflow = f.service.store.data.workflows[1];
    const ticking = f.service.tick(); await vi.waitFor(() => expect(workflow.steps.some(s => s.status === 'running')).toBe(true));
    await f.service.request({ type: 'workflow', id: workflow.id, action: 'cancel' }); await ticking;
    expect(workflow.status).toBe('cancelled'); expect(f.service.store.data.lessons).toEqual([lesson]);
    f.course.reminders = true; f.course.studyTime = '19:00'; const before = vi.mocked(f.host.notify).mock.calls.length; await f.service.tick(); await f.service.tick(); expect(vi.mocked(f.host.notify).mock.calls.length).toBe(before + 1);
  });
  it('外部记录超时保留未知结果，重试沿用同一 sessionId', async () => {
    const f = await fixture(); const lesson = await f.prepare(); await f.service.request({ type: 'start-lesson', lessonId: lesson.id }); const session = f.service.store.data.sessions[0];
    await f.service.request({ type: 'answer', sessionId: session.id, answer: 'ねこ', requestId: 'answer' }); f.course.reviewTarget = 'anki';
    vi.mocked(f.host.recordReview).mockRejectedValueOnce(new Error('response lost'));
    expect((await f.service.request({ type: 'session', id: session.id, action: 'export-review' })).ok).toBe(false); expect(session.exportState).toBe('unknown');
    await f.service.request({ type: 'session', id: session.id, action: 'export-review' }); expect(vi.mocked(f.host.recordReview).mock.calls.map(c => c[1].sessionId)).toEqual([session.id, session.id]);
  });
  it('即使不关应用，跨天课堂也暂停，普通问候不自动续题', async () => {
    const f = await fixture(); const lesson = await f.prepare(); await f.service.request({ type: 'start-lesson', lessonId: lesson.id }); f.advance(86400000);
    f.service.beginTurn({ id: 'greeting', actor: 'user', source: 'desktop', conversationId: 'desktop', text: '你好', at: Date.now() });
    expect(f.service.store.data.sessions[0].status).toBe('paused'); expect(f.service.context()).toContain('不要自行继续旧话题');
    await expect(f.service.call('study_answer', {}, new AbortController().signal)).rejects.toThrow('暂停');
  });
  it('不读取无关的搜索结果，继续生成标明范围的通用入门课', async () => {
    const f = await fixture(); await f.service.close();
    const reader = new SourceReader(); reader.search = vi.fn(async () => [{ title: '完全无关的新闻', url: 'https://example.com/news', snippet: '体育' }]); reader.web = vi.fn();
    const service = new StudioService(await directory(), { ...f.host, generate: async (messages, signal) => messages[0].content?.includes('筛选与课程') ? JSON.stringify({ indexes: [], reason: '所有候选都不涉及日语学习' }) : f.host.generate(messages, signal) }, reader); services.push(service); await service.start();
    await service.request({ type: 'create-course', course: { title: '日语', edition: '', level: '', goal: '日语入门', minutes: 20 } });
    await service.request({ type: 'prepare', courseId: service.store.data.courses[0].id, goal: '日语入门', templateId: '', scheduledAt: 0 }); await service.tick();
    expect(service.store.data.workflows[0].status).toBe('completed'); expect(service.store.data.workflows[0].warnings.join('；')).toContain('没有找到相关资料'); expect(reader.web).not.toHaveBeenCalled(); expect(service.store.data.lessons[0].check).toContain('通用入门课');
  });
});
