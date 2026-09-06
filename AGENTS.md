# AGENTS.md

## 开始前

请完整读取根目录 `CODEX_DESKTOP_PET_PROMPT.md`，并查看 `reference/character-reference.png`。长任务书是本次功能需求，不要仅凭本文件的摘要开始实现。尊重现有仓库的更具体约定，不破坏用户已有内容。

## 不可变边界

本轮交付离线桌宠的完整普通模式；AI 模式仅预留契约并保持 unavailable。不要调用任何模型 API，不安装 Agents SDK，不创建 API Key 设置，不做语音、截屏分析或电脑自动化。

使用 Electron、TypeScript strict、React、PixiJS 8.x。统一动作执行器供普通随机、点击交互和手动预览调用；未来 AI 复用同一入口。

动作组和 motion 必须数据驱动。新增 JSON / 图像及更新包清单、导入或重新加载即可生效，不允许为新动作组修改 TypeScript 枚举或 switch。

完整实现顺序/并行时间轴、有限时长、通道校验、递归取消、权重与冷却、优先级及动作生命周期。包不能执行脚本或读取任意路径。

参考图是未分层截图。没有精细素材时交付可动画的分层演示角色并如实标记，不把整张背景截图当最终透明桌宠，不声称已完成未做的原图绑定。

## 工作方式

先给简短计划，直接分阶段实现、运行、修复。保留安全隔离和严格类型。不要通过禁用测试、隐藏错误或删掉核心功能宣称完成。

最终运行并记录 `npm run typecheck`、`npm run lint`、`npm run test`、`npm run build`；当前环境允许时运行 `npm run dist:win` 并验证 GUI。未执行的项目写明原因。

维护 README、动作包教程、AI 接口说明、素材来源和测试报告。区分编译通过、构建产物生成与真实 Windows GUI 验证。

## 实现文档
模块说明见 docs/ARCHITECTURE.md，中文细纲见 docs/实现细纲.md，验收状态见 docs/TEST_REPORT.md。长任务书仍是需求依据。

