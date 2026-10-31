import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { AnkiLauncher } from './launch.mjs';

const defaults = { profile: '', level: '入门', dailyMinutes: 20, newCards: 5, time: '20:00', days: [1, 2, 3, 4, 5, 6, 0], deck: '大肥鱼::日语', reviewDeck: '大肥鱼::日语', logDeck: '大肥鱼::学习记录', port: 8765 };
const text = (max = 2000) => ({ type: 'string', minLength: 1, maxLength: max });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const empty = object({});
const tokenSchema = object({ token: text(80) });
const lessonRecordSchema = object({ sessionId: text(100), topic: text(200), summary: text(4000), corrections: { type: 'string', maxLength: 4000 }, minutes: { type: 'integer', minimum: 0, maximum: 600 }, turns: { type: 'array', minItems: 1, maxItems: 20, items: object({ user: text(1000), assistant: text(1500) }) }, vocabulary: { type: 'array', maxItems: 30, items: object({ expression: text(200), reading: { type: 'string', maxLength: 200 }, meaning: text(500), example: { type: 'string', maxLength: 500 } }) } });
export const tools = [
  { name: 'anki_launch', description: '用户要求打开 Anki 或开始需要 Anki 的学习时，可启动绑定目录中的 Anki，并等待本机 AnkiConnect 就绪。无需先保存学习计划；已连接时不重复启动。只在用户提出相关任务时调用，不在闲聊或后台提醒时启动。依据 connected 区分已发起启动和已连接；失败时如实说明。不能安装 Anki 或 AnkiConnect。', inputSchema: empty },
  { name: 'anki_status', description: '读取 Anki 连接、当前用户、牌组、日语程度、学习计划、到期数量与今天的真实练习记录。开始日语练习先调用此工具，按程度用日语一次问一个问题，用中文解释纠错；Anki 未连接时不能声称已记录。', inputSchema: empty },
  { name: 'anki_settings_save', description: '保存日语学习计划及目标牌组；只能按用户明确要求修改。提醒开关由用户在小屋开启。不会修改 Anki 设置或创建卡片。', inputSchema: object({ settings: object({ profile: text(100), level: { enum: ['入门', 'N5', 'N4', 'N3', 'N2', 'N1'] }, dailyMinutes: { type: 'integer', minimum: 1, maximum: 120 }, newCards: { type: 'integer', minimum: 0, maximum: 50 }, time: text(5), days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, minItems: 1, maxItems: 7, uniqueItems: true }, deck: text(120), reviewDeck: text(120), logDeck: text(120), port: { type: 'integer', minimum: 1, maximum: 65535 } }) }) },
  { name: 'anki_practice_start', description: '开始或恢复一轮日语对话练习，返回 sessionId 和学习计划。按用户程度选话题，一次问一句并等待回答；不要代用户回答。每轮有实质回答后调用 anki_practice_record 保存真实对话、纠错与生词。长练习先记录再开新轮；不要把聊天记成正式卡片复习。', inputSchema: object({ topic: text(100) }) },
  { name: 'anki_practice_record', description: '把已发生的日语练习保存到 Anki：练习日志卡自动暂停；生词另建可复习卡。只写真实对话，纠错必须有依据；不能虚构用户回答。使用 start 返回的 sessionId，同一轮重试不会重复建卡。调用成功才可说已记录；反馈中报告保存数量。学习分钟由实际开始时间计算。', inputSchema: object({ sessionId: text(80), summary: text(1500), corrections: { type: 'string', maxLength: 2000 }, turns: { type: 'array', minItems: 1, maxItems: 12, items: object({ user: text(1000), assistant: text(1000) }) }, vocabulary: { type: 'array', maxItems: 6, items: object({ expression: text(200), reading: { type: 'string', maxLength: 200 }, meaning: text(500), example: { type: 'string', maxLength: 500 } }) } }) },
  { name: 'anki_lesson_record', description: '学习工作室的课程记录接口。保存真实作答与反馈、实际用时、本课词表；同一 sessionId 重试幂等。日志暂停，词汇去重，不能替代 Anki 复习评分。只记录已经发生的课堂，不能代用户编造答案。', inputSchema: lessonRecordSchema },
  { name: 'anki_review_next', description: '打开计划牌组的 Anki 原生复习界面，沿用原生队列、学习步长与计时取题。只返回题面与 token。等用户真实作答后 reveal，再等用户自评。媒体卡请查看 Anki。', inputSchema: empty },
  { name: 'anki_review_reveal', description: '用户作答后，使用 review_next 的 token 读取卡片答案。解释后请用户明确选择：1 重来、2 困难、3 良好、4 简单，等待用户选择后才能调用 grade。', inputSchema: tokenSchema },
  { name: 'anki_review_grade', description: '只有用户已看答案并明确选择评分后才调用：1 重来、2 困难、3 良好、4 简单。将真实评分交给 Anki 调度并写入其复习历史；不可代用户评分。同一 token 最多提交一次，未知结果不自动重试。', inputSchema: object({ token: text(80), ease: { type: 'integer', minimum: 1, maximum: 4 } }) },
  { name: 'anki_reminder', description: '只读检查今天学习计划是否到提醒时间；由小屋的计划提醒开关启用。返回提醒或 null，不发送通知、不写卡片、不运行模型。', inputSchema: empty }
];
function validate(value, schema, label = '参数') {
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${label}选项无效`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}应是对象`);
    if (Object.keys(value).some(k => !Object.hasOwn(schema.properties, k))) throw new Error(`${label}含未知字段`);
    for (const k of schema.required) if (!Object.hasOwn(value, k)) throw new Error(`缺少 ${k}`);
    for (const [k, v] of Object.entries(value)) validate(v, schema.properties[k], k);
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > schema.maxLength) throw new Error(`${label}长度无效`);
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value) || value < schema.minimum || value > schema.maximum) throw new Error(`${label}范围无效`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > schema.maxItems || (schema.uniqueItems && new Set(value).size !== value.length)) throw new Error(`${label}数量无效`);
    value.forEach(v => validate(v, schema.items, label));
  }
}
const html = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]).replace(/\n/g, '<br>');
const plain = value => String(value).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<\/?(?:br|hr|div|p|li|tr|h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000);
const day = at => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
const cardStamp = c => hash([c.cardId, c.note, c.deckName, c.type, c.queue, c.due, c.interval, c.reps, c.lapses, c.mod, c.question, c.answer]);

export class AnkiPlugin {
  constructor(directory, { request = fetch, now = Date.now, softwareDirectory, launcher = new AnkiLauncher(softwareDirectory) } = {}) { this.directory = directory; this.file = path.join(directory, 'study.json'); this.request = request; this.now = now; this.launcher = launcher; this.state = { version: 1, settings: { ...defaults }, sessions: [], reviews: [] }; }
  async load() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const stat = await fs.stat(this.file); if (stat.size > 4 * 1024 * 1024) throw new Error('学习状态文件过大');
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.sessions) || !Array.isArray(data.reviews)) throw new Error('学习状态格式无效');
      this.validateSettings(data.settings); this.state = data;
    } catch (e) { if (e.code !== 'ENOENT') throw new Error(`学习状态无法读取，已保留原文件：${e.message}`); }
  }
  async save() { await fs.writeFile(`${this.file}.tmp`, JSON.stringify(this.state), 'utf8'); await fs.rename(`${this.file}.tmp`, this.file); }
  validateSettings(s) {
    validate({ settings: s }, tools.find(t => t.name === 'anki_settings_save').inputSchema);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) throw new Error('提醒时间应为 HH:mm');
    for (const key of ['profile', 'deck', 'reviewDeck', 'logDeck']) if (!s[key].trim() || /[\r\n"*\\]/.test(s[key])) throw new Error(`${key}不能为空或含引号、星号、反斜线、换行`);
    if (s.deck === s.logDeck || s.reviewDeck === s.logDeck) throw new Error('学习记录牌组须与生词及复习牌组分开');
  }
  async api(action, params = {}, signal, port = this.state.settings.port) {
    let response;
    try { response = await this.request(`http://127.0.0.1:${port}`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(8000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, version: 6, params }) }); }
    catch (e) { if (signal?.aborted) throw e; throw new Error(`无法连接 AnkiConnect（127.0.0.1:${port}）。请打开 Anki、安装并启用 AnkiConnect 后重试。`); }
    if (!response.ok) throw new Error(`AnkiConnect HTTP ${response.status}`);
    const raw = await response.text(); if (raw.length > 4 * 1024 * 1024) throw new Error('Anki 返回数据过大，请缩小复习牌组');
    const result = JSON.parse(raw);
    if (result.error) throw new Error(`Anki：${String(result.error).slice(0, 300)}`);
    if (!Object.hasOwn(result, 'result')) throw new Error('AnkiConnect 响应格式无效');
    return result.result;
  }
  async profile(signal) {
    const profile = await this.api('getActiveProfile', {}, signal);
    if (!this.state.settings.profile) throw new Error('请在小屋读取并保存日语学习计划，确认 Anki 用户后再开始学习');
    if (profile !== this.state.settings.profile) throw new Error('Anki 当前用户与学习计划不一致，请切回原用户或重新配置');
    return profile;
  }
  async status(signal) {
    const version = await this.api('version', {}, signal); if (version < 6) throw new Error('需要 AnkiConnect API v6');
    const activeProfile = await this.api('getActiveProfile', {}, signal), decks = await this.api('deckNames', {}, signal);
    const s = this.state.settings;
    const due = await this.api('findCards', { query: `deck:${quote(s.reviewDeck)} is:due -is:suspended` }, signal);
    let reviewStats, reviewWarning;
    try {
      // Anki 换日点可在凌晨；先取两个 Anki 日的候选，再按本地午夜筛 revlog，避免漏掉 0–4 点。
      const reviewed = await this.api('findCards', { query: `deck:${quote(s.reviewDeck)} rated:2` }, signal);
      if (reviewed.length > 2000) throw new Error('今天复习卡片超过统计上限，请在 Anki 查看完整统计');
      const records = reviewed.length ? await this.api('getReviewsOfCards', { cards: reviewed }, signal) : {};
      const start = new Date(this.now()); start.setHours(0, 0, 0, 0);
      const rows = Object.entries(records).flatMap(([cardId, rows]) => rows.filter(r => r.id >= start.getTime() && r.ease >= 1 && r.ease <= 4).map(r => ({ ...r, cardId })));
      reviewStats = { day: day(this.now()), cards: new Set(rows.map(r => r.cardId)).size, count: rows.length, timeMs: rows.reduce((n, r) => n + Math.max(0, r.time || 0), 0) };
      this.state.reviewStats = reviewStats;
    } catch (e) { signal?.throwIfAborted(); reviewWarning = `正式复习统计暂不可用：${e.message}`; }
    const minutes = this.minutesToday();
    return { settings: { ...s, profile: s.profile || activeProfile }, summary: `Anki 已连接 · 当前用户：${activeProfile} · 待复习 ${due.length} 张 · 今天已记录约 ${minutes} 分钟。${reviewStats ? `正式复习 ${reviewStats.count} 次、${reviewStats.cards} 张不同卡片。` : reviewWarning}${s.profile ? '' : '请先保存计划以绑定此用户。'}`, activeProfile, decks: decks.slice(0, 80), due: due.length, minutes, reviewStats, reviewWarning,
      practice: this.state.sessions.filter(s => !s.external && !s.result && this.now() - s.at < 2 * 3600000).map(s => ({ sessionId: s.id, topic: s.topic })),
      review: this.state.reviews.filter(r => !r.consumed && this.now() - r.at < 3600000).map(r => ({ token: r.token, revealed: r.revealed })) };
  }
  minutesToday() { return this.state.sessions.filter(s => s.result && s.day === day(this.now())).reduce((n, s) => n + s.minutes, 0) + Math.floor((this.state.reviewStats?.day === day(this.now()) ? this.state.reviewStats.timeMs : 0) / 60000); }
  async model(name, fields, front, back, signal) {
    const names = await this.api('modelNames', {}, signal);
    if (!names.includes(name)) await this.api('createModel', { modelName: name, inOrderFields: fields, css: '.card { font: 24px sans-serif; text-align: left; line-height: 1.8; } .reading { color: #667; }', cardTemplates: [{ Name: '大肥鱼', Front: front, Back: back }] }, signal);
    const actual = await this.api('modelFieldNames', { modelName: name }, signal);
    if (JSON.stringify(actual) !== JSON.stringify(fields)) throw new Error(`${name} 字段与插件不兼容，请保留原笔记并检查笔记类型`);
  }
  async addUnique(modelName, deckName, key, fields, signal) {
    const tag = `dafeiyu-key-${key}`, found = await this.api('findNotes', { query: `tag:${tag}` }, signal);
    if (found.length) return { id: found[0], created: false };
    const id = await this.api('addNote', { note: { deckName, modelName, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, html(v)])), options: { allowDuplicate: false }, tags: ['dafeiyu', tag] } }, signal);
    if (!Number.isSafeInteger(id)) throw new Error('Anki 未确认笔记保存成功');
    return { id, created: true };
  }
  async record(args, signal) {
    await this.profile(signal);
    const session = this.state.sessions.find(s => s.id === args.sessionId);
    if (!session) throw new Error('找不到练习轮次，请先开始日语练习');
    if (session.result) return session.result;
    if (session.payload && hash(session.payload) !== hash(args)) throw new Error('本轮已有待完成的记录，请使用原内容重试');
    if (!session.payload && this.now() - session.at > 2 * 3600000) throw new Error('练习超过两小时，请开始新一轮，不补记不确定时长');
    // 先固定内容与时长；失败重试按唯一标签恢复，避免重复笔记或夸大学习时间。
    if (!session.payload) { session.payload = args; session.minutes ??= Math.max(1, Math.min(120, Math.ceil((this.now() - session.at) / 60000))); session.day = day(this.now()); await this.save(); }
    const s = this.state.settings;
    await this.api('createDeck', { deck: s.deck }, signal); await this.api('createDeck', { deck: s.logDeck }, signal);
    await this.model('大肥鱼 日语 v1', ['Key', 'Expression', 'Reading', 'Meaning', 'Example'], '{{Expression}}', '{{FrontSide}}<hr id="answer"><div class="reading">{{Reading}}</div>{{Meaning}}<br>{{Example}}', signal);
    await this.model('大肥鱼 练习记录 v1', ['Key', 'Date', 'Topic', 'Minutes', 'Summary', 'Corrections', 'Transcript'], '{{Date}} · {{Topic}}', '{{FrontSide}}<hr>{{Minutes}} 分钟<br>{{Summary}}<br>{{Corrections}}<hr>{{Transcript}}', signal);
    const noteIds = [];
    for (const word of args.vocabulary) {
      const key = hash([s.deck, word.expression.trim(), word.reading.trim()]);
      const note = await this.addUnique('大肥鱼 日语 v1', s.deck, key, { Key: key, Expression: word.expression, Reading: word.reading, Meaning: word.meaning, Example: word.example }, signal); noteIds.push(note.id);
    }
    const key = session.id;
    const log = await this.addUnique('大肥鱼 练习记录 v1', s.logDeck, key, { Key: key, Date: session.day, Topic: session.topic, Minutes: session.minutes, Summary: args.summary, Corrections: args.corrections, Transcript: args.turns.map(t => `我：${t.user}\n大肥鱼：${t.assistant}`).join('\n\n') }, signal);
    const cards = await this.api('findCards', { query: `nid:${log.id}` }, signal);
    if (cards.length) await this.api('suspend', { cards }, signal);
    session.result = { recorded: true, sessionId: session.id, logNoteId: log.id, vocabularyNoteIds: [...new Set(noteIds)], minutes: session.minutes, message: '练习记录已保存；日志卡已暂停，生词可正常复习。此记录不计入 Anki 正式复习次数。' };
    delete session.payload; await this.save(); return session.result;
  }
  pending(token) {
    const review = this.state.reviews.find(r => r.token === token);
    if (!review || review.consumed || this.now() - review.at > 3600000) throw new Error('此复习凭据已使用或过期，请获取下一张卡片；不要重复评分');
    return review;
  }
  async current(review, signal) {
    await this.profile(signal);
    const native = await this.api('guiCurrentCard', {}, signal);
    if (!native || native.cardId !== review.cardId) throw new Error('Anki 当前卡片已改变，请重新取卡');
    const cards = await this.api('cardsInfo', { cards: [review.cardId] }, signal), card = cards[0];
    if (!card || cardStamp(card) !== review.stamp || card.queue < 0) throw new Error('卡片已在 Anki 中改变，请重新取卡，不提交旧评分');
    return card;
  }
  async call(name, args, signal) {
    const tool = tools.find(t => t.name === name); if (!tool) throw new Error('未知工具');
    validate(args, tool.inputSchema); signal?.throwIfAborted();
    if (name === 'anki_launch') return this.launcher.open(async probeSignal => {
      const version = await this.api('version', {}, probeSignal);
      if (!Number.isInteger(version) || version < 6) throw new Error('需要 AnkiConnect API v6');
      const activeProfile = await this.api('getActiveProfile', {}, probeSignal);
      if (typeof activeProfile !== 'string' || !activeProfile) throw new Error('Anki 尚未打开用户集合');
      return { activeProfile };
    }, this.state.settings.profile, signal);
    if (name === 'anki_status') {
      try { return { connected: true, ...await this.status(signal) }; }
      catch (e) { signal?.throwIfAborted(); return { connected: false, settings: this.state.settings, summary: e.message }; }
    }
    if (name === 'anki_settings_save') {
      this.validateSettings(args.settings);
      const active = await this.api('getActiveProfile', {}, signal, args.settings.port);
      if (active !== args.settings.profile) throw new Error('请填写 Anki 当前打开的用户名称');
      if (this.state.settings.profile && (this.state.settings.profile !== active || this.state.settings.port !== args.settings.port)) throw new Error('更换 Anki 用户或接口时请新建软件关联，以隔离学习记录');
      const old = this.state.settings; this.state.settings = { ...args.settings };
      try { await this.save(); } catch (e) { this.state.settings = old; throw e; }
      if (old.reviewDeck !== args.settings.reviewDeck) { for (const review of this.state.reviews) if (!review.consumed) review.consumed = 'plan-changed'; await this.save(); }
      return { settings: this.state.settings, summary: '学习计划已保存；需要提醒时，请开启下方计划提醒。' };
    }
    if (name === 'anki_reminder') {
      const s = this.state.settings, now = new Date(this.now()), scheduled = Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3)), minutes = now.getHours() * 60 + now.getMinutes();
      if (!s.profile || !s.days.includes(now.getDay()) || minutes < scheduled || minutes > scheduled + 120 || this.minutesToday() >= s.dailyMinutes) return null;
      return { key: `${day(this.now())}:${s.time}`, text: `该学日语啦！今天计划练习 ${s.dailyMinutes} 分钟（${s.level}），已经记录 ${this.minutesToday()} 分钟。来和大肥鱼聊几句，或打开 Anki 复习吧。` };
    }
    if (name === 'anki_practice_start') {
      await this.profile(signal);
      let session = this.state.sessions.find(s => !s.external && !s.result && this.now() - s.at < 2 * 3600000);
      if (!session) { session = { id: randomUUID(), topic: args.topic, at: this.now() }; this.state.sessions = [...this.state.sessions.slice(-999), session]; await this.save(); }
      return { sessionId: session.id, topic: session.topic, settings: this.state.settings, instruction: '用日语提一个适合此程度的问题并等待回答。真实交流后及时保存这一轮；纠错用中文。不要代答。' };
    }
    if (name === 'anki_practice_record') return this.record(args, signal);
    if (name === 'anki_lesson_record') {
      await this.profile(signal);
      const id = `lesson-${hash(args.sessionId)}`;
      let session = this.state.sessions.find(s => s.id === id);
      if (!session) {
        // 使用宿主提供的真实课堂编号和计时；后台等待、隔夜暂停不算学习时长。
        session = { id, topic: args.topic, at: this.now(), minutes: args.minutes, external: true };
        this.state.sessions = [...this.state.sessions.slice(-999), session]; await this.save();
      }
      return this.record({ sessionId: id, summary: args.summary, corrections: args.corrections, turns: args.turns, vocabulary: args.vocabulary }, signal);
    }
    if (name === 'anki_review_next') {
      await this.profile(signal);
      const existing = this.state.reviews.find(r => !r.consumed && this.now() - r.at < 3600000);
      if (existing) { try { const card = await this.current(existing, signal); return { token: existing.token, question: plain(card.question), revealed: existing.revealed }; } catch { signal?.throwIfAborted(); existing.consumed = 'changed'; await this.save(); } }
      const s = this.state.settings;
      if (!await this.api('guiDeckReview', { name: s.reviewDeck }, signal)) throw new Error('无法打开复习牌组，请检查牌组名称');
      if (!await this.api('guiReviewActive', {}, signal)) return { done: true, message: 'Anki 当前没有排到可复习卡片；可能已完成，或正在等待学习步长。请以 Anki 的下次复习时间为准。' };
      const native = await this.api('guiCurrentCard', {}, signal);
      if (!native?.cardId) throw new Error('Anki 没有返回当前复习卡片');
      const [card] = await this.api('cardsInfo', { cards: [native.cardId] }, signal);
      if (!card || card.cardId !== native.cardId || card.queue < 0) throw new Error('卡片状态已变，请重试取卡');
      if (card.deckName !== s.reviewDeck && !card.deckName.startsWith(`${s.reviewDeck}::`)) throw new Error('Anki 当前复习牌组已改变，请重新取卡');
      const started = new Set(this.state.reviews.filter(r => r.wasNew && r.day === day(this.now())).map(r => r.cardId));
      if (card.type === 0 && !started.has(card.cardId) && started.size >= s.newCards) return { done: true, message: '已达到插件今天的新卡上限。没有重排或跳过 Anki 队列；可以继续对话，或在 Anki 中调整新卡计划。' };
      await this.api('guiShowQuestion', {}, signal);
      if (!await this.api('guiStartCardTimer', {}, signal)) throw new Error('Anki 复习计时未能启动');
      const review = { token: randomUUID(), cardId: card.cardId, at: this.now(), stamp: cardStamp(card), wasNew: card.type === 0, day: day(this.now()), revealed: false };
      this.state.reviews = [...this.state.reviews.slice(-499), review]; await this.save();
      return { token: review.token, question: plain(card.question), message: '请先让用户作答；尚未显示答案、尚未评分。媒体卡请在 Anki 查看原卡。' };
    }
    if (name === 'anki_review_reveal') {
      const review = this.pending(args.token), card = await this.current(review, signal);
      if (!await this.api('guiShowAnswer', {}, signal)) throw new Error('Anki 未显示答案');
      const native = await this.api('guiCurrentCard', {}, signal);
      if (native.cardId !== review.cardId || !Array.isArray(native.buttons) || !native.buttons.length) throw new Error('Anki 评分选项无法确认');
      review.revealed = true; review.buttons = native.buttons; await this.save();
      return { token: review.token, answer: plain(card.answer), choices: Object.fromEntries(native.buttons.map((ease, i) => [ease, { label: ['', '重来', '困难', '良好', '简单'][ease], interval: native.nextReviews?.[i] ?? null }])), instruction: '这些是 Anki 当前卡片的实际评分选项与预计间隔。请用户自评并等待选择，不要代评分。' };
    }
    if (name === 'anki_review_grade') {
      const review = this.pending(args.token); if (!review.revealed) throw new Error('请先显示答案并让用户选择评分');
      await this.current(review, signal);
      const native = await this.api('guiCurrentCard', {}, signal);
      if (native.cardId !== review.cardId) throw new Error('Anki 当前卡片已改变，请重新取卡');
      if (!native.buttons?.includes(args.ease)) throw new Error('此卡片当前没有这个评分选项，请重新显示答案');
      // 在请求前消耗凭据。响应丢失时宁可要求检查 Anki，也不重复写复习历史。
      review.consumed = 'pending'; await this.save();
      try {
        const result = await this.api('guiAnswerCard', { ease: args.ease }, signal);
        if (result !== true) throw new Error('Anki 未确认评分');
        review.consumed = 'graded'; review.ease = args.ease; await this.save(); return { graded: true, cardId: review.cardId, ease: args.ease, message: '评分已交给 Anki，复习历史及下次计划由 Anki 更新。' };
      } catch (e) { throw new Error(`评分结果未确认，请在 Anki 检查；此 token 不会再次提交。${e.message}`); }
    }
  }
}
