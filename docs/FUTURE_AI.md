# 未来 AI 接口（本轮禁用）

当前只有普通驱动。界面 AI 项禁用。`checkMode('ai')` 和绑定 AI 来源的命令入口返回 `MODE_NOT_AVAILABLE`，检查发生在停止正常驱动之前。因此错误的 AI 切换不会破坏普通模式。

## 已实现的契约

- `src/shared/contracts.ts`：PetCommand、CommandReceipt、PetSnapshot、GroupCapability、PetControlPort、PetEvent、BehaviorContext、IBehaviorDriver。
- `src/renderer/pet/PetRuntime.ts`：`port(source)` 绑定来源；`submit` 校验协议、命令 ID、到期、权限、可用性、频率和优先级。
- `src/renderer/pet/behavior.ts`：真实 NormalBehaviorDriver 与不可用模式检查。
- `tests/core.test.ts`：AI 不可用不会停止普通驱动；AI 命令不能执行；幂等、过期和权限行为测试。

## 未来接法

主进程中的模型服务将订阅受限交互事件和只读快照，读取动态 `listCapabilities()`，选择可用 `groupId` 后通过受限桥接调用现有控制端口。新增 JSON 组会自动出现在能力目录，无需修改工具枚举。

未来模型服务不能持有 Pixi 节点、不能写窗口 bounds、不能指定命令 source 或优先级。接收结果只表示 accepted/rejected，真实完成通过 action_lifecycle 实例事件确认。取消、移动限制和拖动锁仍由同一个运行时管理。

本次不安装模型 SDK，不创建 Key 设置，不提供假聊天、假回复或随机行为伪装的 AI。生成角色设定图是开发过程中的素材制作，不是应用运行时的 AI 功能。
