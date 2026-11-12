#!/usr/bin/env bash
# 窗口客户端不能继承外部 WebDriver 地址，且需传递隔离路径。
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
mkdir -p "$TMP/bin"
cat > "$TMP/bin/pnpm" <<'SH'
#!/usr/bin/env bash
printf '%s\n%s\n%s\n%s\n%s\n' "$TAURI_DRIVER_URL" "$TAURI_APP_BIN" "$E2E_SCREENSHOT_DIR" "$E2E_WORKSPACE_DIR" "$*" > "$WINDOW_CLIENT_CAPTURE"
SH
cat > "$TMP/bin/xvfb-run" <<'SH'
#!/usr/bin/env bash
[ "$1" = -a ] || exit 3
shift
exec "$@"
SH
chmod +x "$TMP/bin/pnpm" "$TMP/bin/xvfb-run"
export PATH="$TMP/bin:$PATH" WINDOW_CLIENT_CAPTURE="$TMP/capture"
TAURI_DRIVER_URL='http://unrelated.invalid:9999' bash "$ROOT/tests/e2e/window-client.sh" '/app path/app' '/results path' '/workspace path' || fail "窗口客户端调用失败"
[ "$(sed -n '1p' "$TMP/capture")" = 'http://127.0.0.1:4444' ] || fail "未覆盖外部驱动地址"
[ "$(sed -n '2p' "$TMP/capture")" = '/app path/app' ] || fail "应用路径未正确传递"
[ "$(sed -n '3p' "$TMP/capture")" = '/results path' ] || fail "结果路径未正确传递"
[ "$(sed -n '4p' "$TMP/capture")" = '/workspace path' ] || fail "工作区路径未正确传递"
grep -q 'tests/e2e/window.smoke.test.ts' "$TMP/capture" || fail "未执行窗口测试"
echo 'window-client.test.sh self-test: ok'
