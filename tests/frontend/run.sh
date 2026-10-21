#!/usr/bin/env bash
# tests/frontend/run.sh —— 前端行为层(发布门禁 L2)。
#
# 这一层跑**真实前端**的行为测试:
#   1. `pnpm typecheck` —— tsc --noEmit,类型面零错误;
#   2. `pnpm test` —— vitest 全量(src/ 与 tests/ 两个收集根)。
#
# 后端在这个层里是**模拟**的(tests/helpers/fakeBackend.ts 实现了全部
# IPC 命令)—— 前端行为与线格式在这里验;真实后端的命令体由 L3
# 能力覆盖层负责。两层合起来才是完整的功能面。
#
# 退出码 0 = 全部通过。缺 pnpm / node_modules 时整层 SKIP(不算失败)。

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib.sh"

cd "$ROOT"

suite_begin "frontend"

if ! require_cmd pnpm; then
    tskip "frontend" "未安装 pnpm,前端层跳过"
    tfinish
    exit 0
fi

if ! require_node_deps; then
    tskip "frontend" "node_modules 缺失(先跑 pnpm install),前端层跳过"
    tfinish
    exit 0
fi

# ── 1. 类型检查 ───────────────────────────────────────────────────────────
tcase_log "pnpm typecheck(tsc --noEmit)" \
    "$RESULT_DIR/frontend-typecheck.log" \
    pnpm typecheck

# ── 2. vitest 全量 ───────────────────────────────────────────────────────
tcase_log "pnpm test(vitest 全量)" \
    "$RESULT_DIR/frontend-vitest.log" \
    pnpm test

# vitest 结尾会打印 `Test Files  N passed` / `Tests  N passed`。
# 把规模抓出来贴在用例名后 —— 发布审查报告里能直接看到测试量。
vitest_scale() {
    local log="$1" files="" tests=""
    files=$(grep -oE '^ *Test Files +[0-9]+ passed' "$log" | grep -oE '[0-9]+' | head -1 || true)
    tests=$(grep -oE '^ *Tests +[0-9]+ passed' "$log" | grep -oE '[0-9]+' | head -1 || true)
    if [ -n "$tests" ]; then
        echo "${tests} 个测试 / ${files:-?} 个文件"
    else
        echo "规模未知"
    fi
}

if [ "$FAIL_COUNT" -eq 0 ] && [ -f "$RESULT_DIR/frontend-vitest.log" ]; then
    echo "  ↳ vitest 规模:$(vitest_scale "$RESULT_DIR/frontend-vitest.log")"
fi

tfinish
