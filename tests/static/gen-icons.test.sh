#!/usr/bin/env bash
# scripts/gen-icons.sh 的自测。锁四件事：
#   1. 默认源图永远解析到仓库根 logo.png，与调用目录无关；
#   2. 缺文件 / 白名单外残留 / 源图比产物新 / 托盘图标无透明底 —— --check 必须失败并点名；
#   3. --dry-run 不得改动任何已存在的产物；
#   4. 脚本不得踩 bash 3.2「变量名紧跟多字节字符」的展开陷阱（实测会 unbound variable）。
# 所有读写都经 ZHUYE_ICONS_DIR / ZHUYE_PUBLIC_ICON / ZHUYE_ICON_SOURCE 重定向到临时目录，
# 不触碰 src-tauri/icons、public/ 与 logo.png。
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
GEN="$ROOT/scripts/gen-icons.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

have_engine() {
    [ -x "$ROOT/node_modules/.bin/tauri" ] && return 0
    command -v tauri >/dev/null 2>&1 && return 0
    python3 -c 'import PIL' >/dev/null 2>&1
}

# ── 1. 文本类用例（不需要图像引擎）────────────────────────────────────────
bash "$GEN" --help 2>&1 | grep -q 'gen-icons.sh' || fail "--help 未打印用法"

if LC_ALL=C grep -n '\$[A-Za-z_][A-Za-z0-9_]*[^ -~]' "$GEN" "$ROOT/scripts/build.sh"; then
    fail '变量名后紧跟多字节字符：bash 3.2 会连字节一起算进变量名，触发 unbound variable'
fi

mkdir -p "$fixture/empty" "$fixture/elsewhere"
out="$( (cd "$fixture/elsewhere" && ZHUYE_ICONS_DIR="$fixture/empty" bash "$GEN" --check) 2>&1)" \
    && fail "空图标目录必须校验失败"
printf '%s\n' "$out" | grep -Fq "$ROOT/logo.png（仓库默认源图）" \
    || fail "默认源图未指向仓库根 logo.png：$(printf '%s\n' "$out" | head -1)"
printf '%s\n' "$out" | grep -q '缺失' || fail "缺失文件未点名"

cp "$ROOT/logo.png" "$fixture/other.png"
out="$(ZHUYE_ICONS_DIR="$fixture/empty" bash "$GEN" --check "$fixture/other.png" 2>&1)"
printf '%s\n' "$out" | grep -q '命令行指定' || fail "显式源图未标注来源"

if ! have_engine; then
    echo 'gen-icons.test.sh self-test: ok（无图像引擎，仅跑文本类用例）'
    exit 0
fi

# ── 2. 真生成 + 四类失败路径 ──────────────────────────────────────────────
ICONS="$fixture/icons"
mkdir -p "$ICONS"
cp "$ROOT/logo.png" "$fixture/src.png"
export ZHUYE_ICONS_DIR="$ICONS" ZHUYE_ICON_SOURCE="$fixture/src.png"
export ZHUYE_PUBLIC_ICON="$fixture/favicon.png"   # 放图标目录外，否则会被判成白名单外残留

bash "$GEN" > "$fixture/gen.log" 2>&1 || fail "生成失败：$(tail -3 "$fixture/gen.log")"
for f in 32x32.png icon32.png 128x128.png 128x128@2x.png 256x256.png icon.png icon.icns icon.ico; do
    [ -s "$ICONS/$f" ] || fail "产物缺少 $f"
done
bash "$GEN" --check > /dev/null 2>&1 || fail "刚生成的完整产物应通过 --check"

# 白名单外残留（tauri icon 会顺带产出 UWP/android/ios 资产）。
: > "$ICONS/Square44x44Logo.png"
out="$(bash "$GEN" --check 2>&1)" && fail "白名单外文件必须校验失败"
printf '%s\n' "$out" | grep -q '白名单外' || fail "白名单外残留未点名"
rm "$ICONS/Square44x44Logo.png"

# 源图比产物新 = 改了 logo 忘记重生成。
# bash 3.2 的 -nt 只比整秒，所以必须先跨过一秒边界再 touch。
sleep 1
touch "$fixture/src.png"
out="$(bash "$GEN" --check 2>&1)" && fail "源图比产物新时必须判定过期"
printf '%s\n' "$out" | grep -q '比现有图标更新' || fail "过期原因未点名"
touch -r "$ICONS/icon.png" "$fixture/src.png"

# 托盘图标按 template 只取 alpha 渲染，退化成实心方块必须报错。
if python3 -c 'import PIL' >/dev/null 2>&1; then
    cp "$ICONS/32x32.png" "$ICONS/icon32.png"
    out="$(bash "$GEN" --check 2>&1)" && fail "icon32.png 无透明底时必须失败"
    printf '%s\n' "$out" | grep -q '无透明底' || fail "托盘实心方块未点名"
    bash "$GEN" > /dev/null 2>&1 || fail "重生成未能修回剪影 alpha"
fi

# ── 3. --dry-run 只读 ─────────────────────────────────────────────────────
hash_icons() {
    (cd "$ICONS" && shasum -a 256 32x32.png icon32.png 128x128.png "128x128@2x.png" \
        256x256.png icon.png icon.icns icon.ico)
}
before="$(hash_icons)"
bash "$GEN" --dry-run > /dev/null 2>&1 || fail "--dry-run 应正常退出"
after="$(hash_icons)"
[ "$before" = "$after" ] || fail "--dry-run 改动了产物"

echo 'gen-icons.test.sh self-test: ok'
