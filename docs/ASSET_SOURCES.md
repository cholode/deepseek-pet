# 素材来源与真实状态

## 1.1 精细组件（当前实际使用）

按用户要求，使用内置 imagegen 工具生成组件，未使用 API Key 或 CLI。工具未暴露可核实的底层模型版本，故不声称已指定某个型号。应用运行时仍完全离线。

- 原始组件图集：art/source/components-v2.png（1536×1024 RGBA）。含身体、双臂、后发、鲸尾；第一版头部边缘不足，已用第二张图集替换。
- 修订头部图集：art/source/heads-v2.png（1774×887 RGBA）。含完整双侧鳍耳、睁眼及闭眼。
- 完整生成提示词：art/source/prompt-v2.txt、art/source/prompt-heads-v2.txt。
- 参考来源：用户压缩包中的 reference/character-reference.png 和上一版 imagegen 生成的精细设定图。截图背景、界面、水印不进入桌宠。
- 可复现加工：scripts/art-assets.ts，只进行图集矩形裁切、透明裁边、尺寸配准、合成和序列帧色调变化；角色绘制来自生成模型。运行 npm run assets。

所有实际角色图层均位于 resources/builtin/assets，使用 680×840 RGBA 画布，以 340×420 逻辑坐标显示。headClosed 只替换模型生成的闭眼区域，保持睁眼头部的耳朵、轮廓和双侧蝴蝶结一致。后发、头、身体、双臂、鲸尾可独立变换；鳍耳跟随头部。eyes/mouth/hairFront 保留兼容节点及透明占位，现有自定义动作不会因节点消失而失效，但它们不再代表独立绘制的原始面部层。

portrait.png 用实际运行组件合成；frame-0.png 至 frame-3.png 为同一组件的 340×420 PNG 序列，表现闭眼和水光亮度变化。不会切回旧版矢量角色。预览：art/previews/assembled-v2.png。

resources/icon.png 与 icon.ico 延续项目内原始鲸鱼图标。scripts/assets.ts 是历史 1.0 原创矢量设计与动作生成代码，不再由 npm run assets 调用，请勿用其覆盖当前素材。

这些素材随便携包本地分发。未声明 DeepSeek 官方授权或用户参考图的再分发许可证。本项目没有自动拆层或 Live2D 模型绑定。
# 盖被子睡眠素材（1.1.2）

下文的 `art/animations/`、提示词及 `scripts/sleep-*.cjs`、`scripts/integrate-sleep.cjs` 是本机制作用记录，按要求加入 Git 忽略规则，不随仓库发布。应用所需的 96 张身体序列帧及独立尾巴 PNG 全部位于已提交的 `resources/builtin/assets/sleep/`，克隆后无需生成素材即可构建运行。

`resources/builtin/assets/sleep/` 来自本项目 `art/animations/sleep-v4`：同一张已确认的 AI 睡姿原画，96 帧仅让被子缓慢起伏；尾巴提取为独立透明 PNG，根部隐藏区域作延伸以供遮挡。运行时绕根部旋转，不拉伸尾巴。人物、枕头和口水静止，Z 由 Pixi Text 动态绘制。原画提示词与来源保留在 `art/animations/sleep-v1/source`。生成与接入脚本为 `sleep-tail-layer.cjs`、`integrate-sleep.cjs`。入睡和醒来按用户要求直接切换，无过渡动画。
