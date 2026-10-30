#!/usr/bin/env bash
# tests/static/run.sh —— 静态审查层(发布门禁 L1)。
#
# 这一层测的是**源码与仓库状态**,不跑任何运行时:
#   1. 命令面四方一致(后端实现 ↔ lib.rs 注册表 ↔ 前端包装 ↔ 文档);
#   2. 路由 ↔ 视图文件、命名空间 ↔ barrel 等"接线"完整性;
#   3. 版本号四处一致、CHANGELOG / 能力矩阵新鲜度;
#   4. 仓库卫生(无垃圾文件入库、子模块指针已提交、无硬编码密钥、
#      无调试残留、生产文件大小预算棘轮)。
#
# 设计取舍:命令面比对是**全量**而非抽样 —— grep 只能给出"看起来对"的
# 结论,真正的交叉比对交给 Node 分析器(`tests/static/analyze.mjs`),
# shell 只做编排与仓库状态检查。
#
# 退出码 0 = 全部通过。缺 node 时整层 SKIP(不算失败)。

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib.sh"

cd "$ROOT"

suite_begin "static-audit"

if ! require_cmd node; then
    tskip "static-audit" "未安装 node,静态审查层跳过"
    tfinish
    exit 0
fi

# ── 1. 源码级交叉比对(Node 分析器)────────────────────────────────────────
# 分析器自身崩了必须**响亮**地失败 —— 否则"分析器没跑"会被当成
# "分析器没发现问题",门禁就成了摆设。
ANALYZE_OUT="$RESULT_DIR/static-audit.analyze"
ANALYZE_LOG="$RESULT_DIR/static-audit-analyze.log"
rm -f "$ANALYZE_OUT"
analyze_status=0
node "$HERE/analyze.mjs" "$ANALYZE_OUT" > "$ANALYZE_LOG" 2>&1 || analyze_status=$?
# 分析器用 1 表示检查失败；它仍应输出逐项结果。其它退出码或
# 状态与结果不一致表示分析器异常，不能读取上次残留的报告。
if [ -s "$ANALYZE_OUT" ] && { { [ "$analyze_status" -eq 0 ] && ! grep -q $'^FAIL\t' "$ANALYZE_OUT"; } || { [ "$analyze_status" -eq 1 ] && grep -q $'^FAIL\t' "$ANALYZE_OUT"; }; }; then
    suite_absorb "$ANALYZE_OUT"
else
    tcase "静态分析器运行" false
    if [ -s "$ANALYZE_LOG" ]; then
        tail -20 "$ANALYZE_LOG" | sed 's/^/         │ /'
    fi
fi

# ── 2. 版本号四处一致 ────────────────────────────────────────────────────
check_versions() {
    local pkg cargo_root cargo_tauri tauri_conf
    pkg=$(node -p "require('./package.json').version" 2>/dev/null) || return 1
    cargo_root=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
    # src-tauri 用 `version.workspace = true` 继承根清单。
    if grep -q '^version.workspace = true' src-tauri/Cargo.toml; then
        cargo_tauri="$cargo_root"
    else
        cargo_tauri=$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)
    fi
    tauri_conf=$(node -p "require('./src-tauri/tauri.conf.json').version" 2>/dev/null) || return 1
    if [ "$pkg" = "$cargo_root" ] && [ "$pkg" = "$cargo_tauri" ] && [ "$pkg" = "$tauri_conf" ]; then
        echo "版本一致:$pkg(package.json / Cargo.toml / src-tauri / tauri.conf.json)"
        return 0
    fi
    echo "版本不一致:package.json=$pkg Cargo.toml=$cargo_root src-tauri=$cargo_tauri tauri.conf.json=$tauri_conf"
    return 1
}
tcase "版本号四处一致(package.json / Cargo.toml / src-tauri / tauri.conf.json)" check_versions

# ── 3. CHANGELOG 覆盖当前版本 ────────────────────────────────────────────
check_changelog() {
    local version
    version=$(node -p "require('./package.json').version" 2>/dev/null) || return 1
    if grep -qE "^## +v?${version}\b" docs/CHANGELOG.md; then
        echo "CHANGELOG 含 $version 条目"
        return 0
    fi
    echo "CHANGELOG.md 缺少版本 $version 的条目(发布前需补 ## v$version)"
    return 1
}
tcase "CHANGELOG 覆盖当前版本" check_changelog

# ── 4. 能力矩阵新鲜度(审计到的 submodule commit 与实际一致)──────────────
check_capabilities_fresh() {
    local status marker full_sha sha
    status=$(git -C "$ROOT" submodule status reflect-agent 2>/dev/null) || { echo "读不到 reflect-agent submodule 状态"; return 1; }
    marker=${status:0:1}
    full_sha=${status:1:40}
    if [ "$marker" = '-' ] || [ "$marker" = 'U' ]; then
        echo "reflect-agent submodule 未初始化或存在冲突"
        return 1
    fi
    if [ "$marker" != ' ' ] && [ "$marker" != '+' ]; then
        echo "reflect-agent submodule 状态标记无效"
        return 1
    fi
    if [[ ! "$full_sha" =~ ^[[:xdigit:]]{40}$ ]]; then
        echo "reflect-agent submodule 状态格式无效"
        return 1
    fi
    sha=${full_sha:0:7}
    if grep -Fq "$sha" docs/CAPABILITIES.md; then
        echo "docs/CAPABILITIES.md 已覆盖 submodule $sha"
        return 0
    fi
    echo "docs/CAPABILITIES.md 未提及当前 submodule $sha —— 能力矩阵已过期"
    return 1
}
tcase "能力矩阵与 submodule 版本一致" check_capabilities_fresh

# ── 5. 子模块指针已提交(未提交 = 发布产物不可复现)───────────────────────
check_submodule_committed() {
    if git -C "$ROOT" diff --quiet --ignore-submodules=none --submodule=short HEAD -- reflect-agent 2>/dev/null; then
        echo "reflect-agent submodule 指针已提交"
        return 0
    fi
    echo "reflect-agent submodule 指针有未提交改动 —— 发布产物不可复现"
    return 1
}
tcase "submodule 指针已提交" check_submodule_committed

# ── 6. 仓库卫生:无垃圾文件入库 ───────────────────────────────────────────
check_no_junk() {
    local junk
    junk=$(git -C "$ROOT" ls-files | grep -E '(^|/)node_modules/|\.DS_Store$|^dist/|^target/' || true)
    if [ -z "$junk" ]; then
        echo "无垃圾文件入库"
        return 0
    fi
    echo "以下文件不应入库:$(echo "$junk" | head -5 | tr '\n' ' ')"
    return 1
}
tcase "无垃圾文件入库(node_modules / .DS_Store / dist / target)" check_no_junk

# ── 7. 协议文档与代码地图存在 ────────────────────────────────────────────
check_docs_exist() {
    local missing=""
    for f in docs/PROTOCOL_BRIDGE.md docs/CAPABILITIES.md docs/codebase-map.md docs/CHANGELOG.md; do
        [ -s "$ROOT/$f" ] || missing="$missing $f"
    done
    if [ -z "$missing" ]; then
        echo "协议 / 能力 / 地图 / 变更日志四份文档齐备"
        return 0
    fi
    echo "缺失或为空:$missing"
    return 1
}
tcase "发布必备文档齐备" check_docs_exist

# ── 8. 工具链锁定 ────────────────────────────────────────────────────────
check_toolchain() {
    if [ -s "$ROOT/rust-toolchain.toml" ] && [ -s "$ROOT/package.json" ]; then
        echo "工具链已锁定(rust-toolchain.toml + package.json)"
        return 0
    fi
    echo "缺少 rust-toolchain.toml 或 package.json —— 构建不可复现"
    return 1
}
tcase "工具链锁定" check_toolchain

tfinish
