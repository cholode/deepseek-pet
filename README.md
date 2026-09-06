# DeepBlue · 小蓝桌宠

一个可离线运行的 Windows 桌宠。Electron + React 管理窗口与小屋，PixiJS 8 驱动真正分层的角色。动作、动作组和图片序列均由本地 JSON 定义。

## 直接使用

双击 `release/DeepBlue-Desktop-Pet-1.1.0-win-x64.exe`。便携版不需要 Node.js、不需要安装依赖、不需要账号或网络。首次解压启动需稍等。此程序未签名。

- 单击头部：摸摸头；单击身体：戳戳肚子。设置里可以更换绑定动作。
- 双击角色：打开“桌宠小屋”；右键角色：打开菜单。
- 按住并移动超过 6 DIP：拖动；松手会站稳，拖动不会误触单击。
- 正常情况下，人物区域可交互，透明空白区域近似穿透。
- 开启全部穿透后，从托盘选择“恢复交互”，或按 `Ctrl + Alt + P`。
- 托盘提供显示、隐藏、重置位置、恢复交互和退出。关闭小屋不退出桌宠。
- 固定位置会禁止拖动和所有移动动作。关闭漫游只影响自动散步。

内置 13 组：微风摇摇、看看四周、向你招手、开心跳跳、有点害羞、小小抗议、打个盹儿、向左散步、向右散步、摸摸头、戳戳肚子、站稳啦、水光变奏。最后一组用于演示真实 PNG 序列帧。

## 开发与构建

在本目录运行（当前路径 `D:\go-project\vibecodingatempt\desktoppet`）：

```powershell
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run dist:win
```

`npm run start` 运行已构建版本。`npm run test:watch` 是监听测试，普通 `test` 会自动退出。`dist:win` 会先检查类型并构建，然后生成 Windows x64 便携包。没有签名证书，不配置假签名。

本机实际验证版本：Node **24.20.0**、npm **11.19.0**、Electron **44.2.0**、PixiJS **8.20.1**、React **19.2.8**、TypeScript **5.9.3**、electron-vite **5.0.0**、Vite **7.3.6**、electron-builder **26.15.3**、Vitest **3.2.7**、Zod **4.5.4**。以 `package-lock.json` 锁定的依赖为准；复现安装可使用 `npm ci`。

本机默认 Electron 下载源连接失败，改用镜像成功安装：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
```

这个环境变量只用于开发下载，程序运行时不访问镜像。

## 不写 TypeScript，增加一个动作

1. 打开小屋 → **动作组 → 导入动作包**。
2. 选择 `examples/custom-action-pack`（便携版解压资源中也附带此示例）。
3. 列表出现“点头后开心挥手”，点击预览即可。它同时引入一个新的点头 motion。
4. 点击“打开用户动作包目录”，修改已导入包中的 JSON 和 `pack.json` 清单，然后点击“重新加载”。无需编译。

完整教程：[动作包格式](docs/ACTION_PACKS.md)。加载失败会保留旧的可用快照。修改导入前的原文件夹不会自动修改已经复制到用户目录的包。

## 配置与存储

配置和用户动作包位于 Electron `userData`（本程序默认 `%APPDATA%\deepblue-desktop-pet`，可通过界面打开动作包子目录）。`settings.json` 保存大小、开关、位置、点击绑定和以完整组 ID 为键的覆盖项；`action-packs/` 保存导入的动作包。不会修改安装目录里的内置 JSON。损坏配置会重命名备份再恢复默认值。

## 素材与 AI 边界

桌面实际使用 **AI 生成的精细分层组件**：头部（含鳍状耳朵）、后发、身体、双臂、鲸尾独立装配；鲸尾和头发摆动，生成的闭眼区域用于眨眼和微笑。小屋图片由同一套实际组件合成，与桌面角色一致。旧的简化矢量素材已替换。这是 Pixi 分层骨架动画，未使用 Live2D。运行 `npm run assets` 可从已保存的生成图集重新裁切、配准和合成素材，无需再次生图。

AI 模式明确不可用：无 API Key、无模型 SDK、无聊天、无语音、无屏幕读取。类型在 `src/shared/contracts.ts`，可信命令入口在 `src/renderer/pet/PetRuntime.ts`，不可用检查在 `src/renderer/pet/behavior.ts`。详见 [未来 AI 接口](docs/FUTURE_AI.md)。

## 交付和验证

- [架构说明](docs/ARCHITECTURE.md)
- [素材来源与生成提示词](docs/ASSET_SOURCES.md)
- [实际测试报告及平台限制](docs/TEST_REPORT.md)
- [中文实现细纲](docs/实现细纲.md)

Windows 透明穿透采用系统整窗开关和有限频率鼠标采样，不承诺逐像素命中。当前优先验证 Windows 11；不宣称其他系统、多显示器热插拔等未实际执行的组合全部通过。

## 本机 1.1 启动说明

桌面“DeepBlue 桌宠”快捷方式当前启动项目内 Electron 本地运行版，已验证新素材和鼠标互动。请保留整个项目目录。1.1 便携 EXE 已构建，但本机 Windows 应用控制拦截该文件，尚未通过便携启动验证；本次未修改系统安全策略。
