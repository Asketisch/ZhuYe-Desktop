#!/usr/bin/env bash
# tests/live/desktop_e2e.sh —— 桌面端全任务端到端演练(本地专用,不进 CI)。
#
# ## 定位
#
# 与上游 `zhuye-agent/tests/live/cli_e2e.sh`(headless `zhuye serve` 链路 ×
# 31 场景)互补:这里走**桌面 IPC 链路**(zhuye_submit → 嵌入 AgentThread →
# 真 HTTP/SSE → zhuye_event),消费**同一份** agent 配置
# `tests/live/cli_e2e.toml`,跑 `[task]` 段的完整任务:
#
#   plan 模式提交 → plan_ready → auto_mode 批准 → 开发回合
#   (工具调用 + 沙箱内 git init/add/commit)→ continue_prompt 收尾
#   → 验收:产物存在 + 提交主题匹配
#
# 覆盖 CLI 套件在桌面端够不到的两件事:plan 审批流的真模型行为、沙箱
# `.git` 归属快照的端到端回归。单进程单场景(一个测试体),崩溃/超时
# 由 run_with_timeout 看门狗兜底。
#
# ## 跑法
#
#   ZHUYE_LIVE=1 bash tests/live/desktop_e2e.sh
#
# 常用环境变量(转发给 Rust 测试,字段级覆盖详见 ipc_live_cli_e2e.rs 头部):
#   ZHUYE_E2E_TOML            —— 配置路径(默认:上游工作检出 → submodule 镜像)
#   ZHUYE_E2E_BASE_URL / _API_KEY / _MODEL / _ENDPOINT / _CONTEXT_WINDOW
#   ZHUYE_E2E_EFFORT / _PHASE_TIMEOUT / _EXPECT_ARTIFACT / _EXPECT_COMMIT
#   ZHUYE_E2E_CONTINUE_ROUNDS —— 收尾回合数(默认 1)
#   ZHUYE_E2E_TIMEOUT         —— 本脚本看门狗秒数(默认 5400)
#   ZHUYE_E2E_KEEP=1          —— 保留日志目录供翻查
#
# ## 断言口径
#
# 结构化检查项(协议形状 + 任务验收),逐项折成 tcase;不断言模型文本。
# 上游限流 / 地区门 / 配置缺失判 SKIP 而非失败 —— 测的是代码,不是配额。

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib.sh"

suite_begin "live-desktop-e2e"

if [ "${ZHUYE_LIVE:-}" != "1" ]; then
    tskip "桌面端到端演练" "未设 ZHUYE_LIVE=1 —— 默认不发网络请求"
    tfinish
    exit 0
fi

if ! require_cmd cargo; then
    tskip "桌面端到端演练" "未安装 cargo"
    tfinish
    exit 0
fi

TIMEOUT="${ZHUYE_E2E_TIMEOUT:-5400}"
LOG="$RESULT_DIR/desktop-e2e-test.log"
RAW="$RESULT_DIR/desktop-e2e.raw"

# 看门狗内跑测试二进制(--ignored 只跑 #[ignore] 实模型用例;单线程保
# 事件流互不交叉)。超时判 FAIL —— 既可能是端点排队,也可能是引擎挂死,
# 都该被看见(日志尾巴给出定位线索)。
run_with_timeout "$TIMEOUT" bash -c '
    cd "'"$ROOT"'/src-tauri" &&
    ZHUYE_LIVE=1 cargo test --test ipc_live_cli_e2e --no-fail-fast \
        -- --ignored --nocapture --test-threads=1
' > "$LOG" 2>&1
CARGO_STATUS=$?

if [ "$CARGO_STATUS" = "124" ]; then
    tcase "桌面端到端执行未超时(${TIMEOUT}s)" false
    tail -30 "$LOG" | sed 's/^/         │ /'
    tfinish
    exit 1
fi

# LIVE_CASE\t<用例名>\t<PASS|FAIL|SKIP>\t<原因> 折进门禁用例表 ——
# 与 tests/live/run.sh 消费同一份 fold_live_cases.awk,防复制漂移。
if ! awk -F'\t' -f "$HERE/fold_live_cases.awk" "$LOG" > "$RAW"; then
    tcase "端到端结果解析器运行" false
    tail -40 "$LOG" | sed 's/^/         │ /'
    tfinish
    exit 1
fi

if [ ! -s "$RAW" ]; then
    # 没有产出任何用例行 —— Rust 侧崩在打点之前,或 cargo 没跑起来。
    echo "  ⚠️  桌面端到端演练没有产出任何用例 —— 视为失败"
    tcase "桌面端到端演练(cargo test 无结果)" false
    tail -40 "$LOG" | sed 's/^/         │ /'
    tfinish
    exit 1
fi

suite_absorb "$RAW"

# 汇总用例之外,cargo 退出码再判一次 —— 防止「用例全 PASS 但 cargo 崩了」。
if [ "$CARGO_STATUS" -ne 0 ] && [ "$FAIL_COUNT" -eq 0 ]; then
    echo "  ⚠️  cargo test 退出码非零($CARGO_STATUS)但没有失败用例 —— 视为失败"
    tcase "桌面端到端演练(cargo test 异常退出)" false
fi

if [ "${ZHUYE_E2E_KEEP:-}" = "1" ]; then
    echo "  [keep] 测试日志保留:$LOG"
fi

tfinish
