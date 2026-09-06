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
