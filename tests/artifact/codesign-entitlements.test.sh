#!/usr/bin/env bash
# codesign-entitlements.test.sh —— 产物门禁 codesign 授权断言的自测。
#
# 断言逻辑抽在 artifact/lib.sh(与 run.sh 生产共用);这里用 PATH 垫片
# 伪造 codesign 的三种形态,验:
#   1. 签名嵌入授权(plist 上 stdout、退出 0)→ 通过;
#   2. 签名无授权(退出非零)→ 拒绝;
#   3. 退出 0 但输出为空 → 拒绝(空输出不是有效授权 blob)。
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/lib.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

SHIM="$TMP/bin"
mkdir -p "$SHIM"
FAKE_BUNDLE="$TMP/Fake.app"
mkdir -p "$FAKE_BUNDLE"

write_shim() {
    cat > "$SHIM/codesign"
    chmod +x "$SHIM/codesign"
}

run_case() {
    (
        PATH="$SHIM:$PATH"
        codesign_entitlements_ok "$FAKE_BUNDLE" "$TMP/ent.log"
    )
}

fail() { echo "FAIL: $*" >&2; exit 1; }

# ── 1. 嵌入授权 → 通过 ──
write_shim <<'EOF'
#!/usr/bin/env bash
[ "$1" = "-d" ] && [ "$2" = "--entitlements" ] || exit 1
printf '<?xml version="1.0"?>\n<plist version="1.0"><dict/></plist>\n'
EOF
run_case || fail "嵌入授权的签名应通过"
grep -q '<dict/>' "$TMP/ent.log" || fail "授权 plist 应落日志文件"

# ── 2. 无授权(非零退出)→ 拒绝 ──
write_shim <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
run_case && fail "无授权的签名应被拒绝"

# ── 3. 退出 0 但输出为空 → 拒绝 ──
write_shim <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
run_case && fail "空输出的授权应被拒绝"

# ── 4. 参数防护:目标不存在 → 拒绝(不打 codesign)──
if (PATH="$SHIM:$PATH"; codesign_entitlements_ok "$TMP/missing.app" "$TMP/x.log"); then
    fail "不存在的 bundle 应直接拒绝"
fi

echo "codesign-entitlements self-test: ok"
