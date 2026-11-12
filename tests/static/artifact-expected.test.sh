#!/usr/bin/env bash
# 在隔离产物目录验证发布矩阵中每种类型都必须存在且唯一。
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
mkdir -p "$TMP/bin" "$TMP/bundles/deb" "$TMP/bundles/appimage"
cat > "$TMP/bin/uname" <<'SH'
#!/usr/bin/env bash
printf 'Linux\n'
SH
chmod +x "$TMP/bin/uname"
export PATH="$TMP/bin:$PATH" DIST_DIR="$TMP/bundles" RESULT_DIR="$TMP/results"
export ARTIFACT_REQUIRED=1 ARTIFACT_EXPECTED=deb,appimage
printf 'not a real package\n' > "$DIST_DIR/deb/test.deb"
if bash "$ROOT/tests/artifact/run.sh" > "$TMP/run.log" 2>&1; then fail "缺 AppImage 时必须失败"; fi
grep -q $'^FAIL\t预期发布产物齐全且唯一' "$RESULT_DIR/artifact.cases" || fail "缺失类型未报告"
printf 'not a real package\n' > "$DIST_DIR/deb/duplicate.deb"
printf 'not a real package\n' > "$DIST_DIR/appimage/test.AppImage"
if bash "$ROOT/tests/artifact/run.sh" > "$TMP/run.log" 2>&1; then fail "重复 .deb 必须失败"; fi
grep -q '实际 2 个' "$TMP/run.log" || fail "重复类型未点名数量"
rm "$DIST_DIR/deb/duplicate.deb"
# 两个类型都存在时，预期产物检查应通过；后续内容检查会拒绝伪造包。
bash "$ROOT/tests/artifact/run.sh" > "$TMP/run.log" 2>&1 || true
grep -q $'^PASS\t预期发布产物齐全且唯一' "$RESULT_DIR/artifact.cases" || fail "完整且唯一的清单未通过存在性检查"
ARTIFACT_EXPECTED=deb,,appimage bash "$ROOT/tests/artifact/run.sh" > "$TMP/run.log" 2>&1 && fail "空类型必须失败"
grep -q '清单格式无效' "$TMP/run.log" || fail "无效清单未报错"
echo 'artifact-expected.test.sh self-test: ok'
