# Anki 启动能力验证（1.1.0，2026-10-27）

主程序保持 1.5.0，仅插件新增 `anki_launch`。状态、计划、练习与复习的数据格式未变。

- `npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 通过，共 253 项测试、18 个测试文件。新增 8 项覆盖路径/数据布局、目录联接越界、启动错误、异常退出、当前用户不匹配、取消、重复调用及无任意命令入口。
- 源码 Windows GUI 验证通过：小屋加载 9 项工具，保存授权后，“帮我打开 Anki”经过模型工具路由和实际 MCP 子进程，接口已在线时返回已运行。原计划、对话记录、复习、提醒、重启和最小窗口检查仍通过。模型和 Anki API 为协议夹具，不代表真实模型教学验证。
- `scripts/anki-launch-smoke.cjs` 使用实际 Windows Anki 和实际 MCP 子进程，在已有测试集合的副本上完成冷启动：`started=true`、`connected=true`、当前用户为测试用户；第二次调用 `started=false`、`connected=true`。测试结束只退出该隔离实例，未向用户集合新增笔记或评分。
- 冷启动测试需要 `ANKI_LAUNCH_TEST_APP` 指向现有 Anki 安装目录，`ANKI_LAUNCH_TEST_DATA` 指向仓库 `test-results` 内的隔离集合。程序文件通过硬链接/目录联接复用；测试集合独立复制并使用随机端口和 `ANKI_SINGLE_INSTANCE_KEY`。初次测试未设独立实例标识，启动被已有 Anki 单实例接收而等待超时；修正测试隔离后通过，未更改产品启动逻辑。
- 冷启动报告：`test-results/anki-launch-Da2Aox/report.json`。基础 GUI 报告：`test-results/anki/gui-report.json`。

这次验证不包含修复原有取卡队列、复习计时或进度问题；这些问题仍见 [20词评估](USER_AUDIT.md)。
