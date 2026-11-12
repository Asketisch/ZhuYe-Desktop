#!/usr/bin/env bash
# live-fold.test.sh —— 实模型层 LIVE_CASE 折叠逻辑的自测。
#
# 折叠逻辑是生产文件 tests/live/fold_live_cases.awk(与 live/run.sh 消费
# 同一份),这里验证三种状态、libtest 行前缀与格式错误的处理。
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIVE_AWK="$(cd "$HERE/.." && pwd)/live/fold_live_cases.awk"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
[ -f "$LIVE_AWK" ] || fail "折叠脚本不存在:$LIVE_AWK(生产文件被移动了?)"

fold() { awk -F'\t' -f "$LIVE_AWK"; }

# ── 1. 三种状态 + 混合噪音行 ─────────────────────────────────────────────
out=$(printf 'running 1 test\ntest live ... LIVE_CASE\ttool-call\tPASS\t模型 openai/gpt-4o\nnoise line\nLIVE_CASE\ttool-approval\tFAIL\t超时无审批\nLIVE_CASE\tdiscussion\tSKIP\t上游429限流\n' | fold)
echo "$out" | grep -q $'^PASS\ttool-call\t模型 openai/gpt-4o$' || fail "PASS 行折叠错"
echo "$out" | grep -q $'^FAIL\ttool-approval\t超时无审批$' || fail "FAIL 行折叠错"
echo "$out" | grep -q $'^SKIP\tdiscussion\t上游429限流$' || fail "SKIP 行折叠错"
[ "$(echo "$out" | wc -l | tr -d ' ')" = "3" ] || fail "噪音行不应折叠进用例表"

# ── 2. 未知状态或缺字段不能伪装成跳过 ──────────────────────────────────
out2=$(printf 'LIVE_CASE\tinterrupt\tTIMEOUT\t预算内无终态\nLIVE_CASE\t\tPASS\t缺名称\nLIVE_CASE\tmissing\tSKIP\n' | fold)
[ "$(printf '%s\n' "$out2" | grep -c $'^FAIL\t实模型结果格式错误\t')" = "3" ] || fail "格式错误必须全部判失败"

# ── 3. 空输入产出空输出(run.sh 的「无用例行 = 失败」护栏依赖这一点)────
[ -z "$(printf '' | fold)" ] || fail "空输入应产出空输出"

echo "live-fold.test.sh self-test: ok"
