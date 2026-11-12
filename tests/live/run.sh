#!/usr/bin/env bash
# tests/live/run.sh —— 实模型演练层(发布门禁 L6)。
#
# ## 这一层测什么
#
# L2(前端行为层)的后端是**模拟**的;L3(能力覆盖层)的后端是**真的**,
# 但模型是**假的**(wiremock / 本地 mock LLM)。
#
# 假模型永远测不到:真实 HTTP 往返、真实 SSE 帧形状、真实模型的思考
# 过程、真实限流(429)、真实截断续作、真实 provider 的工具调用质量。
# 这一层把**免费模型池**接进同一条真链路:
#
#   reflect_submit → AgentThread → HTTP → SSE 解析 → reflect_event 通道
#
# 与 GUI 点一次「发送」是同一条链(同一个 `generate_handler!` 注册表、
# 同一个 AgentThread、同一个事件通道)。
#
# ## 默认跳过
#
# 未设 `REFLECT_LIVE=1` 时整层 SKIP —— **不发起任何网络请求**。
# 与 submodule `tests/live/` 同一口径:实模型层是**可选演练**,不进 CI
# 门禁(免费池配额是全局的,CI 上跑只会制造噪声)。
#
# 跑法:
#   REFLECT_LIVE=1 bash tests/run_all.sh live
#
# ## 断言口径
#
# 只断言**协议形状**:model spec 解析成真实 id、turn 有终态、usage 字段
# 齐全、工具调用成对。**不断言回答文本** —— 真实模型输出不确定,逐字
# 断言只会制造假失败。
#
# 上游限流(429)判为**跳过**而不是失败 —— 测的是代码,不是配额。

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib.sh"

cd "$ROOT"

suite_begin "live"

if [ "${REFLECT_LIVE:-}" != "1" ]; then
    tskip "实模型演练层" "未设 REFLECT_LIVE=1 —— 默认不发网络请求"
    tfinish
    exit 0
fi

if ! require_cmd cargo; then
    tskip "实模型演练层" "未安装 cargo"
    tfinish
    exit 0
fi

LOG="$RESULT_DIR/live-test.log"
RAW="$RESULT_DIR/live-cases.raw"

# 两个测试二进制都要跑:
# - `ipc_live_free_model`  —— 主回合(真模型 → 正文 → token → 终态);
# - `ipc_live_capabilities` —— 能力域矩阵(15 个场景,其余依赖模型的命令面)。
#
# `--ignored` 只跑标记了 `#[ignore]` 的实模型用例;
# `--nocapture` 让 `LIVE_CASE` 行直接落到 stdout(否则被测试框架吞掉)。
(
    cd "$ROOT/src-tauri" &&
    REFLECT_LIVE=1 cargo test \
        --test ipc_live_free_model --test ipc_live_capabilities --no-fail-fast \
        -- --ignored --nocapture --test-threads=1
) > "$LOG" 2>&1
CARGO_STATUS=$?

# 把 Rust 侧打印的 `LIVE_CASE\t<名>\t<状态>\t<原因>` 折进门禁用例表。
# 折叠逻辑在 fold_live_cases.awk —— 与自测(live-fold.test.sh)消费
# **同一份**文件,防复制漂移。
if ! awk -F'\t' -f "$HERE/fold_live_cases.awk" "$LOG" > "$RAW"; then
    tcase "实模型结果解析器运行" false
    tfinish
    exit 1
fi

if [ ! -s "$RAW" ]; then
    # 没有产出任何用例行 —— Rust 侧崩在打点之前,或 cargo 根本没跑起来。
    echo "  ⚠️  实模型演练层没有产出任何用例 —— 视为失败"
    tcase "实模型演练层(cargo test 无结果)" false
    tail -40 "$LOG" | sed 's/^/         │ /'
    tfinish
    exit 1
fi

suite_absorb "$RAW"

# 两个二进制都必须上报，且解析模型成功后必须有主回合结果。
for name in free-model-resolution live-capability-matrix; do
    if ! awk -F '\t' -v name="$name" '$2 == name { found=1 } END { exit !found }' "$RAW"; then
        tcase "实模型结果缺失($name)" false
    fi
done
if awk -F '\t' '$1 == "PASS" && $2 == "free-model-resolution" { found=1 } END { exit !found }' "$RAW" &&
   ! awk -F '\t' '$2 == "full-chain-protocol-shape" { found=1 } END { exit !found }' "$RAW"; then
    tcase "实模型主回合结果缺失" false
fi

# 场景表以 Rust 测试的 SCENARIOS 为准；无论执行、筛选还是限流，
# 矩阵成功初始化后每个场景都必须恰好上报一次。
if awk -F '\t' '$1 == "PASS" && $2 == "live-capability-matrix" { found=1 } END { exit !found }' "$RAW"; then
    scenarios="$RESULT_DIR/live-scenarios.expected"
    awk '/^const SCENARIOS:.*= &\[/ { in_table=1; next } in_table && /^\];/ { exit } in_table && /^[[:space:]]*\("/ { line=$0; sub(/^[[:space:]]*\("/, "", line); sub(/".*/, "", line); print line }' \
        "$ROOT/src-tauri/tests/ipc_live_capabilities.rs" > "$scenarios"
    if [ ! -s "$scenarios" ]; then
        tcase "实模型场景表读取" false
    else
        while IFS= read -r name; do
            count=$(awk -F '\t' -v name="$name" '$2 == name { n++ } END { print n+0 }' "$RAW")
            if [ "$count" -ne 1 ]; then
                tcase "实模型场景结果数量($name=$count)" false
            fi
        done < "$scenarios"
    fi
fi

# cargo 退出码非零但用例行都在 —— 说明有 FAIL 用例(已折进计数)。
# 这里把退出码再判一次,防止「用例全 PASS 但 cargo 崩了」被放过。
if [ "$CARGO_STATUS" -ne 0 ] && [ "$FAIL_COUNT" -eq 0 ]; then
    echo "  ⚠️  cargo test 退出码非零($CARGO_STATUS)但没有失败用例 —— 视为失败"
    FAIL_COUNT+=1
    FAIL_NAMES+=("实模型演练层(cargo test 异常退出)")
    printf 'FAIL\t%s\n' "实模型演练层(cargo test 异常退出)" >> "$RESULT_DIR/$SUITE_NAME.cases"
fi

tfinish
