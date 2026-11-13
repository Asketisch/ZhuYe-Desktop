#!/usr/bin/env bash
# tests/backend/run.sh —— 真后端能力覆盖层(发布门禁 L3)。
#
# 这一层测的是**真后端**:
#   0. `cargo metadata` —— submodule 跨 workspace 解析(继承键完整的权威校验);
#   1. `cargo fmt --check` —— 本仓库自有 crate 的格式(不检查 submodule);
#   2. `cargo clippy --workspace --all-targets` —— 警告拒绝;
#   3. `cargo test --workspace --all-targets` —— 单元测试 + **能力覆盖层**。
#
# ## 能力覆盖层是什么
#
# `src-tauri/tests/ipc_*.rs` 用 `tauri::test` 的 mock runtime 建 app,
# 对**生产同一份** `generate_handler!` 注册表
# (`reflect_desktop_lib::configure`)注入 JSON 负载,断言真命令体返回的真结果。
# 不经前端 `invoke` 包装,不经 `tests/helpers/fakeBackend.ts`。
#
# 为什么必须有这一层:前端测试的后端是**模拟**的 —— 模拟后端的 bug 会把
# 真后端的 bug 遮住。与 submodule「能力覆盖层不经过任何 SDK」同理。
#
# 隔离:HOME / cwd 指向进程专属临时目录，清除继承的 ZHUYE_HOME
# (见 `src-tauri/tests/common/mod.rs`),不污染开发者的 `~/.zhuye`。
#
# 退出码 0 = 全部通过。

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib.sh"

cd "$ROOT"

suite_begin "backend"

# Cargo 仍使用开发者已安装的工具链和依赖缓存，测试进程的数据目录则隔离。
run_isolated_cargo() (
    export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
    export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
    if [ "$(uname -s)" = Darwin ]; then
        # Seatbelt 放行系统临时目录；HOME 必须位于其外才能验证禁止写 HOME。
        mkdir -p "$ROOT/.test-results/backend-homes" || return 1
        make_isolated_env "$ROOT/.test-results/backend-homes" || return 1
    else
        make_isolated_env || return 1
    fi
    trap cleanup_isolated_env EXIT
    # 所有后端子进程的临时文件都在本次工作目录内，退出时一并清理。
    mkdir -p "$ISO_CWD/tmp" || return 1
    export TMPDIR="$ISO_CWD/tmp"
    # 固定空隔离环境中的 Git 默认分支；不读取开发者或系统配置。
    printf '[init]\n\tdefaultBranch = master\n' > "$HOME/.gitconfig"
    export GIT_CONFIG_GLOBAL="$HOME/.gitconfig"
    export GIT_CONFIG_NOSYSTEM=1
    # 子模块源文件的路径相对桌面工作区，insta 检测到的上游根会重复拼接。
    # 断言失败仍需报告，不能在子模块写入或自动接受快照。
    export INSTA_WORKSPACE_ROOT="$ROOT"
    export INSTA_UPDATE=no
    # MCP 子进程清除 npm 环境变量，只保留 HOME/PATH；配置文件也必须离线。
    printf 'offline=true\nregistry=http://127.0.0.1:9/\ncache=%s/.npm\n' "$HOME" > "$HOME/.npmrc"
    export npm_config_offline=true NPM_CONFIG_OFFLINE=true
    export npm_config_cache="$HOME/.npm" NPM_CONFIG_CACHE="$HOME/.npm"
    export npm_config_registry="http://127.0.0.1:9/" NPM_CONFIG_REGISTRY="http://127.0.0.1:9/"
    cargo "$@"
)

if ! require_cmd cargo; then
    tskip "backend" "未安装 cargo,真后端层跳过"
    tfinish
    exit 0
fi

# ── 0. 跨 workspace 解析(submodule 继承键的权威校验)────────────────────
# L1 的清单奇偶校验是纯文本近似;这里让 cargo 自己说话:核心 crate 的
# `workspace = true` 全部解析到根清单,任何一个缺键都会让 metadata 对
# **整个工作区**报错(升级 submodule 后首个会断的地方)。只解析不编译,
# 秒级完成,放最前面 —— 这里断了后面 fmt/clippy/test 全无意义。
tcase_log "cargo metadata(submodule 跨 workspace 解析)" \
    "$RESULT_DIR/backend-metadata.log" \
    cargo metadata --no-deps --format-version 1 --quiet

# ── 1. 格式 ───────────────────────────────────────────────────────────────
# 只检查本仓库自有 crate(app-core + src-tauri):zhuye-agent/ submodule
# 的格式由上游 ZhuYe 仓库的 CI 负责,不该阻塞本仓库。
tcase_log "cargo fmt --check(自有 crate)" \
    "$RESULT_DIR/backend-fmt.log" \
    cargo fmt -p reflect-app-core -p reflect-desktop -- --check

# ── 2. clippy ────────────────────────────────────────────────────────────
tcase_log "cargo clippy --workspace --all-targets" \
    "$RESULT_DIR/backend-clippy.log" \
    cargo clippy --workspace --all-targets

# ── 3. 文档测试(rust-testing 技能:Testing Commands)─────────────────────
# `--all-targets` 不含 doctest(cargo 行为)—— `///` 注释里的 ```rust
# 代码块从没人跑,API 演进后示例悄悄腐烂。单独跑;当前基线 0 例,本用例
# 是绊网:今后写了示例,门禁自动开始验它。
tcase_log "cargo doc-test(/// 示例可编译可运行)" \
    "$RESULT_DIR/backend-doctest.log" \
    run_isolated_cargo test --manifest-path "$ROOT/Cargo.toml" --workspace --doc

# ── 4. 测试(单元 + 能力覆盖层)────────────────────────────────────────────
# --no-fail-fast:首个失败 binary 后其余 30+ 个测试 binary 照常跑 —— 失败
# 报告要的是全貌,不是第一块碎片(退出码仍非零,门禁不受影响)。
tcase_log "cargo test --workspace --all-targets(含能力覆盖层)" \
    "$RESULT_DIR/backend-test.log" \
    run_isolated_cargo test --manifest-path "$ROOT/Cargo.toml" --workspace --all-targets --no-fail-fast

# cargo 在部分 CI 环境下强制带色输出(CARGO_TERM_COLOR / TTY 探测),下游
# 纯文本解析器都会被 ANSI 序列打断:ignored.awk 的 `/^Running /` 行首锚定
# 匹配不到带色行(→ 忽略项 binary 判空、可选演练被误记 SKIP),集成目标
# 检查的 `Running tests/<t>.rs` grep 同理(→ 77 个目标全判漏跑)。统一剥掉
# ANSI,产物与解析用同一份日志,不影响审查。
sed 's/\x1b\[[0-9;]*m//g' "$RESULT_DIR/backend-test.log" > "$RESULT_DIR/backend-test.log.clean" &&
    mv "$RESULT_DIR/backend-test.log.clean" "$RESULT_DIR/backend-test.log"

# libtest 的 ignored 不影响 cargo 退出码，必须写入门禁结果。
# 两个 L6 入口及上游明确的外网演练由各自的可选路径负责；其他忽略项
# 是未执行的后端检查，严格门禁必须拒绝。
ignored_results="$RESULT_DIR/backend-ignored.analyze"
ignored_log="$RESULT_DIR/backend-ignored.log"
if awk -f "$HERE/ignored.awk" "$RESULT_DIR/backend-test.log" > "$ignored_results" 2> "$ignored_log"; then
    suite_absorb "$ignored_results"
    grep $'^INFO\t' "$ignored_results" >> "$RESULT_DIR/$SUITE_NAME.cases" || true
else
    tcase "Rust 测试忽略项解析器运行" false
    tail -20 "$ignored_log" | sed 's/^/         │ /'
fi

# Cargo 找不到测试目标时也可能成功退出；每个桌面集成测试目标必须实际运行。
check_integration_targets() {
    local missing="" target
    while IFS= read -r target; do
        if ! grep -q "Running tests/${target}\.rs" "$RESULT_DIR/backend-test.log"; then
            missing="$missing $target"
        fi
    done < <(find "$ROOT/src-tauri/tests" -maxdepth 1 -type f -name '*.rs' -exec basename {} .rs \; | sort)
    if [ -n "$missing" ]; then
        echo "未运行的桌面集成测试目标:$missing"
        return 1
    fi
    echo "桌面集成测试目标全部运行($(find "$ROOT/src-tauri/tests" -maxdepth 1 -type f -name '*.rs' | wc -l | tr -d ' ') 项)"
}
tcase "桌面集成测试目标全部运行" check_integration_targets

# 能力覆盖层的规模报出来 —— 报告里能直接看到真后端验了多少条命令。
if [ -f "$RESULT_DIR/backend-test.log" ]; then
    # 注意 grep -c 零匹配时输出 "0" 且退出码 1 —— 不能写 `|| echo 0`
    # (会把 "0\n0" 塞进变量,整数比较直接报错)。
    cap_count=$(grep -c '^test .* \.\.\. ok$' "$RESULT_DIR/backend-test.log" 2>/dev/null || true)
    cap_count=${cap_count:-0}
    if [ "$cap_count" -gt 0 ] 2>/dev/null; then
        echo "  ↳ 本次通过用例:$cap_count 条"
    fi
fi

# ── 5. 行覆盖报告(rust-testing 技能:Test Coverage;可选,装了才跑)───────
# 只出报告不设硬门槛:当前基线未知,先让数字进审查报告,阈值另议。
# llvm-cov 要以覆盖旗标重编全部 target,耗时长 —— 缺工具时跳过不算败。
if [ "${BACKEND_COVERAGE:-1}" = 0 ]; then
    echo "  [INFO] BACKEND_COVERAGE=0，未生成可选覆盖率报告"
    printf 'INFO\tcargo llvm-cov 行覆盖报告\tBACKEND_COVERAGE=0，未生成可选报告\n' >> "$RESULT_DIR/$SUITE_NAME.cases"
elif command -v cargo-llvm-cov >/dev/null 2>&1; then
    tcase_log "cargo llvm-cov 行覆盖报告(报告型,无门槛)" \
        "$RESULT_DIR/backend-coverage.log" \
        run_isolated_cargo llvm-cov --manifest-path "$ROOT/Cargo.toml" --workspace --all-targets --summary-only
else
    # 可选报告不是发布检查项，不计入门禁跳过；严格模式只针对实际要求的检查。
    echo "  [INFO] 未安装 cargo-llvm-cov，未生成可选覆盖率报告"
    printf 'INFO\tcargo llvm-cov 行覆盖报告\t未安装，未生成可选报告\n' >> "$RESULT_DIR/$SUITE_NAME.cases"
fi

tfinish
