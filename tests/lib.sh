#!/usr/bin/env bash
# tests/lib.sh —— 发布测试套件公共助手。
#
# 所有 tests/ 下的脚本 source 本文件,获得:
#   - 仓库根 / 产物定位(TESTS_DIR / ROOT / DIST_DIR);
#   - 隔离环境:mktemp HOME + 独立 cwd,不污染真实 ~/.reflect;
#   - 断言助手(assert_* / tcase / tfinish);
#   - 便携超时(macOS 无 timeout/gtimeout,用后台 pid + kill 模拟);
#   - 用例统计与失败汇总,以及供发布审查报告消费的逐套件结果落盘。
#
# 约定:注释一律中文;脚本自身可独立执行;退出码 0 = 全部通过。

# ── 仓库根与产物定位 ────────────────────────────────────────────────────────
TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$TESTS_DIR/.." && pwd)"
# 构建产物目录(Tauri bundle 落点)。
DIST_DIR="${DIST_DIR:-$ROOT/target/release/bundle}"
# 逐套件结果落盘目录(供 run_all.sh 汇总成发布审查报告)。
RESULT_DIR="${RESULT_DIR:-$ROOT/.test-results}"

# ── 全局状态 ────────────────────────────────────────────────────────────────
declare -i PASS_COUNT=0
declare -i FAIL_COUNT=0
declare -i SKIP_COUNT=0
declare -a FAIL_NAMES=()
# 当前套件名(报告用);由 suite_begin 设置。
SUITE_NAME="${SUITE_NAME:-$(basename "${BASH_SOURCE[1]:-unknown}")}"

# ── 套件生命周期 ────────────────────────────────────────────────────────────

# suite_begin <套件名>:初始化计数与结果文件,打印横幅。
suite_begin() {
    SUITE_NAME="$1"
    PASS_COUNT=0
    FAIL_COUNT=0
    SKIP_COUNT=0
    FAIL_NAMES=()
    mkdir -p "$RESULT_DIR"
    : > "$RESULT_DIR/$SUITE_NAME.cases"
    echo
    echo "╔══════════════════════════════════════════════════╗"
    echo "  套件:$SUITE_NAME"
    echo "╚══════════════════════════════════════════════════╝"
}

# tcase <名称> <命令...>:执行一条用例,记录通过/失败。
# 命令可以是外部命令,也可以是本脚本定义的 shell 函数。
tcase() {
    local name="$1"
    shift
    local out
    if out="$("$@" 2>&1)"; then
        PASS_COUNT+=1
        echo "  [ok]   $name"
        printf 'PASS\t%s\n' "$name" >> "$RESULT_DIR/$SUITE_NAME.cases"
        return 0
    fi
    FAIL_COUNT+=1
    FAIL_NAMES+=("$name")
    echo "  [FAIL] $name"
    # 失败时把捕获的输出缩进打印 —— 定位根因的第一手材料。
    if [ -n "$out" ]; then
        printf '%s\n' "$out" | sed 's/^/         │ /' | head -40
    fi
    printf 'FAIL\t%s\n' "$name" >> "$RESULT_DIR/$SUITE_NAME.cases"
    return 1
}

# tcase_log <名称> <日志文件> <命令...>:执行一条用例,输出落日志文件。
# 失败时把日志尾部打出来 —— 长跑型命令(typecheck / vitest / cargo test)
# 的失败原因通常在末尾,直接打出来省一次手动翻日志。
tcase_log() {
    local name="$1" log="$2"
    shift 2
    mkdir -p "$(dirname "$log")"
    if "$@" > "$log" 2>&1; then
        PASS_COUNT+=1
        echo "  [ok]   $name"
        printf 'PASS\t%s\n' "$name" >> "$RESULT_DIR/$SUITE_NAME.cases"
        return 0
    fi
    FAIL_COUNT+=1
    FAIL_NAMES+=("$name")
    echo "  [FAIL] $name"
    if [ -s "$log" ]; then
        tail -40 "$log" | sed 's/^/         │ /'
    fi
    printf 'FAIL\t%s\n' "$name" >> "$RESULT_DIR/$SUITE_NAME.cases"
    return 1
}

# tskip <名称> <原因>:记一条跳过(工具缺失等),不算失败。
tskip() {
    local name="$1" reason="${2:-未说明}"
    SKIP_COUNT+=1
    echo "  [SKIP] $name —— $reason"
    printf 'SKIP\t%s\t%s\n' "$name" "$reason" >> "$RESULT_DIR/$SUITE_NAME.cases"
    return 0
}

# suite_absorb <结果文件>:把外部分析器产出的用例结果并入计数。
# 文件每行格式:
#   PASS\t<用例名>
#   FAIL\t<用例名>
#   SKIP\t<用例名>\t<原因>
# 与 tcase 写出的格式一致 —— 静态分析层用 Node 分析器产出,这里统一折叠。
suite_absorb() {
    local file="$1"
    [ -f "$file" ] || return 0
    local status name reason
    while IFS=$'\t' read -r status name reason; do
        case "$status" in
            PASS)
                PASS_COUNT+=1
                echo "  [ok]   $name${reason:+ —— $reason}"
                # 原因也落盘 —— 发布审查报告里能直接看到「这轮跑的是哪个
                # 模型 / 多少 token」,不必回翻日志。
                printf 'PASS\t%s%s\n' "$name" "${reason:+	$reason}" >> "$RESULT_DIR/$SUITE_NAME.cases"
                ;;
            FAIL)
                FAIL_COUNT+=1
                FAIL_NAMES+=("$name")
                echo "  [FAIL] $name${reason:+ —— $reason}"
                printf 'FAIL\t%s%s\n' "$name" "${reason:+	$reason}" >> "$RESULT_DIR/$SUITE_NAME.cases"
                ;;
            SKIP)
                SKIP_COUNT+=1
                echo "  [SKIP] $name —— ${reason:-未说明}"
                printf 'SKIP\t%s\t%s\n' "$name" "${reason:-}" >> "$RESULT_DIR/$SUITE_NAME.cases"
                ;;
        esac
    done < "$file"
    return 0
}

# tfinish:打印汇总、落盘套件结果,并返回汇总退出码(0=全过)。
tfinish() {
    local script_name="${1:-$SUITE_NAME}"
    echo
    echo "──────────────────────────────────────────"
    echo "  $script_name: $PASS_COUNT passed, $FAIL_COUNT failed, $SKIP_COUNT skipped"
    if [ "$FAIL_COUNT" -gt 0 ]; then
        printf '  失败用例: %s\n' "${FAIL_NAMES[*]}"
    fi
    local status
    if [ "$FAIL_COUNT" -gt 0 ]; then
        status=fail
    elif [ "$PASS_COUNT" -eq 0 ] && [ "$SKIP_COUNT" -eq 0 ]; then
        # **一条用例都没产出** —— 套件自己坏了(提前退出 / 忘了写用例)。
        # 这绝不能算「通过」:门禁会变成一个什么都不做的摆设。
        status=fail
        echo "  ⚠️  套件没有产出任何用例 —— 视为失败(套件本身可能坏了)"
    elif [ "$PASS_COUNT" -eq 0 ]; then
        # 整层因工具缺失而跳过 —— 报告里要能看出「没跑」而不是「跑过了」。
        status=skip
    else
        status=pass
    fi
    {
        echo "suite=$SUITE_NAME"
        echo "passed=$PASS_COUNT"
        echo "failed=$FAIL_COUNT"
        echo "skipped=$SKIP_COUNT"
        echo "status=$status"
        if [ "$FAIL_COUNT" -gt 0 ]; then
            printf 'failed_case=%s\n' "${FAIL_NAMES[@]}"
        fi
    } > "$RESULT_DIR/$SUITE_NAME.status"
    # 跳过**不是**失败 —— 本地没构建产物时产物审查层会整层跳过,不该把
    # 日常的 `tests/run_all.sh` 变成永远红。发布流水线里要它硬失败,用
    # `ARTIFACT_REQUIRED=1`(产物层支持)。
    [ "$status" != "fail" ]
}

# suite_status <层名>:读出套件的真实状态(pass / fail / skip)。
# 层名与套件名可能不同(层 `static` 的套件叫 `static-audit`)——
# 先找精确名,再找 `<层名>-*` 前缀的。
suite_status() {
    local suite="$1" status_file="$RESULT_DIR/$suite.status"
    if [ ! -f "$status_file" ]; then
        local match
        match=$(find "$RESULT_DIR" -maxdepth 1 -name "$suite-*.status" 2>/dev/null | head -1)
        [ -n "$match" ] && status_file="$match"
    fi
    if [ -f "$status_file" ]; then
        sed -n 's/^status=//p' "$status_file" | head -1
    else
        echo "unknown"
    fi
}

# summarize_suite <层名>:从结果文件拼一行摘要,供发布审查报告消费。
# 层名与套件名可能不同(层 `static` 的套件叫 `static-audit`)——
# 先找精确名,再找 `<层名>-*` 前缀的。
summarize_suite() {
    local suite="$1" status_file="$RESULT_DIR/$suite.status"
    if [ ! -f "$status_file" ]; then
        local match
        match=$(find "$RESULT_DIR" -maxdepth 1 -name "$suite-*.status" 2>/dev/null | head -1)
        [ -n "$match" ] && status_file="$match"
    fi
    if [ -f "$status_file" ]; then
        local p f s
        p=$(sed -n 's/^passed=//p' "$status_file")
        f=$(sed -n 's/^failed=//p' "$status_file")
        s=$(sed -n 's/^skipped=//p' "$status_file")
        echo "${p:-0} passed / ${f:-0} failed / ${s:-0} skipped"
    else
        echo "无结果"
    fi
}

# ── 断言助手(供脚本内的函数体使用,配合 tcase)───────────────────────────────

# assert_contains <子串> <文件>:文件包含子串。
assert_contains() {
    local needle="$1" file="$2"
    grep -qF -- "$needle" "$file"
}

# assert_not_contains <子串> <文件>:文件不含子串。
assert_not_contains() {
    local needle="$1" file="$2"
    ! grep -qF -- "$needle" "$file"
}

# assert_eq <期望> <实际>:字符串相等。
assert_eq() {
    [ "$1" = "$2" ]
}

# assert_file_exists <路径>:路径存在。
assert_file_exists() {
    [ -e "$1" ]
}

# assert_file_not_exists <路径>:路径不存在。
assert_file_not_exists() {
    [ ! -e "$1" ]
}

# assert_nonempty <值>:值非空。
assert_nonempty() {
    [ -n "${1:-}" ]
}

# assert_ge <实际> <下界>:实际 ≥ 下界(整数比较)。
assert_ge() {
    [ "${1:-0}" -ge "${2:-0}" ]
}

# assert_contains_count <子串> <文件> <最少命中数>:子串至少命中 N 次。
assert_contains_count() {
    local needle="$1" file="$2" least="$3"
    local n
    n=$(grep -cF -- "$needle" "$file" || true)
    [ "$n" -ge "$least" ]
}

# assert_json <jq 表达式> <jsonl 文件>:对 JSONL 逐行过滤后至少命中 1 条。
# 例:assert_json 'select(.msg.type=="turn_complete")' out.jsonl
assert_json() {
    local expr="$1" file="$2"
    if command -v jq >/dev/null 2>&1; then
        jq -e "$expr" "$file" >/dev/null 2>&1
    else
        python3 - "$expr" "$file" <<'PY' >/dev/null 2>&1
import json, sys
expr, path = sys.argv[1], sys.argv[2]
# 只支持 select(.a.b=="v") 形态的子集 —— 够用且不引第三方依赖。
needle = expr.strip()
if not (needle.startswith("select(") and needle.endswith(")")):
    sys.exit(1)
cond = needle[len("select("):-1].strip()
if "==" not in cond:
    sys.exit(1)
lhs, rhs = cond.split("==", 1)
rhs = rhs.strip().strip('"')
parts = lhs.strip().lstrip(".").split(".")
found = False
for line in open(path, encoding="utf-8"):
    line = line.strip()
    if not line:
        continue
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        continue
    cur = obj
    for p in parts:
        if not isinstance(cur, dict) or p not in cur:
            cur = None
            break
        cur = cur[p]
    if cur == rhs:
        found = True
        break
sys.exit(0 if found else 1)
PY
    fi
}

# ── 便携超时:run_with_timeout <秒> <命令...> ─────────────────────────────
# macOS 无 coreutils timeout;后台起进程,轮询等待,超时 SIGTERM+SIGKILL。
run_with_timeout() {
    local secs="$1"; shift
    "$@" &
    local pid=$!
    local waited=0
    while kill -0 "$pid" 2>/dev/null; do
        if [ "$waited" -ge "$secs" ]; then
            kill -TERM "$pid" 2>/dev/null
            sleep 1
            kill -9 "$pid" 2>/dev/null
            wait "$pid" 2>/dev/null
            return 124
        fi
        sleep 1
        waited=$((waited + 1))
    done
    wait "$pid"
}

# ── 隔离环境 ────────────────────────────────────────────────────────────────
# make_isolated_env:创建并进入隔离环境,设置:
#   ISO_HOME / ISO_CWD(导出 HOME、cd 进去)
#   预写 ~/.reflect/config.toml —— 空配置,关掉全部内置 hook。
#   真实后端命令读写 `~/.reflect/*`;不隔离就会污染开发者真实会话与记忆。
make_isolated_env() {
    ISO_HOME="$(mktemp -d "${TMPDIR:-/tmp}/reflect-desktop-test-home.XXXXXX")"
    ISO_CWD="$(mktemp -d "${TMPDIR:-/tmp}/reflect-desktop-test-cwd.XXXXXX")"
    mkdir -p "$ISO_HOME/.reflect"
    cat > "$ISO_HOME/.reflect/config.toml" <<'EOF'
# 测试用最小配置:关闭全部内置 hook(能力覆盖层只验行为语义,不验 hook 计时)
[hooks]
enabled = []
EOF
    export HOME="$ISO_HOME"
    cd "$ISO_CWD" || exit 1
}

# cleanup_isolated_env:清掉隔离目录(脚本 trap 里调用)。
cleanup_isolated_env() {
    [ -n "${ISO_HOME:-}" ] && rm -rf "$ISO_HOME"
    [ -n "${ISO_CWD:-}" ] && rm -rf "$ISO_CWD"
    return 0
}

# ── 依赖检查 ────────────────────────────────────────────────────────────────
# require_cmd <命令...>:缺少任一依赖命令则返回非零(调用方决定 SKIP 还是 FAIL)。
require_cmd() {
    local c
    for c in "$@"; do
        command -v "$c" >/dev/null 2>&1 || return 1
    done
    return 0
}

# require_node_deps:node_modules 是否就位(pnpm install 已跑过)。
require_node_deps() {
    [ -d "$ROOT/node_modules" ]
}

# require_cargo:cargo 是否可用。
require_cargo() {
    require_cmd cargo
}
