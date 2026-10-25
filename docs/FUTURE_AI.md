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
