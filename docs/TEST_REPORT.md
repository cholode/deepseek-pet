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
- 精细设定图的完整拆层、精修补画或 Live2D 绑定。桌面角色明确是可动画的分层演示资产。

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
