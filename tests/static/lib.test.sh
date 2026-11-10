#!/usr/bin/env bash
# lib.test.sh —— tests/lib.sh 门禁原语的自测。
#
# lib.sh 是全部六层门禁的地基:tcase/tfinish/suite_absorb/run_with_timeout
# 的状态分类错了,所有层的通过/失败结论都不可信。这里用隔离 RESULT_DIR
# 逐个验证关键语义(被忽略的失败测试等于没有测试)。
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# ── 1. tcase / tfinish 的状态分类与落盘 ──────────────────────────────────
RESULT_DIR="$TMP/r1" bash -c '
    source "'"$(cd "$(dirname "$0")/.." && pwd)"'/lib.sh"
    suite_begin "t-lib"
    tcase "会过" true
    tcase "会挂" false
    tcase "会跳" false
    tskip "显式跳过" "缺依赖"
    tfinish >/dev/null 2>&1
' || true
[ -f "$TMP/r1/t-lib.status" ] || fail "tfinish 没写状态文件"
grep -q '^suite=t-lib$' "$TMP/r1/t-lib.status" || fail "状态文件缺 suite 行"
grep -q '^passed=1$' "$TMP/r1/t-lib.status" || fail "passed 计数错"
grep -q '^failed=2$' "$TMP/r1/t-lib.status" || fail "failed 计数错"
grep -q '^skipped=1$' "$TMP/r1/t-lib.status" || fail "skipped 计数错"
grep -q '^status=fail$' "$TMP/r1/t-lib.status" || fail "有失败时 status 应为 fail"
grep -q $'^PASS\t会过$' "$TMP/r1/t-lib.cases" || fail "PASS 用例未落盘(空输出应无 reason 列)"
grep -q $'^FAIL\t会挂$' "$TMP/r1/t-lib.cases" || fail "FAIL 用例未落盘"
grep -q $'^SKIP\t显式跳过\t缺依赖$' "$TMP/r1/t-lib.cases" || fail "SKIP 用例未落盘或缺原因"

# tcase 的 PASS reason:空输出 → 无 reason 列;有输出 → 取最后非空行。
RESULT_DIR="$TMP/r2" bash -c '
    source "'"$(cd "$(dirname "$0")/.." && pwd)"'/lib.sh"
    suite_begin "t-reason"
    loud() { echo "第一行"; echo ""; echo "末行才是摘要"; }
    tcase "带输出的用例" loud
    tcase "无输出的用例" true
    tfinish >/dev/null
' || fail "全 PASS 的套件不应失败"
grep -q $'^PASS\t带输出的用例\t末行才是摘要$' "$TMP/r2/t-reason.cases" || fail "PASS reason 未取输出末行"
grep -q $'^PASS\t无输出的用例$' "$TMP/r2/t-reason.cases" || fail "空输出 PASS 不应带空 reason 列(尾随 tab)"

# ── 2. tfinish 的「零用例 = fail」护栏 ───────────────────────────────────
RESULT_DIR="$TMP/r3" bash -c '
    source "'"$(cd "$(dirname "$0")/.." && pwd)"'/lib.sh"
    suite_begin "t-empty"
    tfinish >/dev/null 2>&1
    exit $?
' && fail "零用例的套件应该退出非零(tfinish 护栏)"
grep -q '^status=fail$' "$TMP/r3/t-empty.status" || fail "零用例套件的 status 应为 fail"

# 全 SKIP → status=skip(不是 fail,也不是 pass)。
RESULT_DIR="$TMP/r4" bash -c '
    source "'"$(cd "$(dirname "$0")/.." && pwd)"'/lib.sh"
    suite_begin "t-skip"
    tskip "a" "x"
    tskip "b" "y"
    tfinish >/dev/null
'
grep -q '^status=skip$' "$TMP/r4/t-skip.status" || fail "全 SKIP 套件的 status 应为 skip"

# ── 3. suite_absorb 折叠(分析器输出的三种状态)──────────────────────────
RESULT_DIR="$TMP/r5" bash -c '
    source "'"$(cd "$(dirname "$0")/.." && pwd)"'/lib.sh"
    suite_begin "t-absorb"
    printf '"'"'PASS\t外部过\t某摘要\nFAIL\t外部挂\t原因\nSKIP\t外部跳\t缺依赖\n'"'"' > "'"${TMP}"'/absorb.in"
    suite_absorb "'"${TMP}"'/absorb.in"
    tfinish >/dev/null 2>&1
    exit $?
' && fail "含 FAIL 的 absorb 应退出非零"
grep -q '^failed=1$' "$TMP/r5/t-absorb.status" || fail "absorb 的 FAIL 未计数"
grep -q $'^PASS\t外部过\t某摘要$' "$TMP/r5/t-absorb.cases" || fail "absorb 的 PASS reason 未透传"

# ── 4. run_with_timeout 的超时语义(124 = 按超时杀)────────────────────────
RESULT_DIR="$TMP/r6" bash -c '
    source "'"$(cd "$(dirname "$0")/.." && pwd)"'/lib.sh"
    run_with_timeout 1 sleep 30
    exit $?
'
[ "$?" = "124" ] || fail "run_with_timeout 超时应返回 124"

# 正常完成的命令透传退出码。
RESULT_DIR="$TMP/r7" bash -c '
    source "'"$(cd "$(dirname "$0")/.." && pwd)"'/lib.sh"
    run_with_timeout 5 sh -c "exit 7"
    exit $?
'
[ "$?" = "7" ] || fail "run_with_timeout 应透传子命令退出码"

echo "lib.test.sh self-test: ok"
