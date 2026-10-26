# 软件插件开发模板

这是可导入、可连接的空协议骨架，没有具体软件操作能力。需要本机 Node.js；将此目录直接导入小屋中的“可操作软件”，添加软件目录，选择此插件和 `node.exe`，连接后会显示“插件尚未提供可调用能力”。不需要安装依赖，也不会自动安装运行时。

实现插件时请更换清单的 ID、名称、版本和说明，并在 `server.mjs` 实现标准 MCP `tools/list` 与 `tools/call`，或改用官方 MCP SDK。推荐优先使用软件官方 API、CLI、扩展接口或 Windows UI Automation。主程序不规定具体软件，也不内置点击、输入、文件操作等业务工具。

主进程会传入 `DAFEIYU_SOFTWARE_DIRECTORY`、`DAFEIYU_SOFTWARE_ID`、`DAFEIYU_PLUGIN_DIRECTORY` 和 `DAFEIYU_PLUGIN_DATA_DIRECTORY`；工具调用的 `_meta['dafeiyu/target']` 也包含绑定目标。工作目录是每个软件实例独立的数据目录，缓存和日志写到这里；插件源码目录保持只读，避免影响内容指纹。由插件验证路径和目标、执行操作并返回可核对的结果。插件不可把目标目录当作已经建立的系统沙箱。

完整协议、权限、HTTP 接入及分发方式见仓库的 `docs/SOFTWARE_PLUGINS.md`。
