# 不修改 TypeScript，扩展动作包

本版只导入文件夹，不导入 ZIP，不执行插件脚本。一个包至少包含 `pack.json` 和一个动作组 JSON；需要新动作时再加入 motion 或 PNG/WebP。

## 最短上手

复制项目中的 `examples/custom-action-pack`。打开小屋 → 动作组 → 导入动作包 → 选择这个文件夹。它将注册：

- `user.celebrations:gentle_nod`：700ms 新的头部关键帧动作。
- `user.celebrations:celebrate`：点头 → 招手、微笑、星星和气泡并行 → 等待。

预览忽略随机资格、权重、冷却和随机条件，但不会绕过禁用、拖动锁定、角色兼容和固定位置。组必须先启用才能预览。

## 新增组合动作

例如新建 `my-pet-pack/pack.json`：

```json
{
  "schemaVersion": 1,
  "id": "user.myday",
  "name": "我的日常动作",
  "version": "1.0.0",
  "avatarId": "deepblue-chibi-v1",
  "description": "使用已有角色能力组合新动作。",
  "motions": [],
  "groups": ["groups/hello.json"]
}
```

创建 `my-pet-pack/groups/hello.json`：

```json
{
  "schemaVersion": 1,
  "id": "hello",
  "name": "午后问候",
  "description": "挥挥手，送一句轻轻的问候。",
  "tags": ["问候", "日常"],
  "enabled": true,
  "random": { "eligible": true, "weight": 2, "cooldownMs": 30000 },
  "conditions": { "minIdleMs": 5000, "requiresRoaming": false, "requiresPointerAway": false },
  "maxDurationMs": 1900,
  "timeline": {
    "type": "parallel",
    "children": [
      { "type": "motion", "motionId": "builtin.deepblue:wave", "repeat": 1 },
      { "type": "expression", "expressionId": "smile", "durationMs": 1400 },
      { "type": "bubble", "text": "休息一下，再继续吧。", "durationMs": 1400 }
    ]
  }
}
```

直接导入这个文件夹。新组完整 ID 是 `user.myday:hello`。**无需重新编译**。注意：界面覆盖参数保存在 settings，不会回写这些原始 JSON。

## 新增关键帧 motion

`examples/custom-action-pack/motions/gentle_nod.json` 已是可用实例。它按 `head.rotationDeg` 和 `head.offsetY` 插值，时长 700ms；在 pack.json 的 motions 清单加入文件路径，再由组用完整 ID 引用。

公开节点：`root`、`body`、`head`、`hairBack`、`hairFront`、`armLeft`、`armRight`、`eyes`、`mouth`、`effects`。

属性：`offsetX/offsetY` 是设计坐标相对偏移；`rotationDeg` 是相对旋转角；`scaleX/scaleY` 为基准缩放乘数；`alpha` 为 0～1 绝对透明度。关键帧必须含 `timeMs:0` 和 `durationMs`，严格递增。easing 为 linear、easeInOut、easeOut，定义前一帧到此帧的插值。头身发臂属于 pose，眼嘴属于 face，effects 节点属于 effect；声明通道必须与实际轨道一致。

默认画布 340×420。PNG 部件定位是共享画布上的设计基准；实际支点可见 `Avatar.ts` 的 pivot 表。新增 motion 不应改变永久基准。

## 图片序列

本机真实示例：`resources/builtin/motions/frame_magic.json`，使用 `assets/frame-0.png` 至 `frame-3.png`。格式如下：

```json
{
  "schemaVersion": 1,
  "id": "my_frames",
  "name": "我的逐帧动作",
  "kind": "frame_animation",
  "avatarId": "deepblue-chibi-v1",
  "durationMs": 800,
  "channels": ["pose", "face"],
  "frames": ["assets/frame-0.png", "assets/frame-1.png", "assets/frame-2.png", "assets/frame-3.png"],
  "fps": 5,
  "canvas": { "width": 340, "height": 420 },
  "anchor": { "x": 0.5, "y": 0.9285714285714286 }
}
```

可以删除 fps 改用 `frameDurationsMs:[200,200,200,200]`，但两者只能选一个，总和必须等于 durationMs。所有图片的真实尺寸要与 canvas 一致。帧列表不能空，最大 240 帧。播放时隐藏分层树，结束或取消时恢复。

## 动作树能力

| 节点 | 字段与语义 |
|---|---|
| sequence | children 按顺序播放 |
| parallel | children 同时启动，等待最长分支；通道重叠直接拒绝 |
| motion | motionId 为完整 ID，repeat 为 1～20 的有限整数 |
| expression | expressionId + durationMs，占 face |
| move_by | dxDip / dyDip / durationMs / easing，占 movement，改变真实窗口位置 |
| effect | effectId + durationMs，占 effect |
| bubble | text + durationMs，占 bubble；关闭显示时仍保留时间长度 |
| wait | durationMs，不占通道 |

表情：neutral、smile、shy、annoyed、sleep、surprised。特效：sparkles、hearts、sleepy、splash。内置 wave 固定 1400ms，walk_right 周期 800ms；它们都只占 pose。

顺序时长求和、并行取最大；maxDurationMs 要比预计时长至少多 100ms，且不超过 30 秒。树最大深度 8、节点总数 128。不允许零/负时长、无限循环、NaN、Infinity 或未知字段。

## 导入与重新加载

导入先检查来源、复制到临时目录、再次校验，再提交。相同 packId 弹出是否替换的原生提示。用户包不能冒用 `builtin.*`。用户包目录名需等于 packId（导入时会自动这样命名）。

更新时在小屋点击“打开用户动作包目录”，编辑**已导入副本**。增加文件必须更新 pack.json 的 motions/groups 清单。点击“重新加载”预校验和预加载成功后生效。坏包错误可在动作页提示或运行错误区查看；旧版本会保留，不把半成品显示成成功。

用户覆盖与 JSON 分离：启用、随机开关、权重、冷却以完整 groupId 存储，重载保留。权重 0 仅排除随机，不影响手动预览。删除组留下的孤立覆盖不会执行任何动作。

## 文件与资源限制

每包最多 100 MB、1000 个文件和目录，目录深度最多 12。JSON 单文件最多 1 MB。图片只接受 PNG/WebP，单图最大 4096×4096，估算解码总量最多 256 MB。路径必须是包内相对路径，禁止绝对路径、`..`、网络路径、反斜杠、编码逃逸、符号链接和目录联接。包中不接受 JS/TS/HTML/SVG；原创内部 SVG 仅在开发资产脚本中使用，不是用户包可执行资源。

`schemas/*.schema.json` 由相同 Zod 结构通过 `npm run schemas` 生成，可配置编辑器文件关联进行补全。JSON Schema 表达字段结构；路径安全、通道交叉引用、帧时长总和等跨字段约束仍由运行时校验，不能仅靠编辑器提示判定有效。
# 睡姿及独立图层扩展（1.1.2）

`conditions.requiresStanding: true` 是所有命令来源均须遵守的入口条件：当前有前景动作时拒绝开始该组，不抢占现有动作。基础待机是站立姿态；动作完成或取消由统一执行器 reset 恢复站立。

`frame_animation` 可选 `displayScale`（默认 1）、`layers` 和 `hitAreas`。`layers` 是位于序列帧后方的独立图片列表，字段为包内 `image`、画布位置 `x/y`、图片内支点 `pivotX/pivotY`、正弦旋转幅度 `rotationDeg`、周期 `periodMs`。图片须已加载并通过包路径校验。`hitAreas` 使用帧画布坐标，每项为 `target: head|body`、`x/y/width/height`，随缩放更新鼠标区域。

`effect` 节点可选 `origin: {x,y}`，为 sleepy 特效的起始设计坐标（相对角色脚底），Z 向右上方移动并淡出。特效独立于隐藏的站立角色，完成、取消、失败均清理。示例见内置 `motions/sleep.json` 与 `groups/sleep_short.json`。
