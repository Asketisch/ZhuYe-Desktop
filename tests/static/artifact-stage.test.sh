#!/usr/bin/env bash
# 直接运行发布暂存脚本，验证不同目标和异常清单的隔离。
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
STAGE="$ROOT/tests/artifact/stage.sh"
mkdir -p "$TMP/current/deb" "$TMP/current/appimage" "$TMP/old/deb" "$TMP/mac/dmg" "$TMP/win/msi"
printf 'current deb' > "$TMP/current/deb/current.deb"
printf 'current appimage' > "$TMP/current/appimage/current.AppImage"
printf 'old deb' > "$TMP/old/deb/old.deb"
printf 'dmg' > "$TMP/mac/dmg/current.dmg"
printf 'msi' > "$TMP/win/msi/current.msi"
bash "$STAGE" "$TMP/current" deb,appimage "$TMP/linux-stage" > "$TMP/log" || fail "Linux 暂存失败"
[ -f "$TMP/linux-stage/current.deb" ] && [ -f "$TMP/linux-stage/current.AppImage" ] || fail "当前目标产物缺失"
[ ! -e "$TMP/linux-stage/old.deb" ] || fail "旧目标产物不应被暂存"
bash "$STAGE" "$TMP/mac" app,dmg "$TMP/mac-stage" > "$TMP/log" || fail "macOS 暂存失败"
[ -f "$TMP/mac-stage/current.dmg" ] || fail "DMG 未暂存"
bash "$STAGE" "$TMP/win" msi "$TMP/win-stage" > "$TMP/log" || fail "Windows 暂存失败"
[ -f "$TMP/win-stage/current.msi" ] || fail "MSI 未暂存"
if bash "$STAGE" "$TMP/current" deb,appimage "$TMP/linux-stage" > "$TMP/log" 2>&1; then fail "非空暂存目录必须失败"; fi
printf 'duplicate' > "$TMP/current/deb/duplicate.deb"
if bash "$STAGE" "$TMP/current" deb,appimage "$TMP/duplicate-stage" > "$TMP/log" 2>&1; then fail "重复产物必须失败"; fi
[ -z "$(find "$TMP/duplicate-stage" -mindepth 1 -print -quit)" ] || fail "验证失败不得复制产物"
rm "$TMP/current/deb/duplicate.deb"
if bash "$STAGE" "$TMP/current" deb,msi "$TMP/missing-stage" > "$TMP/log" 2>&1; then fail "缺失类型必须失败"; fi
[ -z "$(find "$TMP/missing-stage" -mindepth 1 -print -quit)" ] || fail "缺失类型不得留下部分产物"
if bash "$STAGE" "$TMP/current" app "$TMP/app-stage" > "$TMP/log" 2>&1; then fail "没有可交付安装包必须失败"; fi
echo 'artifact-stage.test.sh self-test: ok'
