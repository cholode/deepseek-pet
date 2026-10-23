# 实际测试报告

日期：2026-09-06。环境：Windows 11，系统版本 10.0.26200，Node 24.20.0，Electron 44.2.0，单显示器，缩放 200%，逻辑显示器尺寸 1440×900 DIP。

## 自动检查：实际执行通过

| 命令 | 结果 |
|---|---|
| `npm install` | 成功；Electron 二进制单独通过镜像安装 |
| `npm run typecheck` | 退出 0，TypeScript strict 保持启用 |
| `npm run lint` | 退出 0 |
| `npm run test` | 退出 0；2 个文件，51 项行为测试通过 |
| `npm run schemas` | 成功生成四份 JSON Schema |
| `npm run build` | 退出 0；main / preload / renderer 均构建成功 |
| `npm run dist:win` | 实际生成 Windows x64 便携 EXE |
| `npm audit --omit=dev` | 0 个已报告漏洞；开发依赖 sharp 也已升级到 0.35.4 |
| `npm run dev -- --inspect 9233 --remoteDebuggingPort 9234` | localhost:5173 中真实 Electron 启动；13 组、canvas 正常、运行错误为空 |

51 项测试覆盖：有效示例；未知字段/负时长/无限 repeat；深度和节点上限；未知 motion；重复 ID；并行通道冲突；关键帧递增和实际通道；序列帧时长歧义及缺图；JSON 扩展；顺序/并行执行；递归取消、分支失败、唯一终态、看门狗；幂等/冲突/到期/伪造来源；优先级和拖动锁；固定位置；禁用和零权重；AI 不可用不影响普通驱动；非法 registry 不污染旧快照；合法更新取消旧实例；失败隔离；挂起级 delta 清理；确定性权重/冷却/历史/条件/空池；计时器生命周期；负坐标工作区和缩放；安全路径、链接、脚本文件、图像头和尺寸；配置并发写与损坏备份。

## Electron 集成：实际执行通过

使用 `scripts/gui-test.cjs` 启动真实 Electron，使用独立 `.test-user`。它运行真实 renderer、主进程 IPC、文件系统和原生窗口；不是把 WindowHost mock 当 Windows 验收。

- 启动 13 个内置组，按组逐一预览，均观察到对应实例 completed。
- 实际完成 9 秒睡眠、左右移动、分层动作和四张 PNG 的逐帧动画。
- 真实主进程固定位置限制拒绝手动移动，AI 请求返回 MODE_NOT_AVAILABLE。
- 实際读取 BrowserWindow 原生位置，验证散步取消后位置不再变化。
- 导入随附 custom-action-pack 并执行新增点头 motion 和组合组；重载后目录更新且可继续播放。
- 导入集成测试用确定性的文件夹选择器返回值，但后面的解析、临时复制、资源加载、提交和播放均为真实实现。没有把该项写成原生文件选择器已手动全程验收。
- 右键菜单 IPC 回归：真实打开原生菜单，Promise 返回 undefined，关闭菜单；不再出现 native Menu 无法克隆。
- 错误缓冲在上述正常流程后为空。

运行汇总在 `test-results/gui-report.json`。图像证据：`pet-start.png`、`panel-home.png`、`panel-actions.png`、`panel-settings.png`、`dev-pet.png`。

## Windows 鼠标：实际执行通过

使用 Windows computer-use 发送真实鼠标/键盘输入，并结合运行时生命周期和真实窗口位置核对：

- 透明分层角色可见，能看到后面的窗口，没有不透明背景矩形。
- 单击头部发出 target=head 并启动 head_touch；单击身体发出 target=body 并启动 body_touch。
- 双击后小屋获得焦点，没有误发单击动作。
- 快速拖动中断随机动作，发出 drag-start / drag-end；窗口实际移动到新坐标，随后完成 drag_release，无误触单击。
- 透明留白上的点击进入下方窗口；全部穿透开启后，人物上的点击也进入下方窗口。
- Ctrl+Alt+P 从全部穿透恢复；配置 clickThrough=false；之后再次真实单击头部能启动 head_touch。
- 控制面板“重置桌面位置”实际将窗口恢复至工作区右下方。

工具在单显示器 200% 缩放下运行。穿透是近似矩形与约 29Hz 采样的组合；从很远处瞬移鼠标并在同一瞬间按下的合成输入，可能先经过一次采样才恢复人物命中。正常移入后可持续点击，不宣称逐像素或零延迟。

托盘恢复与退出入口已经实现且复用相同恢复函数。隐藏托盘图标的完整点击路径未逐一实点。原生文件夹选择器全程操作未完成（自动化期间窗口收到用户操作并最小化，停止了这一轮界面点击）；实际导入管线见上文。

## 长时间观察

保存了三轮实际采样，间隔约 5 秒：

| 文件 | 持续时长 | 采样 | 事件上限 | 主进程 Timeout 数 | 暖机后/末次总工作集 |
|---|---:|---:|---:|---:|---:|
| soak-before-final-fixes.json | 831 秒（13 分 51 秒） | 166 | 60 | 1 | 689 / 705 MB |
| soak-second-pass.json | 371 秒 | 74 | 60 | 1 | 676 / 693 MB |
| soak-final-interactions.json | 586 秒（9 分 46 秒） | 117 | 60 | 0～1（包含穿透关闭采样） | 698 / 708 MB |

工作集为整个 Electron 应用（主进程、GPU、工具进程、两个 renderer）合计，包含测试调试开销，不是角色纹理大小，也不代表所有机器的常驻内存。观察未出现计时器或事件数组无界增加，不能据此证明永远没有内存泄漏。第一轮超过 10 分钟；最后一轮包含交互修复的运行到 9 分 46 秒结束。菜单返回值与错误展示的最后小修复另外做了回归，未伪称在最后一字节完全相同的构建上又做了一轮 10 分钟测试。

## 打包与离线：实际执行通过

实际双击等价启动 `release/DeepBlue-Desktop-Pet-1.0.0-win-x64.exe`，从便携包临时展开目录的 `resources/app.asar` 加载。确认 `app.isPackaged=true`、Electron 44.2.0、13 组、错误为空、角色和小屋素材可见、窗口实际置顶。

使用测试浏览器上下文的离线模式后重新加载桌宠页面：canvas、13 组和本地素材仍成功加载，错误为空。未操作系统网络设置，也未声称物理拔网线。应用运行代码没有模型 API、密钥、联网素材或远程页面。

产物未签名，`Get-AuthenticodeSignature` 返回 NotSigned。交付的是便携包，不是已安装 NSIS 安装器；不宣称签名或安装器卸载验收。

## 测试中发现并修复

1. Electron 默认下载源连接失败：使用镜像并按包内校验和安装。
2. Pixi 在严格 CSP 下默认 uniform 生成报错：导入官方免 eval 静态 polyfill，生产 CSP 没有放开 unsafe-eval。
3. 全画布透明纹理导致头部包围盒覆盖身体：改为变换后的明确命中矩形。
4. 本机 floating 级别未维持实际置顶：改为经实测有效的 pop-up-menu 级别。
5. 重载后小屋仍引用过期资源令牌：提交后广播 registry 给小屋，及时替换设定图 URL；托盘变更设置也同步小屋。
6. 快速拖放早于轮询、以及按下 IPC 到达时鼠标已移动：传递经过主进程命中检查的按下事件 DIP 坐标，在起止时立即更新位置。
7. 移动取消测试使用低频 UI 快照时误判 2 DIP 差异：改为测量原生 BrowserWindow 位置，取消后实际不再移动。
8. 原生右键 Menu 对象无法跨 IPC 克隆：打开菜单后返回 void，并捕获 renderer 请求错误；集成回归已加入。

## 未执行或不作保证

- Windows 10、多显示器负坐标真实硬件、热拔插、混合 DPI、系统睡眠/恢复的实机组合；相应纯函数和清理路径已实现，不能用单测代替多屏实测。
- 每一机型的稳定 60 FPS、按压反馈严格小于 100ms 的仪器测量、无限运行稳定性。
- 此处是 1.0 的历史范围：当时未完成 Live2D。1.2.0 已完成正面原画拆件绑定与程序接入，见文末；大角度侧转仍未制作。

已知范围限制：本版无 AI、无 ZIP 市场、无脚本插件、无跨屏自主漫游；这些符合任务书边界。

## 最终交付复核
最后一轮 GUI 回归退出 0，共 22 个集成检查通过（包括右键菜单 IPC 回归）。最终便携 EXE 大小 109559326 字节，SHA-256 为 674AD2970E31C59CCFBCD378E3C97BE83E83ADB22E844A3AACEB7317DEC3697F。已在桌面创建 DeepBlue 桌宠.lnk，并以正常参数启动正式版本；当前仅保留正式桌宠窗口，没有测试调试窗口。


## 2026-09-06：1.1 精细组件升级

- 已替换桌面实际素材，并补全鳍耳和独立鲸尾；小屋预览和逐帧动作使用同一套组件。原图集及提示词保存在 art/source。
- npm run typecheck、lint、test、build 均通过，51 项单元测试。npm run schemas 生成含 tail 节点的 JSON Schema。
- npm run test:gui 完整通过 22 项真实 Electron 检查，含全部 13 动作、导入与热重载。第一次执行在原生菜单关闭后出现 Electron length_error 导致进程退出；未修改测试或跳过项目，第二次完整执行通过。
- scripts/art-gui-test.cjs 捕获新版 idle、wave、sleep、water 画面，保存于 test-results/art-v2。检查耳朵完整、尾巴清晰、闭眼不切换蝴蝶结、挥手有独立手臂。
- Windows 原生鼠标拖动从 (750,250) 到 (800,290)，与输入 (50,40) 一致；记录 drag-start/end 与站稳动作完成。单击头部产生 head_touch 且完成，运行错误列表为空。证据 test-results/art-v2/native-state.json。
- 分层方式为 Pixi 部件变换，耳朵跟随头部，不是独立 Live2D 网格。眼睛通过已生成区域切换，鼠标视线表现为细微头部偏移。
- 追加原生右键菜单检查：菜单正常显示，Escape 关闭后桌宠继续响应，无进程退出。
- npm run dist:win 成功生成 release/DeepBlue-Desktop-Pet-1.1.0-win-x64.exe（110572017 字节），SHA256 475CD3F1CDEE1F44127CC5928A84706CD99FAFB2A9AF54B59D3EF9DE824C8670。桌面快捷方式已指向新版。
- 最终便携运行验证未通过：Windows 返回“应用程序控制策略已阻止此文件”。本地运行时与打包运行时均无 Authenticode 签名，没有更改任何系统安全策略。桌面快捷方式改为已验证的本地 Electron 运行版，指向本项目；便携 EXE 保留但不能声称在本机可用。

## 尾巴连接修正
调整尾巴方向、位置、尾根锚点及 body 父节点，预览与序列帧同步更新。typecheck、lint、51 项单元测试、build 通过。首次画面脚本在启动期间请求动作被拒绝；等待就绪后实际执行 greet_wave 和 body_touch 均 accepted/completed，错误为空，截图及状态见 test-results/art-v2/tail-*.png 与 tail-check.json。本轮更新本地运行版，未重做被应用控制拦截的便携包。
# 1.1.2 盖被子睡眠集成（2026-09-25）

本节的睡眠 GUI 专项脚本及截图为本机验收记录，按要求忽略，不随仓库发布；通用 GUI 测试仍通过 `npm run test:gui` 执行，新增自动化用例保存在 `tests/core.test.ts`。

- `npm run typecheck`、`npm run lint`、`npm test`（53 项）、`npm run schemas`、`npm run build`、`npm run dist:win` 均退出 0。
- 新增用例验证：非站立时不能进入睡觉且不打断原动作、14.4 秒完成后 reset、拖动取消睡姿与特效、独立尾巴图片缺失会拒绝加载。
- `node scripts/sleep-gui-test.cjs` 在真实 Electron 窗口中验证站立入口限制、睡眠自然完成和停止后恢复站立、无运行错误。随后通过 `PET_TEST_EXE=release/win-unpacked/DeepBlue Desktop Pet.exe` 对打包程序重复检查，通过。截图 `test-results/sleep-live.png` 可见盖被子姿势、独立尾巴、头顶向右上分布的 Z；站立恢复截图和结果见同目录。
- 安装 EXE `DeepBlue-Setup-1.1.2-win-x64.exe`：192952436 字节；便携 EXE `DeepBlue-Desktop-Pet-1.1.2-win-x64.exe`：152501120 字节。SHA256 见 `release/SHA256SUMS.txt`。未签名，本轮验证打包后的 unpacked 程序，未执行安装向导或便携自解压启动流程。
- 本轮没有重新进行多屏、原生拖动、十分钟驻留测试；历史相关结果不能替代本轮完整回归。新增脚本仅操作本项目测试窗口，使用独立测试用户目录。

## 1.2.0 Live2D 接入（2026-09-27）

- `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、`npm run dist:win` 最终均退出 0。59 项单元测试通过，新增 6 项覆盖通道占用、参数范围、复位、眼部不重复缩放、虹膜与遮罩同步变换以及手臂/腿/尾巴隔离。第三方 Core 和本机制作用文件不属于 ESLint 源码检查范围。
- 通用 `node scripts/gui-test.cjs` 实际运行 Electron：13 个内置动作组全部完成；AI unavailable、固定位置、移动取消、示例包导入、自定义 JSON 播放、事务重载均通过，运行错误为空。记录 `test-results/gui-report.json`。
- `node scripts/live2d-gui-test.cjs` 使用独立用户目录进行 11 项专项验收；开发运行版与 `PET_TEST_EXE=release/win-unpacked/DeepBlue Desktop Pet.exe` 打包运行版最终均退出 0。验证实际 Core 参数的眨眼和尾巴变化、双轴视线、站立入睡限制、睡眠暂停隐藏模型更新、自然结束/取消后恢复、旧动作兼容、缩放与 30 FPS 设置、重载；未观察到 HTTP(S) 请求、renderer 异常或应用运行错误。
- 鼠标跟随测试通过临时替换本项目测试进程的系统鼠标采样结果完成，不移动用户物理鼠标。截图由应用测试接口取得，未使用 Computer Use。最终记录与站立/招手/睡眠/缩放截图位于 `test-results/live2d-source/`、`test-results/live2d-packaged/`。
- 验收过程曾出现鼠标跟随等待超时，以及后台控制面板截图超时。测试保留了原有功能断言，鼠标改为有界条件等待，控制面板截图前显式前置窗口；最后一次完整打包版回归 11 项全部通过。这些重试不作为长期帧率或所有硬件稳定性的证明。
- 实测生产 CSP 保留 `nodeIntegration:false`，不含 JavaScript `unsafe-eval`；只为本地 Core 内嵌 WebAssembly 增加 `wasm-unsafe-eval`。模型与纹理位于打包后的 `app.asar` 静态资源内，无需制作目录、Python、Node 开发环境或模型编辑器。
- 安装版 `DeepBlue-Setup-1.2.0-win-x64.exe`：194058387 字节，SHA256 `7561caa6896ec7dd0f67667202e42f37e9f53d25e24aff10012504aa56e2e7f7`。
- 便携版 `DeepBlue-Desktop-Pet-1.2.0-win-x64.exe`：153719169 字节，SHA256 `b4bee03b79948827f46a0310795a0a5a7f2bad0d588b06da2437425bf54f6eb0`。两者 Authenticode 实测均为 `NotSigned`。本轮验证了实际打包运行程序，未执行安装向导或便携自解压启动流程。
- 本轮未重新进行物理鼠标拖动、透明区域跨应用穿透、多显示器热插拔、十分钟驻留测试；不能以旧版结果替代本轮实测。模型当前为正面轻动作，旧部件时间轴幅度按此范围适配。


## 1.2.1 头颈与尾巴拆件修正（2026-09-27）

- 原因：后发兜底层残留头饰/呆毛/尾鳍边缘；脸层切进颈部和领口；后发上端未继承动作时间轴的头部位移。重新分配原图像素并清理底层，新增独立 Neck 网格、重建被遮挡的颈部与后发；头部动作幅度未缩小。
- `npm run typecheck`、`npm run lint`、`npm test`（61 项）、`npm run build`、`npm run dist:win` 均通过。新单测覆盖脖子随身体而非头部移动、后发根部随点头而发梢维持锚定。
- `node scripts/live2d-cutout-test.cjs` 调用生产 Live2DRenderer、真实 MOC3 和官方 Core：27 网格，头部位移/旋转/缩放不改变独立脖子图像；后发顶部无头饰残片；原尾鳍下缘抽样透明；摆尾参数不改变身体图层。检查头部 ±8 设计像素、±4 度及尾巴参数 ±1 的极限姿态，输出 90 帧/3 秒循环和截图，证据 `test-results/live2d-cutouts/`。实际视觉检查了抬头、低头、左右摆尾及打包版摸头截图。像素抽样与截图不代表全部可能姿态已穷举。
- 独立制作预览的官方 Core 验证在 27 层首次导出时通过全部参数极值、眼罩与部件隔离；随后下巴精修的最终模型又通过上述生产渲染器检查与打包程序检查。
- `PET_TEST_EXE=release/win-unpacked/DeepBlue Desktop Pet.exe node scripts/live2d-gui-test.cjs` 最终 11 项通过：眨眼、尾巴待机、主进程鼠标视线、招手、站立入睡限制、睡眠完成及取消恢复、摸头/身体/水光/张望、缩放与 30 FPS、重载，零运行错误、零 HTTP(S) 请求。首次运行鼠标检查因固定采样坐标与窗口缩放不一致超时；改为按当前窗口 bounds 取比例坐标，保留原视线方向断言，完整重跑通过。截图和报告在 `test-results/live2d-packaged/`。未使用 Computer Use。
- 安装 EXE `DeepBlue-Setup-1.2.1-win-x64.exe`：193748893 字节，SHA256 `2457b32053fd961bacd5d2d23fc0198f2f73b75e2536d6f0727d903c81b4519a`。
- 便携 EXE `DeepBlue-Desktop-Pet-1.2.1-win-x64.exe`：153412692 字节，SHA256 `f11f41ccbffc037fed367e7401d59b1e444ca83efbc8eb1b5a659629ea777076`。两者实测 NotSigned；验证的是打包后的 unpacked 程序，未运行安装向导或便携自解压启动流程。
- 本轮未重跑通用 GUI 全部动作/导入测试，也未重测物理鼠标拖动、多显示器及长时间驻留；历史结果不替代本轮验证。制作目录继续忽略，程序使用的模型与图集独立打包。


## 1.2.2 侧视步行（2026-09-27）

- 内置左右步行改为原三视图侧面拆件导出的序列，每方向 32 帧，512×752，40 FPS，周期 800ms；与原有 2400ms 窗口移动重复三次同步。左行使用原侧面，右行水平镜像。没有新增动作 ID 分支或改动统一执行器。
- `npm run typecheck`、`npm run lint`、`npm test`（63 项）、`npm run build` 均通过。新增用例验证侧面序列与窗口移动同时开始、2400ms 同时完成并 reset，以及缺少侧面帧时保持旧 registry。
- 初始全尺寸导出使动作包解码预算超出 256 MiB，加载和测试明确失败；将 64 张侧面帧等比缩至 512×752，同时调整显示比例与命中区域。最终整个内置 PNG 解码量约 216.19 MiB，未放宽安全上限。重新导出后全部 63 项测试通过。
- 素材检查：左右各 32 帧、画布一致、所有姿态在画布内，右行逐帧与左行的水平镜像相同。检查透明背景、尾巴周围与腿部运动，未重新生成角色。源码中只增加运行用 PNG/JSON；制作脚本和 GIF 继续留在忽略目录。
- `node scripts/side-walk-gui-test.cjs` 在源码运行版与最终 `PET_TEST_EXE=release/win-unpacked/DeepBlue Desktop Pet.exe` 打包运行版各通过 7 项：左右素材识别、左/右实际移动 120 DIP 且方向正确、完成恢复正面、停止后正面且不继续移动、固定位置拒绝移动、走动期间重载恢复正面、零运行错误。实际渲染截图、正面恢复截图和 JSON 报告位于 `test-results/side-walk-source/` 和 `test-results/side-walk-packaged/`。未使用 Computer Use。
- 本轮没有重新运行全部旧动作的 GUI 回归、多屏、物理鼠标拖动或长时间驻留。拖动中断仍经过原有单测与执行器清理逻辑，不能等同于本轮物理鼠标实测。

- `npm run dist:win` 最终退出 0。安装版 `DeepBlue-Setup-1.2.2-win-x64.exe` 为 214895903 字节，SHA256 `942bdb8e9a87b416d11628ef055333db253f110ae4275c9e7165e097e1a19a2d`；便携版 `DeepBlue-Desktop-Pet-1.2.2-win-x64.exe` 为 174589806 字节，SHA256 `171cc3a7afcd0bd4b77a98c39712ed1acdfa4a94688c2238f3298606e55f1072`。两者仍未签名。
- 本轮实际启动了便携 EXE，自解压后出现 `DeepBlue Pet` 正常用户窗口，进程来自便携临时解压目录；安装向导和卸载流程未执行。打包内容的步行交互验收仍以上述 unpacked 专项测试为依据。


## 1.2.3 侧视腿根修正（2026-09-27）

- 原腿层顶部延伸不够，且误保留原裙摆的白边、描线和截断阴影；迈步后这些像素露在裙外。向裙内加长腿根，清除顶部旧裁切痕迹，按原肤色重建连续大腿及侧边描线。双腿共用修正后的原腿组件，重导左右 64 帧。步幅、关节、脚底位置和时长均未改变。
- `npm run typecheck`、`npm run lint`、`npm test`（63 项）通过。素材专项验证 32 个相位的近腿/远腿上截口均被裙身完全覆盖，腿根内部为连续不透明肤色、不再包含旧黑色横线；右行与左行保持逐帧严格镜像。放大检查三种极限位置与全 32 帧腿部接缝，记录位于本机忽略目录 `art/animations/side-walk-v2/thigh-validation.json`、`thigh-all-frames.png`、`thigh-closeup.png`。

- `npm run build`、`npm run dist:win` 最终退出 0。打包后的 `side-walk-gui-test.cjs` 最终 7 项通过，检查左右 120 DIP 移动、结束/取消/重载恢复正面和固定位置限制，运行错误为空。首轮在打包压缩同时运行时，移动距离断言失败；补充坐标诊断后，待打包完成再完整重跑通过，未修改或放宽原断言。检查了最终打包版左走截图中的腿部接缝。
- 安装版 `DeepBlue-Setup-1.2.3-win-x64.exe`：214819308 字节，SHA256 `36fcb1556f22458f2a7a3b6860986fcabea9a9c9f282e5715ecacd042de7be54`；便携版 `DeepBlue-Desktop-Pet-1.2.3-win-x64.exe`：174514038 字节，SHA256 `7e82293cd798d77303850281cb1fc29a01c8c9941ba46d9527a0048ce52beafc`。均实测 NotSigned。未执行安装/卸载向导，也未重测多屏或其他旧动作的完整 GUI 回归。

- 1.2.3 便携版启动确认：自解压后成功显示 DeepBlue Pet 窗口，并读取实际运行目录 resources/app.asar 中的 package.json，版本为 1.2.3。

# 1.2.4 新侧卧睡姿与飘动 Z（2026-10-23）

- 使用用户确认的 SVG 睡姿导出 24 张透明 PNG（150ms/帧），独立尾巴周期 3600ms、幅度 ±6.5°；最小口型面积为最大时的 1/3。SVG 预览验证 Z 的 x 增大、y 减小，且头、被子、枕头检查区域在 24 个姿态间像素稳定。
- `npm run lint`、`npm run test`（63/63）、`npm run build`（包含 `npm run typecheck`）通过。首次单测失败来自旧用例假设任意帧动画都有 fps；改为显式同时设置 fps 与 frameDurationsMs 后，原有互斥断言通过，未放宽校验。
- `node scripts/sleep-svg-gui-test.cjs` 已在实际 Electron 进程验证：加载 1.2.4 素材，非站立入口拒绝，新睡姿/口型/尾巴/Z 渲染，14.4 秒自然结束及手动停止恢复站立，资源包重载；零运行错误、零 HTTP(S) 请求。截图与结果位于 `test-results/sleep-124-source/`。未使用 Computer Use。
- `npm run dist:win` 退出 0，生成 `DeepBlue-Setup-1.2.4-win-x64.exe` 与 `DeepBlue-Desktop-Pet-1.2.4-win-x64.exe`，SHA-256 写入 `release/SHA256SUMS.txt`。
- `PET_TEST_EXE=release/win-unpacked/DeepBlue Desktop Pet.exe node scripts/sleep-svg-gui-test.cjs` 同样六项通过，零运行错误、零 HTTP(S) 请求；打包程序截图与报告位于 `test-results/sleep-124-packaged/`。本轮验证的是打包程序运行，未执行安装向导或覆盖用户安装目录。

## 1.2.5 睡姿肤色与站立统一（2026-10-23）

- 以站立头部脸颊 RGB(253,244,239) 为参考，校正睡姿面部偏橙的底色，并同步修改缩小嘴型下方的皮肤填补。校正后 SVG 三处脸部中性肤色样本均为 RGB(253,244,239)，运行用 24 帧均通过同色取样检查。头发、被子、尾巴与枕头的抽检区域和校正前逐像素相同。前后对照及报告保留在本机 `test-results/sleep-skin-125/`。
- SVG 预览检查通过：24 个姿态中头、被子、枕头检查区稳定，循环接缝误差在既有容限内，Z 向右上漂移，嘴型面积比例和尾巴运动参数保持原值。人工查看了张嘴与最小嘴型的放大对照图。
- `npm run lint`、`npm run test`（63/63）、`npm run build`（包含 `npm run typecheck`）通过。仅更新睡眠 PNG、素材版本和文档，无新增运行时图像处理或依赖。
- `npm run dist:win` 退出 0；便携版 `DeepBlue-Desktop-Pet-1.2.5-win-x64.exe` 与安装版 `DeepBlue-Setup-1.2.5-win-x64.exe` 已生成，校验和写入 `release/SHA256SUMS.txt`。实际打包程序六项 GUI 检查通过：加载新版素材、站立入口限制、睡姿与 Z 渲染、自然结束恢复站立、停止恢复站立、资源包重载；运行错误和 HTTP(S) 请求均为零，记录位于 `test-results/sleep-125-packaged/`。本轮未执行安装向导、卸载或多屏测试。

## 1.2.6 睡姿放大与窗口适配（2026-10-23）

- 睡姿显示比例从 0.44 提至 0.64，线性尺寸增大约 45%，优先匹配站立头部。Z 起点同步更新。程序按动作画布自适应横向窗口；睡姿为 502×420，站立为 340×420。用户大小设置改为缩放完整子场景，修正此前只放大窗口的问题。
- `npm run lint`、`npm run test`（64/64）、`npm run build`（包含 typecheck）通过。新增几何检查覆盖 0.6、0.65、1、1.25、1.5 倍下 50 次扩展/恢复不漂移，以及负坐标工作区边界。
- 源码 GUI 七项通过：实际宽窗口、脚底中心保持、放大脸部命中区域与主进程点击验证、完整画面不裁切、0.6/1.5 倍画面及命中区同步缩放、自然结束/取消恢复尺寸和位置、面板无权调用窗口尺寸 IPC。实际截图与结果位于 `test-results/sleep-size-126-source/`。在同一显示比例下人工查看站立与新睡姿对照，预览位于本机忽略目录 `art/animations/sleep-size-v1/`。
- `npm run dist:win` 退出 0，1.2.6 安装版与便携版 EXE 均已生成。最终打包程序的尺寸专项七项通过（`test-results/sleep-size-126-packaged/`）；打包程序侧视步行七项通过，含左右各移动 120 DIP、停止、固定位置和重载。源码 Live2D 综合十一项通过，含眨眼、双轴鼠标跟随、旧动作、睡眠切换、缩放和重载。SVG 动画专项同样通过。本轮未执行安装/卸载向导或物理多屏测试。
- 补测复现了启动后立即从已保存的 1.5 倍改成 1 倍时丢失设置消息的问题：主进程窗口已缩回，Renderer 仍保持 1.5 倍，鼠标跟随坐标偏差。改为纹理预加载前订阅并暂存消息，初始化后顺序应用；强制以 1.5 倍配置启动、立即切回 1 倍的鼠标跟随专项已通过，保留原有断言。
- 加入启动消息处理修正并重新构建后，最终打包程序再次通过尺寸专项七项和保存 1.5 倍配置启动的鼠标跟随专项；lint、64 项单测和类型检查通过。
