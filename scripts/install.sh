#!/usr/bin/env bash
# install.sh —— 安装烛夜（ZhuYe）二进制与 macOS .app
# 用法：
#   bash scripts/install.sh                  # 默认安装到 /usr/local/bin 与 ~/Applications
#   bash scripts/install.sh --dry-run      # 仅打印动作，不实际执行
#   bash scripts/install.sh --prefix=$HOME/.local

set -euo pipefail

PREFIX="${PREFIX:-/usr/local/bin}"
APP_DIR="${APP_DIR:-$HOME/Applications}"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=true ;;
    --prefix=*) PREFIX="${arg#--prefix=}" ;;
    --app-dir=*) APP_DIR="${arg#--app-dir=}" ;;
    -h|--help)
      cat <<EOF
用法：install.sh [--dry-run] [--prefix=PATH] [--app-dir=PATH]

  --prefix=PATH   二进制安装位置（默认：/usr/local/bin）
  --app-dir=PATH  macOS 上 .app 包安装位置（默认：~/Applications）
  --dry-run       仅打印将执行的操作，不修改系统
  -h, --help      显示本帮助

EOF
      exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

# 解析仓库根目录（scripts/ 的父目录）。
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BIN_SRC="$REPO_ROOT/target/release/reflect-desktop"
APP_SRC="$REPO_ROOT/target/release/bundle/macos/ZhuYe.app"

run() {
  echo "+ $*"
  $DRY_RUN || eval "$@"
}

if [ ! -f "$BIN_SRC" ]; then
  echo "binary not found: $BIN_SRC"
  echo "build first: pnpm tauri build --bundles app"
  exit 1
fi

run "install -m 0755 '$BIN_SRC' '$PREFIX/reflect-desktop'"

if [ "$(uname)" = "Darwin" ] && [ -d "$APP_SRC" ]; then
  run "mkdir -p '$APP_DIR'"
  run "rm -rf '$APP_DIR/ZhuYe.app'"
  run "cp -R '$APP_SRC' '$APP_DIR/ZhuYe.app'"
  echo "installed .app → $APP_DIR/ZhuYe.app"
fi

echo "done. launch with: $PREFIX/reflect-desktop"
echo "                  or open $APP_DIR/ZhuYe.app on macOS"
