"""测量实际桥接端点，保存公开测试句的音频与缓存标记，不接触用户聊天记录。"""
import argparse
import concurrent.futures
import io
import json
import time
import urllib.request
import wave
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:9885")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--concurrency", type=int, choices=[1, 2, 3, 4], default=1)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"health": json.loads(urllib.request.urlopen(args.url + "/health").read()), "warmup": [], "samples": []}

    def synthesize(index, text, language):
        began = time.perf_counter()
        payload = json.dumps({"input": text, "voice": "happy", "language": language}).encode()
        request = urllib.request.Request(args.url + "/v1/audio/speech", data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=300) as response:
            audio = response.read()
            cache, worker = response.headers.get("X-Audio-Cache"), response.headers.get("X-Worker")
        elapsed = time.perf_counter() - began
        with wave.open(io.BytesIO(audio)) as source:
            seconds = source.getnframes() / source.getframerate()
        if seconds < 0.1:
            raise RuntimeError("合成返回了过短的音频")
        (args.output / f"{index}-{language}.wav").write_bytes(audio)
        row = {"text": text, "language": language, "seconds": elapsed, "audioSeconds": seconds, "cache": cache, "worker": worker}
        print(json.dumps(row, ensure_ascii=False), flush=True)
        return row

    for i, (text, language) in enumerate([("你好。", "zh"), ("这是我的声音。", "zh"), ("こんにちは。一緒に日本語を勉強しましょう。", "ja")]):
        print(f"Warmup {i}", flush=True)
        report["warmup"].append(synthesize(f"warmup-{i}", text, language))
        (args.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    texts = ["第46题。今天我们一起练习新的日语句子。", "第47题。先听一遍，然后试着用自己的话回答。",
             "第48题。答错也没有关系，我们可以慢慢练习。", "第49题。最后再回忆一下刚才学过的内容。"]
    began = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(synthesize, index, text, "zh") for index, text in enumerate(texts)]
        report["samples"] = [future.result() for future in futures]
    report["elapsedSeconds"] = time.perf_counter() - began
    report["healthAfter"] = json.loads(urllib.request.urlopen(args.url + "/health").read())
    (args.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("TOTAL", report["elapsedSeconds"], flush=True)


if __name__ == "__main__":
    main()
