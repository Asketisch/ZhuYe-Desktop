#!/usr/bin/env bash
# macOS 真窗口冒烟:macOS 无 Tauri WebDriver 桥,改用系统窗口层验证真实窗口。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
APP_BIN="${1:?缺少调试二进制路径}"
RESULT_DIR="${2:?缺少结果目录}"

cd "$ROOT"
mkdir -p "$RESULT_DIR"

VITE_PID=""
APP_PID=""
cleanup() {
    if [ -n "$APP_PID" ]; then
        kill "$APP_PID" 2>/dev/null || true
        wait "$APP_PID" 2>/dev/null || true
    fi
    if [ -n "$VITE_PID" ]; then
        kill "$VITE_PID" 2>/dev/null || true
        wait "$VITE_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if (exec 3<>/dev/tcp/127.0.0.1/5173) 2>/dev/null; then
    echo "端口 5173 已被占用" >&2
    exit 2
fi
pnpm exec vite --strictPort >"$RESULT_DIR/e2e-macos-vite.log" 2>&1 &
VITE_PID=$!
ready=0
for _ in $(seq 1 60); do
    kill -0 "$VITE_PID" 2>/dev/null || break
    if curl -fsS http://localhost:5173/ >/dev/null 2>&1; then
        ready=1
        break
    fi
    sleep 0.5
done
if [ "$ready" -ne 1 ]; then
    echo "Vite dev server 30s 未就绪" >&2
    tail -20 "$RESULT_DIR/e2e-macos-vite.log" >&2 || true
    exit 2
fi

"$APP_BIN" >"$RESULT_DIR/e2e-macos-window.log" 2>&1 &
APP_PID=$!

probe_log="$RESULT_DIR/e2e-macos-window-probe.log"
found=0
for _ in $(seq 1 60); do
    kill -0 "$APP_PID" 2>/dev/null || break
    if swift "$HERE/macos_window_probe.swift" >"$probe_log" 2>&1; then
        found=1
        break
    fi
    sleep 0.5
done

if [ "$found" -ne 1 ]; then
    echo "真实窗口 30s 未出现在系统窗口层" >&2
    cat "$probe_log" >&2 || true
    tail -30 "$RESULT_DIR/e2e-macos-window.log" >&2 || true
    exit 1
fi

# 窗口出现后继续保持 3 秒,捕获启动即崩、首帧退出和窗口闪烁。
sleep 3
if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "窗口出现后应用进程退出" >&2
    tail -30 "$RESULT_DIR/e2e-macos-window.log" >&2 || true
    exit 1
fi
if ! swift "$HERE/macos_window_probe.swift" >"$probe_log" 2>&1; then
    echo "3 秒后窗口不再在屏" >&2
    cat "$probe_log" >&2
    exit 1
fi

shot="$RESULT_DIR/e2e-window-macos.png"
if ! screencapture -x "$shot" >/dev/null 2>&1 || [ ! -s "$shot" ]; then
    echo "macOS 截图失败或产物为空:$shot" >&2
    exit 3
fi

echo "macOS native window verified: $(cat "$probe_log")"
