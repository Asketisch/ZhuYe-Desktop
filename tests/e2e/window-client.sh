#!/usr/bin/env bash
# 在隔离环境中连接由门禁启动的本机驱动。
set -u
if [ "$#" -ne 3 ]; then
    echo '用法: window-client.sh <应用二进制> <结果目录> <工作区>' >&2
    exit 2
fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export TAURI_APP_BIN="$1" E2E_SCREENSHOT_DIR="$2" E2E_WORKSPACE_DIR="$3"
export TAURI_DRIVER_URL='http://127.0.0.1:4444'
cd "$ROOT" || exit 1
if command -v xvfb-run >/dev/null 2>&1; then
    exec xvfb-run -a pnpm exec vitest run --config tests/e2e/vitest.config.ts tests/e2e/window.smoke.test.ts
fi
exec pnpm exec vitest run --config tests/e2e/vitest.config.ts tests/e2e/window.smoke.test.ts
