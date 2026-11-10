#!/usr/bin/env bash
# run_all.test.sh —— tests/run_all.sh 聚合层行为的自测。
#
# run_all.sh 是发布门禁总入口,它的聚合逻辑错了(未知套件参数、报告段
# 缺失、GATE_STRICT 误报)会污染全部六层的结论。这里验证三个可离线复现
# 的行为;套件内部失败/缺结果文件的检测由各 runner 自测与既有护栏覆盖。
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# ── 1. 未知套件参数 → exit 2 + 点名 ──────────────────────────────────────
out=$(bash "$ROOT/tests/run_all.sh" not-a-suite 2>&1); rc=$?
[ "$rc" = "2" ] || fail "未知套件应退出 2,实际 $rc"
echo "$out" | grep -q 'not-a-suite' || fail "未知套件的报错应点名参数"

# ── 2. 真实套件跑完后报告结构完整(结论 / 层内跳过明细 / 逐用例明细)──────
RESULT_DIR="$TMP/results" bash "$ROOT/tests/run_all.sh" static > "$TMP/static.log" 2>&1
rc=$?
[ "$rc" = "0" ] || { tail -20 "$TMP/static.log" >&2; fail "static 层应通过(rc=$rc)"; }
[ -f "$TMP/results/release-review.md" ] || fail "报告未生成"
for section in '## 分层结果' '## 层内跳过明细' '## 逐用例明细' '**结论:'; do
    grep -qF "$section" "$TMP/results/release-review.md" || fail "报告缺段落:$section"
done
grep -q '允许发布' "$TMP/results/release-review.md" || fail "全绿场景报告结论应含「允许发布」"

# ── 3. GATE_STRICT=1 在无跳过场景不误报 ──────────────────────────────────
RESULT_DIR="$TMP/results2" GATE_STRICT=1 bash "$ROOT/tests/run_all.sh" static > "$TMP/strict.log" 2>&1
rc=$?
[ "$rc" = "0" ] || { tail -20 "$TMP/strict.log" >&2; fail "无跳过时 GATE_STRICT 不应判失败(rc=$rc)"; }
echo "$TMP/strict.log" | grep -q . || fail "GATE_STRICT 运行应产生输出"

echo "run_all.test.sh self-test: ok"
