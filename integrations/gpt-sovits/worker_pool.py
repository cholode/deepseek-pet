"""独立推理进程池：每个进程有自己的模型/参考缓存，HTTP 请求并发，播放器负责排序。"""
import asyncio
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


def exchange(url, payload=None, timeout=120):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(), dict(response.headers)


def serve_pool(args, root):
    import uvicorn
    from fastapi import FastAPI, Request, Response
    from contextlib import asynccontextmanager

    processes = []
    workers = []
    available = asyncio.Queue()
    executor = ThreadPoolExecutor(max_workers=args.workers)
    ready = False
    errors = []
    waiting = 0
    active = 0
    peak = 0

    def start_worker(index):
        # 只生成固定桥接入口和本机端口，不把模型文本拼接进命令。
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        command = [sys.executable, "-I", "-X", "utf8", "-u", str(Path(root) / "bridge.py"),
                   "--host", "127.0.0.1", "--port", str(port), "--workers", "1",
                   "--threads", str(max(1, args.threads // args.workers)), "--device", args.device, "--parent-stdin"]
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        processes.append(process)
        url = f"http://127.0.0.1:{port}"
        deadline = time.monotonic() + 105
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError("推理进程启动失败，请检查所选设备和运行环境")
            try:
                health = json.loads(exchange(url + "/health", timeout=1)[0])
                if health.get("ready"):
                    # 所有进程都准备默认参考，不能让第二句落到未预热的进程。
                    voices = health.get("voices", [])
                    voice = next((v["id"] for v in voices if v["id"] == "happy"), voices[0]["id"] if voices else "neutral")
                    exchange(url + "/v1/audio/speech", {"input": "你好。", "voice": voice, "language": "zh"})
                    return {"index": index, "url": url, "health": health}
            except (OSError, ValueError):
                time.sleep(0.2)
        raise RuntimeError("并发语音进程加载超时")

    async def initialize():
        nonlocal ready
        try:
            loop = asyncio.get_running_loop()
            values = await asyncio.gather(*(loop.run_in_executor(executor, start_worker, index) for index in range(args.workers)))
            workers.extend(values)
            for worker in values:
                available.put_nowait(worker)
            ready = True
        except Exception as error:
            errors.append(str(error))

    @asynccontextmanager
    async def lifetime(_app):
        task = asyncio.create_task(initialize())
        try:
            yield
        finally:
            task.cancel()
            for process in processes:
                if process.stdin:
                    process.stdin.close()
                if process.poll() is None:
                    process.terminate()
            executor.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifetime)

    @app.middleware("http")
    async def local_client(request: Request, call_next):
        if request.headers.get("origin") or int(request.headers.get("content-length", "0")) > 16384:
            return Response(status_code=403)
        return await call_next(request)

    @app.get("/health")
    def health():
        sample = workers[0]["health"] if workers else {}
        return {**sample, "service": "deepblue-gpt-sovits", "protocol": 1, "ready": ready,
                "workers": args.workers, "threads": args.threads, "threadsPerWorker": max(1, args.threads // args.workers),
                "active": active, "peakActive": peak, "error": errors[-1] if errors else None}

    @app.post("/v1/audio/speech")
    async def speech(request: Request):
        nonlocal waiting, active, peak
        if not ready:
            return Response(status_code=503)
        if waiting >= 32:
            return Response(status_code=429)
        payload = await request.json()
        waiting += 1
        worker = None
        try:
            while worker is None:
                if await request.is_disconnected():
                    return Response(status_code=499)
                try:
                    worker = await asyncio.wait_for(available.get(), 0.2)
                except asyncio.TimeoutError:
                    continue
            active += 1
            peak = max(peak, active)
            began = time.perf_counter()
            loop = asyncio.get_running_loop()
            audio, headers = await loop.run_in_executor(executor, exchange, worker["url"] + "/v1/audio/speech", payload)
            return Response(content=audio, media_type="audio/wav", headers={
                "X-Worker": str(worker["index"]), "X-Synthesis-Ms": str(round((time.perf_counter() - began) * 1000)),
                "X-Audio-Cache": headers.get("X-Audio-Cache", headers.get("x-audio-cache", "unknown"))})
        except Exception:
            return Response(status_code=502)
        finally:
            waiting -= 1
            if worker is not None:
                active -= 1
                available.put_nowait(worker)

    uvicorn.run(app, host=args.host, port=args.port, access_log=False, log_level="warning")
