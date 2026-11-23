#!/usr/bin/env bash
# build.sh —— 烛夜（ZhuYe）跨平台构建入口。
#
# 检测当前操作系统，选择正确的 Tauri 打包目标，可选地生成
# macOS 通用二进制，并打印构建产物摘要。
#
# 用法：
#   bash scripts/build.sh                       # 当前系统，默认打包目标
#   bash scripts/build.sh --fast                # release-fast 配置（无 LTO，更快）
#   bash scripts/build.sh --universal           # macOS：arm64 + x86_64 通用二进制
#   bash scripts/build.sh --bundles=app,dmg     # 覆盖打包目标列表
#   bash scripts/build.sh --target=x86_64-apple-darwin  # 显式指定 rustc 目标
#   bash scripts/build.sh --no-frontend         # 跳过前端重新构建
#   bash scripts/build.sh --frontend-only       # 只构建前端（→ dist/），不编译 Rust、不打包
#   bash scripts/build.sh --dry-run             # 只打印将执行的命令，不实际执行
#   bash scripts/build.sh --help
#
# 各系统默认打包目标：
#   macOS    → app,dmg        （通用模式 → 相同，但包内是通用二进制）
#   Linux    → deb,appimage
#   Windows  → msi
#
# 环境变量覆盖：
#   SIGNING_IDENTITY   macOS 代码签名身份（默认：ad-hoc，不做公证）
#   NODE_INSTALLER     包管理器（默认 'pnpm'）| 'npm' | 'yarn'
#   TAURI_CLI_ARGS     原样追加到 `pnpm tauri build` 的额外参数

set -euo pipefail

# ── Repo root ────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── Defaults ─────────────────────────────────────────────────────────────
DRY_RUN=false
FAST=false
UNIVERSAL=false
NO_FRONTEND=false
FRONTEND_ONLY=false
BUNDLES_OVERRIDE=""
TARGET_OVERRIDE=""
NODE_INSTALLER="${NODE_INSTALLER:-pnpm}"
SIGNING_IDENTITY="${SIGNING_IDENTITY:-}"

# ── Arg parsing ──────────────────────────────────────────────────────────
# 带值参数同时支持 `--flag value` 与 `--flag=value` 两种写法。
while [ $# -gt 0 ]; do
  arg="$1"
  case "$arg" in
    --fast)          FAST=true ;;
    --universal)     UNIVERSAL=true ;;
    --no-frontend)   NO_FRONTEND=true ;;
    --frontend-only) FRONTEND_ONLY=true ;;
    --dry-run)       DRY_RUN=true ;;
    --bundles)     BUNDLES_OVERRIDE="${2:?--bundles requires a value}"; shift ;;
    --bundles=*)   BUNDLES_OVERRIDE="${arg#--bundles=}" ;;
    --target)      TARGET_OVERRIDE="${2:?--target requires a value}"; shift ;;
    --target=*)    TARGET_OVERRIDE="${arg#--target=}" ;;
    -h|--help)
      cat <<EOF
Usage: bash scripts/build.sh [options]

Options:
  --fast               Use release-fast profile (no LTO, ~2x faster, larger binary)
  --universal          macOS only: build universal arm64+x86_64 binary
  --bundles=LIST       Override bundle list (e.g. app,dmg | deb,appimage | msi)
  --target=TRIPLE      Pass explicit rustc target to tauri build (advanced)
  --no-frontend        Skip 'pnpm build' (assume dist/ is current)
  --frontend-only      Build frontend only (→ dist/); skip Rust compile & bundling
  --dry-run            Print commands without executing
  -h, --help           Show this help

Env:
  SIGNING_IDENTITY     macOS codesign identity (default: ad-hoc, unsigned)
  NODE_INSTALLER       pnpm (default) | npm | yarn
  TAURI_CLI_ARGS       Extra args appended to 'pnpm tauri build'

Per-OS default bundles:
  macOS   → app,dmg
  Linux   → deb,appimage
  Windows → msi
EOF
      exit 0 ;;
    *)
      echo "unknown arg: $arg (use --help)" >&2
      exit 1 ;;
  esac
  shift
done

# 互斥：--no-frontend 与 --frontend-only 语义相反，同时给即报错。
if $NO_FRONTEND && $FRONTEND_ONLY; then
  echo "--no-frontend 与 --frontend-only 互斥，不能同时使用" >&2
  exit 1
fi

# ── Run helper: echo + eval, respect DRY_RUN ─────────────────────────────
run() {
  echo "+ $*"
  if ! $DRY_RUN; then
    eval "$@"
  fi
}

# ── 人类可读的大小辅助函数 ────────────────────────────────────────────────
# macOS 与 Linux 的 `du -h` 行为一致；若 numfmt/du 不可用则回退到原始字节数。
human_size() {
  local path="$1"
  if command -v du >/dev/null 2>&1; then
    # -sh: summary, human-readable. -L not needed; we want bundle dir size.
    du -sh "$path" 2>/dev/null | cut -f1
  else
    echo "?"
  fi
}

# ── Trap: report abort on Ctrl-C ─────────────────────────────────────────
cleanup() {
  local code=$?
  if [ $code -ne 0 ]; then
    echo "build aborted (exit $code)" >&2
  fi
  exit $code
}
trap cleanup EXIT INT TERM

# ── OS detection ─────────────────────────────────────────────────────────
OS_NAME="$(uname -s)"
case "$OS_NAME" in
  Darwin)
    PLATFORM="macos"
    DEFAULT_BUNDLES="app,dmg"
    ;;
  Linux)
    PLATFORM="linux"
    DEFAULT_BUNDLES="deb,appimage"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    PLATFORM="windows"
    DEFAULT_BUNDLES="msi"
    ;;
  *)
    echo "unsupported OS: $OS_NAME" >&2
    echo "ZhuYe can be built on macOS, Linux, or Windows (Git Bash)." >&2
    exit 1
    ;;
esac

# --universal only meaningful on macOS.
if $UNIVERSAL && [ "$PLATFORM" != "macos" ]; then
  echo "WARN: --universal is macOS-only; ignoring on $PLATFORM" >&2
  UNIVERSAL=false
fi

# --frontend-only 只跑前端构建，打包相关参数在此模式下不生效，提示避免误解。
if $FRONTEND_ONLY; then
  if $FAST || $UNIVERSAL || [ -n "$BUNDLES_OVERRIDE" ] || [ -n "$TARGET_OVERRIDE" ]; then
    echo "WARN: --frontend-only 只构建前端；--fast/--universal/--bundles/--target 在此模式下不生效" >&2
  fi
fi

BUNDLES="${BUNDLES_OVERRIDE:-$DEFAULT_BUNDLES}"

echo "── ZhuYe build ────────────────────────────────────────────"
echo "mode:          $([ $FRONTEND_ONLY = true ] && echo frontend-only || echo full)"
echo "platform:      $PLATFORM ($OS_NAME)"
echo "bundles:       $([ $FRONTEND_ONLY = true ] && echo '(skipped)' || echo "$BUNDLES")"
echo "profile:       $([ $FAST = true ] && echo release-fast || echo release)"
echo "universal:     $UNIVERSAL"
echo "target:        ${TARGET_OVERRIDE:-<host>}"
echo "dry-run:       $DRY_RUN"
echo "───────────────────────────────────────────────────────────"

# ── Toolchain checks ─────────────────────────────────────────────────────
need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required tool: $1" >&2
    exit 1
  }
}
need_cmd "$NODE_INSTALLER"
# 仅前端模式不碰 Rust 工具链，cargo/rustc 缺失不阻断。
if ! $FRONTEND_ONLY; then
  need_cmd cargo
  need_cmd rustc
fi

# ── Frontend deps ────────────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  echo "+ $NODE_INSTALLER install (node_modules missing)"
  $DRY_RUN || "$NODE_INSTALLER" install
fi

# ── Determine rustc target ───────────────────────────────────────────────
TARGET_ARGS=()
if $FRONTEND_ONLY; then
  : # 仅前端模式不需要 rustc target，也不装 universal 工具链
elif [ -n "$TARGET_OVERRIDE" ]; then
  TARGET_ARGS=(--target "$TARGET_OVERRIDE")
elif $UNIVERSAL; then
  # Tauri 通过 'apple' 通用目标支持 universal-apple-darwin。
  # 需要同时安装 aarch64-apple-darwin + x86_64-apple-darwin 工具链。
  for t in aarch64-apple-darwin x86_64-apple-darwin; do
    if ! rustup target list --installed 2>/dev/null | grep -q "^$t$"; then
      echo "+ rustup target add $t (required for universal binary)"
      $DRY_RUN || rustup target add "$t"
    fi
  done
  TARGET_ARGS=(--target universal-apple-darwin)
fi

# ── Profile arg ──────────────────────────────────────────────────────────
PROFILE_ARGS=()
if $FAST; then
  PROFILE_ARGS=(-- --profile release-fast)
fi

# ── Bundles arg ──────────────────────────────────────────────────────────
BUNDLES_ARGS=(--bundles "$BUNDLES")

# ── macOS signing hook ───────────────────────────────────────────────────
if ! $FRONTEND_ONLY && [ "$PLATFORM" = "macos" ] && [ -n "$SIGNING_IDENTITY" ] && ! $DRY_RUN; then
  export APPLE_SIGNING_IDENTITY="$SIGNING_IDENTITY"
fi

# ── Frontend build ───────────────────────────────────────────────────────
if ! $NO_FRONTEND; then
  run "$NODE_INSTALLER run build"
fi

# ── 应用图标新鲜度 ───────────────────────────────────────────────────────
# 打包读的是 src-tauri/icons/，改了仓库根 logo.png 忘记重生成就会静默出旧图标
# （0.0.5 实际踩过）。这里只做提示：--check 全读、不改任何文件，因此 dry-run 也跑。
if ! bash "$REPO_ROOT/scripts/gen-icons.sh" --check >/dev/null 2>&1; then
  echo "WARN: src-tauri/icons/ 与仓库根 logo.png 不一致 —— 产物可能带旧图标" >&2
  echo "      修复：bash scripts/gen-icons.sh （或 pnpm icons），然后重新构建" >&2
fi

# ── 仅前端模式：dist/ 就绪即结束 ─────────────────────────────────────────
# 不编译 Rust、不打包、不签名，供只改 ts/tsx 的快速验证使用。
if $FRONTEND_ONLY; then
  echo ""
  echo "── frontend-only 完成（跳过 Rust 编译与打包）──────────────"
  if $DRY_RUN; then
    echo "(dry-run: skipping dist/ scan)"
  elif [ -d "$REPO_ROOT/dist" ]; then
    printf "  %8s  %s\n" "$(human_size "$REPO_ROOT/dist")" "$REPO_ROOT/dist"
  else
    echo "WARN: dist/ 不存在 —— 前端构建可能未成功" >&2
  fi
  echo "───────────────────────────────────────────────────────────"
  echo "done."
  exit 0
fi

# ── Assemble final command ───────────────────────────────────────────────
# 注意：在 `set -u` 下展开空数组会报错。`${arr[@]+"${arr[@]}"}`
# 在数组为空时展开为空，非空时展开为其元素。
# shellcheck disable=SC2206,SC2086
CMD=("$NODE_INSTALLER" tauri build
  ${TARGET_ARGS[@]+"${TARGET_ARGS[@]}"}
  ${BUNDLES_ARGS[@]+"${BUNDLES_ARGS[@]}"}
  ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"}
  ${TAURI_CLI_ARGS:-})

# ── Run the build ────────────────────────────────────────────────────────
run "${CMD[*]}"

# ── Resolve bundle output dir for summary ────────────────────────────────
PROFILE_DIR="release"
if $FAST; then
  PROFILE_DIR="release-fast"
fi

# 使用 --target 时，Tauri 将输出放在 target/<target>/<profile>/bundle 下。
# 使用 universal-apple-darwin 时，输出在 target/universal-apple-darwin/<profile>/bundle 下。
TARGET_SUBDIR=""
if [ -n "$TARGET_OVERRIDE" ]; then
  TARGET_SUBDIR="$TARGET_OVERRIDE/"
elif $UNIVERSAL; then
  TARGET_SUBDIR="universal-apple-darwin/"
fi

case "$PLATFORM" in
  macos)   BUNDLE_DIR="target/${TARGET_SUBDIR}${PROFILE_DIR}/bundle/macos" ;;
  linux)   BUNDLE_DIR="target/${TARGET_SUBDIR}${PROFILE_DIR}/bundle/deb target/${TARGET_SUBDIR}${PROFILE_DIR}/bundle/appimage" ;;
  windows) BUNDLE_DIR="target/${TARGET_SUBDIR}${PROFILE_DIR}/bundle/msi" ;;
esac

# ── macOS ad-hoc 封印(兜底) ──────────────────────────────────────────────
# 常规路径:tauri.conf.json 的 bundle.macOS.signingIdentity="-" 让 bundler
# 在打包期封印 .app —— 关键在**时序**:DMG 由 .app 打出,封印必须发生在
# DMG 创建之前,否则 DMG 里的 app 无封印,下载后 Gatekeeper 判「已损坏」
# (v0.0.1 实测翻车:此处的后置封印只救了散装 .app,救不了已打好的 DMG)。
# 这个循环保留为兜底:绕过 conf 的构建路径(旧 tag / TAURI_CLI_ARGS 覆盖)
# 至少保证散装 .app 可校验。幂等,已签名会被覆盖。
if [ "$PLATFORM" = "macos" ] && command -v codesign >/dev/null 2>&1; then
  for dir in $BUNDLE_DIR; do
    for app in "$dir"/*.app; do
      [ -d "$app" ] || continue   # glob didn't match
      # 常规路径下 tauri 已按 conf( signingIdentity="-" + entitlements )封印;
      # 此处再 --force 重签会把嵌入的授权剥掉(产物门禁断言
      # codesign --entitlements 可读,v0.0.3 实测翻车)。已有效签名 → 跳过,
      # 兜底只救真正未签名的散装 .app;兜底签名也带上 entitlements。
      if codesign --verify "$app" 2>/dev/null; then
        continue
      fi
      entitlements=""
      [ -f "${REPO_ROOT}/src-tauri/Entitlements.plist" ] &&
        entitlements="--entitlements ${REPO_ROOT}/src-tauri/Entitlements.plist"
      run "codesign --force --deep --sign - $entitlements '$app'"
    done
  done
fi

# ── Artifact summary ─────────────────────────────────────────────────────
echo ""
echo "── artifacts ──────────────────────────────────────────────"
if $DRY_RUN; then
  echo "(dry-run: skipping artifact scan of $BUNDLE_DIR)"
else
  FOUND=0
  for dir in $BUNDLE_DIR; do
    if [ -d "$dir" ]; then
      # 列出顶层条目（跳过 . ..）。.app/.dmg/.deb/.msi/.AppImage
      # 等安装包都直接出现在 bundle/<type>/ 目录下。
      for entry in "$dir"/*; do
        [ -e "$entry" ] || continue   # glob didn't match
        base="$(basename "$entry")"
        size="$(human_size "$entry")"
        printf "  %8s  %s\n" "$size" "$entry"
      done
      FOUND=1
    fi
  done
  if [ "$FOUND" -eq 0 ]; then
    echo "WARN: no artifacts found under expected paths ($BUNDLE_DIR)" >&2
    echo "      check target/${TARGET_SUBDIR}${PROFILE_DIR}/bundle/ for actual output" >&2
  fi
fi
echo "───────────────────────────────────────────────────────────"
echo "done."
