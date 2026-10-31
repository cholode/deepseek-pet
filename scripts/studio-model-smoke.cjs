// 使用已配置模型和自编资料验证真实备课；所有答案均为脚本测试，不混入用户学习记录。
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const noMaterials = process.env.STUDIO_TEST_NO_MATERIALS === '1';
  const folder = path.resolve(`test-results/studio-model${noMaterials ? '-search' : ''}`); await fs.mkdir(folder, { recursive: true }); const userDir = await fs.mkdtemp(path.join(folder, 'user-'));
  const original = path.join(process.env.APPDATA, 'deepblue-desktop-pet'); const { config } = JSON.parse(await fs.readFile(path.join(original, 'companion.json'), 'utf8'));
  await fs.copyFile(path.join(original, 'companion-secrets.json'), path.join(userDir, 'companion-secrets.json'));
  // Windows 的密文还依赖原配置目录中的系统加密密钥。只复制加密配置，不解出/保存明文。
  await fs.copyFile(path.join(original, 'Local State'), path.join(userDir, 'Local State'));
  config.memory.automatic = false; config.mood.enabled = false; config.initiative.enabled = false; config.qq.enabled = false; config.mcp.enabled = false; config.speech.enabled = false;
  const env = { ...process.env, PET_TEST_USER: userDir, ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve('.'), '--panel'], env }); const errors = []; app.on('window', p => p.on('pageerror', e => errors.push(e.message)));
  const wait = async (fn, timeout = 180000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 500)); } throw new Error('真实模型备课超时'); };
  try {
    await app.firstWindow(); await wait(() => app.windows().some(p => p.url().includes('page=panel')), 15000); const panel = app.windows().find(p => p.url().includes('page=panel'));
    await app.evaluate(({ Notification }) => { Notification.isSupported = () => false; });
    // 只报告密钥是否成功解密，避免把隔离目录中的解密问题误判为服务端拒绝；不输出任何凭证。
    const initial = await panel.evaluate(() => window.pet.companion({ type: 'state' }));
    const credentials = { decryptedModelKey: Boolean(initial.state.hasSecrets.model), loadError: initial.state.error || '' };
    console.log('模型凭证状态', JSON.stringify(credentials));
    await fs.writeFile(path.join(folder, 'credentials-status.json'), JSON.stringify(credentials, null, 2));
    assert.equal(credentials.decryptedModelKey, true, '隔离测试未能读取已配置的模型凭证');
    const configured = await panel.evaluate(config => window.pet.companion({ type: 'configure', config }), config); assert.equal(configured.ok, true, configured.message);
    await panel.evaluate(() => window.pet.companion({ type: 'growth-configure', enabled: false, locked: [] }));
    const request = value => panel.evaluate(value => window.pet.studio(value), value);
    await request({ type: 'settings', settings: { webSearch: noMaterials, background: true, maxModelCalls: 20 } });
    const created = await request({ type: 'create-course', course: { title: noMaterials ? '新标准日本语初级入门' : '自编日语入门试课', edition: noMaterials ? '版本待核对' : '测试资料 v1', level: '零基础', minutes: 10, goal: '能用「私は〜です」自我介绍，认识三个人物名词；先诊断再讲解练习。' } }); assert.equal(created.ok, true, created.message); const course = created.state.data.courses[0];
    const text = '自编日语入门资料。主题一：自我介绍。私は学生です。读作「わたしはがくせいです」，意思是“我是学生”。作助词的「は」读作 wa，用来标记话题。「です」是礼貌的判断表达。「私（わたし）」是“我”，“学生（がくせい）”是学生。\n主题二：人物身份。「先生（せんせい）」是老师，「会社員（かいしゃいん）」是公司职员。「私は先生です」表示我是老师。「私は会社員です」表示我是公司职员。替换名词可介绍不同身份。\n主题三：礼貌提问。疑问句在句末加「か」：「学生ですか。」意思是“是学生吗？”肯定回答可以说「はい、学生です。」。初次见面可以说「はじめまして」，意思是“初次见面”。介绍完可说「よろしくお願いします」，是请对方多关照的礼貌表达。';
    if (!noMaterials) assert.equal((await request({ type: 'add-note', courseId: course.id, title: '自编入门讲义', text })).ok, true);
    const started = Date.now(); await request({ type: 'prepare', courseId: course.id, goal: course.goal, templateId: '', scheduledAt: 0 });
    let data; await wait(async () => { data = (await request({ type: 'state' })).state.data; return ['completed', 'failed', 'needs-review'].includes(data.workflows[0]?.status); });
    const workflow = data.workflows[0]; await fs.writeFile(path.join(folder, 'latest.json'), JSON.stringify({ userDir, workflow, lessons: data.lessons, realModel: true, model: config.model.model, scriptedAnswers: true, elapsedMs: Date.now() - started, errors }, null, 2));
    assert.equal(workflow.status, 'completed', workflow.error); console.log(`PASS 真实模型生成并检查课件：${data.lessons[0].title}，${data.lessons[0].exercises.length} 题，${workflow.calls} 次模型调用`);
    const lesson = data.lessons[0]; await request({ type: 'start-lesson', lessonId: lesson.id });
    for (const [i, exercise] of lesson.exercises.entries()) {
      const state = (await request({ type: 'state' })).state; const sessionId = state.data.sessions[0].id;
      if (i === 1) assert.equal((await request({ type: 'session', id: sessionId, action: 'hint' })).ok, true);
      const result = await request({ type: 'answer', sessionId, requestId: `scripted-answer-${i}`, answer: i === 0 ? '我不记得了，不知道怎么回答。' : exercise.answer }); assert.equal(result.ok, true, result.message);
      console.log(`PASS 脚本测试第 ${i + 1} 题：${i === 0 ? '不会回答' : i === 1 ? '提示后回答' : '参考答案输入'}，评分 ${result.state.data.sessions[0].attempts.at(-1).score}/2`);
    }
    await wait(async () => { data = (await request({ type: 'state' })).state.data; return data.workflows[1] && ['completed', 'failed'].includes(data.workflows[1].status); });
    // 在断言前保存评分证据，真实模型若误判也有完整记录可排查。
    await fs.writeFile(path.join(folder, 'latest.json'), JSON.stringify({ userDir, workflows: data.workflows, lessons: data.lessons, sessions: data.sessions, sourceCount: data.sources.length, realModel: true, model: config.model.model, scriptedAnswers: true, noMaterials, elapsedMs: Date.now() - started, errors }, null, 2));
    assert.equal(data.workflows[1].status, 'completed', data.workflows[1].error); assert.equal(data.sessions[0].status, 'completed'); assert.ok(data.sessions[0].reflection);
    assert.ok(data.sessions[0].attempts[0].score < 2, '模型不应将“不会回答”评为答对'); if (lesson.exercises.length > 1) assert.equal(data.sessions[0].attempts[1].hintUsed, true);
    for (const attempt of data.sessions[0].attempts.slice(1)) assert.equal(attempt.score, 2, `模型将已提交的参考答案误判：${attempt.feedback}`);
    console.log('PASS 真实模型评分与课后复盘，测试答案仅存在隔离工作区');
    await panel.getByRole('button', { name: '智能陪伴', exact: true }).click(); await panel.getByRole('button', { name: '学习工作室', exact: true }).click(); await panel.screenshot({ path: path.join(folder, 'real-model-classroom.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await app.close(); for (const name of ['companion-secrets.json', 'Local State']) await fs.rm(path.join(userDir, name), { force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
