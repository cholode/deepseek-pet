# 动作包示例

这里的 JSON 是开发规范的可执行目标，不是独立应用。主任务要求 Codex 实现相应的 schema、动作播放器与内置能力，然后用本示例做导入验收。

## custom-action-pack

包 ID：user.celebrations。角色兼容标识：deepblue-chibi-v1。

导入整个 custom-action-pack 文件夹。新 motion gentle_nod 完全由关键帧 JSON 定义；新动作组 celebrate 先执行点头，再并行执行内置挥手、微笑、星星和气泡。

这个样例用来检查两个扩展点：新增基本关键帧动作不改 TypeScript；新增动作组合不改 TypeScript。

内置依赖：builtin.deepblue:wave（1400ms，仅 pose）、smile（face）、sparkles（effect）。普通模式默认不显示自主气泡，但要保持 bubble 节点的时间长度。

更改 JSON 后，点击应用“重新加载”。增加其他文件时，更新 pack.json 的 motions 或 groups 列表。

## walk_right.group.json

该组属于 builtin.deepblue 包，引用 800ms 的 builtin.deepblue:walk_right motion，重复三次，与 2400ms 窗口位移并行。

该文件用于内置包实现和时间同步测试，不是带 pack.json 的完整独立导入包。
