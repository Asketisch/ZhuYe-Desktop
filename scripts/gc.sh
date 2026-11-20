#!/usr/bin/env bash
# gc.sh —— 回收 cargo 不会自动 GC 的陈旧中间产物占用的磁盘。
#
# cargo 对下列产物**从不**自动清理，随时间无界增长：
#   - <profile>/incremental/    增量编译缓存。dev 已在 [profile.dev] 关增量，
#                              但 release-fast(incremental=true) 与交叉 target
#                              (target/<triple>/{debug,release}/) 仍会持续生成。
#   - llvm-cov-target/          L3 后端覆盖率(cargo-llvm-cov)的重建树，报告型无门槛。
#   - debug/examples/           示例构建产物。
#
# 本脚本是「低痛感」默认档：只删缓存类产物，**不**触碰 deps/ 的 .rlib/.rmeta
# 与 .fingerprint，下次 cargo build 不会触发全量重编，只需补全缺失部分。
# 磁盘真正告急时用 gc-deep 再清 deps/（下次构建 ≈ 冷构建）。
#
# 用法：
#   bash scripts/gc.sh              # 默认：gc
#   bash scripts/gc.sh gc           # 显式：gc
#   bash scripts/gc.sh gc-deep      # gc + 清 target/debug/deps（下次构建 ≈ 冷构建）
#
# 与上游 ZhuYe `make gc` 的**有意偏离**（勿改回）：
#   上游 gc 还会删 target/debug/.fingerprint。经对照实验确认，删 .fingerprint
#   会让 cargo 把**所有**单元判为过期、下次构建全量重编依赖；而 .fingerprint
#   体积仅 ~38M。省盘收益可忽略、重编代价是整个 deps 树，故本脚本不删它。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$REPO_ROOT/target"

mode="${1:-gc}"
case "$mode" in
  gc|gc-deep) ;;
  *)
    echo "未知模式: $mode（支持 gc / gc-deep）" >&2
    exit 2
    ;;
esac

if [ ! -d "$TARGET" ]; then
  echo "target/ 不存在，无需 gc"
  exit 0
fi

# ── gc：缓存类产物（删除安全，不触发全量重编）─────────────────────────
# incremental 覆盖全部 profile（含 release-fast）与交叉 target（target/<triple>/<profile>/）。
rm -rf "$TARGET"/*/incremental "$TARGET"/*/*/incremental
# L3 覆盖率重建树（cargo-llvm-cov 的默认 target-dir）。
rm -rf "$TARGET"/llvm-cov-target
# 示例产物。
rm -rf "$TARGET"/debug/examples

echo "✅ gc 完成：移除 target/**/incremental + llvm-cov-target + debug/examples（保留 deps/.rlib，下次构建不全量重编）"

if [ "$mode" = "gc-deep" ]; then
  # ── gc-deep：再清 deps（下次构建 ≈ 冷构建，仅磁盘告急时用）─────────
  rm -rf "$TARGET"/debug/deps
  echo "✅ gc-deep 完成：另移除 target/debug/deps（下次构建接近冷构建）"
fi
