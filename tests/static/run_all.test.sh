#!/usr/bin/env bash
# 验证总入口聚合真实 runner 的退出码、结果文件、跳过和报告范围。
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# 用隔离仓库布置可控 runner，实际执行生产 run_all.sh 和 lib.sh。
FIXTURE="$TMP/repo"
mkdir -p "$FIXTURE/tests"
cp "$ROOT/tests/run_all.sh" "$ROOT/tests/lib.sh" "$FIXTURE/tests/"
for suite in static frontend backend artifact e2e live; do
    mkdir -p "$FIXTURE/tests/$suite"
    cat > "$FIXTURE/tests/$suite/run.sh" <<'RUNNER'
#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
suite="$(basename "$(dirname "$0")")"
suite_begin "$suite"
case "${FAKE_RESULT:-pass}" in
    pass) tcase test true; tfinish ;;
    skip) tskip test missing; tfinish ;;
    fail_zero) tcase test false; tfinish || true; exit 0 ;;
    pass_nonzero) tcase test true; tfinish; exit 7 ;;
    invalid) tcase test true; tfinish; printf 'status=pass\n' > "$RESULT_DIR/$suite.status" ;;
    missing) exit 0 ;;
    hold) : > "$HOLD_READY"; read -r _ < "$HOLD_FIFO"; tcase test true; tfinish ;;
esac
RUNNER
done

# 单独 Git 仓库验证报告区分干净、已修改和未跟踪状态。
git -C "$FIXTURE" init -q || fail "初始化夹具仓库失败"
git -C "$FIXTURE" add tests || fail "添加夹具失败"
git -C "$FIXTURE" -c user.name=Test -c user.email=test@example.invalid commit -qm fixture || fail "提交夹具失败"

run_gate() {
    RESULT_DIR="$TMP/results" bash "$FIXTURE/tests/run_all.sh" "$@" > "$TMP/gate.log" 2>&1
}
run_gate not-a-suite; rc=$?
[ "$rc" = 2 ] || fail "未知套件应退出 2，实际 $rc"
run_gate static static; rc=$?
[ "$rc" = 2 ] || fail "重复套件应退出 2，实际 $rc"

run_gate static || fail "部分套件应成功"
grep -q '工作区(运行前):干净' "$TMP/results/release-review.md" || fail "干净工作区应在报告中标明"
printf '# changed\n' >> "$FIXTURE/tests/static/run.sh"
run_gate static || fail "已修改工作区应能运行"
grep -q '工作区(运行前):有未提交或未跟踪变更' "$TMP/results/release-review.md" || fail "已修改工作区应在报告中标明"
git -C "$FIXTURE" checkout -- tests/static/run.sh || fail "恢复夹具失败"
touch "$FIXTURE/untracked"
run_gate static || fail "含未跟踪文件的工作区应能运行"
grep -q '工作区(运行前):有未提交或未跟踪变更' "$TMP/results/release-review.md" || fail "未跟踪文件应在报告中标明"
grep -q '只运行了部分套件' "$TMP/results/release-review.md" || fail "部分套件应标明范围"
if grep -q '允许发布' "$TMP/results/release-review.md"; then fail "部分套件不能宣称允许发布"; fi
for section in '## 分层结果' '## 层内跳过明细' '## 逐用例明细'; do
    grep -qF "$section" "$TMP/results/release-review.md" || fail "报告缺段落:$section"
done
GATE_STRICT=1 run_gate static || fail "无跳过时严格模式不应失败"
FAKE_RESULT=skip run_gate static || fail "普通模式允许显式跳过"
if FAKE_RESULT=skip GATE_STRICT=1 run_gate static; then fail "严格模式必须拒绝跳过"; fi
grep -q '❌ 严格门禁未通过' "$TMP/results/release-review.md" || fail "严格模式报告须标明跳过导致的失败"
for result in fail_zero pass_nonzero invalid missing; do
    if FAKE_RESULT="$result" run_gate static; then fail "$result 不应放行"; fi
    grep -q '禁止发布' "$TMP/results/release-review.md" || fail "$result 报告应判失败"
    grep -q '❌ 失败' "$TMP/results/release-review.md" || fail "$result 对应层应标失败"
done
run_gate || fail "全部套件通过时应成功"
grep -q '允许发布' "$TMP/results/release-review.md" || fail "完整门禁全绿才允许发布"

# 并发运行同一目录应拒绝后者，不能清掉前者的结果；不同目录仍可运行。
mkfifo "$TMP/hold.fifo"
FAKE_RESULT=hold HOLD_READY="$TMP/ready" HOLD_FIFO="$TMP/hold.fifo" run_gate static &
first_pid=$!
for _ in $(seq 1 100); do
    [ -f "$TMP/ready" ] && break
    sleep 0.05
done
[ -f "$TMP/ready" ] || fail "并发夹具未就绪"
if RESULT_DIR="$TMP/results" bash "$FIXTURE/tests/run_all.sh" frontend > "$TMP/second.log" 2>&1; then fail "相同目录的并发运行必须失败"; fi
grep -q '结果目录正在使用' "$TMP/second.log" || { cat "$TMP/second.log" >&2; fail "并发失败必须说明原因"; }
RESULT_DIR="$TMP/other-results" bash "$FIXTURE/tests/run_all.sh" frontend > "$TMP/other.log" 2>&1 || fail "不同目录应可并行运行"
printf 'continue\n' > "$TMP/hold.fifo"
wait "$first_pid" || fail "持锁运行应正常完成"
[ ! -e "$TMP/results/.release-gate.lock" ] || fail "运行结束必须释放锁"
echo "run_all.test.sh self-test: ok"
