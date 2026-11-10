#!/usr/bin/env bash
# live-fold.test.sh —— 实模型层 LIVE_CASE 折叠逻辑的自测。
#
# 折叠逻辑是生产文件 tests/live/fold_live_cases.awk(与 live/run.sh 消费
# 同一份),这里验证三种状态折进门禁表的行为,以及「非 LIVE_CASE 行 /
# 非 PASS-FAIL 状态折为 SKIP」的纪律(模型不配合不是产品缺陷)。
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIVE_AWK="$(cd "$HERE/.." && pwd)/live/fold_live_cases.awk"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
[ -f "$LIVE_AWK" ] || fail "折叠脚本不存在:$LIVE_AWK(生产文件被移动了?)"

fold() { awk -F'\t' -f "$LIVE_AWK"; }

# ── 1. 三种状态 + 混合噪音行 ─────────────────────────────────────────────
out=$(printf 'running 1 test\ntest live ... ok\nLIVE_CASE\ttool-call\tPASS\t模型 openai/gpt-4o\nnoise line\nLIVE_CASE\ttool-approval\tFAIL\t超时无审批\nLIVE_CASE\tdiscussion\tSKIP\t上游429限流\n' | fold)
echo "$out" | grep -q $'^PASS\ttool-call\t模型 openai/gpt-4o$' || fail "PASS 行折叠错"
echo "$out" | grep -q $'^FAIL\ttool-approval\t超时无审批$' || fail "FAIL 行折叠错"
echo "$out" | grep -q $'^SKIP\tdiscussion\t上游429限流$' || fail "SKIP 行折叠错"
[ "$(echo "$out" | wc -l | tr -d ' ')" = "3" ] || fail "噪音行不应折叠进用例表"

# ── 2. 非 PASS/FAIL 状态一律折为 SKIP(模型不配合 ≠ 产品缺陷)────────────
out2=$(printf 'LIVE_CASE\tinterrupt\tTIMEOUT\t预算内无终态\nLIVE_CASE\tplan-mode\tQUOTA\t429\n' | fold)
echo "$out2" | grep -q $'^SKIP\tinterrupt\t预算内无终态$' || fail "TIMEOUT 应折为 SKIP"
echo "$out2" | grep -q $'^SKIP\tplan-mode\t429$' || fail "QUOTA 应折为 SKIP"
echo "$out2" | grep -q $'^FAIL' && fail "非 FAIL 状态不得折为 FAIL"

# ── 3. 空输入产出空输出(run.sh 的「无用例行 = 失败」护栏依赖这一点)────
[ -z "$(printf '' | fold)" ] || fail "空输入应产出空输出"

echo "live-fold.test.sh self-test: ok"
