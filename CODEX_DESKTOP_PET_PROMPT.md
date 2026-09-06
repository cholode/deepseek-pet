# Codex 开发任务书：可扩展动作组桌宠

**项目代号：DeepBlue Desktop Pet**  
**版本：MVP v1 · 普通模式完整实现 · AI 模式仅预留接口**  
**目标平台：Windows 10/11 桌面优先；其他平台不作未经验证的兼容性承诺**

---

## 0. 你的任务与交付边界

你是一名负责交付产品的 Electron / TypeScript 桌面应用工程师。请在当前工作目录创建或完善一个真实可运行的桌宠项目，而不是只输出方案、页面原型、伪代码或一组尚未接通的接口。

用户要的是：一个参考所附蓝发 Q 版 DeepSeek 娘化形象的桌宠，能动、能点击互动、能拖动；动作组可以通过数据文件灵活新增。普通模式自动随机选择并播放动作组。未来 AI 模式由 AI 选择动作组，但本轮绝对不接 AI。

本轮的产品公式是：

```text
可替换角色素材 + 数据驱动动作组 + 普通随机调度 + 点击互动
                                  ↓
                  同一个可取消、可观测的动作执行器
                                  ↑
                       未来 AI 驱动接口（未启用）
```

必须完整实现普通模式、动作包加载、动作组播放器、交互、设置、错误处理与必要测试。AI 相关仅允许类型契约、模式可用性检查、未启用占位与接入说明。

**本轮禁止：**接入 OpenAI / DeepSeek 或其他模型 API；安装 Agents SDK；制作 API Key 输入或存储；联网聊天；Realtime / TTS / 麦克风；屏幕截图分析；读取用户正在使用的应用；电脑自动化；命令行执行工具；长期记忆系统。应用安装完成后的普通模式必须能够完全离线运行。开发时下载依赖不属于应用运行时联网。

“DeepSeek 娘化形象”在此是用户的视觉描述，不意味着必须使用 DeepSeek API，也不得在产品界面宣称官方授权。

先阅读整个任务书和现有仓库，给出简短实施计划，然后直接逐阶段写代码、验证和修复。除确实阻塞工作的素材或环境问题外，不要反复询问已经给出默认值的问题。不要为赶进度默默删掉动作组扩展性。

## 1. 核心验收：什么才算做完

启动应用后，桌面出现透明背景的蓝发 Q 版角色。她有真实可见的待机动画，普通模式会依权重、冷却和条件选动作组。点击头部或身体能触发不同反馈，拖动能改变位置，右键和托盘可打开控制面板。

用户可以导入一个动作包文件夹，里面只有 JSON 和允许的图像素材。导入后不用修改 TypeScript、不用重新编译，新的动作组即出现在动作管理列表中，能够手动预览，并按配置加入普通模式的随机池。修改用户动作包后点击“重新加载”，新定义即可生效。

设置中显示“普通模式：可用”和“AI 模式：开发中”。AI 项禁用；从内部接口请求切换 AI 也必须返回明确的 `MODE_NOT_AVAILABLE`，且不破坏正在运行的普通模式。不得把随机行为包装成 AI 行为。

至少包含 12 个内置动作组与一个可导入的自定义动作包示例。窗口能退出、能恢复鼠标交互、不会因为某个动作异常永远卡住。

## 2. 技术栈与工程约束

采用 Electron + TypeScript strict + React + PixiJS 8.x。构建采用 electron-vite，Windows 打包采用 electron-builder，单元测试采用 Vitest。可以选择轻量状态管理，但不要为这个 MVP 引入多 Agent 框架、服务端、数据库、通用插件执行环境或复杂 ECS。

开始实现时核对依赖的实际兼容版本，使用相互兼容的稳定版本并提交 lockfile。在 README 写明实际使用的 Node、Electron、PixiJS 和构建工具版本；不要混用 PixiJS v7 与 v8 的初始化、事件或 ticker 写法。electron-vite 的主进程、preload 与 renderer 分别配置。[S5][S6][S7]

React 管理控制面板、设置和调试信息；PixiJS 管理人物、表情、图层和特效。不要通过每帧 React `setState` 驱动角色。动画运行在统一 ticker / 时间轴上；时间单位统一为毫秒，不能依赖“每帧固定移动多少像素”。[S5]

提供真实有效的 npm scripts：

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run dist:win
```

`test` 应是可退出的测试命令，另设 `test:watch` 才进入监听模式。打包脚本应包含必要构建步骤，不依赖用户猜测运行顺序。已有工程时保留用户已有代码与配置，先合并，不做破坏性重建。

## 3. 角色参考与素材策略

参考图位置：`reference/character-reference.png`。这是用户提供的完整截图，不是已分层角色，也不是去过背景的透明动画素材。

视觉重点：大头小身的 Q 版比例、深蓝到亮蓝长发、蓝色眼睛、蓝白服装与女仆头饰、蝴蝶结、鲸鱼视觉元素。保持可爱、清爽、轮廓易辨识，不用网页截图背景、播放控件或水印充当角色的一部分。

优先采用透明分层 PNG / WebP。内置角色至少具有可独立控制的 `root`、`body`、`head`、`hairBack`、`hairFront`、`armLeft`、`armRight`、`eyes`、`mouth` 与 `effects` 容器或节点。前后层级、旋转支点和基准姿态必须清楚。`head` 是随附自定义动作示例要求的稳定节点 ID。

若当前环境没有可用分层原画、无法完成质量合格的抠图与补全：不要假装已经把截图自动拆层。先交付一个以参考图配色和轮廓为目标、真正可分层运动的本地演示角色，可使用程序化绘制或自行制作的透明图层。不得只用矩形、表情符号或一张上下晃动的整图冒充完成的动画角色。清晰标明“演示角色，精细原画待替换”，并让后续替换角色不影响动作组、随机调度器与控制接口。

不要因为最终原画暂缺而停止实现工程；同样，演示角色不等于完成参考图的精细重绘或 Live2D 绑定。交付报告必须分别说明工程状态与角色素材状态。

将素材来源、处理方式、是否为演示资产记录在 `docs/ASSET_SOURCES.md`。用户提供参考图不代表已提供可再分发授权，不替来源不明的原图编造许可证。运行时不从第三方网站下载角色。此轮不引入 Live2D / Spine SDK。

## 4. 模块职责：只保留一个执行核心

建议结构如下，允许合理调整文件名，但职责必须保留：

```text
src/
  main/
    index.ts
    windows/                 # 桌宠窗、控制面板窗、托盘
    desktop/                 # 显示器、窗口位置、鼠标采样、拖动
    packs/                   # 文件夹导入、路径校验、资源服务
    settings/                # userData 配置读写
    ipc/                     # 白名单桥接、发送方验证
  preload/
    index.ts                 # 仅暴露明确的类型化接口
  renderer/
    pet/
      PetRuntime.ts          # 装配 runtime，唯一状态真源
      avatar/                # 图层绑定、表情、基础待机
      animation/             # motion 播放、插值、有限时间轴
      actions/               # registry、校验、group runner
      behavior/              # NormalBehaviorDriver
      interaction/           # 命中区、点击、拖动手势
      controllers/           # PetController 与命令入口
    panel/                   # 设置和动作管理
  shared/
    schema/                  # 包、motion、group、设置校验
    contracts/               # 命令、事件、快照、能力列表
    geometry/                # 坐标转换与边界函数
resources/
  builtin/                   # 内置角色和内置动作包
examples/
  custom-action-pack/        # 可由用户导入的完整示例
reference/
  character-reference.png    # 仅视觉参考
schemas/                     # 生成的 JSON Schema
tests/
docs/
```

主进程只负责操作系统窗口、磁盘、导入与权限边界。桌宠 renderer 中只有一个 `PetRuntime`、一个前景动作调度器和一个时间轴驱动。控制面板是客户端，不得建立第二套随机调度器。

动画引擎不依赖 AI，也不依赖随机算法。普通驱动只负责“什么时候选哪个动作组”，不能直接修改人物图层。未来 AI 驱动也只能提交相同的受限命令。

```text
普通驱动 ───────┐
点击交互 ───────┼──→ PetController / CommandGateway
手动动作预览 ───┤                ↓
未来 AI 驱动 ───┘         校验 + 优先级 + 生命周期
                                  ↓
                            ActionGroupRunner
                                  ↓
                    Motion / 表情 / 移动 / 特效 / 气泡
```

跨进程只传可序列化数据，不传函数、Pixi 对象或 `AbortSignal`。未来 AI 服务可放在主进程，但必须通过桥接命令使用现有 runtime；不提前搭建实际模型服务。

## 5. 三层定义：素材、动作、动作组

**素材 Asset**：图层图片、表情图、序列帧，负责角色看起来是什么。

**动作 Motion**：一个有限时长的基本动画，例如挥手、点头、走路周期。Motion 可以是分层关键帧时间轴，也可以是逐帧图片序列。

**动作组 ActionGroup**：由基本动作、表情、移动、特效、气泡与等待组成的完整行为，可以顺序或并行，例如“点头 → 挥手 + 微笑 + 星星”。

普通模式随机选择的是动作组，不是随机切换 PNG。未来 AI 选择的也必须是动作组。动作组 ID、名称、标签和数量不可写死在 TypeScript union 或 `switch` 中；只允许有限的基础节点类型写入类型系统。

全局动作与动作组 ID 都使用 `packId:localId`。例如 `builtin.deepblue:wave` 与 `user.celebrations:celebrate`。角色兼容标识为 `avatarId`，默认角色固定为 `deepblue-chibi-v1`。不同动作包可引用内置的 motion，但不得靠读取任意磁盘路径跨包访问文件。

新增组合动作只需新增动作组 JSON。新增同一角色的关键帧动作只需新增 motion JSON。新增逐帧动作只需增加图像文件与 motion JSON。只有引入新的底层能力，例如一种全新物理系统，才需要修改引擎代码。

## 6. 动作包格式与导入

动作包是文件夹，本轮只实现文件夹导入，不实现 ZIP 在线市场、脚本插件或远程 URL 导入。

```text
my-action-pack/
  pack.json
  groups/
    celebrate.json
  motions/
    gentle_nod.json
  assets/                    # 有新图像时使用
```

`pack.json` 示例：

```json
{
  "schemaVersion": 1,
  "id": "user.celebrations",
  "name": "自定义庆祝动作包",
  "version": "1.0.0",
  "avatarId": "deepblue-chibi-v1",
  "description": "演示不修改 TypeScript，只增加 JSON 即可添加新动作与动作组。依赖内置角色的 wave 动作、smile 表情和 sparkles 特效。",
  "motions": [
    "motions/gentle_nod.json"
  ],
  "groups": [
    "groups/celebrate.json"
  ]
}
```

`groups`、`motions` 是相对于当前包根目录的文件列表，不是文件系统任意路径。用户新增 JSON 后更新这个列表，再点击重新加载；导入新包则自动读取其清单。

内置包只读，安装后新增的包放在 `app.getPath('userData')` 下的专用目录；不要要求修改安装目录或重新打包。通过原生文件夹选择器导入，先完整校验、复制到临时目录，成功后再提交。重复 `packId` 必须提示是否替换，不可静默覆盖；禁止外部包冒用保留的 `builtin.*` 命名空间。

提供“导入动作包”“打开用户动作包目录”“重新加载”三个入口。手动重新加载即可，无须第一版做文件监听。

包的更新采用事务式快照：先解析、校验并预加载新资源，全部成功后取消正在使用旧快照的动作，等待清理完成再切换 registry revision。失败保留原来的可用版本，并展示具体错误。首次导入失败则不注册任何半成品。

一个坏包不得使其他有效包失效。角色不匹配、未知 motion、重复 ID、缺图、无效 JSON 都必须有可读错误，不得静默跳过后再显示“加载成功”。

安全要求：解析路径后验证始终位于包根目录内；拒绝绝对路径、父目录逃逸、网络路径、符号链接和重复编码逃逸；不执行 JS/TS/HTML，不使用 `eval` / `new Function`。用户可导入的图像格式先限定 PNG/WebP；不接受任意用户 SVG 或脚本化资源。默认限制每包 100 MB、单图 4096×4096、1000 个文件，限制必须在解码或分配大纹理前尽可能检查。错误中可以显示文件名，不向 renderer 暴露任意文件读取 API。

## 7. 基本动作 Motion 的可扩展格式

### 7.1 分层关键帧

支持 `kind: "rig_timeline"`。节点只允许来自当前角色公开的命名节点，属性只允许 `offsetX`、`offsetY`、`rotationDeg`、`scaleX`、`scaleY`、`alpha`，不能访问任意对象属性。

位移是相对于角色基准姿态的设计坐标偏移，旋转是相对基准姿态的角度，缩放是基准姿态的乘数，alpha 是 0～1 的绝对透明度。坐标偏移不是系统屏幕坐标。角度仅在引擎内部转换为弧度。

时间戳从 0 到 `durationMs`，严格递增，至少包含起点与终点。关键帧上的 easing 描述“前一个关键帧到此关键帧”的插值；第一个关键帧的 easing 不参与插值。支持 `linear`、`easeInOut`、`easeOut` 三种即可。

下面这个 JSON 必须能够直接增加一个新动作，无须新增 `case "gentle_nod"`：

```json
{
  "schemaVersion": 1,
  "id": "gentle_nod",
  "name": "轻轻点头",
  "kind": "rig_timeline",
  "avatarId": "deepblue-chibi-v1",
  "durationMs": 700,
  "channels": [
    "pose"
  ],
  "tracks": [
    {
      "targetId": "head",
      "property": "rotationDeg",
      "keyframes": [
        {
          "timeMs": 0,
          "value": 0,
          "easing": "linear"
        },
        {
          "timeMs": 200,
          "value": 7,
          "easing": "easeInOut"
        },
        {
          "timeMs": 430,
          "value": -2,
          "easing": "easeInOut"
        },
        {
          "timeMs": 700,
          "value": 0,
          "easing": "easeInOut"
        }
      ]
    },
    {
      "targetId": "head",
      "property": "offsetY",
      "keyframes": [
        {
          "timeMs": 0,
          "value": 0,
          "easing": "linear"
        },
        {
          "timeMs": 250,
          "value": 4,
          "easing": "easeInOut"
        },
        {
          "timeMs": 700,
          "value": 0,
          "easing": "easeInOut"
        }
      ]
    }
  ]
}
```

`channels` 声明该 motion 使用的逻辑通道。引擎要依据角色节点归属核对声明，禁止通过少报通道制造并行竞争。默认 `head`、躯干、头发、手臂归入 `pose`；眼眉口等表情节点归入 `face`。面部细节无需全部进入通用关键帧系统，表情适配器可以处理。

### 7.2 序列帧

同一 motion registry 还必须支持 `kind: "frame_animation"`：明确按顺序列出的 PNG/WebP 路径、每帧持续时间或统一 `fps`、统一画布尺寸与脚底锚点。全身序列帧占用 `pose` 与 `face`，播放时临时隐藏分层角色；完成或取消后恢复。第一版不要求实现所有图集厂商格式，也不要求直接播放 GIF。

如果同时提供 fps 和单帧时长则拒绝，避免时长含义冲突；帧列表不得为空。裁剪尺寸和锚点应防止切帧跳位。至少附带一个小型真实图片序列与测试，让这种格式确实跑通，而不是只留未实现类型。

角色基础待机独立运行：轻微呼吸、随机眨眼、轻微头发摆动。前景动作占用 `pose` 或 `face` 时，暂停对应通道的基础待机，结束后恢复。不要让眨眼不断覆盖闭眼睡觉，或让呼吸修改挥手动作正在控制的同一组变换。

## 8. 动作组结构与执行语义

使用 TypeScript 类型与运行时 schema 双重校验，生成 JSON Schema 供编辑器补全。下面是需要实现的基础契约，可添加非破坏性字段，但不可删除能力：

```ts
type Easing = 'linear' | 'easeInOut' | 'easeOut';
type ActionChannel = 'pose' | 'face' | 'movement' | 'effect' | 'bubble';

type ActionNode =
  | { type: 'sequence'; children: ActionNode[] }
  | { type: 'parallel'; children: ActionNode[] }
  | { type: 'motion'; motionId: string; repeat: number }
  | { type: 'expression'; expressionId: string; durationMs: number }
  | { type: 'move_by'; dxDip: number; dyDip: number;
      durationMs: number; easing: Easing }
  | { type: 'effect'; effectId: string; durationMs: number }
  | { type: 'bubble'; text: string; durationMs: number }
  | { type: 'wait'; durationMs: number };

interface ActionGroupDefinition {
  schemaVersion: 1;
  id: string;                 // 包内 ID，运行时组合成 packId:id
  name: string;
  description: string;       // UI 与未来 AI 均可使用
  tags: string[];
  enabled: boolean;
  random: {
    eligible: boolean;
    weight: number;
    cooldownMs: number;
  };
  conditions: {
    minIdleMs: number;
    requiresRoaming: boolean;
    requiresPointerAway: boolean;
  };
  maxDurationMs: number;
  timeline: ActionNode;
}
```

所有字段在文档与 schema 中保持一致；示例里显式给出的默认值不得在实现中悄悄改变含义。ID 不包含冒号，完整引用才包含一次冒号；名称允许中文。`description` 和 `tags` 不是可执行代码。

顺序节点等待前一个子节点终止后再启动下一个。并行节点在同一个逻辑 tick 启动所有子节点，全部成功结束才算完成。一个分支失败时取消其他分支，并清理整组资源，不得留下仍在播放的动画或气泡。

`motion` 的 `repeat` 是有限正整数 1～20，不能写无限循环。`expression`、`effect`、`bubble` 在自己的时长结束后恢复/移除。`wait` 不占通道。一次前景动作组最长 30 秒；单个节点、嵌套深度和节点数也必须限制，默认最大深度 8、节点数 128。所有数值必须有限，不接受 NaN、Infinity、负时长或未识别枚举。

静态计算预计时长：顺序取和、并行取最大、motion 取基本时长乘 repeat、其他取声明时长。`maxDurationMs` 是整个动作组的看门狗上限，必须覆盖预计时长并留清理余量，且不超过 30 秒。卡住的动作最终以 `ACTION_TIMEOUT` 失败并恢复待机。

通道由树和 motion 元数据推导：expression 使用 face，move_by 使用 movement，effect 使用 effect，bubble 使用 bubble。第一版保守处理并行：任何两个并行分支的通道集合有重叠就拒绝加载，即使作者认为它们实际生效时间错开。顺序节点内复用同一通道合法。

第一版同一时间仅允许一个前景动作组。组内可以跨通道并行，基础待机在没有被占用的通道继续工作。不要额外实现多组并发图调度器。

停止或取消必须传到全部子节点，并且幂等。正在运行的时间轴、等待任务、特效、气泡、桌面移动都要停止。恢复角色基准姿态，但保留已经发生的合法桌面位置变化，不要突然传送回动作开始的位置。

## 9. 完整动作组示例

### 9.1 新增“点头后开心挥手”

```json
{
  "schemaVersion": 1,
  "id": "celebrate",
  "name": "点头后开心挥手",
  "description": "先轻轻点头，再微笑挥手并显示星星；可用于打招呼或表达开心。",
  "tags": [
    "greeting",
    "happy",
    "upper-body"
  ],
  "enabled": true,
  "random": {
    "eligible": true,
    "weight": 3,
    "cooldownMs": 18000
  },
  "conditions": {
    "minIdleMs": 1500,
    "requiresRoaming": false,
    "requiresPointerAway": false
  },
  "maxDurationMs": 6000,
  "timeline": {
    "type": "sequence",
    "children": [
      {
        "type": "motion",
        "motionId": "user.celebrations:gentle_nod",
        "repeat": 1
      },
      {
        "type": "parallel",
        "children": [
          {
            "type": "motion",
            "motionId": "builtin.deepblue:wave",
            "repeat": 1
          },
          {
            "type": "expression",
            "expressionId": "smile",
            "durationMs": 1400
          },
          {
            "type": "effect",
            "effectId": "sparkles",
            "durationMs": 1400
          },
          {
            "type": "bubble",
            "text": "今天也要加油呀。",
            "durationMs": 1400
          }
        ]
      },
      {
        "type": "wait",
        "durationMs": 300
      }
    ]
  }
}
```

内置 `builtin.deepblue:wave` 应为 1400ms 的 pose 动作，不占 face；这样微笑、星星和气泡可以真正并行。`smile` 与 `sparkles` 是默认角色必须公开的表情与特效能力。

随附 `examples/custom-action-pack/` 必须能通过应用“导入动作包”直接导入。它不是仅供看的伪配置；将它作为扩展性验收用例。

### 9.2 桌面移动与人物动画同步

下面定义属于内置 `builtin.deepblue` 包：

```json
{
  "schemaVersion": 1,
  "id": "walk_right",
  "name": "向右散步",
  "description": "一边播放步行动画，一边沿桌面向右移动。",
  "tags": [
    "locomotion",
    "walk",
    "right"
  ],
  "enabled": true,
  "random": {
    "eligible": true,
    "weight": 3,
    "cooldownMs": 12000
  },
  "conditions": {
    "minIdleMs": 5000,
    "requiresRoaming": true,
    "requiresPointerAway": true
  },
  "maxDurationMs": 4500,
  "timeline": {
    "type": "parallel",
    "children": [
      {
        "type": "motion",
        "motionId": "builtin.deepblue:walk_right",
        "repeat": 3
      },
      {
        "type": "move_by",
        "dxDip": 160,
        "dyDip": 0,
        "durationMs": 2400,
        "easing": "linear"
      }
    ]
  }
}
```

`builtin.deepblue:walk_right` 的一个步行周期为 800ms，因此重复三次与 2400ms 窗口移动匹配。移到边界时按合法终点截断位移，不穿出桌面工作区；不得用未受控的 `setInterval` 留下继续移动的窗口。

动作组的移动必须是真正改变桌宠窗口位置，而不只是人物走到自己的小窗口边缘后被裁切。

## 10. 普通模式：随机播放规则

实现独立、可单测的 `NormalBehaviorDriver`。它只从 registry 获取目录，并通过统一控制器提交动作组。不能在这个类里写死 12 个动作 ID。

默认逻辑：应用准备好后进入基础待机；在前景动作完成或取消后，等待随机空闲间隔，再选择下一组。默认间隔 3～10 秒，可在设置中调整；这个是设计默认值，不是平台性能保证。一次动作没有结束前不得再启动一个普通动作。

候选过滤次序：

1. 包与组有效，角色兼容，`enabled=true`，`random.eligible=true`，`weight>0`。
2. 所需 motion、表情、特效存在且可用；当前未暂停、隐藏、拖动或被更高优先级操作占用。
3. 冷却已结束，且 idle、指针远离和漫游条件满足。`minIdleMs` 指距离上一次真实用户交互的时长，不因自主播放动作而重置。
4. 从合格候选中排除最近两次实际启动的普通动作 ID；如果仅因历史过滤造成候选为空，按最旧到最新逐步放宽历史约束。只有一个合法候选时允许最终重复，但不能绕过冷却、禁用、兼容性或权限约束。
5. 按非负权重进行加权随机。权重 0 只表示不参加随机，不影响手动预览。

随机数生成器与时钟应依赖注入，生产使用真实时钟，测试使用确定性种子和假时钟。不要每次选择重新用同一个 seed 初始化随机数生成器。

冷却按“上次动作完成或被取消的时间”开始计算；拒绝提交不算启动，不记入历史或冷却。失败的动作组本次 registry revision 内暂时隔离并显示错误，直到重新加载成功后恢复，防止反复崩溃。

没有合格候选时继续基础待机，按低频定时器或最早冷却到期时刻重试；不空转、不抛出未处理异常、不把禁用动作当 fallback。内置基础待机不是会被用户删掉的普通动作组。

每次 pause/stop/dispose 取消尚未执行的随机定时器。用 generation / epoch 防止旧回调复活。恢复调度只能安排一个新计时器。

暂停普通模式仅停止自动选择，不关闭点击和手动预览。固定位置禁止所有带 movement 的前景动作，包括手动预览；允许漫游开关只控制自主移动。手动移动动作仍受固定位置、边界和其他安全限制。`minIdleMs`、`requiresPointerAway`、`requiresRoaming` 是普通模式的选组条件，不阻止手动预览或点击绑定动作；固定位置、拖动锁定、素材兼容与安全限制仍对所有来源生效。

气泡全局可关；另设“允许自主气泡”，默认关闭。关闭时 bubble 节点不显示文本但仍占用自己的时间长度，避免改变动作组节奏；不要因此取消整组。

## 11. 交互、抢占与生命周期

必须实现头部与身体至少两类命中区域。可以采用圆形、多边形或矩形的近似区域，不要求像素级抠图命中。区域应随角色缩放、翻转与主要姿态变换正确更新。PixiJS 事件应使用当前版本的事件模式与命中区接口。[S4]

默认交互：单击头部播放 `head_touch`，单击身体播放 `body_touch`，双击打开控制面板，拖动移动桌宠，释放后播放 `drag_release`，右键打开菜单。触发映射放在配置中，用户可从已注册动作组中更改头部和身体单击动作，不在事件回调中硬编码动画细节。

手势区分必须真实可靠：按下时立即做轻量按压反馈；移距超过 6 DIP 进入拖动并取消待触发单击；单击语义等约 260ms 确认不是双击后再派发，双击取消待定单击。拖动释放不能再误发 click。按压反馈必须在下一次可用渲染更新中出现，目标小于 100ms，但必须实测后才能报告达标。

按压反馈是可清除的交互覆盖层，不可永久写坏 motion 基准姿态。快速连点应合并或节流，不累计几百个待执行动作。第一版不必实现复杂摸头识别、抛掷物理或全局键盘监听。

优先级由可信入口固定指定，不来自用户动作包：

```text
系统恢复 / 拖动     100
用户手动预览        80
点击交互            60
未来 AI             40  （本轮不可用）
普通随机            10
基础待机             0
```

拖动开始立即取消当前动作与桌面移动，并暂停普通调度。手动预览和点击可以抢占低优先级随机动作。相同优先级交互采用 latest-wins 替换，并加短时节流；较低优先级请求返回 `BUSY`，不无限排队。拖动期间手动动作也不得抢占窗口控制。

本轮动作组默认都可由更高优先级操作取消，不允许动作包自称不可打断从而拒绝用户拖动。释放后先做短恢复动作，再在延迟后恢复普通调度。窗口失焦、指针取消、捕获丢失、应用隐藏、系统休眠/恢复必须有清理路径，不能永远停在 dragging=true。

每次动作启动分配独立 `actionInstanceId`。同一动作组连续播放的两个实例必须能区分。至少发出 `queued/accepted` 或等价接收结果、`started`、`completed`、`cancelled`、`failed` 状态；一个实例只发出一个终态。旧实例迟到的完成回调不能覆盖新动作。

## 12. Electron 窗口、穿透和多屏

使用一个包围人物与动画余量的小型透明无边框窗口，而不是全屏覆盖层。控制面板使用单独、正常可交互的窗口。默认人物靠近当前屏幕右下方工作区，窗口宽高根据角色尺寸、动作包络与气泡留白计算，不强行把角色压缩变形。

桌宠支持置顶、隐藏/显示、拖动、缩放与固定位置；置顶不得反复抢用户焦点。第一版不支持用户直接拖窗口边框缩放，缩放由设置控制并验证透明性。透明窗口存在平台限制，尤其不能把“像素透明”当成“自动鼠标穿透”。[S1]

实现三种输入方式：

- 正常交互：人物区域接收点击；透明空白区域尽可能穿透。
- 全部穿透：整个桌宠窗口不拦截鼠标。
- 拖动锁定：手势期间临时保持交互，避免鼠标出人物范围后中断。

Windows 下使用 `setIgnoreMouseEvents`，结合 `{ forward: true }` 与主进程有限频率鼠标采样、renderer 提供的命中区域，动态恢复人物区域的交互。`setIgnoreMouseEvents` 是整窗开关，不是逐像素区域 API。必须同时测试从完全穿透状态重新进入人物的路径，不能只靠已经收不到的 `mouseenter` 恢复。[S1]

主进程的全局鼠标采样初始频率不高于约 30Hz，按可见性与输入模式启停；只有状态变化才切换 ignoreMouseEvents，不能每帧反复调用相同设置。近似命中即可，不在每个 tick 读取整张纹理的 alpha。像素级精确穿透不属于本轮承诺。

托盘始终提供“恢复交互”“显示桌宠”“重置位置”“退出”。全部穿透不能导致用户永远无法点回桌宠。可增加快捷键作为补充，但快捷键冲突时仍必须能通过托盘恢复。

屏幕鼠标坐标、窗口位置和 `workArea` 统一使用 DIP；角色图层内部使用设计坐标，经明确变换转换。不得随意乘 `devicePixelRatio`。Electron 的屏幕 API 区分 DIP 和物理像素，`getCursorScreenPoint` 返回 DIP；某些平台能力有额外限制。[S2]

边界计算包含 `workArea.x/y`，不能默认显示器左上角是 0,0。支持负坐标副屏和任务栏占用。将窗口可见包络约束在选定显示器工作区中；副屏移除、分辨率改变、缩放改变、历史位置失效时，将角色移到最近可用工作区。默认自主移动不跨屏，用户可拖到其他屏幕。

拖动期间位置以主进程为真源；renderer 通过受限 drag-start / drag-end 与生命周期消息协作，不暴露任意 `setBounds` 通道。窗口移动时间插值避免依赖 renderer 每秒发送 60 次通用 IPC。验证拖动时鼠标离开原窗口、快速释放、显示器切换、失焦等边界。具体平台无法验证时，在测试报告标明。

## 13. 内置内容最低要求

至少提供以下 12 组，动作之间有可见区别，不允许只改名称、实际播放同一段动画：

| 组 ID | 预期表现 | 随机池建议 |
| --- | --- | --- |
| idle_sway | 轻微站立摆动、发梢变化 | 是，高权重 |
| look_around | 左右探看或歪头 | 是 |
| greet_wave | 挥手打招呼 | 是，低频 |
| happy_hop | 轻跳与开心表情 | 是，低频 |
| shy_pose | 歪头、脸红或收手 | 是，低频 |
| annoyed_shake | 摇头或轻微不满表情 | 否，手动/交互 |
| sleep_short | 闭眼与有限时长睡眠 | 是，长冷却 |
| walk_left | 向左走并移动窗口 | 是，需漫游 |
| walk_right | 向右走并移动窗口 | 是，需漫游 |
| head_touch | 点击头部的局部反应 | 否，仅交互 |
| body_touch | 身体轻弹或惊讶反应 | 否，仅交互 |
| drag_release | 松手后的回稳动作 | 否，仅交互 |

sleep_short 约 8～12 秒即可，不能用无限睡眠动作锁死随机调度。左右步行可共享镜像资源，但实际朝向必须正确，翻转不能把窗口或文字也倒过来。

内置 `wave` motion ID 固定存在，时长 1400ms，占 pose；内置 `walk_right` motion 一个周期 800ms，占 pose。暴露 `smile` 表情与 `sparkles` 特效，使随附 JSON 可直接使用。其他 motion 的命名、时长可自行设计并写入目录。

启动默认行为安静：基础待机明显但幅度小，自主气泡关闭，自动漫游低频且短距离，指针靠近或用户操作时不突然跑走。无需音效。

## 14. 控制面板与动作管理

界面使用中文，布局清楚，避免把宠物窗变成复杂聊天软件。至少有“桌宠”“动作组”“设置”三个区域或页面。

“桌宠”页显示当前模式、当前动作、是否暂停、当前角色、素材是否演示版本；提供暂停/恢复自动行为、停止当前动作、重置位置、打开动作管理。

“动作组”页动态显示所有注册动作组：名称、说明、包来源、标签、有效/错误状态、随机资格、权重、冷却、预计时长。支持搜索、启用/禁用、随机开关、调整权重和冷却、预览、停止、导入与重新加载。提供实际可用的表单校验和错误说明，不能只有按钮外观。

手动预览忽略普通模式的随机资格、权重、冷却、历史及随机条件，但不绕过 enabled、素材兼容、拖动锁定、固定位置或安全约束。用户必须先启用一个被禁用的组才能预览它。预览结束后恢复正常随机调度，不同时播放两份。

“设置”页包含：角色大小、置顶、固定位置、允许自主漫游、随机间隔范围、气泡总开关、允许自主气泡、全部鼠标穿透、重置配置，以及模式显示。AI 模式明确为“开发中，当前版本不可用”，不放 Key 输入框或假聊天输入框。

设置和动作覆盖参数持久化到 userData。用户调整权重和开关存储为以全局组 ID 为键的覆盖项，不直接改写内置 JSON。重新加载不能丢掉仍然适用的用户覆盖；原组删除后的覆盖可标记为孤立项。配置有 schemaVersion，损坏时备份并恢复合理默认值，不能启动白屏。

添加开发调试视图：当前组 ID 与实例 ID、来源、已用时间、registry revision、随机候选数、下一次选择倒计时和最近有限条错误。日志采用有界缓冲，不记录每一帧。

## 15. 未来 AI 模式的接口——现在实现边界，不实现智能

未来需求是“把普通驱动换成 AI 驱动”，不是再复制一套动画引擎。请实现下列本地契约，并写实际单元测试。

```ts
type PetMode = 'normal' | 'ai';
type DriverStatus = 'stopped' | 'running' | 'paused' | 'unavailable';
type CommandSource = 'normal' | 'interaction' | 'manual' | 'ai' | 'system';

type PetCommand =
  | { protocolVersion: 1; commandId: string; type: 'play_group';
      groupId: string; expiresAtUnixMs?: number }
  | { protocolVersion: 1; commandId: string; type: 'stop_current' }
  | { protocolVersion: 1; commandId: string; type: 'reset_pose' };

interface GroupCapability {
  groupId: string;
  name: string;
  description: string;
  tags: readonly string[];
  channels: readonly ActionChannel[];
  expectedDurationMs: number;
  available: boolean;
  unavailableReason?: string;
}

interface PetSnapshot {
  snapshotVersion: 1;
  mode: PetMode;
  driverStatus: DriverStatus;
  avatarId: string;
  registryRevision: number;
  visible: boolean;
  dragging: boolean;
  fixedPosition: boolean;
  windowPositionDip: { x: number; y: number };
  currentAction: null | {
    actionInstanceId: string;
    groupId: string;
    source: CommandSource;
    elapsedMs: number;
  };
}

interface CommandReceipt {
  commandId: string;
  status: 'accepted' | 'rejected';
  actionInstanceId?: string;
  errorCode?: string;
  message?: string;
}

interface PetControlPort {
  getSnapshot(): PetSnapshot;
  listCapabilities(): readonly GroupCapability[];
  submit(command: PetCommand): Promise<CommandReceipt>;
}

interface PetEvent {
  type: 'interaction' | 'action_lifecycle' | 'runtime_changed';
  occurredAtUnixMs: number;
  // 实现时用判别联合细化各类 payload，不用 any。
  payload: Readonly<Record<string, unknown>>;
}

interface BehaviorContext {
  control: PetControlPort;
  // 返回取消订阅函数；实际实现按各类事件进一步收窄类型。
  subscribe(listener: (event: PetEvent) => void): () => void;
}

interface IBehaviorDriver {
  readonly mode: PetMode;
  readonly status: DriverStatus;
  start(context: BehaviorContext): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
}
```

`ActionChannel` 引用第 8 节。生产代码应把 `PetEvent` 收窄为明确的 discriminated union，例如 interaction 包含 target、手势和点击次数，action_lifecycle 包含实例 ID、状态、失败原因。不要把示意性 `Record<string, unknown>` 当成最终全系统类型。

`submit` 的 source 与优先级由服务端/本地可信入口绑定，不接受模型或用户包在 payload 中冒充 system。控制面板、交互系统、普通驱动拿到各自绑定权限的 port。命令入口校验 schema、group ID、当前权限、可用性、频率与可选到期时间。

`commandId` 用于幂等；短期有界缓存中重复同一 ID、同一内容时返回相同接收结果，不重复执行；同 ID 不同内容报 `COMMAND_ID_CONFLICT`。`accepted` 只说明接收，不等于动作完成；完成通过 action_lifecycle 事件查询/订阅。过期命令报 `COMMAND_EXPIRED`。

模式管理器先检查目标模式可用性，再停止当前驱动；不能先停普通模式，再发现 AI 不可用，导致桌宠失去调度。

真正实现 `NormalBehaviorDriver`。AI 只保留 unavailable 的能力描述或一个明确返回 `MODE_NOT_AVAILABLE` 的桩类。这个桩不能发网络请求、读取环境里的密钥、创建 SDK、偷偷回退随机驱动，或输出虚构模型回复。生产界面无法选中 AI。

`docs/FUTURE_AI.md` 写清未来连接方式：主进程模型服务接收交互事件与只读快照，读取动态动作能力目录，选择 groupId，再通过受限桥接调用同一 PetControlPort；新增动作后 AI 无需改工具枚举即可看见它。此轮不需要实现自然语言、提示词模板、API 供应商配置、对话历史或智能情绪系统。

## 16. 安全、稳定性和性能底线

Electron renderer 使用 `contextIsolation: true`、`nodeIntegration: false`，并保持 sandbox 安全边界。preload 暴露细分功能，不暴露整个 ipcRenderer、fs、shell 或 Node 对象；验证 IPC sender/frame、参数、调用时机和权限。打包版本不加载远程页面，不允许未批准的新窗口或页面导航。[S3]

采用明确的本地资源访问方案，优先注册受限自定义协议；资源请求只能访问已注册包内已批准文件，不把绝对路径透传给网页。开发服务器与打包路径都必须测试，避免开发能看见角色、打包全是 404。生产 CSP 不为省事开放任意脚本或远程连接。[S3]

动画按时间差推进；限制过大的 delta，系统长时间挂起后恢复时取消旧前景动作并回到安全姿态，不能一次补完数分钟的位移。渲染目标 60 FPS，允许设置 30 FPS；这是目标，不是未经测量的保证。[S5]

窗口隐藏或系统休眠时停止无意义动画和轮询；仅仅失去焦点不应把正常桌宠冻结。创建/销毁窗口、React 热更新与组件卸载时移除 ticker、监听器、定时器和纹理引用。程序退出不能留下后台进程。

缓存已有纹理，限制导入资源规模。重新加载时不能先卸载仍被运行实例使用的纹理；成功切换和取消旧实例之后再释放旧资源。[S6]

所有关键错误应进入可见状态和日志，但不引发未处理 Promise rejection。Windows 无法创建托盘或透明窗口等关键能力时应明确提示，不静默启动一个用户找不到的后台程序。

## 17. 测试与可复现验收

至少实现以下自动化覆盖。可将相近项合并在一个测试文件中，但不要仅用快照测试代替行为断言。

| 模块 | 必须验证 |
| --- | --- |
| Schema | 有效示例通过；错误字段、负时长、超深嵌套、未知 motion、无效资源被拒绝 |
| 扩展性 | 加入新的 JSON 组与 motion 后 registry 能发现、能力目录更新；无需改 TS |
| 随机驱动 | 确定性加权选择、权重零、冷却、历史排除、条件过滤、空池安全待机 |
| 定时生命周期 | pause/stop 后旧 timer 不再提交；多次恢复仍只有一个计时器 |
| 时间轴 | sequence 顺序正确、parallel 同时启动并等待最长分支、通道冲突被拒绝 |
| 取消与失败 | 取消递归传播；并行某分支失败取消其他分支；只产生一个终态 |
| 抢占 | 点击/拖动能中断随机；低优先级不能覆盖高优先级；迟到回调被忽略 |
| 命令协议 | 幂等、重复 ID 内容冲突、过期命令、未知动作、不可用 AI 模式 |
| Registry 更新 | 非法新包不污染旧快照；合法更新取消旧动作并刷新目录 |
| 坐标 | 非零工作区原点、负坐标副屏、屏幕移除、不同角色大小、边界裁剪 |
| 配置 | 默认值、参数覆盖、损坏文件回退、AI 禁用不影响普通模式 |
| 资源类型 | rig timeline 与 frame animation 均实际播放/推进并可取消 |

几何、随机、schema 与时间轴核心应能脱离 Electron GUI 做单测。桌面集成可用受控假 WindowHost 辅助测试，但不能把 mock 通过当成真实 Windows 穿透和拖动通过。

在具备 GUI 的目标 Windows 环境做人工/集成验收并记录：

- 启动可见透明角色；没有意外黑色矩形；关闭调试工具后仍正常。
- 单击、双击、拖动区分正确，按压有即时反馈，松手不误触点击。
- 透明区域能点击背后的应用；从完全穿透恢复人物交互和托盘恢复都有效。
- 手动预览、随机播放和导入重载后没有多实例竞争或卡死。
- 拖到边缘、副屏和任务栏附近不会消失；重启后位置合法。
- 关闭网络后普通模式正常；不存在模型 API 调用或 Key 依赖。
- 导入随附 custom-action-pack，只改 JSON 即可出现新动作，并参与随机。
- 至少连续运行 10 分钟观察是否出现计时器、监听器或内存持续无界增长。

`docs/TEST_REPORT.md` 区分“实际执行通过”“未执行”“环境限制”“已知失败”，包含命令、退出状态、测试环境和必要证据。未在 Windows GUI 下运行时，明确记录 Windows 行为待验证。不能把编译成功写成所有功能通过。

## 18. 分阶段执行顺序

**阶段 A：能看见。** 初始化工程、安全桥接与透明小窗口；放入可运行的分层演示角色；实现基础待机、托盘、退出与控制面板。先验证图像路径与窗口不抢焦点。

**阶段 B：能播放与扩展。** 完成 motion registry、JSON schema、ActionGroupRunner、sequence/parallel、取消和通道验证；实现一个真正可导入的动作包。此阶段即写核心测试，不能最后才发现格式无法扩展。

**阶段 C：能自然交互。** 接入 NormalBehaviorDriver、随机规则、点击/拖动、优先级、移动边界和输入穿透；填充内置动作组。

**阶段 D：能配置与稳定使用。** 完成动作管理、设置持久化、资源重载、错误面板、隐藏恢复、多屏处理与有限资源管理。

**阶段 E：可交付。** 加入未来 AI 的不可用接口契约与测试，完成 README、动作包教程、测试报告和 Windows 打包配置；在当前环境能执行的范围内实际构建和验证。

每阶段先交付可运行增量，再进入下一阶段。不要为 UI 装饰牺牲动作组数据化，也不要为了未来 AI 提前开发一整套后端。遇到构建错误优先定位根因，不用删除 strict、跳过测试或无限放宽安全策略解决。

## 19. 最终交付清单与报告格式

交付完整工程、源码、真实内置资源、lockfile、动作包示例和 JSON Schema，而不是只给散落代码块。文档至少包含：

```text
README.md                   # 安装、运行、打包、操作方式、实际版本
AGENTS.md                   # 简短项目约定，链接本任务书和实现文档
docs/ARCHITECTURE.md         # 模块边界、状态真源与进程通信
docs/ACTION_PACKS.md         # 从零增加组、motion、图片序列的教程
docs/FUTURE_AI.md            # 契约、禁用状态、未来接入点
docs/ASSET_SOURCES.md        # 参考图与演示素材的真实状态
docs/TEST_REPORT.md          # 已执行 / 未执行 / 失败项
schemas/                    # 与运行时 schema 一致的 JSON Schema
examples/custom-action-pack/# 必须可以从应用 UI 导入
```

最后用中文汇报：已经完成的具体功能；启动和打包命令；新增动作组的最短操作路径；实际测试结果；AI 接口所在文件；素材是否精细复刻或仅演示；已知限制。

Windows 安装包/便携包只有在实际生成后才能提供路径。没有签名证书就说明未签名，不伪造签名结果。当前系统无法运行 Windows 安装包时，区分“已生成构建产物”和“已完成 Windows 安装验证”。

以下情况均不得宣称完成：只有项目目录、动画按钮无效、随机逻辑硬编码组名、新增组要改 TS、AI 显示可用但实际随机、动作取消后继续移动、导入只显示名称而不能播放、素材仍是带背景截图、声称完成未实际执行的 GUI 测试。

## 20. 实施参考资料

以下为实现时应核对的官方资料，文中 [S1]～[S8] 对应这些来源。行为调度、动作组 schema 和优先级规则是本项目设计要求，不是这些框架自动提供的能力。相关软件文档会更新，应以实际安装版本为准。

**[S1] Electron：窗口样式与 BrowserWindow。**透明窗口限制、整窗输入穿透等实现参考：  
`https://www.electronjs.org/docs/latest/tutorial/custom-window-styles`  
`https://www.electronjs.org/docs/latest/api/browser-window`

**[S2] Electron：screen。**DIP、显示器工作区、鼠标位置和平台限制：  
`https://www.electronjs.org/docs/latest/api/screen`

**[S3] Electron：Security 与 IPC。**进程隔离、IPC 白名单、发送方验证和资源边界：  
`https://www.electronjs.org/docs/latest/tutorial/security`  
`https://www.electronjs.org/docs/latest/tutorial/ipc`

**[S4] PixiJS 8：Events / Interaction。**事件模式与命中检测：  
`https://pixijs.com/8.x/guides/components/events`

**[S5] PixiJS 8：Ticker。**统一时间更新与帧率设置：  
`https://pixijs.com/8.x/guides/components/ticker`

**[S6] PixiJS 8：Assets。**加载、缓存和释放素材：  
`https://pixijs.com/8.x/guides/components/assets`

**[S7] electron-vite / electron-builder。**构建和打包配置：  
`https://electron-vite.org/guide/`  
`https://www.electron.build/`

**[S8] OpenAI Codex：AGENTS.md。**项目级持久约定应保持简短，长任务书单独存放并显式要求读取：  
`https://developers.openai.com/codex/agent-configuration/agents-md`

---

**现在开始：先阅读当前仓库和参考图，列出实施步骤，然后直接创建并验证第一阶段代码，持续推进到普通模式的完整可交付版本。本轮不开发 AI 模式。**
