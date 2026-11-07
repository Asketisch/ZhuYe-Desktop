#!/usr/bin/env bash
# 验证 submodule 清单奇偶校验:完整镜像通过;缺键逐个点名并失败。
set -eu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. 真实清单:根完整镜像子模块 → 通过。
node "$HERE/manifest-parity.mjs" "$ROOT/zhuye-agent/Cargo.toml" "$ROOT/Cargo.toml" > "$TMP/ok.log"
grep -q '完整镜像' "$TMP/ok.log"

# 2. 去掉两个继承键(一个 zhuye-* path 项、一个外部依赖)→ 失败且逐个点名。
grep -v '^rusqlite\|^zhuye-fs ' "$ROOT/Cargo.toml" > "$TMP/root-missing.toml"
if node "$HERE/manifest-parity.mjs" "$ROOT/zhuye-agent/Cargo.toml" "$TMP/root-missing.toml" > "$TMP/missing.log"; then
    echo "缺键时应失败" >&2; exit 1
fi
grep -q '缺少子模块继承键(2)' "$TMP/missing.log"
grep -q 'rusqlite' "$TMP/missing.log"
grep -q 'zhuye-fs' "$TMP/missing.log"

# 3. 根清单多出桌面专属键不算错(只查"子模块有、根没有")。
{ cat "$ROOT/Cargo.toml"; echo 'desktop-only-extra = "1"'; } > "$TMP/root-extra.toml"
node "$HERE/manifest-parity.mjs" "$ROOT/zhuye-agent/Cargo.toml" "$TMP/root-extra.toml" > "$TMP/extra.log"
grep -q '完整镜像' "$TMP/extra.log"

# 4. 子模块段解析为空(格式漂移)→ 失败而不是静默通过。
printf '[workspace]\nmembers = []\n' > "$TMP/sub-empty.toml"
if node "$HERE/manifest-parity.mjs" "$TMP/sub-empty.toml" "$ROOT/Cargo.toml" > "$TMP/empty.log"; then
    echo "子模块段为空时应失败" >&2; exit 1
fi
grep -q '解析为空' "$TMP/empty.log"

# 5. lints 奇偶:真实清单的 clippy allow 键已镜像 → 通过(输出镜像数)。
node "$HERE/manifest-parity.mjs" "$ROOT/zhuye-agent/Cargo.toml" "$ROOT/Cargo.toml" > "$TMP/ok2.log"
if grep -q '缺少子模块 allow 继承键' "$TMP/ok2.log"; then
    echo "真实清单 lints 不应缺键" >&2; exit 1
fi

# 6. 子模块带 allow、根缺同名 allow → 失败且点名;根 deny 多出不算错。
cat > "$TMP/sub-lints.toml" <<'TOML'
[workspace]
members = []
[workspace.dependencies]
foo = "1"
[workspace.lints.clippy]
all = "deny"
collapsible_if = { level = "allow", priority = 10 }
manual_div_ceil = "allow"
TOML
cat > "$TMP/root-lints-missing.toml" <<'TOML'
[workspace.dependencies]
foo = "1"
[workspace.lints.clippy]
all = "deny"
TOML
if node "$HERE/manifest-parity.mjs" "$TMP/sub-lints.toml" "$TMP/root-lints-missing.toml" > "$TMP/lints.log"; then
    echo "缺 allow 继承键时应失败" >&2; exit 1
fi
grep -q '缺少子模块 allow 继承键(2)' "$TMP/lints.log"
grep -q 'collapsible_if' "$TMP/lints.log"
grep -q 'manual_div_ceil' "$TMP/lints.log"
cat > "$TMP/root-lints-ok.toml" <<'TOML'
[workspace.dependencies]
foo = "1"
[workspace.lints.clippy]
all = "deny"
some_upstream_denied_lint = "deny"
collapsible_if = { level = "allow", priority = 10 }
manual_div_ceil = "allow"
TOML
node "$HERE/manifest-parity.mjs" "$TMP/sub-lints.toml" "$TMP/root-lints-ok.toml" > "$TMP/lints-ok.log"
grep -q '镜像子模块 2 个 clippy allow 继承键' "$TMP/lints-ok.log"
echo "manifest-parity self-test: ok"
