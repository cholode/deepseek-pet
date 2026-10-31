const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const folders = process.argv.slice(2).map(p => path.resolve(p));
assert.equal(folders.length, 2, '请提供两次完整评测目录');
const runs = folders.map(folder => ({ folder, prereg: JSON.parse(fs.readFileSync(path.join(folder, 'preregistered.json'))), report: JSON.parse(fs.readFileSync(path.join(folder, 'report.json'))), transcripts: JSON.parse(fs.readFileSync(path.join(folder, 'blind-transcripts.json'))) }));
for (const key of ['model', 'temperature', 'methods', 'rubric', 'curriculum']) assert.deepEqual(runs[0].prereg[key], runs[1].prereg[key], `两轮条件不同：${key}`);
const mean = a => a.reduce((x,y) => x+y,0)/a.length;
const ranking = runs[0].report.ranking.map(row => {
  const paired = runs.map(r => r.report.ranking.find(s => s.id === row.id));
  return { id: row.id, name: row.name, anonymous: row.anonymous, ...Object.fromEntries(['logic','humanity','quality','total','meanScenarioMs'].map(k => [k,mean(paired.map(r=>r[k]))])), roundTotals: paired.map(r=>r.total), worstScenario: Math.min(...paired.map(r=>r.worstScenario)), completed: paired.reduce((n,r)=>n+r.completed,0), scenarios: paired.reduce((n,r)=>n+r.scenarios,0) };
}).sort((a,b)=>b.total-a.total || b.quality-a.quality || a.meanScenarioMs-b.meanScenarioMs);
assert.ok(ranking.every(r=>r.scenarios===12 && r.completed===12), '评测不完整，保留失败记录后再处理');
const calls=runs.flatMap(r=>r.report.calls), teacherLatency=calls.filter(c=>c.role==='teacher').map(c=>c.elapsedMs).sort((a,b)=>a-b);
const summary={ date:'2026-10-29', scope:'新版标准日本语初级上第1–3课', model:runs[0].report.model, runs:folders.map((f,i)=>({directory:path.basename(f),hash:runs[i].report.preregHash})), maxConcurrency:Math.max(...runs.map(r=>r.report.maxInFlight)), scenarios:120, teacherDialogueTurns:runs.reduce((n,r)=>n+r.transcripts.reduce((m,t)=>m+t.transcript.length,0),0), judgeRatings:240, apiCalls:calls.length, tokens:calls.reduce((n,c)=>n+(c.usage?.total_tokens||0),0), evaluationFormatRepairs:runs.reduce((n,r)=>n+(r.report.evaluationRepairs||0),0), teacherMedianMs:teacherLatency[Math.floor(teacherLatency.length*.5)],teacherP95Ms:teacherLatency[Math.floor(teacherLatency.length*.95)], ranking, selection:'两轮所有场景/评委三维等权平均；独立盲审另列，不事后改权重。差距小，不据此宣称统计显著或真人长期记忆最优。', limitations:runs[0].report.limitations };
const directory=path.resolve('docs/evaluations/teaching-2026-10-29');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(summary,null,2));
fs.writeFileSync('src/shared/teaching-selection.json',JSON.stringify({methodId:ranking[0].id,evaluation:'docs/evaluations/teaching-2026-10-29/summary.json',scope:summary.scope,score:ranking[0].total,replicates:2},null,2)+'\n');
// 把模拟对话、评分证据和冻结方案一起保存；不能只留漂亮的汇总分。
for (const [i, run] of runs.entries()) {
  for (const [source, target] of [['preregistered.json', 'protocol'], ['blind-transcripts.json', 'transcripts'], ['report.json', 'automatic-report']]) {
    fs.copyFileSync(path.join(run.folder, source), path.join(directory, `${target}-round-${i + 1}.json`));
  }
  const evidence = fs.readdirSync(run.folder).filter(name => /^C\d{2}-lesson-\d-.+\.json$/.test(name)).map(name => {
    const { transcript, ...record } = JSON.parse(fs.readFileSync(path.join(run.folder, name)));
    return record;
  });
  fs.writeFileSync(path.join(directory, `judge-evidence-round-${i + 1}.json`), JSON.stringify(evidence, null, 2));
}
const independentPath = path.join(directory, 'independent-review.json');
const independent = fs.existsSync(independentPath) ? JSON.parse(fs.readFileSync(independentPath)) : undefined;
const two = n => n.toFixed(2);
const scoreTable = ranking.map((r, i) => `| ${i + 1} | ${r.name} | ${two(r.logic)} | ${two(r.humanity)} | ${two(r.quality)} | ${two(r.total)} | ${r.roundTotals.map(two).join(' / ')} |`).join('\n');
const flows = runs[0].prereg.methods.map(m => `| ${m.name} | ${m.stages.join(' → ')} | ${m.remediation} |`).join('\n');
const reviewTable = independent?.ratings.slice().sort((a,b) => b.total-a.total).map(r => `| ${r.anonymous} | ${ranking.find(m => m.anonymous === r.anonymous).name} | ${r.logic} | ${r.humanity} | ${r.quality} | ${r.total.toFixed(1)} |`).join('\n') || '| 未执行 | — | — | — | — | — |';
const document = [
  '# 十种 Agent 教学工作流评测与接入',
  '',
  '日期：2026-10-29。主程序版本保持 1.5.0，插件版本未因本次教学选择而调整。',
  '',
  '## 结果',
  '',
  `两轮真实模型测试合并后，主动回忆与交错（retrieval）以 ${two(ranking[0].total)} 分最高，已设为新带学课堂的默认方法。独立 Codex Agent 在不知道方法映射和自动排名时也把该候选 C05 排在第一，83.3 分。第二名与第一名只差 ${two(ranking[0].total-ranking[1].total)} 分，不能据此声称对真人显著更有效。`,
  '',
  '默认流程是：短诊断 → 最小讲解 → 闭卷回忆 → 换词交错 → 稍后再取回 → 复习约定。阶段是教学建议，学生追问、要求缩短或停止时优先回应实际意图；不会强迫用户逐格走完流程。',
  '',
  '## 课程范围与依据',
  '',
  '按用户确认的第 1–3 课测试：身份介绍；指示物品与所属；地点介绍与询问。使用自编知识摘要和新例句，没有取得或复制整本教材正文，也不声称完整覆盖书上每个词汇、练习或听力内容。',
  '',
  '- [济南大学课程大纲](https://wyxy.ujn.edu.cn/info/1031/3701.htm)列出第 1–3 课标题与课程范围；该大纲所用版本为 2005 年版。',
  '- [人民教育出版社第二版介绍](https://www.pep.com.cn/products/jc/dwhytsh/201711/t20171107_1920490.shtml)与[光村图书教材介绍](https://www.mitsumura-tosho.co.jp/shoseki/nihongo/s)用于核对教材定位。',
  '- [日本国际交流基金指示词教学资料](https://www.kyozai.jpf.go.jp/kyozai/material/BTS00015/ja/render.do)用于核对指示词关系。具体自编资料与探针见冻结方案中的 curriculum；更多来源说明见 [SOURCES.md](../../../scripts/teaching/SOURCES.md)。',
  '',
  '## 十种流程设计',
  '',
  '| 方法 | 阶段 | 出错时如何帮助 |',
  '| --- | --- | --- |',
  flows,
  '',
  '十种流程共用事实资料、模型、输出契约和评价方法；阶段顺序与补救策略不同。教练—教师协作还实际增加一个教练模型调用，再由教师生成对外回复，不是只换角色名字。其余采用单个教师调用和宿主状态管理。',
  '',
  '## 测试与评分协议',
  '',
  `使用用户已配置的 DeepSeek deepseek-flash，关闭深度思考，教师温度 0.4。两轮均实际并发 10 条方法流水线，每条依次测试三课 × 两种学生画像（新手、较自信但可能混淆者）。共 ${summary.scenarios} 个场景、${summary.teacherDialogueTurns} 次教师回复、${summary.judgeRatings} 份盲评、${summary.apiCalls} 次模型请求。模型返回累计 ${summary.tokens.toLocaleString('en-US')} tokens。测试没有创建语音、麦克风输入或 Anki 写入，也没有使用用户真实课堂作答。`,
  '',
  '每场景八轮：开场、动态学生回应、固定错误探针、合理等价答案探针、要求缩短、迁移请求、动态学生回应、明确停止。动态学生只看公开对话和画像，不读取教师知识摘要、隐藏答案或方法说明。固定探针用于施压和比较，不代表完整自然课堂。',
  '',
  '教学逻辑、像人程度、教学质量三维等权，各含五项 0–20 分指标，合计各 100 分。两名自动评委不知道方法名、内部提示或排名，必须给轮次证据。两位自动评委仍使用相同模型，存在相关偏差；独立 Codex 盲审单列，未在看到结果后修改总分权重。',
  '',
  '方案与量表在运行前保存。第一轮分差较小，完整重复全部十种方法，以两轮所有场景和评委的均值选择，不挑有利轮次。第二轮一份评委 JSON 格式失败，教师八轮对话与第一份有效评分均保留，仅补足缺失的第二评委；原失败原因仍在 judge-evidence-round-2.json 的 evaluationError。没有把教师失败样本删除后重跑取最好结果。',
  '',
  '| 排名 | 方法 | 教学逻辑 | 像人程度 | 教学质量 | 综合 | 第一轮 / 第二轮 |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  scoreTable,
  '',
  `十种方法均完成 12/12 场景。教师单次请求中位数 ${summary.teacherMedianMs} ms，P95 ${summary.teacherP95Ms} ms，仅是本机本次网络和并发条件下的 API 耗时，不含学生思考或语音。教练—教师协作每场景均值约 ${(ranking.find(r=>r.id==='team').meanScenarioMs/1000).toFixed(1)} 秒，获胜流程约 ${(ranking[0].meanScenarioMs/1000).toFixed(1)} 秒；本次增加代理并没有换来更高质量。`,
  '',
  '## 独立匿名复核',
  '',
  '独立审查覆盖第一轮六十场景的关键响应；审查者读取匿名转录、知识范围和量表，没有读取方法映射、自动评分或排名。这仍是 AI 审查，不是人类教师实验。',
  '',
  '| 匿名号 | 揭盲后方法 | 教学逻辑 | 像人程度 | 教学质量 | 综合 |',
  '| --- | --- | ---: | ---: | ---: | ---: |',
  reviewTable,
  '',
  '具体优缺点及逐轮证据见 [independent-review.json](independent-review.json)。主要观察：',
  '',
  '- 获胜流程较稳定地区分当堂回忆与长期记忆；疲劳时缩短，复习安排较具体。第一轮六十个末轮都尊重明确停课，没有继续要求回答新题。',
  '- 部分方法把正确完整句「ここは図書館です」按“本来想要短答”扣分；这属于不公平评分，不能把表达风格偏好当语法错误。',
  '- 部分指示词场景在交换说话者时位置视角不一致；不能仅凭自然口吻认定知识正确。',
  '- 有的方法给“解释短一点”等非作答请求赋分；已在生产宿主里分离课堂控制请求与实际答题记录，增加回归。提示也由宿主保存到后续作答。',
  '- 原始教师输出 usedHint 表示“本轮教师提供了提示”；它并不单独证明学生使用了上一轮提示。生产记录结合历史提示状态与真实提交保存 hintUsed，不能直接把两类标记逐行比较。',
  '',
  '## 落地架构与入口',
  '',
  '资料与教案 → 选定教学策略 → 单个教师调用 → 短回复与当前任务 → 宿主保存公开对话/提示状态/真实作答 → 课后复盘 → 已配置且已授权的学习记录插件。',
  '',
  '小屋 → 智能陪伴 → 学习工作室 → 准备下一课 → 老师带我学。原自主练习入口保留。可直接追问、请求提示、暂停、继续，至少有一次实际作答后可以结束本课并复盘；聊天中的 study_tutor 使用同一服务。',
  '',
  'src/companion/teaching.ts 是评测和应用共用的十种策略与单轮执行器；src/shared/teaching-selection.json 保存本轮选择与证据路径。每个新带学课堂快照方法 ID，更新默认方法不改旧课堂。StudioService 负责当前题、真实消息绑定、请求去重、提示依赖、用时、暂停与恢复；参考答案不会出现在对外课堂呈现中。阶段和反思都不执行模型生成的任意代码。',
  '',
  '宽松教学校验保留：允许模型围栏和额外字段，缺失评分不伪造“答对”；解析失败只修复一次。宿主对真实作答的记录规则不作为卡住上课的质量门槛。教师判完最后一题后直接结束课堂时，宿主也先保留真实答案；纯粹请求结束不会伪造成答对。',
  '',
  '选中方法另经生产 StudioService + 真实模型的三个新课堂验证：真实备课、开始带学、缩短请求、提示、脚本作答、重复请求去重、暂停、复盘和重启恢复均通过，33 次模型调用，无外部写入。这里的答案由脚本提交，不能视为真人成绩。报告见 [production-integration.json](production-integration.json)。界面及构建检查见 [TEST_REPORT.md](../../TEST_REPORT.md)。',
  '',
  '## 证据与复现',
  '',
  '- [汇总](summary.json)、[第一轮冻结协议](protocol-round-1.json)、[第二轮冻结协议](protocol-round-2.json)。原始协议哈希保存在汇总 runs 字段。',
  '- [第一轮匿名转录](transcripts-round-1.json)、[第二轮匿名转录](transcripts-round-2.json)、[第一轮评委证据](judge-evidence-round-1.json)、[第二轮评委证据](judge-evidence-round-2.json)。',
  '- automatic-report-round-1.json / automatic-report-round-2.json 保留逐次调用耗时与 token 用量。仅复制模拟资料和调用统计，不复制密钥或用户资料目录。',
  '',
  '在已配置模型且可解密密钥的 Windows 用户下运行 npm run test:teaching-benchmark；第二轮设置 TEACHING_REPLICATE=2。完成后以两个结果目录作为参数运行 node scripts/teaching-report.cjs <第一轮目录> <第二轮目录>。生产集成可用 node scripts/teaching-integration.cjs 运行。这些模型测试会产生实际 API 用量，汇总脚本会更新默认选择文件；不需要语音或 Anki。',
  '',
  '模拟学生与模型评委无法证明隔天、隔周的记忆收益，也没有检测发音、听力、真实课堂疲劳或整本教材覆盖。当前默认方案是本次有限比较的胜出者，后续应结合真实使用反馈与延迟回忆继续检验。',
  ''
].join('\n');
fs.writeFileSync(path.join(directory, 'REPORT.md'), document);
console.log(JSON.stringify({directory,selected:ranking[0].id,score:ranking[0].total,scenarios:summary.scenarios}));
