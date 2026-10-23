# 工具与运行库来源

- 制作与模型导出：Umamo 0.3.0-dev，调用本机已安装应用的 JVM 库。源码与许可：https://github.com/umamoorg/umamo/tree/v0.3.0-dev
- 预览运行库：Live2D Cubism Core Web 6.0.1，官方文件 https://cubism.live2d.com/sdk-web/core/06/live2dcubismcore.min.js 。其版权与许可保留在文件头部。
- Cubism Core 许可：https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html
- 模型使用范围及公开发布时应参考：https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html
- 原始人物和组件图片由用户提供；本次不改变这些图片原有的权利归属。

制作脚本在本机使用 Pillow、NumPy、OpenCV、JPype、Sharp、ag-psd 与 Playwright；不把这些工具安装包包含在模型文件中。
