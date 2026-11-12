#!/usr/bin/env python3
"""桌面端性能门禁:冷启动、前端预算与真后端大数据预算。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / ("target/release/reflect-desktop.exe" if os.name == "nt" else "target/release/reflect-desktop")


def run(command: list[str], *, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )


def main() -> int:
    if not BINARY.is_file():
        print(f"[ERROR] 缺少 release 二进制:{BINARY};先执行 pnpm tauri build", file=sys.stderr)
        return 2

    report: dict[str, object] = {}
    cold_start_seconds: list[float] = []
    with tempfile.TemporaryDirectory(prefix="reflect-desktop-perf-") as home_name:
        env = os.environ.copy()
        env["HOME"] = home_name
        env["USERPROFILE"] = home_name
        env["ZHUYE_HEADLESS"] = "1"
        for _ in range(3):
            started = time.monotonic()
            process = subprocess.Popen(
                [str(BINARY)],
                cwd=ROOT,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            time.sleep(3)
            elapsed = time.monotonic() - started
            if process.poll() is not None:
                print(f"[ERROR] 冷启动 3s 内退出:{process.returncode}", file=sys.stderr)
                return 1
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            if elapsed > 10:
                print(f"[ERROR] 冷启动超过 10s:{elapsed:.3f}s", file=sys.stderr)
                return 1
            cold_start_seconds.append(round(elapsed, 3))
        report["cold_start_seconds"] = cold_start_seconds

    frontend = run(["pnpm", "exec", "vitest", "run", "tests/perf.budgets.test.tsx"])
    report["frontend_perf"] = {
        "returncode": frontend.returncode,
        "stdout_tail": frontend.stdout[-2000:],
    }
    if frontend.returncode != 0:
        print(frontend.stdout + frontend.stderr, file=sys.stderr)
        return 1

    backend = run(["cargo", "test", "--locked", "-p", "reflect-desktop", "--test", "ipc_perf_budgets"])
    report["backend_perf"] = {
        "returncode": backend.returncode,
        "stdout_tail": backend.stdout[-2000:],
    }
    if backend.returncode != 0:
        print(backend.stdout + backend.stderr, file=sys.stderr)
        return 1

    result_dir = ROOT / ".test-results"
    result_dir.mkdir(exist_ok=True)
    (result_dir / "desktop-performance.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("PASS", json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
