"""隔离模型进程做真实推理对照；不启动 HTTP、不读写聊天、不改变生产桥接。

阶段计时存在嵌套，不可直接相加。GPU 同步点的等待也包含此前排队的计算，
tensorMembership 并不是纯粹的传输耗时；端到端速度另用 benchmark_service.py 验证。
"""
import argparse
import concurrent.futures
import ctypes
import inspect
import io
import hashlib
import json
import os
from pathlib import Path
import queue
import runpy
import subprocess
import sys
import threading
import time
import wave

PREFIX = "DIAGNOSTIC_JSON "
TEXTS = ["第46题。今天我们一起练习新的日语句子。", "第47题。先听一遍，然后试着用自己的话回答。",
         "第48题。答错也没有关系，我们可以慢慢练习。", "第49题。最后再回忆一下刚才学过的内容。"]


def memory():
    if os.name != "nt":
        return {}
    class Status(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [(n, ctypes.c_ulonglong) for n in
            ["total", "available", "totalPage", "availablePage", "totalVirtual", "availableVirtual", "extended"]]
    status = Status(); status.length = ctypes.sizeof(status)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
    return {"availableGB": status.available / 2**30, "committedGB": (status.totalPage - status.availablePage) / 2**30}


def emit(value):
    print(PREFIX + json.dumps(value, ensure_ascii=False), flush=True)


def worker(args):
    import uvicorn
    def capture(app, **_kwargs):
        import torch
        from text import chinese2
        speech = next(r.endpoint for r in app.routes if r.path == "/v1/audio/speech")
        health = next(r.endpoint for r in app.routes if r.path == "/health")
        variables = inspect.getclosurevars(speech).nonlocals
        pipeline = inspect.getclosurevars(variables["synthesize"]).nonlocals["pipeline"]
        body_type = inspect.signature(speech).parameters["body"].annotation
        metrics = {}; mode = "release"; optimized_g2pw = False
        def sync():
            if torch.cuda.is_available(): torch.cuda.synchronize()
        def timed(name, function, synchronize=False):
            def call(*values, **kwargs):
                if synchronize: sync()
                started = time.perf_counter()
                result = function(*values, **kwargs)
                if synchronize: sync()
                entry = metrics.setdefault(name, {"seconds": 0, "calls": 0})
                entry["seconds"] += time.perf_counter() - started; entry["calls"] += 1
                return result
            return call
        decoder = pipeline.t2s_model.model
        decoder.infer_panel_batch_infer = timed("semantic", decoder.infer_panel_batch_infer, True)
        frontend = pipeline.text_preprocessor
        frontend.preprocess = timed("frontend", frontend.preprocess, True)
        frontend.get_bert_feature_batch = timed("bert", frontend.get_bert_feature_batch, True)
        frontend.clean_text_inf_with_phone_units = timed("phonemes", frontend.clean_text_inf_with_phone_units, True)
        chinese2.g2pw._predict = timed("g2pwPredict", chinese2.g2pw._predict)
        pipeline.vits_model.decode = timed("vitsDecode", pipeline.vits_model.decode, True)
        pipeline.non_vocoder_synthesis_batched_infer = timed("vits", pipeline.non_vocoder_synthesis_batched_infer, True)
        pipeline.empty_cache = timed("cleanup", pipeline.empty_cache, True)
        original_empty = torch.cuda.empty_cache
        def empty():
            if mode == "release": return original_empty()
        torch.cuda.empty_cache = timed("cudaEmptyCache", empty)
        original_contains = torch.Tensor.__contains__
        torch.Tensor.__contains__ = timed("tensorMembership", original_contains)
        emit({"ready": True, "pid": os.getpid(), "health": health(), "memory": memory(), "torch": torch.__version__})
        thread = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        for raw in sys.stdin:
            request = json.loads(raw)
            if request.get("stop"): return
            try:
                mode = request.get("cacheMode", "release")
                if request.get("optimizeG2pw") and not optimized_g2pw:
                    from torch.utils.mkldnn import to_mkldnn
                    chinese2.g2pw.model = to_mkldnn(chinese2.g2pw.model)
                    optimized_g2pw = True
                variables["cache"].clear()  # 每次绕过整句缓存，保留实际参考特征缓存。
                metrics.clear(); sync(); started = time.perf_counter()
                cpu = time.process_time(); before = memory()
                def invoke():
                    if request.get("setThreads"): torch.set_num_threads(args.threads)
                    local_threads = torch.get_num_threads()
                    return speech(body_type(input=request["text"], language="zh", voice="happy")), local_threads
                if request.get("threaded"):
                    body, local_threads = thread.submit(invoke).result()
                else: body, local_threads = invoke()
                sync(); elapsed = time.perf_counter() - started
                with wave.open(io.BytesIO(body.body)) as audio:
                    duration = audio.getnframes() / audio.getframerate()
                result = {"seconds": elapsed, "cpuSeconds": time.process_time() - cpu, "audioSeconds": duration,
                          "metrics": dict(metrics), "memoryBefore": before, "memoryAfter": memory(), "cacheMode": mode,
                          "audioSha256": hashlib.sha256(body.body).hexdigest(), "optimizedG2pw": optimized_g2pw,
                          "threaded": request.get("threaded", False), "localThreads": local_threads,
                          "g2pwBackend": "onednn" if optimized_g2pw else health().get("phonemeBackend", "default")}
                if torch.cuda.is_available():
                    result["gpuMemoryGB"] = {"allocated": torch.cuda.memory_allocated()/2**30, "reserved": torch.cuda.memory_reserved()/2**30,
                                             "peak": torch.cuda.max_memory_allocated()/2**30}
                emit(result)
            except Exception as error:
                emit({"error": repr(error)})
    uvicorn.run = capture
    sys.argv = [str(args.root / "bridge.py"), "--threads", str(args.threads), "--workers", "1", "--device", args.device]
    runpy.run_path(str(args.root / "bridge.py"), run_name="__main__")


class Worker:
    def __init__(self, args, index):
        environment = args.root / (".venv-rocm" if args.device == "cuda" else ".venv") / "Scripts/python.exe"
        self.log = (args.output / f"worker-{index}.log").open("w", encoding="utf8")
        self.errors = (args.output / f"worker-{index}.stderr").open("w", encoding="utf8")
        self.results = queue.Queue()
        self.process = subprocess.Popen([str(environment), "-I", "-X", "utf8", "-u", str(Path(__file__).resolve()),
            "--worker", "--root", str(args.root), "--device", args.device, "--threads", str(args.threads)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.errors, text=True, encoding="utf8",
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        def read():
            for line in self.process.stdout:
                if line.startswith(PREFIX): self.results.put(json.loads(line[len(PREFIX):]))
                else: self.log.write(line); self.log.flush()
            self.results.put({"error": "诊断进程退出，请查看同目录日志"})
        self.reader = threading.Thread(target=read, daemon=True); self.reader.start()
        try:
            self.ready = self.results.get(timeout=240)
            if not self.ready.get("ready"): raise RuntimeError(self.ready)
        except Exception:
            self.close()
            raise
    def infer(self, text, mode="release", optimize=False, threaded=False, set_threads=False):
        self.process.stdin.write(json.dumps({"text": text, "cacheMode": mode, "optimizeG2pw":optimize,
            "threaded":threaded,"setThreads":set_threads}) + "\n"); self.process.stdin.flush()
        result = self.results.get(timeout=240)
        if "error" in result: raise RuntimeError(result["error"])
        return result
    def close(self):
        self.process.stdin.close()
        try: self.process.wait(timeout=60)
        except subprocess.TimeoutExpired:
            # 仅清理本脚本创建的确切进程树，不按 Python 名称关闭用户的服务。
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(self.process.pid), "/T", "/F"], capture_output=True,
                               creationflags=subprocess.CREATE_NO_WINDOW, check=False)
            else: self.process.kill()
            self.process.wait(timeout=10)
        self.reader.join(timeout=3); self.log.close(); self.errors.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--device", choices=["cpu", "cuda"], required=True)
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--workers", type=int, choices=[1,2], default=1)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--worker", action="store_true")
    comparison = parser.add_mutually_exclusive_group()
    comparison.add_argument("--parallel-first", action="store_true")
    comparison.add_argument("--g2pw-test", action="store_true")
    comparison.add_argument("--thread-test", action="store_true")
    comparison.add_argument("--service-thread", action="store_true")
    args = parser.parse_args()
    args.root = args.root.resolve()
    if args.worker: return worker(args)
    if args.output is None: parser.error("--output required")
    if args.parallel_first and args.workers != 2: parser.error("--parallel-first requires two workers")
    if args.g2pw_test and (args.workers != 1 or args.device != "cuda"):
        parser.error("--g2pw-test requires one GPU worker")
    if (args.thread_test or args.service_thread) and args.workers != 1:
        parser.error("thread comparisons require one worker")
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"device": args.device, "threadsPerWorker": args.threads, "texts": TEXTS,
              "bridgeSha256": hashlib.sha256((args.root / "bridge.py").read_bytes()).hexdigest(),
              "workers": [], "rounds": [], "memory": []}
    workers=[]; stop=threading.Event()
    def monitor():
        while not stop.wait(0.5): report["memory"].append({"at": time.time(), **memory()})
    threading.Thread(target=monitor, daemon=True).start()
    def save(): (args.output/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf8")
    try:
        for index in range(args.workers):
            began=time.perf_counter(); instance=Worker(args,index); workers.append(instance)
            report["workers"].append({**instance.ready,"startupSeconds":time.perf_counter()-began})
            print("READY",index,report["workers"][-1]["startupSeconds"],flush=True)
            warmup = instance.infer("你好。", threaded=args.service_thread)
            report["workers"][-1]["warmup"] = warmup
            print("WARMUP",index,json.dumps(warmup),flush=True); save()
        # 同一进程持有相同模型，交替测清空/保留缓存；双模型驻留时另比较串行和并发。
        configurations = [("release",False),("keep",False),("keep",False),("release",False)] if args.workers==1 else [
            ("release",False),("release",True),("keep",True),("keep",False)]
        if args.parallel_first: configurations=[("release",True),("release",True)]
        if args.g2pw_test: configurations=[("release",False)]*4
        if args.thread_test: configurations=[("release",False)]*3
        if args.service_thread: configurations=[("release",False)]*2
        for round_index,(mode, parallel) in enumerate(configurations):
            optimize=args.g2pw_test and round_index>=2
            started_at = time.time()
            began=time.perf_counter()
            if parallel:
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                    def lane(index): return [workers[index].infer(t,mode,optimize) for t in TEXTS[index::2]]
                    pending=[pool.submit(lane,i) for i in range(2)]
                    rows=[None]*4
                    for i,promise in enumerate(pending): rows[i::2]=promise.result()
            else: rows=[workers[i%len(workers)].infer(t,mode,optimize,
                args.service_thread or (args.thread_test and round_index>0), args.thread_test and round_index>1) for i,t in enumerate(TEXTS)]
            result={"cacheMode":mode,"parallel":parallel,"optimizedG2pw":optimize,"startedAt":started_at,"seconds":time.perf_counter()-began,"samples":rows}
            report["rounds"].append(result); save()
            print("ROUND",mode,parallel,round(result["seconds"],3),flush=True)
    finally:
        for instance in workers: instance.close()
        stop.set(); save()


if __name__=="__main__": main()
