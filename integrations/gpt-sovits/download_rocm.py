"""下载固定 AMD 官方 Windows / gfx1103 运行库；分块续传，完成后检查 ZIP 和 SHA256。"""
import concurrent.futures
import hashlib
import json
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--connections", type=int, choices=range(1, 25), default=16)
    args = parser.parse_args()
    root = args.directory.resolve()
    root.mkdir(parents=True, exist_ok=True)
    # URL 均来自 AMD 的 stable 聚合索引。只下载对应核显的包，不更改系统驱动。
    artifacts = [
        ("core", "rocm-sdk-core", "rocm_sdk_core-10.1.0-py3-none-win_amd64.whl"),
        ("core", "rocm-sdk-libraries", "rocm_sdk_libraries-10.1.0-py3-none-win_amd64.whl"),
        ("core", "rocm-sdk-device-gfx1103", "rocm_sdk_device_gfx1103-10.1.0-py3-none-win_amd64.whl"),
        ("pytorch", "torch", "torch-2.14.0+rocm10.1.0-cp312-cp312-win_amd64.whl"),
        ("pytorch", "amd-torch-device-gfx110x", "amd_torch_device_gfx110x-2.14.0+rocm10.1.0-cp312-cp312-win_amd64.whl"),
        ("pytorch", "torchaudio", "torchaudio-2.11.0.3+rocm10.1.0-cp312-cp312-win_amd64.whl"),
    ]
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    records, jobs = [], []
    block = 8 * 1024 * 1024
    for family, package, name in artifacts:
        url = f"https://stable.repo.amd.com/rocm/{family}/whl-next/{package}/{urllib.parse.quote(name)}"
        with opener.open(urllib.request.Request(url, method="HEAD"), timeout=30) as response:
            size, etag = int(response.headers["Content-Length"]), response.headers.get("ETag")
        target = root / name
        record = {"url": url, "name": name, "bytes": size, "etag": etag}
        records.append(record)
        if target.exists() and target.stat().st_size == size:
            continue
        parts = root / (name + ".parts")
        parts.mkdir(exist_ok=True)
        for offset in range(0, size, block):
            end = min(offset + block, size) - 1
            part = parts / str(offset)
            if not part.exists() or part.stat().st_size != end - offset + 1:
                jobs.append((record, offset, end, part))

    def transfer(job):
        record, start, end, part = job
        for attempt in range(5):
            try:
                request = urllib.request.Request(record["url"], headers={"Range": f"bytes={start}-{end}", "If-Match": record["etag"]})
                with opener.open(request, timeout=45) as response:
                    if response.status != 206 or response.headers.get("Content-Range") != f"bytes {start}-{end}/{record['bytes']}":
                        raise RuntimeError("源站没有返回预期的分块")
                    content = response.read(end - start + 2)
                if len(content) != end - start + 1:
                    raise RuntimeError("下载分块不完整")
                part.write_bytes(content)
                return len(content)
            except Exception:
                if attempt == 4:
                    raise
                time.sleep(attempt + 1)

    expected = sum(job[2] - job[1] + 1 for job in jobs)
    print(f"Need {len(jobs)} blocks, {expected / 1048576:.1f} MiB", flush=True)
    downloaded, last, began = 0, time.monotonic(), time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.connections) as executor:
        futures = [executor.submit(transfer, job) for job in jobs]
        for future in concurrent.futures.as_completed(futures):
            downloaded += future.result()
            if time.monotonic() - last >= 10:
                print(f"Downloaded {downloaded / 1048576:.1f}/{expected / 1048576:.1f} MiB; {downloaded / 1048576 / (time.monotonic() - began):.1f} MiB/s", flush=True)
                last = time.monotonic()
    for record in records:
        target = root / record["name"]
        if not target.exists() or target.stat().st_size != record["bytes"]:
            with target.open("wb") as output:
                for offset in range(0, record["bytes"], block):
                    output.write((root / (record["name"] + ".parts") / str(offset)).read_bytes())
        with zipfile.ZipFile(target) as archive:
            if archive.testzip() is not None:
                raise RuntimeError(f"Wheel ZIP CRC failed: {record['name']}")
        with target.open("rb") as source:
            record["sha256"] = hashlib.file_digest(source, "sha256").hexdigest()
        print(f"Verified {record['name']}", flush=True)
    (root / "manifest.json").write_text(json.dumps(records, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
