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
# 隔离:HOME / REFLECT_HOME / cwd 全部指向进程专属临时目录
# (见 `src-tauri/tests/common/mod.rs`),不污染开发者的 `~/.zhuye`。
#
# 退出码 0 = 全部通过。

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib.sh"

cd "$ROOT"

suite_begin "backend"

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

# ── 3. 测试(单元 + 能力覆盖层)────────────────────────────────────────────
tcase_log "cargo test --workspace --all-targets(含能力覆盖层)" \
    "$RESULT_DIR/backend-test.log" \
    cargo test --workspace --all-targets

# 能力覆盖层的规模报出来 —— 报告里能直接看到真后端验了多少条命令。
if [ -f "$RESULT_DIR/backend-test.log" ]; then
    cap_count=$(grep -c '^test .* \.\.\. ok$' "$RESULT_DIR/backend-test.log" 2>/dev/null || echo 0)
    if [ "$cap_count" -gt 0 ]; then
        echo "  ↳ 本次通过用例:$cap_count 条"
    fi
fi

tfinish
