# 素材来源与真实状态

## 1.3.0 五种新表情与嘴型绑定

在 v7 拆件模型上新增疑惑、委屈、得意、无语和单眼笑闭，并完善开心、害羞、抗议、惊讶的嘴型。沿用原人物、原眉毛和原眼睑，通过原网格形变实现抬眉、挑眉及笑眼；原贴图字节未改变，没有重新生成人物。

嘴部的口腔、轮廓、舌头、牙齿及双眼泪光/高光为代码构建的 Cubism 网格，使用原图集色块的 UV 取色；原嘴在新嘴启用时隐藏，默认时恢复。口腔与眼部使用真实剪裁遮罩，随所属部件移动。新模型共 38 ArtMesh、24 参数和 11 变形器，使用原 Umamo 接口导出；制作脚本、CMO3、预览在忽略目录 `art/animations/live2d-rig-v8/`。应用只需更新运行用 MOC3、预设和动作 JSON，不依赖制作环境。贴图 SHA-256：`01bd640204c5002e1df49a248297d48bb23491ee903398af6cf907c6d3132f6d`。

## 1.2.8 双眼皮与眼睑同步

在 v6 模型上，按原三视图的双眼皮轮廓，从 HeadBase、FrontHair、BangCenter 三层分离对应网格三角形，新增 `EyeCreaseL`、`EyeCreaseR` 和右眼睫毛边缘 `EyeLidEdgeR`。保留原图 UV；静态层腾出的区域通过 UV 映射到邻近干净肤色填补，未重新生成或改写贴图。图集 SHA-256 与 1.2.7 完全相同。

双眼皮和睫毛边缘使用原有左右眼开合参数，沿与眼睑相同的轴收拢；双眼皮在闭合时渐隐。新网格随眼部/头部的时间轴位移、缩放与透明度一起变换，并保持刘海遮挡关系。模型共 30 ArtMesh，参数仍为 17 个；运行只更新 MOC3 与节点绑定。制作脚本及 CMO3 在忽略目录 `art/animations/live2d-rig-v7/`。

## 1.2.7 原眉毛形变修正

删除“小小抗议”额外绘制的 Pixi 眉毛线，新增 Cubism 参数 `ParamBrowForm`。原眉毛跨越 HeadBase、FrontHair、BangCenter 三层，在眉部细化网格，并为三层使用相同的局部形变场；中间刘海同时保留原有摆动参数。实际使用原图中的同一对眉毛，未生成、补画或叠加另一对。贴图与 1.2.6 的 SHA-256 完全相同，模型仍为 27 网格，参数从 16 增至 17。

本机制作文件位于忽略目录 `art/animations/live2d-rig-v6/`，通过原有 Umamo 接口导出并回读 CMO3，同时导出运行用 MOC3。原始分层仍来自 v5；没有改写睡眠、侧面步行或其他贴图。构建直接使用 `src/renderer/public/live2d/DeepBlue.moc3`，无需制作环境。

## 1.2.1 Live2D 原图拆件（当前站立角色）

站立角色来自用户提供并确认的 `bili_poster-1790401524192.png` 三视图正面，裁切原点 `(130,130)`，画布 `640×915`。闭眼线来自用户提供的组件图。没有重新生成人物；接缝通过原图像素重叠和被遮挡后发区域的邻近颜色补齐。

通过代码调用 Umamo 0.3.0-dev 的模型导出接口，完成 27 个 ArtMesh、13 个部件组、11 个变形器及 16 个参数。眼白、虹膜与眼睑独立，两个虹膜有真实剪裁遮罩。CMO3 回读与官方 Core 运行验证均通过。

应用只需要已纳入源码的 `src/renderer/public/live2d/DeepBlue.moc3`、`texture_00.png` 和 `live2dcubismcore.min.js`。制作脚本、分层 PSD、CMO3 和预览仍保留在已忽略的 `art/animations/live2d-rig-v5/`；克隆和打包不依赖这些制作文件。`resources/builtin/assets/portrait.png` 和四张 `frame-*.png` 已改为实际模型渲染图；当前睡眠素材见下文 1.2.4。

Live2D Cubism Core Web 6.0.1 来自官方固定版本地址 https://cubism.live2d.com/sdk-web/core/06/live2dcubismcore.min.js ，保留原始版权头。许可：https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html ；应用发布条件参考 https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html 。相关说明也随运行库放在 `src/renderer/public/live2d/THIRD_PARTY.md`。

本次完成正面轻动作绑定。大角度侧转、完整口型以及大幅肢体动作所需的遮挡区补画不在当前模型内。用户图片的原有权利归属不因拆件而改变。

## 1.1 精细组件（历史站立素材，保留兼容资源）

按用户要求，使用内置 imagegen 工具生成组件，未使用 API Key 或 CLI。工具未暴露可核实的底层模型版本，故不声称已指定某个型号。应用运行时仍完全离线。

- 原始组件图集：art/source/components-v2.png（1536×1024 RGBA）。含身体、双臂、后发、鲸尾；第一版头部边缘不足，已用第二张图集替换。
- 修订头部图集：art/source/heads-v2.png（1774×887 RGBA）。含完整双侧鳍耳、睁眼及闭眼。
- 完整生成提示词：art/source/prompt-v2.txt、art/source/prompt-heads-v2.txt。
- 参考来源：用户压缩包中的 reference/character-reference.png 和上一版 imagegen 生成的精细设定图。截图背景、界面、水印不进入桌宠。
- 可复现加工：scripts/art-assets.ts，只进行图集矩形裁切、透明裁边、尺寸配准、合成和序列帧色调变化；角色绘制来自生成模型。运行 npm run assets。

所有实际角色图层均位于 resources/builtin/assets，使用 680×840 RGBA 画布，以 340×420 逻辑坐标显示。headClosed 只替换模型生成的闭眼区域，保持睁眼头部的耳朵、轮廓和双侧蝴蝶结一致。后发、头、身体、双臂、鲸尾可独立变换；鳍耳跟随头部。eyes/mouth/hairFront 保留兼容节点及透明占位，现有自定义动作不会因节点消失而失效，但它们不再代表独立绘制的原始面部层。

portrait.png 用实际运行组件合成；frame-0.png 至 frame-3.png 为同一组件的 340×420 PNG 序列，表现闭眼和水光亮度变化。不会切回旧版矢量角色。预览：art/previews/assembled-v2.png。

resources/icon.png 与 icon.ico 延续项目内原始鲸鱼图标。scripts/assets.ts 是历史 1.0 原创矢量设计与动作生成代码，不再由 npm run assets 调用，请勿用其覆盖当前素材。

这些素材随便携包本地分发。未声明 DeepSeek 官方授权或用户参考图的再分发许可证。1.1 版本使用 Pixi 图层，1.2.0 站立模型已改为上述 Live2D 绑定。
# 盖被子睡眠素材（1.1.2）

下文的 `art/animations/`、提示词及 `scripts/sleep-*.cjs`、`scripts/integrate-sleep.cjs` 是本机制作用记录，按要求加入 Git 忽略规则，不随仓库发布。应用所需的身体序列帧及独立尾巴 PNG 全部位于 `resources/builtin/assets/sleep/`，克隆后无需生成素材即可构建运行。

1.1.2 的旧睡眠素材来自 `art/animations/sleep-v4`，96 帧表现被子起伏，已在 1.2.4 被下述新版替换。旧制作过程仍在忽略目录保留；入睡和醒来按用户要求直接切换，无过渡动画。

## 1.2.4 盖被侧卧与张嘴摆尾（1.2.5 延用）

采用用户确认的 `art/animations/sleep-html-v5/covered.png`：内置生图工具依据用户三视图先绘完整侧卧人物，再添加被子。嘴巴与鲸尾从同一张原画分离，在 `sleep-svg-v1` 中确认遮挡与运动，嘴巴最小面积保持最大时的三分之一。尾根延伸藏在被子后面；头、身体、枕头和被子固定。

应用使用 `resources/builtin/assets/sleep/001.png` 至 `024.png`（880×500、每帧 150ms），以及独立 `tail.png`。尾巴由运行时连续旋转 ±6.5°，周期 3600ms；Z 由原有 Pixi 特效从新头部位置向右上飘散。四个循环共 14.4 秒，结束或取消后恢复站立。

原画提示词、SVG 和导出脚本 `scripts/sleep-svg-integrate.cjs` 继续按用户要求忽略；应用构建直接使用已纳入版本管理的 PNG/JSON，不依赖制作目录，也不加载 SVG 脚本或连接生图服务。

### 1.2.5 睡姿肤色校准

以站立 Live2D 原头部的脸颊基色 `#fdf4ef` 为参考，在制作 SVG 中仅对面部的暖色亮部校色，保留眼睫、口腔、口水以及原有腮红和明暗。同步校准嘴巴缩小时露出的皮肤底色，并重新导出全部 24 帧；站立模型、头发、被子和鲸尾配色保持原样。未重新生成角色。运行包仍只使用透明 PNG，无新增运行时滤镜或依赖。

1.2.6 沿用这组 PNG，以站立时的头部大小校准显示比例，从 0.44 提至 0.64；没有重绘或重采样素材。嘴型、尾巴与 24 帧时序保持原有内容。

## 1.2.1 拆件修正

沿原图下巴轮廓重新分割，新增身体绑定的 Neck 网格（共 27 个网格）；清除后发层的头饰、呆毛及鲸尾边缘残片，重建尾鳍下方被遮挡的后发，并为抬头补齐隐蔽的颈部。没有重新生成角色。原始拆件与可编辑 CMO3/PSD 位于本机忽略目录 `art/animations/live2d-rig-v5/`，运行所需 MOC3 与图集已同步至 `src/renderer/public/live2d/`。后发根部按渐变权重跟随头部位移，发梢维持身体锚点。

## 1.2.2 侧视步行

采用同一张用户三视图的侧面，原图裁切范围 `(790,130)-(1430,1070)`；剔除背景、标注和相邻角色。上半身保留原画轮廓，腿、手臂、鲸尾单独裁切，局部补齐被遮挡的大腿和袖子底层；远侧腿复用原侧腿并略压暗，右行镜像左行。按各自关节运动导出每方向 32 张透明 PNG，位于 `resources/builtin/assets/walk/`，两份 motion 通过现有 `frame_animation` 播放。侧面为拆件导出的栅格步行周期，不是新增侧面 Cubism 模型；站立仍使用 1.2.1 修正后的正面 Live2D。制作脚本和 GIF 保留在忽略目录 `art/animations/side-walk-v1/`。没有生成替代角色。

### 1.2.3 腿根接缝修正

侧视腿层向上延伸到原裁切画布 y=699，延伸部分藏在裙摆后；去除腿图层中误带入的旧裙摆边线、白边和原有裁切阴影，并按原腿肤色重建连续大腿及两侧描线。重新导出左右共 64 帧，步幅、脚底锚点、动作时长不变。制作记录位于 `art/animations/side-walk-v2/`（忽略目录）。
