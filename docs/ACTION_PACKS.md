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
| expression | expressionId + durationMs，占 face；可选 fadeInMs / fadeOutMs 为进入/退出的平滑过渡时长，两者总和不得超过 durationMs |
| move_by | dxDip / dyDip / durationMs / easing，占 movement，改变真实窗口位置 |
| effect | effectId + durationMs，占 effect |
| bubble | text + durationMs，占 bubble；关闭显示时仍保留时间长度 |
| wait | durationMs，不占通道 |

表情共 12 种，均通过现有 `expression` 节点播放：

| expressionId | 效果 |
|---|---|
| neutral | 默认，恢复原嘴型 |
| smile | 双眼笑闭、张嘴笑 |
| shy | 害羞，小幅微笑、腮红 |
| super_shy | 整脸通红、双眼闭合；遮脸手势与蒸汽由 pose/effect 独立组合 |
| annoyed | 原眉毛皱起、半闭眼、撇嘴 |
| sleep | 闭眼休息，不替代全身盖被睡眠动作 |
| surprised | 圆形张嘴、睁眼 |
| confused | 单侧挑眉、侧看、歪嘴 |
| sad | 眉头抬起、撇嘴、眼内泪光 |
| smug | 不对称半闭眼、挑眉、歪嘴笑 |
| unimpressed | 半闭眼、平嘴 |
| wink | 左眼笑闭、右眼睁开、微笑 |

特效：sparkles、hearts、sleepy、splash、steam。`steam` 从头顶两侧产生浅色蒸汽，支持 `origin` 调整设计坐标，停止时全部销毁。内置 wave 固定 1400ms，只占 pose；walk_right 为 800ms 序列，占 pose 和 face。

1.3.2 增加 `shoulderLeft/Right`、`elbowLeft/Right`、`wristLeft/Right` 六个 pose 关节。旋转为实际关节角度（±150°），关节偏移限 ±8 设计像素、缩放限 0.7～1.5，透明度沿所属手臂链相乘；原 `armLeft/Right` 的小幅动作保持兼容。肩关节抬起时使用清理过的袖子与张开的手掌，并同步处理前后遮挡，袖口和手腕共用肘部变换。内置 `cover_face` 在 260ms 抬手、2480ms 开始放手、2800ms 归零；`super_shy` 组并行组合该 motion、同名表情，以及延迟 150ms 开始、2400ms 持续的蒸汽。表情通过 `fadeInMs:260`、`fadeOutMs:320` 同步渐变肤色、眼睑、眉形和嘴型；未设置过渡的旧动作保持原行为。动作结束或中止恢复原站姿。完整组只从站立状态进入，默认低权重随机、60 秒冷却，也可手动播放或绑定点击。

1.3.0 的五个新组 `confused_tilt`、`sad_pout`、`smug_pose`、`unimpressed_pause`、`playful_wink` 使用普通 pose motion 与 expression 并行组合，无需新执行器。表情占用 face 期间左右眼和视线由预设控制，结束后恢复鼠标跟随及自动眨眼；结束、停止、抢占和重载都复位嘴型、眉形与泪光。

`annoyed` 使用原图眉毛的 Cubism 形变和半闭眼，自动跟随头部，不额外绘制眉毛。表情结束、取消或资源重载时恢复中性眉形；动作包接口不变。

双眼皮线跟随现有眼睑开合，普通眨眼、半闭眼与闭眼表情共用这一绑定。外部动作包仍使用 `eyes` 节点，无需新增目标或参数。

顺序时长求和、并行取最大；maxDurationMs 要比预计时长至少多 100ms，且不超过 30 秒。树最大深度 8、节点总数 128。不允许零/负时长、无限循环、NaN、Infinity 或未知字段。

## 导入与重新加载

导入先检查来源、复制到临时目录、再次校验，再提交。相同 packId 弹出是否替换的原生提示。用户包不能冒用 `builtin.*`。用户包目录名需等于 packId（导入时会自动这样命名）。

更新时在小屋点击“打开用户动作包目录”，编辑**已导入副本**。增加文件必须更新 pack.json 的 motions/groups 清单。点击“重新加载”预校验和预加载成功后生效。坏包错误可在动作页提示或运行错误区查看；旧版本会保留，不把半成品显示成成功。

用户覆盖与 JSON 分离：启用、随机开关、权重、冷却以完整 groupId 存储，重载保留。权重 0 仅排除随机，不影响手动预览。删除组留下的孤立覆盖不会执行任何动作。

## 文件与资源限制

每包最多 100 MB、1000 个文件和目录，目录深度最多 12。JSON 单文件最多 1 MB。图片只接受 PNG/WebP，单图最大 4096×4096，用户导入包估算解码总量最多 256 MiB；应用指定的随附内置包最多 384 MiB，清单不能自行提升。路径必须是包内相对路径，禁止绝对路径、`..`、网络路径、反斜杠、编码逃逸、符号链接和目录联接。包中不接受 JS/TS/HTML/SVG；原创内部 SVG 仅在开发资产脚本中使用，不是用户包可执行资源。

`schemas/*.schema.json` 由相同 Zod 结构通过 `npm run schemas` 生成，可配置编辑器文件关联进行补全。JSON Schema 表达字段结构；路径安全、通道交叉引用、帧时长总和等跨字段约束仍由运行时校验，不能仅靠编辑器提示判定有效。
# 睡姿及独立图层扩展（1.1.2）

`conditions.requiresStanding: true` 是所有命令来源均须遵守的入口条件：当前有前景动作时拒绝开始该组，不抢占现有动作。基础待机是站立姿态；动作完成或取消由统一执行器 reset 恢复站立。

`frame_animation` 可选 `displayScale`（默认 1）、`layers` 和 `hitAreas`。`layers` 是位于序列帧后方的独立图片列表，字段为包内 `image`、画布位置 `x/y`、图片内支点 `pivotX/pivotY`、正弦旋转幅度 `rotationDeg`、周期 `periodMs`。图片须已加载并通过包路径校验。`hitAreas` 使用帧画布坐标，每项为 `target: head|body`、`x/y/width/height`，随缩放更新鼠标区域。

`effect` 节点可选 `origin: {x,y}`，为 sleepy 特效的起始设计坐标（相对角色脚底），Z 向右上方移动并淡出。特效独立于隐藏的站立角色，完成、取消、失败均清理。示例见内置 `motions/sleep.json` 与 `groups/sleep_short.json`。
> 1.2.0 兼容说明：公开的 `head`、`body`、`armLeft`、`armRight`、`tail` 等节点与 JSON 格式保持不变。站立动作通过 Live2D 适配器驱动；头部、手臂等部件幅度会收敛到正面原画支持的范围。根节点跳跃、镜像、位置移动以及表情、特效仍由统一执行器管理。全身序列会暂时隐藏并暂停 Live2D，完成或取消后自动恢复。动作包不能添加 JavaScript 或替换 Core 运行库。

### 侧面步行示例（1.2.2）

`walk_left` 与 `walk_right` 改为 `frame_animation`，各 32 帧 / 40 FPS / 800ms，占用 `pose` 和 `face`。动作组仍将三次循环和 2400ms `move_by` 并行执行，不新增动作 ID 分支。序列各自指定 `anchor`、`displayScale` 和头/身体 `hitAreas`，因此镜像造型的脚底和点击范围仍匹配；结束或取消沿现有清理路径恢复正面。旧自定义组合若把该走路 motion 与表情并行，因同时占用 face 会被正常拒绝，需要移除并行表情或改为顺序。

### 盖被睡眠示例（1.2.4，1.2.5 更新肤色，1.2.6 更新大小）

`sleep` 使用 24 张 880×500 PNG，`frameDurationsMs` 每项 150ms，共 3600ms；动作组循环四次。`layers` 中独立尾巴以 `(684.5,347)` 为支点、±6.5° 连续摆动，周期同为 3600ms。1.2.6 的 `displayScale` 为 `0.64`（原为 `0.44`），`sleepy.origin` 为 `(-71.68,-246.4)`，对应放大后的头部上方；Z 仍由独立 effect 通道管理，未烘焙进图片。入口 `requiresStanding` 和结束/取消清理语义不变。

序列帧使用自身画布和显示比例计算所需透明窗口，不按动作 ID 判断。基础设计窗口为 340×420；超过基础窗口时添加边距，最大设计尺寸为 1024×1024。睡姿窗口为 502×420，再乘用户大小设置；命中区仍按素材坐标定义，随同一个场景变换缩放。结束或取消恢复基础窗口，主进程按底边中心定位，并执行工作区边界约束。

## GIF 转图片序列示例

内置 `curtsy_sway` 展示 GIF 接入：先把 GIF 完整合成并提取为同尺寸 RGBA PNG，保留单帧延迟；运动中的人物不逐帧重新居中，避免抠图引入跳动。`motions/curtsy_sway.json` 使用 `frame_animation`，27 个 `frames` 对应 27 个 100ms 的 `frameDurationsMs`，`durationMs` 为 2700；组只重复一次，占用 pose 和 face 通道。PNG、motion、group 和清单即可增加动作，无需新增动作枚举或专用执行器。

`anchor` 设置在原图脚底的固定位置，`displayScale` 用于与站立角色匹配大小；头部、身体 `hitAreas` 同步适配。组声明 `requiresStanding: true`，自然结束、中止和重载均经通用执行器恢复站立。应用加载 PNG/WebP，不直接执行或播放外部 GIF。

1.3.4 对 `curtsy_sway` 的 27 张 PNG 做统一亮度与肤色校准；motion、锚点、命中区和时序无需修改。

1.3.5 修复共用 Live2D 眼周肤色图集与补片 UV；现有闭眼/半闭眼表情和待机眨眼自动生效，动作包 JSON 无需修改。

## 1.3.6 视频玩手机动作

`play_phone` 使用现有 `frame_animation`：60 张 384×476 PNG、15fps、4000ms、固定画布与锚点；组只重复一次并要求站立入口。动作完成、中止、拖动和资源重载沿用统一执行器复位。无需专用动作枚举或渲染分支。`_tag.png` / `_tag.webp` 是审计历史图，不会注册为可用纹理；若 motion 引用它们，加载按缺失图片报错，避免删图后才出现问题。

1.3.7 的 `play_phone` 改为 96 帧、24fps，总时长及锚点不变。随应用分发的内置包使用 384MiB 解码预算以容纳原生帧率素材；用户导入包仍为 256MiB，清单不能提升预算。100MB 磁盘上限、4096 单图尺寸上限和文件数上限保持不变。

1.3.8 增加独立的 `play_phone_angry` motion/group，使用 96 张 384×476 无损 WebP，24fps、4000ms。沿用原 `play_phone` 的画布、锚点、命中区和站立入口；原动作定义、PNG 与随机设置保持不变。新动作的 `random.eligible=false`，可在面板独立预览或开启随机。仅新增素材、JSON 和清单项，没有新增渲染分支或提升动作包预算。
