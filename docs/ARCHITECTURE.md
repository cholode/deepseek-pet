# 架构与实现边界

## 存储先行

`SettingsStore` 首先读取 `userData/settings.json`，用 Zod 校验全部字段。损坏时备份，使用明确默认值。保存通过串行写队列、临时文件和 rename 完成。主进程是磁盘写入的唯一入口。

`PackStore` 扫描内置资源和用户包，先检查文件类型、目录联接、路径、压缩前大小与图像头，再解析清单、motion、group。每次构建候选 registry，跨引用和通道分析完成后才发给 renderer 预加载。renderer 成功准备纹理后取消旧实例、切换目录、更新图层并释放旧纹理；主进程收到确认后提交资源令牌白名单。失败保留旧目录；坏包不会直接清空其他有效包。

## 单一运行时

`PetRuntime` 只在桌宠 renderer 中创建一次，维护 registry、设置、桌面状态、当前前景实例、幂等接收缓存、隔离组与有界错误/事件缓冲。React 小屋订阅每 250ms 发布的状态，不驱动逐帧动画。

普通驱动、点击绑定和手动预览进入同一个 `PetControlPort` / 命令入口。来源由本地可信入口绑定，优先级依次为系统 100、手动 80、点击 60、AI 40（不可用）、普通 10。低优先级不能抢占；相同或更高优先级取消旧实例。拖动锁住全部前景命令。

`ActionGroupRunner` 将经过校验的有限动作树编译为时间表：顺序累加偏移，并行共享起点。统一 Pixi ticker 推进所有叶子。每个资源句柄具有幂等 dispose，结束的节点先释放，后续顺序节点再获取通道。任一分支异常会释放所有兄弟，恢复基准姿态并发出唯一终态。实例 ID 阻止旧终态清除新动作。

`NormalBehaviorDriver` 只选择组并提交命令。注入时钟和随机源，按启用、资格、权重、冷却、真实用户空闲、指针、漫游条件过滤，再逐步放宽最近两次历史。冷却从终态开始。暂停/停止清除唯一计时器，并用 epoch 拒绝旧回调。空池安全待机。

## 渲染和交互

`Avatar` 使用 PixiJS 8 `Application.init()`、纹理缓存、容器和图形。设计画布 340×420，角色脚底原点固定。`root/body/head/hairBack/hairFront/armLeft/armRight/eyes/mouth/effects` 是公开节点；头部容器带动眼嘴和前发。旋转以度声明，内部转为弧度。

动作通道暂时接管对应待机：pose 不会被呼吸覆盖；face 不会被眨眼覆盖。全身帧动画隐藏分层树，按统一脚底锚点展示序列，完成/取消恢复分层树。按压使用独立覆盖容器，不污染动作基准。

鼠标事件记录按下、移动阈值、指针捕获和松开。单击延迟 260ms 等待双击；拖动启动取消待定单击。矩形命中区通过角色节点变换转换为 DIP，不能用含透明空白的纹理包围盒当头部区域。

主进程每 34ms 采样系统鼠标，只有 ignore 状态变化才调用 Windows 输入开关。拖动时主进程为位置真源，起点和终点立即采样，避免快速拖放在两次轮询之间漏掉位移。自主移动也由主进程插值，取消后保留当前合法位置。

屏幕坐标全部使用 DIP，窗口大小与设计坐标显式变换。设备像素比只用于 canvas 分辨率，不乘入屏幕位置。几何计算包含工作区原点，能处理负坐标和任务栏。显示器变化后选择最近工作区并夹取。

Windows 本机测试采用 `pop-up-menu` 置顶级别。普通 `floating` 在本机返回未置顶，已在实际测试中发现并替换。窗口仍被限制在工作区，不反复抢焦点。

## 安全和离线运行

全部 BrowserWindow 使用 `contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`。preload 仅暴露明确函数，主进程校验发送窗口和顶层 frame、命令内容与参数范围。小屋不能调用宠物专用拖动/位移接口，宠物不能打开任意路径或读取任意文件。

`petasset://local/<随机令牌>` 只能读取当前批准包的图像；不传文件系统路径。禁止导航、新窗口、webview 和权限请求。生产 CSP 不开放远程连接、脚本 eval 或任意脚本源。Pixi 的 `pixi.js/unsafe-eval` 名称容易误解：这里导入的是**免 eval 的静态 uniform polyfill**，未放开 CSP。

安装产物没有 Node 调试端口和测试桥接。`scripts/gui-test.cjs` 只在开发时启用 Playwright/CDP，设置独立测试 userData，不进入打包文件。运行程序不读取模型密钥、不分析屏幕、不调用模型、不加载远程页面。

## 核对的官方文档

- [Electron 窗口](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron screen / DIP](https://www.electronjs.org/docs/latest/api/screen)
- [Electron 输入穿透](https://github.com/electron/electron/blob/main/docs/tutorial/custom-window-interactions.md)
- [PixiJS 8 ticker](https://pixijs.com/8.x/guides/components/ticker)
- [electron-vite](https://electron-vite.org/guide/)

## 1.1 美术组件
新增 tail 姿态节点，锚点 (28,-114)。实际 PNG 图层统一 2 倍分辨率，Avatar 映射回 340×420 逻辑坐标。头部两种纹理使用同一轮廓，idle 根据 eyes 逻辑节点缩放和当前表情切换闭眼区域；鳍耳属于头部。导入包保持 deepblue-chibi-v1 契约。详细加工记录见 ASSET_SOURCES.md。

尾巴连接修正：尾巴改为 body 的子节点，置于身体图像后方；图集尾巴旋转 35°，装配框为 (8,-207,156,110)，尾根隐藏在裙摆内侧。身体缩放和位移共同作用于尾巴，尾巴独立旋转仍以尾根为中心。小屋原画与逐帧资源通过同一装配脚本同步更新。
