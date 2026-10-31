"""大肥鱼本机 GPT-SoVITS 桥接：固定模型及参考音频，支持 CPU / CUDA / ROCm 推理。"""
import argparse
import io
import json
import gc
import os
import sys
import threading
import time
import wave
import statistics
import re
from collections import OrderedDict
from pathlib import Path
from typing import Literal


def chinese_segments(text, default_lang="zh"):
    # 此服务只接收宿主已标明语言的片段。沿用英文词的发音入口，
    # 中日汉字归属不再交给额外的语言识别模型猜测，也不触发其隐式联网下载。
    if default_lang not in {"zh", "ja"}:
        raise ValueError("桥接只接受显式中文或日文片段")
    parts = re.split(r"([A-Za-z]+(?:[ '’-]+[A-Za-z]+)*)", text)
    return [{"lang": "en" if index % 2 else default_lang, "text": part}
            for index, part in enumerate(parts) if part.strip()]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", choices=["127.0.0.1", "::1", "localhost"], default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9881)
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--parent-stdin", action="store_true")
    parser.add_argument("--benchmark", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not 1 <= args.threads <= 64 or not 1 <= args.workers <= 4:
        parser.error("Invalid port or CPU thread count")

    # 宿主关闭管道时退出真正的 Python 推理进程，兼容 Windows venv 启动器的子进程。
    # 手动启动不启用此模式；大肥鱼不会关闭其他人启动的服务。
    if args.parent_stdin:
        def owner_closed():
            if os.name == "nt":
                # Windows 下阻塞读取 stdin 可能与 NumPy/OpenBLAS 初始化争用 CRT 锁。
                # 管道只用于表示父进程存活，不传数据，用非阻塞 PeekNamedPipe 检测断开。
                import ctypes
                import msvcrt
                from ctypes import wintypes
                kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                peek = kernel.PeekNamedPipe
                peek.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                                 ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
                peek.restype = wintypes.BOOL
                handle = msvcrt.get_osfhandle(sys.stdin.fileno())
                while peek(handle, None, 0, None, None, None):
                    time.sleep(0.5)
            else:
                while sys.stdin.buffer.read(1):
                    pass
            os._exit(0)
        threading.Thread(target=owner_closed, daemon=True).start()

    root = Path(__file__).resolve().parent
    if args.workers > 1 and not args.benchmark:
        # -I 不自动加入脚本目录，明确导入同目录随桥接分发的进程池。
        sys.path.insert(0, str(root))
        from worker_pool import serve_pool
        serve_pool(args, root)
        return
    settings = json.loads((root / "runtime.json").read_text(encoding="utf-8-sig"))
    optimized = settings.get("engine") == "cpu-fast"
    engine = root / ("engine-cpufast" if optimized else "engine")
    assets = root / "engine"
    for variable in ["OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"]:
        os.environ[variable] = str(args.threads)
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["PYTHONUTF8"] = "1"
    os.environ["language"] = "zh_CN"
    os.environ["version"] = "v2ProPlus"
    os.environ["NLTK_DATA"] = str(assets / "runtime/nltk_data")
    os.environ["GPT_SOVITS_DATA_DIR"] = str(assets)
    if args.device != "cpu":
        # 对话句长持续变化；ROCm 的全量卷积选优会为新形状花很久，使用官方 FAST 即时方案。
        # 缓存放在绑定目录，多个推理进程和后续启动可以复用；不修改全局系统环境变量。
        os.environ.setdefault("MIOPEN_FIND_MODE", "FAST")
        for variable, name in [("MIOPEN_CUSTOM_CACHE_DIR", "kernels"), ("MIOPEN_USER_DB_PATH", "db")]:
            directory = root / "cache" / "miopen" / name
            directory.mkdir(parents=True, exist_ok=True)
            os.environ.setdefault(variable, str(directory))
    os.chdir(assets)
    sys.path.insert(0, str(engine))
    sys.path.insert(0, str(engine / "GPT_SoVITS"))

    if not optimized:
        from tools.portable_runtime import activate
        activate(change_cwd=True)
    import numpy as np
    import torch
    import torchaudio
    import soundfile as sf
    import uvicorn
    from fastapi import FastAPI, HTTPException, Request, Response
    from pydantic import BaseModel, ConfigDict, Field

    # 此桥接只读取已绑定的 PCM WAV。torchaudio 2.9 默认需要额外的 TorchCodec，
    # 改用 SoundFile 保留 float32/声道在前的语义，不引入第二套 FFmpeg DLL。
    def read_reference(path, *args, **kwargs):
        if args or kwargs:
            raise ValueError("参考音频读取只支持完整 WAV")
        samples, rate = sf.read(path, dtype="float32", always_2d=True)
        return torch.from_numpy(samples.T.copy()), rate
    torchaudio.load = read_reference
    # Windows 无 C++ 编译工具时使用同词典/接口的纯 Python jieba，避免首次安装要求编译器。
    import jieba
    import jieba.posseg
    sys.modules["jieba_fast"] = jieba
    sys.modules["jieba_fast.posseg"] = jieba.posseg
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    # ROCm 版 PyTorch 同样通过 torch.cuda 接口暴露 AMD GPU；CPU 包不能假装启用显卡。
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("当前 PyTorch 没有可用 CUDA/ROCm GPU，请安装匹配的运行环境或选择 CPU")
    device = "cuda" if args.device != "cpu" and torch.cuda.is_available() else "cpu"
    from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config
    from text.LangSegmenter import LangSegmenter
    LangSegmenter.getTexts = staticmethod(chinese_segments)
    cpu_bert = bool(optimized and device == "cuda" and torch.version.hip and settings.get("rocm_cpu_bert", True))
    if cpu_bert:
        # 780M 实测中文 BERT 的小批次在 ROCm 上明显慢于 CPU；让 CPU 负责文字前端，
        # 核显负责语义解码与音频生成。直接从原始权重加载 float32，避免先半精度再转回。
        from text.chinese_bert import load_model, load_tokenizer
        from torch.utils.mkldnn import to_mkldnn
        def init_cpu_bert(self, base_path):
            self.bert_tokenizer = load_tokenizer(base_path)
            # ROCm Windows 包的普通 CPU BLAS 较慢，使用同包内 oneDNN 的预打包线性层。
            # TTS 只取隐藏层，不计算从未使用的词表 logits；保留完整 BERT 编码器及原权重。
            self.bert_model = to_mkldnn(load_model(base_path).eval().bert)
        TTS.init_bert_weights = init_cpu_bert
    # 配置仅从用户绑定的安装目录读取；请求不能切模型、修改路径或执行控制命令。
    config = TTS_Config({"custom": {
        "device": device, "is_half": device == "cuda", "version": "v2ProPlus",
        "t2s_weights_path": settings["gpt_weights"],
        "vits_weights_path": settings["sovits_weights"],
        "bert_base_path": str(assets / "GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large"),
        "cnhuhbert_base_path": str(assets / "GPT_SoVITS/pretrained_models/chinese-hubert-base"),
    }})
    config.configs_path = str(root / "inference.generated.yaml")
    pipeline = TTS(config)
    if cpu_bert:
        # 前端产生的提示/正文特征都留在 CPU；上游 to_batch 在同一边界整体移到 GPU。
        pipeline.text_preprocessor.device = torch.device("cpu")
    if optimized and device == "cuda":
        # CPUFast 的脚本化注意力缓存不是 nn.Module 的 parameter/buffer，.to/.half 不会迁移它。
        # 待主模型完成设备/精度转换后，用原权重重新构建缓存，保持所有矩阵都在同一设备。
        state = torch.load(settings["gpt_weights"], map_location="cpu", weights_only=False)["weight"]
        pipeline.t2s_model.model.rebuild_t2s_transformer_from_state_dict(state, prefix="model.")
        del state
        gc.collect()
        # 核显与 CPU 共用内存；释放载入/转换时的临时显存，避免多进程启动峰值造成换页。
        torch.cuda.empty_cache()
    # 中文前端也属于模型就绪条件；缺多音字模型时不要返回“已就绪”后才在首句失败。
    from text import chinese2  # noqa: F401
    from text import japanese  # noqa: F401
    cpu_g2pw = bool(optimized and device == "cuda" and torch.version.hip and settings.get("rocm_cpu_g2pw", True))
    if cpu_g2pw:
        # 多音字 G2PW 是另一份 CPU 模型，不能只优化上面的文本 BERT。
        # 本机 ROCm 包使用 OpenBLAS，同一前端在原 CPU/MKL 包里明显更快。
        # 用 oneDNN 预打包线性层，保留原权重/读音选择；不关闭多音字模型或换词典。
        from torch.utils.mkldnn import to_mkldnn
        chinese2.g2pw.model = to_mkldnn(chinese2.g2pw.model)
    voices = settings["voices"]
    for voice in voices.values():
        if not Path(voice["audio"]).is_file() or not voice["text"].strip():
            raise ValueError("参考音频或原文缺失")

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    mutex = threading.Lock()
    cache = OrderedDict()
    model_id = "gpt-sovits-v2proplus"

    def synthesize(text, voice_id, speed=1.0, parallel=True, language="zh"):
        voice = voices[voice_id]
        with torch.inference_mode():
            chunks = list(pipeline.run({
                "text": text, "text_lang": "all_ja" if language == "ja" else "all_zh",
                "ref_audio_path": voice["audio"], "prompt_text": voice["text"],
                "prompt_lang": "all_zh", "text_split_method": "cut5",
                "batch_size": 1, "parallel_infer": parallel,
                "vits_parallel_infer": False, "speed_factor": speed,
                "seed": 42, "return_fragment": False, "streaming_mode": False,
                "use_cuda_graph": False, "use_flash_attention": False,
            }))
        if not chunks or any(rate != chunks[0][0] for rate, _ in chunks):
            raise RuntimeError("语音引擎未返回有效音频")
        pcm = np.concatenate([samples for _, samples in chunks]).astype("<i2")
        if pcm.size < 100 or not np.any(pcm):
            raise RuntimeError("语音引擎返回了空白音频")
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(chunks[0][0])
            wav.writeframes(pcm.tobytes())
        return output.getvalue()

    if args.benchmark:
        # 固定测试语料、两轮反向线程顺序、绕过 HTTP 整句缓存；模型只加载一份。
        folder = root / "benchmarks"
        folder.mkdir(exist_ok=True)
        results = []
        began = time.perf_counter()
        (folder / "warmup.wav").write_bytes(synthesize("这是我的声音。", "happy"))
        cold_seconds = time.perf_counter() - began
        texts = ["今天也一起开心地学习日语吧。", "先试着回忆昨天学过的单词，然后再看看答案。"]
        for round_id, threads_list in enumerate([[8, 4, 2, 1, 16], [16, 1, 2, 4, 8]], 1):
            for threads in threads_list:
                torch.set_num_threads(threads)
                for index, text in enumerate(texts):
                    began = time.perf_counter()
                    cpu = time.process_time()
                    audio = synthesize(text, "happy")
                    elapsed = time.perf_counter() - began
                    with wave.open(io.BytesIO(audio)) as wav:
                        duration = wav.getnframes() / wav.getframerate()
                    row = {"round": round_id, "threads": threads, "text": text,
                           "seconds": elapsed, "audioSeconds": duration,
                           "cpuSeconds": time.process_time() - cpu, "cache": "bypassed"}
                    results.append(row)
                    (folder / f"r{round_id}-t{threads}-s{index}.wav").write_bytes(audio)
                    (folder / "results.json").write_text(json.dumps({"coldSeconds": cold_seconds, "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
                    print("BENCH", json.dumps(row, ensure_ascii=False), flush=True)
        medians = {threads: statistics.median(row["seconds"] for row in results if row["threads"] == threads) for threads in [1, 2, 4, 8, 16]}
        print("MEDIANS", json.dumps(medians), "BEST", min(medians, key=medians.get), flush=True)
        return

    class Speech(BaseModel):
        model_config = ConfigDict(extra="forbid")
        model: str = model_id
        input: str = Field(min_length=1, max_length=1000)
        voice: str = "neutral"
        language: Literal["zh", "ja"] = "zh"
        speed: float = Field(default=1.0, ge=0.5, le=2.0)
        response_format: str = "wav"

    @app.middleware("http")
    async def local_client(request: Request, call_next):
        # 浏览器页面不能借本机接口发起合成；Electron 通过主进程请求，不带 Origin。
        if request.headers.get("origin") or int(request.headers.get("content-length", "0")) > 16384:
            return Response(status_code=403)
        return await call_next(request)

    @app.get("/health")
    def health():
        return {"service": "deepblue-gpt-sovits", "protocol": 1, "ready": True,
                "model": model_id, "device": device, "threads": args.threads, "workers": 1,
                "backend": "rocm" if device == "cuda" and torch.version.hip else device,
                "deviceName": torch.cuda.get_device_name(0) if device == "cuda" else "CPU",
                "frontendDevice": "cpu" if cpu_bert else device,
                "phonemeBackend": "onednn" if cpu_g2pw else "default",
                "engine": "cpu-fast" if optimized else "upstream",
                "languages": ["zh", "ja"],
                "voices": [{"id": key, "name": value["name"]} for key, value in voices.items()]}

    @app.post("/v1/audio/speech")
    def speech(body: Speech):
        if body.model != model_id or body.voice not in voices or body.response_format != "wav":
            raise HTTPException(400, "未知模型、声音或音频格式")
        if not body.input.strip():
            raise HTTPException(400, "请输入要朗读的文字")
        # 模型与参考缓存共享，只允许一个计算；不在 CPU 上无限堆积并行请求。
        if not mutex.acquire(blocking=False):
            raise HTTPException(429, "上一段语音仍在合成，请稍后再试")
        began = time.perf_counter()
        try:
            key = (body.input, body.voice, body.speed, body.language)
            cached = key in cache
            if cached:
                audio = cache.pop(key)
            else:
                audio = synthesize(body.input, body.voice, body.speed, language=body.language)
                if device == "cuda" and torch.version.hip:
                    torch.cuda.empty_cache()
            # 仅在内存保留最近八句，不把用户聊天文本和语音写成永久文件。
            cache[key] = audio
            while len(cache) > 8:
                cache.popitem(last=False)
            return Response(content=audio, media_type="audio/wav", headers={
                "X-Synthesis-Ms": str(round((time.perf_counter() - began) * 1000)),
                "X-Audio-Cache": "hit" if cached else "miss",
            })
        finally:
            mutex.release()

    uvicorn.run(app, host=args.host, port=args.port, access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
