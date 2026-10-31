"""实际执行 GPU 张量、矩阵和卷积运算；仅识别到显卡不能算安装完成。"""
import argparse
import json
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    import torch
    report = {"torch": torch.__version__, "torchFile": torch.__file__, "hip": torch.version.hip,
              "available": torch.cuda.is_available(), "checks": []}
    try:
        if not report["available"]:
            raise RuntimeError("GPU unavailable")
        props = torch.cuda.get_device_properties(0)
        report.update(device=props.name, architecture=props.gcnArchName, memoryBytes=props.total_memory)
        torch.manual_seed(42)
        for dtype in [torch.float32, torch.float16]:
            began = time.perf_counter()
            a, b = torch.randn(512, 512), torch.randn(512, 512)
            gpu = a.to(device="cuda", dtype=dtype) @ b.to(device="cuda", dtype=dtype)
            torch.cuda.synchronize()
            reference = a.to(dtype).float() @ b.to(dtype).float()
            torch.testing.assert_close(gpu.float().cpu(), reference, rtol=0.01, atol=0.08)
            x, w = torch.randn(1, 16, 1024).to(dtype), torch.randn(32, 16, 5).to(dtype)
            conv = torch.nn.functional.conv1d(x.cuda(), w.cuda())
            torch.cuda.synchronize()
            reference = torch.nn.functional.conv1d(x.float(), w.float())
            torch.testing.assert_close(conv.float().cpu(), reference, rtol=0.01, atol=0.08)
            report["checks"].append({"dtype": str(dtype), "matrix": True, "conv1d": True,
                                     "seconds": round(time.perf_counter() - began, 3)})
        report["passed"] = True
    except Exception as error:
        report.update(passed=False, error=str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
