#!/usr/bin/env bash
# tests/run_all.sh —— 发布门禁总入口。
#
# 用法:
#   ./tests/run_all.sh                 # 全部分层
#   ./tests/run_all.sh static          # 只跑静态审查层
#   ./tests/run_all.sh frontend        # 只跑前端行为层
#   ./tests/run_all.sh backend         # 只跑真后端能力覆盖层
#   ./tests/run_all.sh artifact        # 只跑发布产物审查层
#   ./tests/run_all.sh e2e             # 只跑真窗口 E2E + 视觉回归层
#   REFLECT_LIVE=1 ./tests/run_all.sh live   # 只跑实模型演练层(真免费模型)
#
# ## 分层模型
#
#   L1 static-audit   源码与仓库状态审查(命令面 / 文档 / 版本 / 卫生)
#   L2 frontend       真实前端的行为测试(typecheck + vitest 全量)
#   L3 backend        **真实后端**能力覆盖层(mock runtime 驱动真实命令体)
#   L4 artifact       发布产物审查(.app / .dmg / .deb / .msi 结构与内容)
#   L5 e2e            真窗口冒烟(tauri-driver)+ 视觉回归(路由 × 主题截图);依赖缺失时整层可跳过
#   L6 live           **真免费模型**演练层(真实 provider + 真实 SSE);默认跳过,需 REFLECT_LIVE=1
#
# L2 的后端是模拟的(fakeBackend),L3 的后端是真的。两者合起来才覆盖
# 完整功能面 —— 与 submodule「能力覆盖层 + SDK 绑定层」的分层同理。
#
# L6 补的是 L3 补不了的那一环:真实模型 / 真实网络 / 真实限流。
#
# 退出码 0 = 所选套件没有阻断项;非 0 = 存在阻断项。
# 报告落在 `$RESULT_DIR/release-review.md`(默认 `.test-results/`)。

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

cd "$ROOT"

# 报告的 HEAD 不足以标识被测代码：本地修改和子模块工作树也会参与构建。
workspace_state() {
    local state
    if ! state=$(git -C "$ROOT" status --porcelain --untracked-files=normal --ignore-submodules=none 2>/dev/null); then
        printf '未知(无法读取 Git 状态)'
    elif [ -n "$state" ]; then
        printf '有未提交或未跟踪变更'
    else
        printf '干净'
    fi
}
WORKSPACE_BEFORE="$(workspace_state)"

ALL_SUITES=(static frontend backend artifact e2e live)
SUITES=("${ALL_SUITES[@]}")
if [ $# -gt 0 ]; then
    SUITES=()
    seen_suites=" "
    for arg in "$@"; do
        case "$arg" in
            static|frontend|backend|artifact|e2e|live)
                case "$seen_suites" in
                    *" $arg "*) echo "重复套件:$arg" >&2; exit 2 ;;
                esac
                seen_suites="$seen_suites$arg "
                SUITES+=("$arg")
                ;;
            *)
                echo "未知套件:$arg(可选:static / frontend / backend / artifact / e2e / live)" >&2
                exit 2
                ;;
        esac
    done
fi

# 同一结果目录只允许一个总入口运行，防止相互删除或覆盖结果。
mkdir -p "$RESULT_DIR" || exit 1
LOCK_DIR="$RESULT_DIR/.release-gate.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "结果目录正在使用或存在未清理的锁:${LOCK_DIR}；并行运行请使用独立 RESULT_DIR" >&2
    exit 1
fi
cleanup_gate_lock() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup_gate_lock EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# 清掉上一轮的逐套件结果(只删本目录内我们自己写的结果文件)。
find "$RESULT_DIR" -maxdepth 1 -type f \( -name '*.status' -o -name '*.cases' -o -name '*.analyze' \) -delete 2>/dev/null || true

OVERALL=0
declare -a SUITE_NAMES=()
declare -a SUITE_SUMMARY=()
declare -a SUITE_FILES=()
declare -a SUITE_STATUS=()

# 校验状态文件与逐用例明细，防止 runner 退出 0 却报告失败或结果不完整。
validate_result() {
    local name="$1" status_file="$RESULT_DIR/$1.status" cases="$RESULT_DIR/$1.cases"
    [ -f "$status_file" ] && [ -f "$cases" ] || return 1
    awk -F '\t' '
        NR == FNR {
            split($0, field, "=")
            if (field[1] == "suite") suite = field[2]
            if (field[1] == "passed") p = field[2]
            if (field[1] == "failed") f = field[2]
            if (field[1] == "skipped") s = field[2]
            if (field[1] == "status") status = field[2]
            next
        }
        $1 == "PASS" { passed++; next }
        $1 == "FAIL" { failed++; next }
        $1 == "SKIP" { skipped++; next }
        $1 == "INFO" { next }
        { invalid = 1 }
        END {
            if (suite != expected || p !~ /^[0-9]+$/ || f !~ /^[0-9]+$/ ||
                s !~ /^[0-9]+$/ || invalid || p != passed || f != failed ||
                s != skipped) exit 1
            if (f > 0 || p + s == 0) expected_status = "fail"
            else if (p == 0) expected_status = "skip"
            else expected_status = "pass"
            if (status != expected_status) exit 1
        }
    ' expected="$name" "$status_file" "$cases"
}

for suite in "${SUITES[@]}"; do
    runner="$HERE/$suite/run.sh"
    echo
    echo "╔══════════════════════════════════════════════════╗"
    echo "  门禁层:$suite"
    echo "╚══════════════════════════════════════════════════╝"
    runner_status=0
    bash "$runner" || runner_status=$?
    SUITE_NAMES+=("$suite")
    SUITE_SUMMARY+=("$(summarize_suite "$suite")")
    if [ -f "$RESULT_DIR/$suite.status" ]; then
        suite_file="$suite"
    else
        match=$(find "$RESULT_DIR" -maxdepth 1 -name "$suite-*.status" 2>/dev/null | head -1)
        if [ -n "$match" ]; then
            suite_file="$(basename "$match" .status)"
        else
            suite_file=""
        fi
    fi
    SUITE_FILES+=("$suite_file")
    status="fail"
    if [ -z "$suite_file" ] || ! validate_result "$suite_file"; then
        echo "  ⚠️  套件结果缺失或与用例明细不一致 —— 视为失败"
    elif [ "$runner_status" -ne 0 ]; then
        echo "  ⚠️  套件异常退出($runner_status) —— 视为失败"
    else
        status="$(suite_status "$suite")"
    fi
    SUITE_STATUS+=("$status")
    [ "$status" = "fail" ] && OVERALL=1
done

# ── 汇总统计(报告块之前算好,供报告与终端两处消费)───────────────────────
SKIPPED_LAYERS=0
for i in "${!SUITE_NAMES[@]}"; do
    [ "${SUITE_STATUS[$i]}" = "skip" ] && SKIPPED_LAYERS=$((SKIPPED_LAYERS + 1))
done

# 层内跳过统计与明细:整层跑过但个别用例因缺工具/缺依赖跳过 —— 发布结论
# 必须让「没真正审过」的部分可见,而不是埋在逐用例列表里。
SKIPPED_CASES=0
SKIP_DETAIL=""
for i in "${!SUITE_NAMES[@]}"; do
    suite_file="${SUITE_FILES[$i]}"
    [ -n "$suite_file" ] && [ -f "$RESULT_DIR/$suite_file.cases" ] || continue
    skips=$(grep -c $'^SKIP\t' "$RESULT_DIR/$suite_file.cases" 2>/dev/null || true)
    [ "${skips:-0}" -gt 0 ] || continue
    SKIPPED_CASES=$((SKIPPED_CASES + skips))
    SKIP_DETAIL="${SKIP_DETAIL}- \`${SUITE_NAMES[$i]}\`:${skips} 条
"
    SKIP_DETAIL="${SKIP_DETAIL}$(grep $'^SKIP\t' "$RESULT_DIR/$suite_file.cases" | sed 's/^SKIP\t/  - /' | cut -c1-160)
"
done

# GATE_STRICT=1(发布流水线可选):跳过 = 没真正审过 = 不允许发布。
# 覆盖两层语义:整层 SKIP(依赖缺失整层没跑)与层内 SKIP(个别用例缺
# 工具)。默认 0 保持既有行为(跳过不算失败,报告标注)。
if [ "${GATE_STRICT:-0}" = "1" ]; then
    if [ "$SKIPPED_LAYERS" -gt 0 ]; then
        echo "  ⛔ GATE_STRICT=1:$SKIPPED_LAYERS 层整层未跑 —— 判失败"
        OVERALL=1
    fi
    if [ "$SKIPPED_CASES" -gt 0 ]; then
        echo "  ⛔ GATE_STRICT=1:层内有 $SKIPPED_CASES 条跳过 —— 判失败"
        OVERALL=1
    fi
fi

# ── 发布审查报告 ──────────────────────────────────────────────────────────
REPORT="$RESULT_DIR/release-review.md"
{
    echo "# 发布审查报告"
    echo
    echo "生成时间:$(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "提交:$(git rev-parse --short HEAD 2>/dev/null || echo '未知')"
    echo "分支:$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '未知')"
    echo "工作区(运行前):$WORKSPACE_BEFORE"
    echo "工作区(运行后):$(workspace_state)"
    submodule_status=$(git submodule status zhuye-agent 2>/dev/null) || submodule_status="未知"
    echo "submodule:${submodule_status:-未知}"
    echo
    echo "## 分层结果"
    echo
    echo "| 层 | 套件 | 结果 | 摘要 |"
    echo "|---|---|---|---|"
    for i in "${!SUITE_NAMES[@]}"; do
        suite_file="${SUITE_FILES[$i]}"
        if [ "${GATE_STRICT:-0}" = "1" ] && [ -n "$suite_file" ] &&
           [ -f "$RESULT_DIR/$suite_file.cases" ] &&
           grep -q $'^SKIP\t' "$RESULT_DIR/$suite_file.cases"; then
            mark="❌ 严格门禁未通过"
        else
            case "${SUITE_STATUS[$i]}" in
                pass) mark="✅ 通过" ;;
                skip) mark="⏭ 跳过" ;;
                *)     mark="❌ 失败" ;;
            esac
        fi
        echo "| $((i + 1)) | \`${SUITE_NAMES[$i]}\` | $mark | ${SUITE_SUMMARY[$i]} |"
    done
    echo
    if [ "$OVERALL" -ne 0 ]; then
        echo "**结论:存在阻断项 —— 禁止发布。**"
    elif [ "${#SUITE_NAMES[@]}" -lt "${#ALL_SUITES[@]}" ]; then
        echo "**结论:所选套件无阻断项；本次只运行了部分套件，不能据此判定完整发布门禁。**"
    elif [ "$SKIPPED_LAYERS" -gt 0 ]; then
        echo "**结论:无阻断项,但有 $SKIPPED_LAYERS 层未真正审过(标记为 ⏭ 跳过)"
        echo "—— 发布前请补跑那些层。**"
    elif [ "$SKIPPED_CASES" -gt 0 ]; then
        echo "**结论:无阻断项;有 $SKIPPED_CASES 条用例在层内跳过(未真正审过,"
        echo "明细见下)。设 GATE_STRICT=1 可把跳过升级为失败。**"
    else
        echo "**结论:全部通过 —— 允许发布。**"
    fi
    echo
    echo "> 「⏭ 跳过」= 该层因依赖缺失而**没有真正跑**(如本地未构建产物时的"
    echo "> 产物审查层)。发布流水线里产物审查是必跑的,不会跳过;"
    echo "> GATE_STRICT=1 时任何跳过(整层或层内)都判失败。"
    echo
    echo "## 层内跳过明细"
    echo
    if [ -n "$SKIP_DETAIL" ]; then
        printf '%s\n' "$SKIP_DETAIL"
    else
        echo "(无)"
    fi
    echo
    echo "## 逐用例明细"
    echo
    for i in "${!SUITE_NAMES[@]}"; do
        suite_file="${SUITE_FILES[$i]}"
        cases="$RESULT_DIR/$suite_file.cases"
        [ -n "$suite_file" ] && [ -f "$cases" ] || continue
        echo "### \`${SUITE_NAMES[$i]}\`"
        echo
        echo '```'
        cat "$cases"
        echo '```'
        echo
    done
    echo "---"
    echo
    echo "逐层日志见 \`$RESULT_DIR/\`;覆盖口径见 [tests/COVERAGE.md](tests/COVERAGE.md)。"
} > "$REPORT"

echo
if [ "$OVERALL" -ne 0 ]; then
    echo "══════════════ 发布门禁:存在失败(禁止发布)══════════════"
elif [ "${#SUITE_NAMES[@]}" -lt "${#ALL_SUITES[@]}" ]; then
    echo "══════════════ 所选套件无阻断项(未运行完整门禁)══════════════"
elif [ "$SKIPPED_LAYERS" -gt 0 ]; then
    echo "══════════════ 发布门禁:无阻断项,但有 $SKIPPED_LAYERS 层未真正审过 ══════════════"
elif [ "$SKIPPED_CASES" -gt 0 ]; then
    echo "══════════════ 发布门禁:无阻断项,$SKIPPED_CASES 条用例层内跳过 ══════════════"
else
    echo "══════════════ 发布门禁:全部通过 ══════════════"
fi
echo "报告:$REPORT"
exit "$OVERALL"
