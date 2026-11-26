#!/usr/bin/env bash
# gen-icons.sh —— 一键生成 ZhuYe 桌面端全平台应用图标
#
# 用法：
#   bash scripts/gen-icons.sh                       用 zhuye-agent/res/logo.png 重生成全部图标
#   bash scripts/gen-icons.sh path/to/logo.png      换源图（正方形 PNG，或 SVG）
#   bash scripts/gen-icons.sh --check               只校验现有图标是否齐全、尺寸是否正确、是否过期
#   bash scripts/gen-icons.sh --dry-run             生成到临时目录并打印结果，不写入仓库
#   bash scripts/gen-icons.sh --local               跳过 tauri CLI，只用系统工具链生成
#   bash scripts/gen-icons.sh --tray-keep           保留现有 icon32.png（托盘图标），不重新推导
#   bash scripts/gen-icons.sh --no-web              不更新 public/tauri-icon.png（favicon）
#                                                   与 public/brand-mark.png（侧栏品牌位）
#
# 约定（与 docs/changelog.md「采用 logo.png 作为跨平台统一应用 logo」一致）：
#   应用图标源图 = zhuye-agent/res/logo.png（submodule 资源，ZhuYe-Desktop 根目录不另存副本）
#   —— 不带参数时始终用它，与当前工作目录无关；产物 = src-tauri/icons/，文件名白名单见 EXPECTED。
#   托盘图标源图 = zhuye-agent/res/clear-logo.png（透明底彩色徽章，独立于应用图标；缺失时回落
#   logo.png 推导）。源图在 submodule 里，只读不写；未初始化 submodule 时先
#   `git submodule update --init`。tauri icon 顺带产出的无消费方资产（UWP Square*Logo.png、
#   android/、ios/、64x64.png）会被清掉，保证目录内容与 tauri.conf.json 的
#   bundle.icon 一一对应。
#   引擎优先级：tauri CLI（官方，.icns/.ico 最稳）→ 本地 python3 + Pillow（macOS 上
#   .icns 走 iconutil，其他平台用内置 icns 写入器）。
#
# 环境变量覆盖（与 install.sh 的 ZHUYE_INSTALL_* 同风格，门禁自测靠它们跑在临时目录）：
#   ZHUYE_ICON_SOURCE   默认源图（默认 <仓库根>/zhuye-agent/res/logo.png）
#   ZHUYE_TRAY_SOURCE   托盘源图（默认 <仓库根>/zhuye-agent/res/clear-logo.png）
#   ZHUYE_ICONS_DIR     产物目录（默认 <仓库根>/src-tauri/icons）
#   ZHUYE_PUBLIC_ICON   favicon 路径（默认 <仓库根>/public/tauri-icon.png）
#   ZHUYE_BRAND_MARK    侧栏品牌位路径（默认 <仓库根>/public/brand-mark.png）
#
# icon32.png 特殊处理：src-tauri/src/tray.rs 用 include_bytes! 把它编进托盘，彩色直出
#   （非 template，不走系统着色），所以它不能是整张方图标（否则菜单栏里是一个实心方块），
#   且必须自带透明底。托盘源图（clear-logo.png）自带透明底时裁 bbox 保色缩放；回落
#   logo.png 时按亮度阈值推导剪影 alpha、RGB 保留原图亮部颜色。

set -euo pipefail

# 仓库根 = 本脚本父目录的父目录；-P 解析软链接，保证无论从哪儿调用，
# 默认源图都落在 ZhuYe-Desktop/zhuye-agent/res/logo.png（submodule 资源）上。
REPO_ROOT="$(cd -P "$(dirname "$0")/.." && pwd)"
ICONS_DIR="${ZHUYE_ICONS_DIR:-$REPO_ROOT/src-tauri/icons}"
PUBLIC_ICON="${ZHUYE_PUBLIC_ICON:-$REPO_ROOT/public/tauri-icon.png}"
BRAND_MARK="${ZHUYE_BRAND_MARK:-$REPO_ROOT/public/brand-mark.png}"
CONF="$REPO_ROOT/src-tauri/tauri.conf.json"

# 产出文件名（= 现有仓库布局）与期望尺寸；icns/ico 只校验魔数。
EXPECTED=(32x32.png icon32.png 128x128.png "128x128@2x.png" 256x256.png icon.png icon.icns icon.ico)
SIZES=(32 32 128 256 256 512 icns ico)

TRAY_ALPHA_CUT=28     # 亮度低于该值视为背景 → alpha 0（回落 logo.png 推导时用）
TRAY_ALPHA_GAIN=2.2   # 超过阈值的部分按此增益折算为 alpha

usage() { awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "$0"; }
die() { echo "错误：$*" >&2; exit 1; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/zhuye-icons.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
OUT="$TMP/icons"
mkdir -p "$OUT"

# --------------------------------------------------------------- 依赖探测
PYTHON=""
for p in python3 python; do
  if command -v "$p" >/dev/null 2>&1 && "$p" -c 'import PIL' >/dev/null 2>&1; then PYTHON="$p"; break; fi
done

HAVE_CLI=false
TAURI=()
if command -v tauri >/dev/null 2>&1; then TAURI=(tauri); HAVE_CLI=true
elif [ -x "$REPO_ROOT/node_modules/.bin/tauri" ]; then TAURI=("$REPO_ROOT/node_modules/.bin/tauri"); HAVE_CLI=true
elif command -v pnpm >/dev/null 2>&1 && [ -d "$REPO_ROOT/node_modules/@tauri-apps/cli" ]; then TAURI=(pnpm exec tauri); HAVE_CLI=true
fi

# --------------------------------------------------------------- 参数解析
SRC=""
CHECK_ONLY=false
DRY_RUN=false
LOCAL_ONLY=false
TRAY_KEEP=false
SYNC_WEB=true

while [ $# -gt 0 ]; do
  case "$1" in
    --check)   CHECK_ONLY=true ;;
    --dry-run) DRY_RUN=true ;;
    --local)   LOCAL_ONLY=true; HAVE_CLI=false ;;
    --tray-keep) TRAY_KEEP=true ;;
    --no-web)  SYNC_WEB=false ;;
    -h|--help) usage; exit 0 ;;
    -*)        usage >&2; die "未知参数：$1" ;;
    *)         SRC="$1" ;;
  esac
  shift
done

# 源图优先级：命令行参数 > ZHUYE_ICON_SOURCE > zhuye-agent/res/logo.png（默认，
# submodule 资源）
DEFAULT_SRC="$REPO_ROOT/zhuye-agent/res/logo.png"
[ -n "$SRC" ] || SRC="${ZHUYE_ICON_SOURCE:-$DEFAULT_SRC}"
case "$SRC" in "~"*) SRC="$HOME${SRC#\~}" ;; esac
if [ ! -f "$SRC" ]; then
  echo "源图不存在：$SRC" >&2
  if [ "$SRC" = "$DEFAULT_SRC" ]; then
    echo "默认源图在 submodule 里（${DEFAULT_SRC}）；未初始化时先跑 git submodule update --init。" >&2
    echo "如要换图，把路径作为第一个参数传入。" >&2
  fi
  usage >&2
  exit 1
fi
case "$SRC" in /*) ;; *) SRC="$PWD/$SRC" ;; esac
SRC_IS_DEFAULT=false
if [ "$SRC" = "$DEFAULT_SRC" ]; then SRC_IS_DEFAULT=true; fi

# 托盘源图优先级：ZHUYE_TRAY_SOURCE > zhuye-agent/res/clear-logo.png（submodule 资源）；
# 缺失时回落 logo.png 推导（历史行为，兼容无透明底托盘源图的临时目录场景）。
TRAY_SOURCE="${ZHUYE_TRAY_SOURCE:-$REPO_ROOT/zhuye-agent/res/clear-logo.png}"
case "$TRAY_SOURCE" in "~"*) TRAY_SOURCE="$HOME${TRAY_SOURCE#\~}" ;; esac
case "$TRAY_SOURCE" in /*) ;; *) TRAY_SOURCE="$PWD/$TRAY_SOURCE" ;; esac

src_label() {
  if $SRC_IS_DEFAULT; then printf '%s（仓库默认源图）' "$SRC"
  else printf '%s（命令行指定）' "$SRC"; fi
}

# --------------------------------------------------------------- 工具函数
png_size() {
  local f="$1" w h
  if command -v sips >/dev/null 2>&1; then
    w="$(sips -g pixelWidth "$f" 2>/dev/null | awk '/pixelWidth/{print $2}')"
    h="$(sips -g pixelHeight "$f" 2>/dev/null | awk '/pixelHeight/{print $2}')"
    printf '%sx%s' "${w:-?}" "${h:-?}"
  elif [ -n "$PYTHON" ]; then
    "$PYTHON" -c 'import sys;from PIL import Image;print("%dx%d"%Image.open(sys.argv[1]).size)' "$f" 2>/dev/null || printf '?'
  else
    file -b "$f" | sed -n 's/.*image data, \([0-9][0-9]*\) x \([0-9][0-9]*\).*/\1x\2/p'
  fi
}

kib() {
  local b
  b="$(wc -c < "$1" | tr -d '[:space:]')"
  awk -v b="$b" 'BEGIN{printf "%.0f KB", b/1024}'
}

# icns 前 4 字节 = "icns"；ico 前 4 字节 = 00 00 01 00
magic_ok() {
  local f="$1" kind="$2" got
  got="$(od -An -tx1 -N4 "$f" | tr -d ' \n')"
  case "$kind" in
    icns) [ "$got" = "69636e73" ] ;;
    ico)  [ "$got" = "00000100" ] ;;
    *)    return 0 ;;
  esac
}

# 生成 `find ! \( -name A -o -name B ... \)` 的谓词数组
NAMES=()
build_name_predicates() {
  local f
  NAMES=()
  for f in "${EXPECTED[@]}"; do NAMES+=(-name "$f" -o); done
  unset 'NAMES[${#NAMES[@]}-1]'
}
build_name_predicates

report() {
  local dir="$1" i f p note
  for i in "${!EXPECTED[@]}"; do
    f="${EXPECTED[$i]}"; p="$dir/$f"
    if [ ! -f "$p" ]; then printf '  ✗ %-16s 缺失\n' "$f"; continue; fi
    case "${SIZES[$i]}" in
      icns) note="macOS icns · $(kib "$p")" ;;
      ico)  note="Windows ico · $(kib "$p")" ;;
      *)    note="$(png_size "$p") · $(kib "$p")" ;;
    esac
    printf '  ✓ %-16s %s\n' "$f" "$note"
  done
}

# --------------------------------------------------------- 校验模式 --check
if $CHECK_ONLY; then
  echo "校验 ${ICONS_DIR}（源图 $(src_label)）"
  fail=0
  for i in "${!EXPECTED[@]}"; do
    f="${EXPECTED[$i]}"; p="$ICONS_DIR/$f"
    if [ ! -f "$p" ]; then echo "  ✗ $f 缺失"; fail=1; continue; fi
    case "${SIZES[$i]}" in
      icns|ico)
        magic_ok "$p" "${SIZES[$i]}" || { echo "  ✗ $f 文件格式异常"; fail=1; } ;;
      *)
        got="$(png_size "$p")"
        [ "$got" = "${SIZES[$i]}x${SIZES[$i]}" ] || { echo "  ✗ $f 尺寸 ${got}，应为 ${SIZES[$i]}x${SIZES[$i]}"; fail=1; } ;;
    esac
    # 托盘图标彩色直出，实心方块会糊满菜单栏，必须有透明底
    if [ "$f" = "icon32.png" ] && [ -n "$PYTHON" ]; then
      share="$("$PYTHON" -c 'import sys;from PIL import Image;a=Image.open(sys.argv[1]).getchannel("A").histogram();print("%.3f"%(sum(a[:1])/(32*32)))' "$p" 2>/dev/null || true)"
      if [ -n "$share" ] && [ "$(awk -v s="$share" 'BEGIN{print (s < 0.02) ? 1 : 0}')" = "1" ]; then
        echo "  ✗ ${f} 无透明底，托盘会显示实心方块；重跑时去掉 --tray-keep 或改用带透明底的源图"; fail=1
      fi
    fi
  done
  stray="$(find "$ICONS_DIR" -maxdepth 1 -type f ! \( "${NAMES[@]}" \) -print | head -5)"
  if [ -n "$stray" ]; then echo "  ✗ 白名单外的文件："; printf '%s\n' "$stray" | sed "s|$ICONS_DIR/|      |"; fail=1; fi
  if [ -f "$ICONS_DIR/icon.png" ] && [ "$SRC" -nt "$ICONS_DIR/icon.png" ]; then
    echo "  ✗ 源图比现有图标更新，请重跑：bash scripts/gen-icons.sh"; fail=1
  fi
  # 托盘源图（clear-logo.png）新鲜度独立校验 —— 与应用图标源（logo.png）互不牵制。
  if [ -f "$TRAY_SOURCE" ] && [ "$TRAY_SOURCE" -nt "$ICONS_DIR/icon32.png" ]; then
    echo "  ✗ 托盘源图比 icon32.png 新：$TRAY_SOURCE —— 请重跑：bash scripts/gen-icons.sh"; fail=1
  fi
  # 侧栏品牌位（brand-mark.png）：缺失即失败（前端 <img> 没有回落位）；
  # 与 icon32.png 同用 clear-logo.png 源但产物独立，新鲜度单独校验。
  if [ ! -f "$BRAND_MARK" ]; then
    echo "  ✗ 侧栏品牌位缺失：$BRAND_MARK —— 请重跑：bash scripts/gen-icons.sh"; fail=1
  elif [ -f "$TRAY_SOURCE" ] && [ "$TRAY_SOURCE" -nt "$BRAND_MARK" ]; then
    echo "  ✗ 托盘源图比侧栏品牌位新：$TRAY_SOURCE —— 请重跑：bash scripts/gen-icons.sh"; fail=1
  fi
  if [ "$fail" -ne 0 ]; then echo "校验未通过"; exit 1; fi
  report "$ICONS_DIR"
  echo "校验通过：图标与 $(src_label) 一致"
  exit 0
fi

# ------------------------------------------------------------- 源图归一化
NORM="$SRC"
case "$SRC" in
  *.svg|*.SVG)
    if ! $HAVE_CLI; then
      command -v rsvg-convert >/dev/null 2>&1 || die "SVG 源图需要 tauri CLI 或 rsvg-convert"
      rsvg-convert -w 1024 -h 1024 -o "$TMP/source.png" "$SRC"
      NORM="$TMP/source.png"
    fi ;;
  *)
    if [ -n "$PYTHON" ]; then
      dims="$(png_size "$SRC")"; w="${dims%x*}"; h="${dims#*x}"
      if [ "$w" != "$h" ]; then
        echo "源图 $dims 非正方形，按短边居中裁切"
        "$PYTHON" - "$SRC" "$TMP/source.png" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGBA")
side = min(im.size)
im.crop(((im.size[0] - side) // 2, (im.size[1] - side) // 2,
         (im.size[0] + side) // 2, (im.size[1] + side) // 2)).save(sys.argv[2])
PY
        NORM="$TMP/source.png"
      fi
    fi ;;
esac

# ----------------------------------------------------------- 引擎 1：CLI
gen_via_cli() {
  $HAVE_CLI || return 1
  echo "→ 引擎：tauri CLI"
  "${TAURI[@]}" icon "$NORM" -o "$OUT" >/dev/null 2>&1 || return 1
  [ -f "$OUT/icon.icns" ] && [ -f "$OUT/icon.ico" ]
}

# ------------------------------------------------------- 引擎 2：本地工具链
gen_via_local() {
  [ -n "$PYTHON" ] || die "没有可用的 tauri CLI，且 python3 缺 Pillow。先 pnpm install，或 pip install pillow"
  echo "→ 引擎：本地工具链（python3 + Pillow$([ "$(uname)" = Darwin ] && echo " + iconutil")）"
  "$PYTHON" - "$NORM" "$OUT" <<'PY'
import os, sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
base = Image.open(src).convert("RGBA")

def save(name, px):
    base.resize((px, px), Image.LANCZOS).save(os.path.join(out, name), optimization=True)

for name, px in [("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256),
                 ("256x256.png", 256), ("icon.png", 512)]:
    save(name, px)

# Windows .ico：多分辨率内嵌（256 为 PNG 条目，其余为 BMP 条目）
base.resize((256, 256), Image.LANCZOS).save(
    os.path.join(out, "icon.ico"), format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
PY

  if [ "$(uname)" = "Darwin" ] && command -v iconutil >/dev/null 2>&1; then
    mkdir -p "$TMP/AppIcon.iconset"
    "$PYTHON" - "$NORM" "$TMP/AppIcon.iconset" <<'PY'
import os, sys
from PIL import Image
base = Image.open(sys.argv[1]).convert("RGBA")
d = sys.argv[2]
for name, px in [("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
                 ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
                 ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
                 ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
                 ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024)]:
    base.resize((px, px), Image.LANCZOS).save(os.path.join(d, name))
PY
    iconutil -c icns -o "$OUT/icon.icns" "$TMP/AppIcon.iconset"
  else
    "$PYTHON" - "$NORM" "$OUT/icon.icns" <<'PY'
# 非 macOS 且无 tauri CLI：直接写 icns 容器（各尺寸以 PNG 负载存放）
import io, struct, sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
base = Image.open(src).convert("RGBA")
body = b""
for tag, px in [(b"icp4", 16), (b"icp5", 32), (b"icp6", 64), (b"ic07", 128),
                (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024)]:
    buf = io.BytesIO()
    base.resize((px, px), Image.LANCZOS).save(buf, format="PNG")
    data = buf.getvalue()
    body += tag + struct.pack(">I", len(data) + 8) + data
with open(dst, "wb") as f:
    f.write(b"icns" + struct.pack(">I", len(body) + 8) + body)
PY
  fi
}

echo "源图：$(src_label) · $(png_size "$SRC")"
if ! gen_via_cli; then
  gen_via_local
fi

# ------------------------------------------- 仓库专有尺寸/别名（CLI 不产出）
[ -f "$OUT/256x256.png" ] || cp "$OUT/128x128@2x.png" "$OUT/256x256.png"

# 托盘图标 icon32.png：彩色直出（非 template，不走系统着色），自带透明底。
if $TRAY_KEEP && [ -f "$ICONS_DIR/icon32.png" ]; then
  cp "$ICONS_DIR/icon32.png" "$OUT/icon32.png"
  echo "  · icon32.png 保留仓库现有版本（--tray-keep）"
elif [ -n "$PYTHON" ] && [ -f "$TRAY_SOURCE" ]; then
  # 托盘独立源图（clear-logo.png，透明底彩色）：裁内容 bbox、方形居中填充、
  # 缩到 32×32（内容 28/32 留菜单栏呼吸位）；保留原色原 alpha 直出 ——
  # tray.rs 不走 icon_as_template，菜单栏明暗外观都显示彩色徽记。
  "$PYTHON" - "$TRAY_SOURCE" "$OUT/icon32.png" <<'PY'
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
bbox = im.getchannel("A").getbbox()
if bbox:
    im = im.crop(bbox)
side = max(im.size)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2), im)
pad = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
inner = square.resize((28, 28), Image.LANCZOS)
pad.paste(inner, (2, 2), inner)
pad.save(dst, optimization=True)
alpha = pad.getchannel("A")
share = sum(alpha.histogram()[:1]) / (32 * 32)
print(f"  · icon32.png 由托盘源图推导（trim + 方形居中，内容 28/32，彩色直出；透明占比 {share:.0%}）")
PY
elif [ -n "$PYTHON" ]; then
  # 回落：托盘源图缺失，用应用图标源推导。亮度阈值出 alpha、RGB 保留原图
  # 亮部颜色（黑底 logo 得出金亮色剪影），彩色直出下明暗菜单栏均可辨。
  "$PYTHON" - "$NORM" "$OUT/icon32.png" "$TRAY_ALPHA_CUT" "$TRAY_ALPHA_GAIN" <<'PY'
import sys
from PIL import Image, ImageOps

src, dst, cut, gain = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
im = Image.open(src).convert("RGBA").resize((32, 32), Image.LANCZOS)
src_alpha = im.getchannel("A")
share = sum(src_alpha.histogram()[:1]) / (32 * 32)
if share > 0.02:
    mask = src_alpha
    print(f"  · icon32.png 沿用源图 alpha（透明占比 {share:.0%}）")
else:
    mask = ImageOps.grayscale(im).point(
        lambda v: max(0, min(255, int((v - cut) * gain))))
    print("  · icon32.png 源图无透明底，按亮度阈值推导剪影 alpha"
          f"（cut={cut:g}, gain={gain:g}）")
Image.merge("RGBA", (*im.split()[:3], mask)).save(dst, optimization=True)
PY
else
  cp "$OUT/32x32.png" "$OUT/icon32.png"
  echo "  · 无 python3+Pillow，icon32.png 直接复用 32x32.png（托盘会显示实心方块）"
fi

echo "生成结果："
report "$OUT"

if $DRY_RUN; then
  echo "dry-run：未写入仓库（去掉 --dry-run 即落盘）"
  exit 0
fi

# --------------------------------------------------------------- 落盘与清理
for f in "${EXPECTED[@]}"; do
  [ -f "$OUT/$f" ] || die "生成结果缺少 $f"
  install -m 0644 "$OUT/$f" "$ICONS_DIR/$f"
done
find "$ICONS_DIR" -maxdepth 1 -type f ! \( "${NAMES[@]}" \) -print -delete
find "$ICONS_DIR" -mindepth 1 -maxdepth 1 -type d -print -exec rm -rf {} +
echo "已写入 $ICONS_DIR"

if $SYNC_WEB && [ -d "$REPO_ROOT/public" ]; then
  if [ -n "$PYTHON" ]; then
    "$PYTHON" - "$NORM" "$PUBLIC_ICON" <<'PY'
import sys
from PIL import Image
Image.open(sys.argv[1]).convert("RGBA").resize((512, 512), Image.LANCZOS).save(
    sys.argv[2], optimization=True)
PY
  else
    cp "$OUT/icon.png" "$PUBLIC_ICON"
  fi
  echo "已写入 ${PUBLIC_ICON}（index.html favicon）"

  # 侧栏品牌位：托盘源图（自带透明底）裁内容 bbox → 方形居中 → 64×64
  # （内容 56/64，与托盘 28/32 同比例留呼吸位）。保留原色 —— 品牌位与托盘
  # 一样都是彩色直出，明暗两套主题下显示彩色徽记。托盘源图缺失时回落应用
  # 图标（黑底方形，亮色主题会露出底色，此时建议补 zhuye-agent/res/clear-logo.png）。
  if [ -n "$PYTHON" ] && [ -f "$TRAY_SOURCE" ]; then
    "$PYTHON" - "$TRAY_SOURCE" "$BRAND_MARK" <<'PY'
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
bbox = im.getchannel("A").getbbox()
if bbox:
    im = im.crop(bbox)
side = max(im.size)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2), im)
mark = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
inner = square.resize((56, 56), Image.LANCZOS)
mark.paste(inner, (4, 4), inner)
mark.save(dst, optimization=True)
PY
    echo "已写入 ${BRAND_MARK}（侧栏品牌位，托盘源图推导）"
  elif command -v sips >/dev/null 2>&1 && [ -f "$TRAY_SOURCE" ]; then
    cp "$TRAY_SOURCE" "$BRAND_MARK"
    sips -Z 64 "$BRAND_MARK" >/dev/null 2>&1
    echo "已写入 ${BRAND_MARK}（侧栏品牌位，无 Pillow 改用 sips 直接缩放）"
  elif [ -f "$OUT/icon.png" ]; then
    cp "$OUT/icon.png" "$BRAND_MARK"
    echo "已写入 ${BRAND_MARK}（侧栏品牌位，托盘源图缺失回落应用图标）"
  fi
fi

# ------------------------------------------------- 与 tauri.conf.json 对齐
echo "检查 src-tauri/tauri.conf.json 的 bundle.icon："
missing=0
for entry in $(grep -o '"icons/[^"]*"' "$CONF" | tr -d '"'); do
  if [ -f "$REPO_ROOT/src-tauri/$entry" ]; then echo "  ✓ $entry"
  else echo "  ✗ $entry 不存在"; missing=1; fi
done

if [ "$missing" -eq 0 ] && command -v git >/dev/null 2>&1 && [ -d "$REPO_ROOT/.git" ]; then
  changed="$(git -C "$REPO_ROOT" status --porcelain -- src-tauri/icons public/tauri-icon.png)"
  if [ -n "$changed" ]; then
    echo "变更："
    printf '%s\n' "$changed" | sed 's/^/  /'
  else
    echo "（与仓库现有图标逐字节一致，无变更）"
  fi
fi

exit "$missing"
