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
# 退出码 0 = 全部通过(可发布);非 0 = 存在阻断项(禁止发布)。
# 报告落在 `$RESULT_DIR/release-review.md`(默认 `.test-results/`)。

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

cd "$ROOT"

ALL_SUITES=(static frontend backend artifact e2e live)
SUITES=("${ALL_SUITES[@]}")
if [ $# -gt 0 ]; then
    SUITES=()
    for arg in "$@"; do
        case "$arg" in
            static|frontend|backend|artifact|e2e|live) SUITES+=("$arg") ;;
            *)
                echo "未知套件:$arg(可选:static / frontend / backend / artifact / e2e / live)" >&2
                exit 2
                ;;
        esac
    done
fi

# 清掉上一轮的逐套件结果(只删本目录内我们自己写的两类文件)。
mkdir -p "$RESULT_DIR"
find "$RESULT_DIR" -maxdepth 1 -type f \( -name '*.status' -o -name '*.cases' -o -name '*.analyze' \) -delete 2>/dev/null || true

OVERALL=0
declare -a SUITE_NAMES=()
declare -a SUITE_SUMMARY=()

for suite in "${SUITES[@]}"; do
    runner="$HERE/$suite/run.sh"
    echo
    echo "╔══════════════════════════════════════════════════╗"
    echo "  门禁层:$suite"
    echo "╚══════════════════════════════════════════════════╝"
    if ! bash "$runner"; then
        OVERALL=1
    fi
    SUITE_NAMES+=("$suite")
    SUITE_SUMMARY+=("$(summarize_suite "$suite")")
    # 退出码 0 还不够 —— 套件必须**真的写了结果文件**。一个崩在
    # `tfinish` 之前、或干脆忘了写的 runner 会留下 0 个结果文件却退出 0,
    # 那等于「什么都没审」却显示通过。缺结果文件 = 失败。
    if [ ! -f "$RESULT_DIR/$suite.status" ] &&
       [ -z "$(find "$RESULT_DIR" -maxdepth 1 -name "$suite-*.status" 2>/dev/null | head -1)" ]; then
        echo "  ⚠️  套件没有产出结果文件 —— 视为失败(套件可能提前崩了)"
        OVERALL=1
    fi
done

# 逐套件结果文件:层名与套件名可能不同(如层 `static` 的套件叫
# `static-audit`),所以先找精确名,再找 `<层名>-*` 前缀的。
# 找到的套件名回写到 SUITE_FILES,供报告逐用例明细用。
declare -a SUITE_FILES=()
for suite in "${SUITE_NAMES[@]}"; do
    if [ -f "$RESULT_DIR/$suite.status" ]; then
        SUITE_FILES+=("$suite")
    else
        match=$(find "$RESULT_DIR" -maxdepth 1 -name "$suite-*.status" 2>/dev/null | head -1)
        if [ -n "$match" ]; then
            SUITE_FILES+=("$(basename "$match" .status)")
        else
            SUITE_FILES+=("")
        fi
    fi
done

# ── 汇总统计(报告块之前算好,供报告与终端两处消费)───────────────────────
SKIPPED_LAYERS=0
for i in "${!SUITE_NAMES[@]}"; do
    [ "$(suite_status "${SUITE_NAMES[$i]}")" = "skip" ] && SKIPPED_LAYERS=$((SKIPPED_LAYERS + 1))
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
    echo "submodule:$(git submodule status zhuye-agent 2>/dev/null | awk '{print substr($1,1,7)}' || echo '未知')"
    echo
    echo "## 分层结果"
    echo
    echo "| 层 | 套件 | 结果 | 摘要 |"
    echo "|---|---|---|---|"
    for i in "${!SUITE_NAMES[@]}"; do
        case "$(suite_status "${SUITE_NAMES[$i]}")" in
            pass) mark="✅ 通过" ;;
            skip) mark="⏭ 跳过" ;;
            *)     mark="❌ 失败" ;;
        esac
        echo "| $((i + 1)) | \`${SUITE_NAMES[$i]}\` | $mark | ${SUITE_SUMMARY[$i]} |"
    done
    echo
    if [ "$OVERALL" -ne 0 ]; then
        echo "**结论:存在阻断项 —— 禁止发布。**"
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
elif [ "$SKIPPED_LAYERS" -gt 0 ]; then
    echo "══════════════ 发布门禁:无阻断项,但有 $SKIPPED_LAYERS 层未真正审过 ══════════════"
elif [ "$SKIPPED_CASES" -gt 0 ]; then
    echo "══════════════ 发布门禁:无阻断项,$SKIPPED_CASES 条用例层内跳过 ══════════════"
else
    echo "══════════════ 发布门禁:全部通过 ══════════════"
fi
echo "报告:$REPORT"
exit "$OVERALL"
