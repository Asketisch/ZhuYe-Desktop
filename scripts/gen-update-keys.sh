#!/usr/bin/env bash
# gen-update-keys.sh —— 生成应用自更新（OTA）的 minisign 密钥对。
#
# tauri-plugin-updater 要求更新包带 minisign 签名：
#   - 私钥：仅保存在本机（默认 ~/.tauri/zhuye-updater.key），并同步配置为
#     GitHub 仓库 secret `TAURI_SIGNING_PRIVATE_KEY`（内容）+
#     `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（口令）；
#   - 公钥：填入 src-tauri/tauri.conf.json > plugins.updater.pubkey。
# 私钥**绝不入库**；丢失后用户只能重装应用（旧公钥失效），务必妥善备份。
#
# 用法：
#   bash scripts/gen-update-keys.sh                 # 交互式生成（会提示口令）
#   bash scripts/gen-update-keys.sh --help
#
# 生成后的手工步骤（脚本会再次提示）：
#   1. 把输出的公钥粘贴进 tauri.conf.json 的 plugins.updater.pubkey；
#   2. gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/zhuye-updater.key
#      gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD "<口令>"

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY_PATH="${TAURI_UPDATE_KEY_PATH:-$HOME/.tauri/zhuye-updater.key}"

case "${1:-}" in
  -h|--help)
    cat <<EOF
用法: bash scripts/gen-update-keys.sh

环境变量:
  TAURI_UPDATE_KEY_PATH   私钥输出路径（默认 ~/.tauri/zhuye-updater.key）
EOF
    exit 0 ;;
esac

if [ -f "$KEY_PATH" ]; then
  echo "私钥已存在: $KEY_PATH" >&2
  echo "如需重建，先手动备份并移走旧密钥（覆盖会导致已发版本无法校验）" >&2
  exit 1
fi

mkdir -p "$(dirname "$KEY_PATH")"

# tauri CLI 自带 minisign 实现，无需额外安装 signify/minisign。
cd "$REPO_ROOT"
echo "── 生成 minisign 密钥对（口令可留空，但强烈建议设置）────────"
pnpm tauri signer generate -w "$KEY_PATH"

echo ""
echo "── 下一步（手工，仓库外）────────────────────────────────────"
PUBKEY="$(sed -n 's/^untrusted comment: .*public key (no password protection)?//p' "$KEY_PATH.pub" 2>/dev/null || true)"
if [ -z "$PUBKEY" ]; then
  # 兼容带口令的公钥注释格式；直接展示文件尾行（公钥本体）。
  PUBKEY="$(tail -n 1 "$KEY_PATH.pub")"
fi
cat <<EOF
1. 公钥粘贴进 src-tauri/tauri.conf.json:
     "plugins": { "updater": { "pubkey": "$PUBKEY" } }

2. 配置 GitHub secrets（release.yml 构建期签名用）:
     gh secret set TAURI_SIGNING_PRIVATE_KEY < "$KEY_PATH"
     gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD   # 交互输入口令

3. 私钥 "$KEY_PATH" 备份到密码管理器/离线介质，然后从工作机删除也可。
EOF
