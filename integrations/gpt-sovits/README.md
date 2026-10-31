# GPT-SoVITS 本地中日声音与情绪

## Radeon 780M 核显环境（2026-10-31）

本机已安装 AMD 官方 ROCm 10.1.0、PyTorch 2.14.0+rocm10.1.0 与 gfx1103 设备包，位于服务目录的 `.venv-rocm`。实际识别到 Radeon 780M，float32/float16 矩阵和卷积检查通过，三月七已合成中日音频，本机 Whisper 转写与测试句一致。原 `.venv` CPU 环境保留，系统显卡驱动未改动。安装来源和架构说明见 [AMD 发布说明](https://github.com/ROCm/TheRock/blob/main/RELEASES.md)及[Windows 支持表](https://github.com/ROCm/TheRock/blob/main/SUPPORTED_GPUS.md)。

宿主仅在 `gpu-runtime.json` 包含 `schemaVersion: 1, backend: "rocm", validated: true` 时选择独立 GPU Python；该标记是在实际设备运算与语音合成通过后写入，不能仅凭下载完成生成。选择“CPU”始终运行原环境；选择“GPU”运行已验证环境。“自动”尊重标记的可选 `autoDevice: "cpu" | "cuda"` 实测推荐，没有推荐时优先已验证 GPU。本机实测 CPU 更快，因此已写入 `autoDevice: "cpu"`，安装 GPU 不会使原日常模式变慢。已有外部服务仍需自行重启；明确选择 GPU 时，CPU 健康响应会报错，避免误报启用。

当前性能结论：相同四句、全部整句缓存未命中，CPU 双路各 8 线程为 **13.92 秒**，GPU 单路为 **27.17 秒**，GPU 双路为 **115.07 秒**。双 GPU 进程确实同时计算，峰值活跃数 2，但共享核显与系统内存时明显退化；不能据此承诺核显加速。测试时其他桌面程序仍在运行，并非独占机器的硬件极限测试。GPU 模式可在小屋“合成设备 → GPU（CUDA / ROCm）”选择并保存；本机日常建议保持自动。数据：[CPU 对照](docs/rocm-control-cpu-pool-2026-10-31.json)、[GPU 单路](docs/rocm-single-2026-10-31.json)、[GPU 双路](docs/rocm-pool-2026-10-31.json)、[真实 Electron 播放](docs/rocm-gui-2026-10-31.json)。

这里采用 CPU 与 GPU 分工：中文 BERT 用 CPU oneDNN 的预打包线性层，语义解码和音频生成用 GPU。ROCm 包内普通 CPU BLAS、本机核显上的中文 BERT 都曾明显较慢，因此不能把所有步骤搬上核显就称为加速。BERT 只输出 TTS 实际使用的隐藏层，省去没有使用的词表 logits，原编码器权重保持。`runtime.json` 的 `rocm_cpu_bert: false` 可用于诊断全 GPU 路径，默认开启 CPU oneDNN 前端。健康接口分别提供 `device: "cuda"`、`backend: "rocm"`、`deviceName` 与 `frontendDevice`。

修复 CPUFast 未注册的注意力缓存不随 `.to()`/`.half()` 迁移的问题，模型转换后从原权重重建缓存。ROCm 使用 [MIOpen FAST 选优](https://rocm.docs.amd.com/projects/MIOpen/en/latest/how-to/find-and-immediate.html)，缓存位于服务目录的 `cache/miopen/`。ROCm 多进程依次加载和预热，降低初始化内存峰值；宿主启动等待预算相应按进程数增加，完成后仍并发合成。首次启动/新算子准备仍有额外耗时，不等于每次聊天的稳定延迟。

维护脚本：`download_rocm.py` 从固定 AMD 官方 URL 分块下载大包并检查 ZIP CRC / SHA-256；随后用 uv/pip 的 `torch[device-gfx1103]` 安装剩余元包和架构依赖。`probe_gpu.py` 实际测试设备运算，`benchmark_service.py` 对真实端点保存公开测试句、音频、耗时与缓存命中情况。完整依赖版本见 [ROCm 环境](docs/rocm-environment-2026-10-31.txt)，[下载记录](docs/rocm-downloads-2026-10-30.json)记录六个大文件；余下的 gfx1103 PyTorch 包由官方索引安装。

同一回复的普通续句会延续前一句参考音，避免从 happy 突然切到 neutral 带来换声感。首句尊重模型情绪（漏标用手动默认），后续 neutral/漏标沿用最近情绪；明确的新情绪仍可切换。这个连贯策略只影响播放计划，不修改保存的模型标签，每条新回复重新选择。关闭自动情绪则固定使用手动参考。参考音本身存在差异，因此明确切换情绪时仍可能听到音色变化。

大肥鱼通过本机桥接服务使用用户安装的 GPT-SoVITS v2ProPlus 模型。本目录维护桥接代码、依赖和说明；不打包模型、参考音频或 Python 环境，不改变主程序 1.5.0 的版本。

## 在小屋使用

打开“智能陪伴 → 对话设置”，声音分配选择“分别指定中文和日文（支持同一音色）”，中文朗读方式选择“GPT-SoVITS 本地声音”。选择**语音服务目录**，开启按需启动，选择参考音色情绪并保存。点“检查本地声音”，再用“试听声音”或“试听中日切换”检查效果。这个目录应包含 `.venv/Scripts/python.exe`、`bridge.py`、`worker_pool.py` 和 `runtime.json`，并非只放 `.ckpt` / `.pth` 的音色包目录。升级时将本目录的 **bridge.py 和 worker_pool.py 一起复制**到已绑定目录，再重启语音服务。

勾选“日文也使用这个 GPT-SoVITS 音色”后，中文和日文都使用三月七，分别按 zh / ja 合成。未勾选时，日文仍可使用 VOICEVOX:雨晴はう。模型在回复中标注语言和情绪，显示正文时隐藏标注。旧版中日分声配置升级后默认保留微软中文；用户选择新引擎并保存后切换。单一声音模式也可选本地 GPT-SoVITS。

本次本机安装目录是 `D:\go-project\vibecodingatempt\tts\gpt-sovits`，音色文件保留在原 `v2ProPlus-zh\三月七` 目录。七种参考情绪分别对应音色包的七个 WAV。开启“根据每句话自动选择情绪”，聊天模型同次输出每句的 neutral / happy / sad / angry / surprised / afraid / disgusted，播放计划应用上述连贯策略后由桥接选取参考音频，不额外调用分类模型。首句漏标用手动默认情绪，未知标签降为 neutral；旧语言标签继续兼容。试听始终使用手动选定的参考情绪。实际情绪强弱和跨语言口音以试听为准，这不是重新训练七个声音。

## 运行目录与来源

```text
gpt-sovits/
  .venv/                         Python 3.12 环境
  .venv-rocm/                    已验证的 GPU 环境，保留 CPU 环境
  gpu-runtime.json               GPU 实测就绪标记，由宿主选择固定 GPU Python
  bridge.py                      本目录的桥接入口
  worker_pool.py                 并发进程池，随 bridge.py 一起更新
  runtime.json                   本地模型与参考音频配置
  engine/GPT_SoVITS/              共享基础模型、中文前端模型
  engine/runtime/nltk_data/       前端词典
  engine-cpufast/                 固定版本的 CPU 推理代码
```

- CPU 推理代码：[GPT-SoVITS-CPUFast](https://github.com/baicai-1145/GPT-SoVITS-CPUFast)，固定提交 `03706cce25085a3f2522679193dd437896e0be21`。该分支减少 T2S 重复内存操作、缓存参考特征，并优化中文 BERT 批处理；效果需以本机测试为准。
- 上游：[GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)，本地对照代码固定提交 `b4570b876f5c086819ba84e3215472733c6a7b70`。
- BERT、CN-HuBERT、说话人编码器来自 [lj1995/GPT-SoVITS](https://huggingface.co/lj1995/GPT-SoVITS)，固定模型版本 `8f8857563c040d542de108a2c18b0425abd6c9c5`。
- CPUFast 中文多音字模型来自 [baicai1145/g2pw](https://huggingface.co/baicai1145/g2pw)，固定版本 `57112a7c10b49c26a171800cf4af04d32a41d5de`；小词典源自 [GitYCC/g2pW](https://github.com/GitYCC/g2pW)。下载完成后核对来源提供的哈希。

CPU 环境安装 `torch==2.9.1+cpu`、`torchaudio==2.9.1+cpu`，其余见 `requirements.txt`。没有 C++ 编译工具时，桥接使用纯 Python jieba 的兼容接口；不要求为分词安装编译器。`requirements-upstream.txt` 仅供运行上游对照代码，正常 CPUFast 服务无需安装它。

`runtime.json` 使用 `"engine": "cpu-fast"`，`gpt_weights` / `sovits_weights` 指向用户模型，`voices` 是音色 ID 到 `{name, audio, text}` 的映射。`audio` 是参考 WAV 的绝对路径，`text` 必须是它说出的原文。模型和参考文件均由本地配置指定，HTTP 请求不能换成其他文件。

手动诊断可在服务目录执行：

```powershell
.\.venv\Scripts\python.exe -I -X utf8 -u bridge.py --host 127.0.0.1 --port 9881 --threads 16 --workers 2 --device auto
```

自动启动会额外使用 `--parent-stdin`，桌宠关闭管道后，实际 Python 推理进程也退出。Windows 使用非阻塞 PeekNamedPipe 检测父进程管道，避免阻塞 stdin 与 NumPy/OpenBLAS 初始化争用 CRT 锁。手动启动的服务直接复用，桌宠不会关闭它。修改线程数后保存设置，仅对下次由桌宠启动的服务生效。

## 并发与速度

单个中日模型内部使用 PyTorch CPU 线程；T2S 开启并行推理，VITS 保持串行，避免额外副本和重复工作。模型常驻，参考特征复用，桥接在内存缓存最近八句完整音频。切换情绪会重新准备参考特征。

播放器在模型流式输出期间立即提交闭合片段，默认同时合成两句，播放严格遵循原文顺序。`--workers` 支持 1–4；每路持有独立模型和参考缓存，可以安全并发处理不同情绪。`--threads` 是总 CPU 预算，例如 16 线程配两路，每路分配 8 线程。每路约需 4 GB 内存（本机样本），增加并发也会增加内存占用，不保证首句更快。预取音频窗口为并发数的两倍，文字流不受此窗口阻塞。停止取消同批次请求和待播队列；已开始的服务端计算可能运行到该句结束，迟到结果不会播放。

`--device auto` 在当前 Python 环境支持 GPU 时选择 CUDA/兼容 ROCm，否则使用 CPU；`cpu` 强制 CPU，`cuda` 在不可用时明确报错。PyTorch 的 ROCm 后端沿用 `torch.cuda` API。手动运行 GPU 服务时使用 `.venv-rocm/Scripts/python.exe`；宿主按上方就绪标记自动选择。DirectML 版 VOICEVOX 是独立引擎。

10 月 30 日首次下载曾超时，10 月 31 日已通过 AMD 官方源直连及分块续传完成安装与实际验证。应用不会自动下载安装系统驱动。

10 月 31 日进一步诊断：ROCm 环境的中文多音字前端改用 oneDNN 后，同进程四句从 31.85 秒降到 23.29–23.42 秒，测试音频逐字节相同。健康检查的 `phonemeBackend` 表明是否启用。两份模型共用一块核显，隔离并发约 25.31 秒，没有超过优化后的单路；真实双路服务还出现预热超时。本机当前推荐 **CPU 两路**；手动试用 GPU 时建议 **一路、8 个 CPU 线程**。原 115.07 秒样本保留，但不能当作稳定的 GPU 性能。详细测量、排除项和限制见 [GPU 性能诊断](docs/gpu-diagnosis-2026-10-31.md)。

线程更多不保证更快。手动运行 `python -I -X utf8 -u bridge.py --benchmark` 会加载一份模型，对 1、2、4、8、16 线程做两轮测试，线程顺序反转，固定两段语料，绕过桥接整句缓存。只把测试语料音频和结果写到服务目录的 `benchmarks/`；正常聊天不写音频文件。首轮准备时间与稳定合成时间分开记录。结果中的 coldSeconds 是模型载入后的首句合成耗时，不是整个进程冷启动时间。

## 本机接口

- `GET /health`：模型、中日前端准备完成后返回服务身份、协议版本、设备、线程数和可用音色。
- `POST /v1/audio/speech`：`model: "gpt-sovits-v2proplus"`、`input`、`language: "zh" | "ja"`、`voice`（参考情绪 ID）、`speed`、`response_format: "wav"`；返回单声道 PCM WAV。
- 只绑定回环地址，不需要模型 API Key，不转发用户保存的其他语音密钥。响应头 `X-Synthesis-Ms` 和 `X-Audio-Cache` 区分计算耗时与整句缓存命中。
- 多进程入口将请求分配给空闲进程，最多 32 个排队/在途请求，超出返回 429；单进程仍保护自己的可变模型。健康检查提供 `workers`、`threadsPerWorker`、`active`、`peakActive`，响应头 `X-Worker` 标识实际执行进程。
- 不提供远程加载模型、训练、任意命令、任意文件读取或全局退出接口。

应用侧测试：`npm test`；GUI 协议测试：`node scripts/gpt-sovits-gui-test.cjs`。设置 `PET_GPT_SOVITS_DIRECTORY` 可运行真实三月七中日模型测试，并检查双进程健康状态与并发峰值；默认协议测试才使用音频夹具。设置 `PET_VOICEVOX_DIRECTORY` 可另外测试双引擎组合。`node scripts/streaming-speech-gui-test.cjs` 用可控 SSE 和音频夹具检查真实 Electron 的首句同步、独立文字流、并发乱序、失败与取消；旧 `speech-sync-gui-test.cjs` 已转为此脚本的兼容入口。`PET_TEST_EXECUTABLE` 可指定打包后的程序重复验证。

真实 GPU 单路验收可设置 `PET_GPT_DEVICE=cuda`、`PET_GPT_WORKERS=1`、`PET_GPT_THREADS=8`；未设置时仍测试两路 / 共 16 线程。`PET_GPT_BENCHMARK=1` 在真实播放后追加同四句 HTTP 实测，检查音频缓存是否命中。

## 文字与声音同步

模型每闭合一个语言标签就提交合成，半标签暂存。第一句 Audio playing 或系统声音 start 事件触发时同时展示第一句文字，下一显示帧放出其余缓冲文字，后续文字增量直接显示，音频独立按序播放。主进程从原文计算首句边界，不接受播放器传入任意正文。图片和代码不朗读但保留显示，完整答案照常保存。停止、失败或超时会打开文字闸门；模型未结束时后文继续流入。工具换轮递增修订号，停止旧轮未播放音频，已播放的工具前言不能撤回。格式修复若改变已经提交的前缀，会停止语音并保留正文，避免整段重复读。

2026-10-30 同机并发实测：四句全部未命中整句缓存，单路 16 线程串行共 **17.55 秒**，两路各 8 线程共 **10.99 秒**，总合成时间减少约 **37%**。两路均实际执行，峰值活跃数 2；其中首句由 4.10 秒变为 4.78 秒，说明吞吐量改善不代表首句一定更快。数据见 [并发实测](docs/pool-benchmark-2026-10-30.json)。流式提交让模型生成和首句合成重叠，但模型生成很快时，全文可能仍早于首音频完成。

## 本机实测（2026-10-30）

硬件：Ryzen 7 H255，8 核 / 16 线程，32 GB RAM。CPUFast + float32，未使用推理量化。两轮反向线程顺序、相同语料和固定 seed、绕过整句缓存；16 线程在本次样本中最快。详细记录见 [CPU 测试数据](docs/cpu-benchmark-2026-10-30.json)。

| 测试内容 | 合成耗时 | 说明 |
| --- | --- | --- |
| 今天也一起开心地学习日语吧。 | 2.24–2.51 秒 | 两轮热模型，同一 happy 参考 |
| 先试着回忆昨天学过的单词，然后再看看答案。 | 3.95–4.27 秒 | 两轮热模型，同一 happy 参考 |
| こんにちは。一緒に日本語を勉強しましょう。 | 5.46 秒 | 此次进程首句，happy |
| 私は学生です。 | 2.94 秒 | 切换 neutral 参考 |
| 先生 | 1.31 秒 | neutral，显式日文 |

日语三例经过本机 whisper.cpp 日文转写，文本与原文一致（不计标点）；这说明样本可识别，不等于验证了母语口音。中文 happy / sad 实际合成也完成。对应记录见 [中日与情绪样本](docs/japanese-emotion-2026-10-30.json)。模型加载、首次词典准备、参考情绪切换和系统负载会影响等待，以上不是任意句子的延迟保证。

## 首次响应延迟

自动朗读和自动启动同时开启时，大肥鱼启动即在后台加载本地模型，并静默合成一句“你好。”初始化默认参考音与算子。不会播放、写入聊天或调用云端。预热与聊天模型请求可重叠，首句共享预热任务；关闭程序、换配置会取消。未启用自动朗读或自动启动时不主动加载。

新对话或连续问候里的独立招呼（如“上午好”）由聊天模型直接生成短回复，跳过工具发现和多轮选图，宿主继续附已缓存表情；“上午好，打开 Anki”仍保留工具能力；学习上下文中的“你好”也可能是答案，不走快捷路径。用户等待时间包含正文生成、图片准备、模型加载及音频合成，热模型单句合成基准不能代表端到端延迟。
