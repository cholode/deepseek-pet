# 可操作软件与插件框架 · 1.5.0

## 学习工作室记录接口（2026-10-29）

清单可选 `learningRecordTool` 声明课程记录工具名。该工具正常参与连接、签名检查和逐项授权；只有授权后才出现在课程的记录目标中。它由学习宿主调用，不向聊天模型开放参数构造。主程序不识别任何具体软件的工具名。

请求包含 `sessionId`（稳定课堂编号）、`topic`、`summary`、`corrections`、`minutes`（真实答题时间估算，允许 0）、`turns`（实际 `{user, assistant}` 答题/反馈数组，最多 20 条）和 `vocabulary`（最多 30 条 `{expression, reading, meaning, example}`）。原始作答完整保存在学习工作区，外部同步按接口字段长度截取。插件须按 `sessionId` 幂等处理，固定首次写入内容，不能在重试时重复建记录。

响应使用 MCP 文本块承载 JSON，成功必须显式返回 `{ "recorded": true, ... }`。宿主只在这个确认后标记同步完成；错误、缺少确认、取消或响应丢失都保留待核查状态。不要仅返回“已发起”而当作完成。

框架提供独立插件宿主和调用链，支持可选择安装、独立维护版本的软件插件。“支持所有软件”是通过插件逐个扩展的目标；是否能操作、能做什么，由对应插件与目标软件提供的接口决定。选择安装目录本身不会产生控制能力。

主程序当前版本为 1.5.0，以根 `package.json` 为准；插件版本以对应目录 `software-plugin.json` 的 `version` 为准，插件握手和发布包应读取该值。新增或更新插件不增加主程序版本。`schemaVersion` 是清单协议格式版本，与这两者分开。具体插件的说明、更新记录和兼容要求放在各自插件目录，不写入主 README。

## 用户流程

1. 在“桌宠小屋 → 可操作软件”点击 **导入软件插件**，选择已下载并解压、包含 `software-plugin.json` 的插件文件夹。框架当前不提供在线商店、自动下载或 ZIP 解压。
2. 点击 **添加软件**，填写名称，定位软件目录并选择对应插件。Node.js 可留空使用内置运行时，或明确选择外部 node.exe；Python 需选择运行时。服务插件填写 MCP Streamable HTTP 地址，可配置 Bearer Token。
3. 保存后点击 **连接并读取能力**。本地插件在此时才启动，导入与保存都不执行插件。首次发现不自动授权。
4. 查看插件提供的说明，逐项勾选工具并 **保存工具授权**。在智能陪伴中配置支持工具调用的模型后，即可从桌面聊天提出任务。
5. 单独“停用”或“停止并停用全部软件”会中止后续调用并断开插件。停止不能撤销插件已经执行的外部操作。重新连接后可以继续使用已有且未变化的授权。

插件可以绑定多个软件实例，实例间的目录、凭证和授权独立。移除关联不删除实际软件；移除插件会停用关联实例、清空工具及授权。升级插件时先移除旧版，再导入新版、重新绑定和授权，不静默替换可执行包。

重启恢复配置与授权，按需连接并核对工具定义；已开启计划提醒的实例在后台检查时也可重连。没有配置插件时保持离线默认。原“智能陪伴 → MCP 工具”单端点配置继续兼容，与软件插件独立。

## 模块与扩展点

```text
小屋软件管理 → 受限 IPC → SoftwareService → SoftwarePlugins（清单、导入、指纹）
                                   ↓
桌面聊天 → CompanionCoordinator → ToolPort → SoftwareConnection
                                                   ↓
                              MCP stdio / Streamable HTTP
                                                   ↓
                         软件插件 → 软件 API / CLI / 扩展 / UIA 等
```

- `src/shared/software.ts`：版本化清单、配置、工具授权与 IPC 契约。
- `src/main/software/plugins.ts`：独立插件仓库，文件导入、路径与规模校验、内容指纹。
- `src/main/software/connection.ts`：MCP 客户端、运行时启动、目标注入、工具目录与调用。
- `src/main/software/service.ts`：软件实例、连接生命周期、加密凭证、授权、停止、活动记录。
- `src/renderer/panel/SoftwarePanel.tsx`：软件列表、插件库、配置和工具授权。
- `examples/software-plugin-template/`：可连接的零能力插件骨架，不控制具体软件。
- `schemas/software-plugin.schema.json`：由运行时 schema 生成的编辑器补全规范。

增加新软件时新增独立插件即可，无须修改主程序中的软件枚举、路由或动作执行器。框架使用插件提供的 JSON Schema 作为模型工具参数规范；工具语义和参数校验由插件实现。

## 插件清单

每个文件夹包含一个 `software-plugin.json`。本地进程示例：

```json
{
  "schemaVersion": 1,
  "id": "vendor.application",
  "name": "某软件的操作插件",
  "version": "1.0.0",
  "description": "解释支持的软件版本、能力和运行前提",
  "author": "插件作者",
  "transport": {
    "type": "stdio",
    "runtime": "executable",
    "entry": "bin/server.exe",
    "args": ["--software-dir", "${softwareDirectory}"]
  }
}
```

`id` 采用小写字母、数字、点和连字符，长度 3–80，首字符为字母，结尾为字母或数字，不能使用 Windows 保留设备名。清单拒绝未知字段。`runtime` 支持 `executable`（包内 `.exe`）、`node`（`.js/.cjs/.mjs`）及 `python`（`.py`）。Node 路径留空时用 `process.execPath` 和 `ELECTRON_RUN_AS_NODE=1` 启动独立进程，也可选择外部运行时；Python 必须指定。宿主不从 PATH 猜测、不安装依赖，作者需打包依赖或使用零依赖入口。

`entry` 必须为插件内的相对路径，不能包含父目录逃逸、绝对路径、冒号或反斜杠。`args` 最多 30 项，每项 2000 字符，仅展开 `${softwareDirectory}` 与 `${pluginDirectory}`，未知占位符拒绝执行。直接传递参数数组，`shell: false`，Windows 后台隐藏控制台窗口；不会把参数拼成 shell 命令。

HTTP 服务只需将 `transport` 换成：

```json
{ "type": "streamable-http", "defaultUrl": "http://127.0.0.1:8787/mcp" }
```

`defaultUrl` 只是填写建议，用户可按实例修改。支持本机 HTTP 和远程 HTTPS；不接受 URL 中的账号、查询参数、片段，不跟随重定向。Bearer Token 使用 Electron 系统加密保存，不返回界面或传给模型；更改绑定身份会清空旧令牌。当前不支持 OAuth、SSE 旧传输或客户端证书。

## 目标与工具协议

插件采用标准 MCP 初始化、`tools/list`、`tools/call`、取消通知及关闭流程。工具名称需满足 `[a-zA-Z0-9_-]{1,64}`；每实例最多 100 项能力、最多 5 页，工具定义每项最大 64,000 字符。模型总共最多使用 100 项已授权工具。

本地进程可读取：

| 变量 | 内容 |
| --- | --- |
| `DAFEIYU_SOFTWARE_DIRECTORY` | 主进程校验后的软件目录 |
| `DAFEIYU_SOFTWARE_ID` | 此绑定的 UUID |
| `DAFEIYU_PLUGIN_DIRECTORY` | 已导入的插件目录 |
| `DAFEIYU_PLUGIN_DATA_DIRECTORY` | 该软件实例独立的可写数据目录，也是子进程工作目录 |

插件源码目录参与内容指纹验证，应当只读。缓存、日志和配置写到实例数据目录，静态资源相对于 `DAFEIYU_PLUGIN_DIRECTORY` 或入口文件定位；Python 运行时设定 `PYTHONDONTWRITEBYTECODE=1`，防止在源码目录生成字节码。实例数据在移除关联后保留，避免隐式删除插件产生的用户内容。

每次调用都带有主进程写入的元数据（本地和 HTTP 一致）：

```json
{
  "name": "插件原始工具名",
  "arguments": { "参数": "模型生成、插件校验" },
  "_meta": {
    "dafeiyu/target": {
      "softwareId": "绑定 UUID",
      "softwareDirectory": "用户选择的软件目录",
      "pluginId": "vendor.application"
    }
  }
}
```

同一软件的工具向模型暴露为 `sw_<实例UUID去连字符>_<工具名哈希>`，不同软件即使都提供 `open` 也不会混用。描述包含软件名称、插件与能力说明。模型不能指定命令、运行时、连接地址或替换上述元数据。HTTP 服务需从调用元数据取目标；面向其他 MCP 客户端开发的服务如果不识别这个目标字段，需要相应适配，不能假设填目录就能约束其行为。

权限绑定软件目录、插件整体 SHA-256 指纹、运行时、服务地址、凭证与工具定义签名。工具名称、完整说明或参数 schema 变化后旧授权失效；`tools/list_changed` 通知会停用该连接并清空授权。重新握手也会比较工具签名。导入后插件文件被更改时拒绝连接或调用，需重新导入。

## 运行边界

- 工具调用不设固定次数或决策轮数，直到模型完成、用户停止或发生请求错误；保留逐项授权和单次调用超时。仅桌面会话可访问软件工具，QQ、主动搭话、日记不调用。
- 连接总时限 20 秒，单次工具调用 30 秒。停止、取消、异常会关闭会话；不自动重试可能已执行的操作。插件需要处理取消并清理自己创建的子进程。
- 只保存最近 50 次调用的会话内状态，不保存参数和返回正文；界面区分执行中、已完成、失败、取消。插件报告 `isError` 不会标为成功。成功仅代表插件报告完成，实际业务结果应由插件提供证据，框架不凭空验证。
- `software.json` 与 `software-plugins/` 位于 userData。配置最大 8 MiB、最多 30 个软件；损坏配置先备份。插件最大 200 MiB、3000 个文件及目录、深度 12，拒绝符号链接与目录联接。导入到临时目录复验后提交；不会执行安装脚本。
- 软件插件是用户信任的本地程序或服务，拥有自身运行身份的权限。软件目录是目标定位信息，**不是操作系统沙箱**。目录内文件、窗口范围、软件 API 权限、危险操作确认、幂等与结果核验必须由具体插件实现。不要将此框架描述为已经能安全控制所有软件。
- 动作包依然只接受原有 JSON/PNG/WebP 格式；不能借动作包装载脚本。插件执行与人物动画分离，普通离线陪伴不受影响。

## 验证

`tests/software.test.ts` 使用官方 SDK 的本机 HTTP 服务和本地 stdio 测试进程，只回显参数和目标，验证框架协议、授权、取消、重启及模型调用链。`npm run test:software-gui` 使用隔离 userData 和本机协议夹具检查真实 Electron 页面、导入、连接和授权。它们都不是具体软件操作验收，也不使用真实模型账号或用户凭证。

## 声明式插件设置与提醒

清单可声明 `configuration: { title, readTool, writeTool, fields }`。字段支持 text、number（min/max）、time、weekdays（0=周日）、select（options）。读工具参数 `{}`，写工具参数 `{settings: {...}}`，两者返回 MCP text 内的 JSON `{settings, summary?, decks?}`。宿主仅解析数据，不执行插件 HTML 或前端脚本；设置调用同样要求当前工具签名的授权。

清单还可声明 `reminderTool`。用户需授权该工具并额外开启实例的计划提醒。每分钟在可提醒时调用 `{}`，返回 MCP text 内 JSON `null` 或 `{key: string, text: string}`，key 最多200字符，text 最多500字符。宿主按实例持久化最后一个 key 防止重启重复，每个计划应返回稳定且有时间窗口的 key；多提醒并行或轮换旧 key 不在本协议保障范围。Anki 插件使用本地日期加计划时间。

设置和提醒调用复用包指纹、目标、实例身份与工具签名检查。停用、停止、撤权、清单/能力变化后不再调用。未开启提醒时不会后台运行插件；提醒不调用模型，也不会扩大 QQ、主动对话或日记的操作权限。允许调用的读工具是否真的只读仍是插件作者的职责。
