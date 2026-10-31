// 真实 Electron 窗口与 IPC/磁盘/HTTP，模型用确定性夹具，不代表真实学习效果。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

function pdf() {
  const stream = 'BT /F1 18 Tf 50 750 Td (Japanese lesson: cat is neko. Study words with examples.) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n'; const offsets = [0]; objects.forEach((o, i) => { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${o}\nendobj\n`; }); const start = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return text;
}
(async () => {
  const packaged = Boolean(process.env.PET_TEST_EXECUTABLE); const folder = path.resolve(`test-results/studio${packaged ? '-packaged' : ''}`); await fs.mkdir(folder, { recursive: true });
  const userDir = await fs.mkdtemp(path.join(folder, 'user-')); const pdfPath = path.join(userDir, 'sample.pdf'); await fs.writeFile(pdfPath, pdf());
  const checks = [], errors = [], calls = []; const check = text => { checks.push(text); console.log('PASS', text); };
  let sourceId = ''; let app, panel;
  const plan = { name: '资料到课堂', steps: ['search', 'read', 'outline', 'lesson', 'check', 'publish'].map((kind, i, list) => ({ id: kind, kind, label: ['找资料', '读资料', '课程目录', '备课', '检查', '保存'][i], dependsOn: i ? [list[i - 1]] : [] })) };
  const reference = () => ({ sourceId, page: 1, quote: '猫の読み方は「ねこ」と説明されています。' });
  const backend = http.createServer(async (req, res) => {
    try {
      const parts = []; for await (const part of req) parts.push(part); const body = JSON.parse(Buffer.concat(parts).toString()); calls.push(body);
      const instruction = body.messages[0].content; let value;
      if (instruction.includes('TUTOR_COACH')) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: '接住当轮问题，只给一个小提示，再等待学生回答。' } }] })); return;
      }
      if (instruction.includes('TUTOR_TURN')) {
        const payload = JSON.parse(body.messages.find(m => m.role === 'user').content);
        const user = payload.conversation.at(-1)?.content || '';
        value = { reply: '先回忆一下，猫怎么读？', question: '猫怎么读？', referenceAnswer: 'ねこ', skill: '读音', move: 'practice', score: null, feedback: '', usedHint: false, phase: '当堂回忆' };
        if (user.includes('提示')) value = { ...value, reply: '第一个音是ね，试着接出后一个音。', question: '', referenceAnswer: '', move: 'hint', usedHint: true };
        // 故意返回错误的成绩，验证宿主不会把教学节奏请求当作一次作答。
        else if (user === '请讲短一点') value = { ...value, reply: '好，只看这一题：猫怎么读？', score: 2, feedback: '这不是实际作答，宿主应忽略这条成绩。' };
        else if (user === 'ねこ') value = { ...value, reply: '读对了，是ねこ。刚才用过提示，稍后再自己回忆一次。', question: '', referenceAnswer: '', move: 'teach', score: 2, feedback: '猫的读音回答正确；本次使用过提示。' };
        else if (user.includes('先停课')) value = { ...value, reply: '好，今天先停在这里，想继续时再叫我。', question: '', referenceAnswer: '', move: 'pause' };
      }
      else if (instruction.includes('设计备课步骤图')) value = plan;
      else if (instruction.includes('组织渐进课程')) value = [{ title: '猫的读音', objectives: ['读出猫'], references: [reference()] }];
      else if (instruction.includes('准备一节')) value = { title: '猫的读音', objectives: ['读出猫'], introduction: '试着回忆一下。', sections: [{ title: '日语名词', body: '猫读作 **ねこ**。', references: [reference()] }], exercises: [{ id: 'q1', skill: '名词', question: '猫怎么读？', answer: 'ねこ', explanation: '读作ねこ。', hint: '第一个音是ね。', references: [reference()] }], vocabulary: [{ expression: '猫', reading: 'ねこ', meaning: '猫', example: '猫は動物です。' }] };
      else if (instruction.includes('独立检查')) value = { passed: false, explanation: '例句较少，建议再加一句' };
      else if (instruction.includes('判断实际读取')) value = { passed: true, explanation: '可用于名词入门单元' };
      else if (instruction.includes('评价学生')) value = { score: 2, feedback: '读音正确，记得稍后复习。', correction: 'ねこ' };
      else if (instruction.includes('真实作答和用户教学反馈复盘')) value = { summary: '提示后回答正确，需要间隔复习。', strategies: ['下节课加入句子练习'] };
      else if (instruction.includes('额外输出 growth') || body.messages.some(m => m.content?.includes('额外输出 growth'))) value = { emotion: 'calm', delta: 0, confidence: .95, reason: '收到表达反馈', memories: [], growth: [{ trait: 'verbosity', direction: -1, evidence: '请说短一点', reason: '用户明确希望简短' }] };
      else {
        const tools = body.messages.filter(m => m.role === 'tool'); const user = body.messages.findLast(m => m.role === 'user')?.content;
        const message = user === 'ねこ' && !tools.length ? { content: null, tool_calls: [{ id: `answer-${Date.now()}`, type: 'function', function: { name: 'study_answer', arguments: '{}' } }] } : { content: user === 'ねこ' ? '答得对，课堂记录已保存。' : '好的，我会慢慢调整。' };
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message }] })); return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
    } catch (e) { errors.push(e.message); res.writeHead(500).end(); }
  });
  await new Promise(r => backend.listen(0, '127.0.0.1', r));
  const wait = async (fn, label) => { const end = Date.now() + 45000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(`等待超时：${label}`); };
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = async () => {
    app = await electron.launch({ ...(packaged ? { executablePath: path.resolve(process.env.PET_TEST_EXECUTABLE), args: ['--panel'] } : { args: [path.resolve('.'), '--panel'] }), env }); app.on('window', p => p.on('pageerror', e => errors.push(e.message)));
    await app.firstWindow(); await wait(() => app.windows().some(p => p.url().includes('page=panel')), '小屋'); panel = app.windows().find(p => p.url().includes('page=panel'));
    await app.evaluate(({ Notification }) => { Notification.isSupported = () => false; });
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click(); await panel.getByRole('button', { name: '学习工作室', exact: true }).click();
  };
  const state = async () => (await panel.evaluate(() => window.pet.studio({ type: 'state' }))).state;
  const request = value => panel.evaluate(value => window.pet.studio(value), value);
  try {
    await launch();
    await panel.evaluate(async baseUrl => { const { state } = await window.pet.companion({ type: 'state' }); const config = state.data.config; config.enabled = true; config.model.model = 'studio-fixture'; config.model.baseUrl = baseUrl; config.memory.automatic = false; config.mood.enabled = false; config.initiative.enabled = false; config.speech.enabled = false; const result = await window.pet.companion({ type: 'configure', config }); if (!result.ok) throw new Error(result.message); }, `http://127.0.0.1:${backend.address().port}`);
    await panel.getByLabel('课程名称', { exact: true }).fill('GUI 日语课堂'); await panel.getByRole('button', { name: '建立课程', exact: true }).click(); await wait(async () => (await state()).data.courses.length === 1, '建立课程'); const course = (await state()).data.courses[0];
    await panel.getByText('粘贴学习资料', { exact: true }).click(); await panel.getByLabel('学习资料正文').fill('猫は動物です。猫の読み方は「ねこ」です。日本語の名詞を練習します。'); await panel.getByRole('button', { name: '保存资料', exact: true }).click(); await wait(async () => (await state()).data.sources.length === 1, '保存资料'); sourceId = (await state()).data.sources[0].id;
    check('小屋建立课程与资料，正文和来源真实落盘');
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, pdfPath);
    const imported = await request({ type: 'import-source', courseId: course.id }); assert.equal(imported.ok, true, imported.message); assert.ok((await state()).data.sources.some(s => s.pages.some(p => p.text.includes('Japanese lesson')))); check('真实 PDF.js 提取 PDF 文字层与页码');
    await panel.getByRole('button', { name: '准备下一课', exact: true }).click(); await wait(async () => (await state()).data.workflows[0]?.status === 'completed' || (await state()).data.workflows[0]?.status === 'failed', '备课'); let data = (await state()).data;
    assert.equal(data.workflows[0].status, 'completed', data.workflows[0].error); assert.equal(data.lessons[0].status, 'published'); const lesson = data.lessons[0]; assert.ok((await fs.readFile(lesson.artifact, 'utf8')).includes('模型引用（原文待核对）')); assert.ok(lesson.check.includes('建议复核')); await panel.getByText('备课说明与核对意见', { exact: true }).click(); assert.ok(await panel.getByText('建议复核：例句较少，建议再加一句', { exact: false }).count()); check('引用不匹配与检查建议不会阻断，课件和界面明确显示待核对说明');
    await panel.getByRole('button', { name: '保存为工作流模板', exact: true }).click(); await wait(async () => (await state()).data.templates.length === 1, '模板');
    await panel.getByRole('button', { name: '开始 / 继续这课', exact: true }).click(); await panel.getByLabel('课堂答案').waitFor(); await panel.getByRole('button', { name: '给我提示', exact: true }).click(); await wait(async () => (await state()).data.sessions[0]?.hintUsed, '提示');
    await panel.screenshot({ path: path.join(folder, 'classroom.png'), fullPage: true }); await app.close(); app = undefined; await launch(); data = (await state()).data;
    assert.equal(data.sessions[0].status, 'paused'); assert.equal(data.sessions[0].hintUsed, true); assert.equal(data.templates.length, 1); check('重启保留课件、模板、提示与进度，课堂暂停等待明确继续');
    await panel.getByRole('button', { name: '继续课堂', exact: true }).click(); const chat = await panel.evaluate(() => window.pet.companion({ type: 'chat', text: 'ねこ' })); assert.equal(chat.ok, true, chat.message);
    await wait(async () => (await state()).data.sessions[0]?.reflection, '课后复盘'); data = (await state()).data;
    assert.equal(data.sessions[0].attempts[0].answer, 'ねこ'); assert.equal(data.sessions[0].attempts[0].hintUsed, true); assert.equal(data.sessions[0].status, 'completed'); assert.deepEqual(data.courses[0].strategies, ['下节课加入句子练习']); check('聊天工具只采用真实消息作答，提示信息、评分、课后策略均保存');
    const guided = async () => (await state()).data.sessions.find(s => s.tutoring);
    const sendToTeacher = async text => {
      const before = (await guided()).tutoring.turns.length;
      await panel.getByLabel('带学课堂输入', { exact: true }).fill(text);
      await panel.getByRole('button', { name: '发送给老师', exact: true }).click();
      await wait(async () => (await guided()).tutoring.turns.length > before, `带学回应：${text}`);
    };
    await panel.getByRole('button', { name: '老师带我学', exact: true }).click();
    await wait(async () => (await guided())?.tutoring.current, '老师开场');
    let guidedSession = await guided(); assert.equal(guidedSession.tutoring.methodId, 'retrieval'); assert.equal(guidedSession.attempts.length, 0);
    assert.equal((await state()).data.sessions.length, 2); assert.equal(await panel.getByLabel('课堂答案', { exact: true }).count(), 0);
    assert.ok(!(await panel.getByRole('log', { name: '带学课堂对话', exact: true }).innerText()).includes('ねこ'), '未作答参考答案不能出现在带学对话里');
    await sendToTeacher('请讲短一点'); guidedSession = await guided(); assert.equal(guidedSession.attempts.length, 0); assert.equal(guidedSession.tutoring.current.question, '猫怎么读？');
    check('带学使用获胜方法，隐藏参考答案；讲短请求即使被模型打分也不记成绩');
    const beforeHint = guidedSession.tutoring.turns.length;
    await panel.getByRole('button', { name: '给我一点提示', exact: true }).click();
    await wait(async () => { const session = await guided(); return session.hintUsed && session.tutoring.turns.length > beforeHint; }, '带学提示');
    assert.ok(!(await panel.getByRole('log', { name: '带学课堂对话', exact: true }).innerText()).includes('ねこ'), '提示不能直接显示完整参考答案');
    await sendToTeacher('ねこ'); guidedSession = await guided();
    assert.equal(guidedSession.attempts.length, 1); assert.equal(guidedSession.attempts[0].answer, 'ねこ'); assert.equal(guidedSession.attempts[0].score, 2); assert.equal(guidedSession.attempts[0].hintUsed, true);
    await panel.screenshot({ path: path.join(folder, 'guided-classroom.png'), fullPage: true });
    check('带学通过真实输入提问与作答，提示依赖保留，正确答案只记录一次');
    await sendToTeacher('今天先停课，不再做新题。'); guidedSession = await guided(); assert.equal(guidedSession.status, 'paused'); assert.equal(guidedSession.attempts.length, 1);
    await panel.getByRole('button', { name: '结束本课并复盘', exact: true }).click();
    await wait(async () => { const session = await guided(); return session.status === 'completed' && session.reflection; }, '带学课后复盘');
    guidedSession = await guided(); assert.equal(guidedSession.exportState, 'none'); assert.equal((await state()).data.courses[0].nextLesson, 1);
    check('带学停课不新增成绩，结束后生成复盘，同一课不重复推进课程');
    await panel.getByRole('button', { name: '性格成长', exact: true }).click();
    for (let i = 0; i < 3; i++) { const r = await panel.evaluate(() => window.pet.companion({ type: 'chat', text: '请说短一点' })); assert.equal(r.ok, true, r.message); }
    const growth = await panel.evaluate(async () => (await window.pet.companion({ type: 'state' })).state.data.growth); assert.equal(growth.values.verbosity, 39); assert.equal(growth.history.length, 1);
    await panel.getByRole('button', { name: '恢复到这次变化前', exact: true }).click(); await wait(async () => (await panel.evaluate(async () => (await window.pet.companion({ type: 'state' })).state.data.growth.values.verbosity)) === 40, '回退'); check('三次明确反馈仅成长一点；小屋可查看依据并回退');
    await panel.getByRole('button', { name: '学习工作室', exact: true }).click();
    await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=panel')); if (w.isMaximized()) await new Promise(r => { w.once('unmaximize', r); w.unmaximize(); }); w.setSize(800, 620); });
    await wait(async () => await panel.evaluate(() => innerWidth <= 800), '小窗口'); assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await panel.screenshot({ path: path.join(folder, 'small-window.png') }); check('最小窗口可滚动且无横向溢出');
    const pet = app.windows().find(p => p.url().includes('page=pet')); const forbidden = await pet.evaluate(async () => { try { await window.pet.studio({ type: 'create-course', course: { title: '拒绝', edition: '', level: '', minutes: 20, goal: '越权' } }); return false; } catch { return true; } }); assert.equal(forbidden, true); check('宠物渲染窗口不能调用小屋的学习管理 IPC');
    assert.deepEqual(errors, []); await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ checks, errors, modelFixture: true, realWindows: true, realPdf: true, userDir, calls: calls.length }, null, 2));
  } finally { if (app) await app.close(); backend.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
