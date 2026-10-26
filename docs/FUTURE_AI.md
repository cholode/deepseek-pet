# AI 接口与智能陪伴 · 1.5.0

1.4.0 按用户后续要求实现了可选智能陪伴，下面历史记录中的“本轮禁用”不再代表当前版本。首次启动仍关闭 AI；配置模型并启用后才开放 AI 命令来源。完整说明见 [智能陪伴使用与架构](COMPANION.md)。

## 当前接口

- `src/shared/companion.ts`：配置、事件、记忆、情绪、展示、受限 IPC 请求与响应的 Zod 契约。
- `src/companion/ports.ts`：`ModelPort`、`ToolPort`、`RepositoryPort`、`CompanionHost`，核心逻辑无需 Electron 即可测试。
- `src/main/companion/service.ts`：主进程装配、保存、QQ 检查、主动性调度。配置及聊天 IPC 只允许可信小屋窗口调用。
- `src/main/pet-chat-windows.ts` 与 `src/renderer/chat/`：悬停输入、蓝色矩形自适应气泡与流式显示。
- `src/renderer/pet/companion-presentation.ts`：完整回复 → 一次本地朗读；评价动作 → `PetRuntime.port('ai')`。正文流与动作事件分离。
- `PetRuntime` 保留既有命令 ID、TTL、限频、优先级、拖动锁和取消规则。禁用智能陪伴会撤销当前 AI 动作。

优先级仍为系统 100、手动 80、点击 60、AI 40、普通 10。模型不能自选来源、操作 Pixi 节点、写窗口边界或运行动作包脚本。动作映射使用当前能力目录，没有第二套动画执行器；accepted 只表示已接受，完成仍由生命周期事件表示。

## 模型与工具

模型适配器支持兼容 Chat Completions 的服务及 function calling。MCP 使用官方 SDK 的 Streamable HTTP；先发现，再由用户逐项授权。每轮最多四次工具操作、两轮工具交互，真实结果送回同一决策模型。QQ 和主动搭话不暴露电脑工具。

取消会阻止迟到结果写入记忆或播放动作，并中断后续请求；已经在外部软件执行的操作不具备通用撤销能力。

## 扩展边界

目前一套模型、一个 QQ 会话，旧 MCP 设置保留单端点；1.5.0 软件插件框架支持多个 stdio/HTTP 服务。向量检索、SQLite、多模型路由、OAuth、游戏感知与持续任务规划仍是后续扩展方向。原设计文档不等于这些能力全部落地。

<details><summary>1.3.x 及以前的接口历史（禁用描述仅适用于旧版本）</summary>

# 未来 AI 接口（本轮禁用）

下一阶段方案见 [大肥鱼大模型宠物系统设计](大肥鱼大模型宠物系统设计.md)，涵盖模型、MCP、软件和游戏适配。该文件是设计稿，当前运行模式与下述实现状态不变。

当前只有普通驱动。界面 AI 项禁用。`checkMode('ai')` 和绑定 AI 来源的命令入口返回 `MODE_NOT_AVAILABLE`，检查发生在停止正常驱动之前。因此错误的 AI 切换不会破坏普通模式。

1.3.13 目录增加“被拎起挣动”，共有 33 组。组件动画与拖动绑定仍通过同一有限动作执行器；系统在用户拖动期间重新提交有限周期，非系统来源仍返回 `DRAG_LOCKED`。没有新增 AI 权限或模型服务。

1.3.19 仅放宽真实用户的拖动范围；动作命令及未来 AI 的 `move_by` 继续受工作区限制，不开放任意窗口位置写入。

## 已实现的契约

1.3.17 的拖动惯性只消费主进程的鼠标采样与动作包的受限数值参数。它不增加动作能力、AI 权限或外部服务；AI 模式仍不可用。

- `src/shared/contracts.ts`：PetCommand、CommandReceipt、PetSnapshot、GroupCapability、PetControlPort、PetEvent、BehaviorContext、IBehaviorDriver。
- `src/renderer/pet/PetRuntime.ts`：`port(source)` 绑定来源；`submit` 校验协议、命令 ID、到期、权限、可用性、频率和优先级。
- `src/renderer/pet/behavior.ts`：真实 NormalBehaviorDriver 与不可用模式检查。
- `tests/core.test.ts`：AI 不可用不会停止普通驱动；AI 命令不能执行；幂等、过期和权限行为测试。

## 未来接法

主进程中的模型服务将订阅受限交互事件和只读快照，读取动态 `listCapabilities()`，选择可用 `groupId` 后通过受限桥接调用现有控制端口。新增 JSON 组会自动出现在能力目录，无需修改工具枚举。

1.3.9 内置目录现有 32 组，包括超级害羞的闭眼、遮脸和蒸汽组合、GIF 提取的提裙摇摇，以及十二种独立玩手机表情；它们仍由同一个有限动作树执行。共用身体与表情图集仅属于帧动画内部实现，控制契约仍只选择动态能力目录中的 groupId。新增表情没有开放模型参数写入、脚本执行或 AI 来源权限，AI 模式继续不可用。

未来模型服务不能持有 Pixi 节点、不能写窗口 bounds、不能指定命令 source 或优先级。接收结果只表示 accepted/rejected，真实完成通过 action_lifecycle 实例事件确认。取消、移动限制和拖动锁仍由同一个运行时管理。

本次不安装模型 SDK，不创建 Key 设置，不提供假聊天、假回复或随机行为伪装的 AI。生成角色设定图是开发过程中的素材制作，不是应用运行时的 AI 功能。

</details>

## 1.5.0 软件工具扩展

`CompanionCoordinator` 新增可选 `ToolPort`，接入独立的软件插件宿主。工具按软件实例命名、逐项授权并绑定内容指纹和定义签名，只有桌面聊天能调用；四次调用/两轮决策与取消边界保持。旧 MCP 设置继续兼容。此版只实现通用插件接入，不包含具体软件操作或通用视觉控制。详见 [软件插件规范](SOFTWARE_PLUGINS.md)。
