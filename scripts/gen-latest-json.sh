#!/usr/bin/env bash
# gen-latest-json.sh —— 汇总各平台 updater 产物生成 tauri-plugin-updater 的
# latest.json（更新清单：platform → { signature, url }）。
#
# 输入目录是 release workflow 中 `download-artifact`(merge-multiple) 合并后的
# 平铺目录，内含各矩阵 job 暂存的安装包与 updater 产物（.app.tar.gz / .msi.zip
# / .AppImage.tar.gz 及对应 .sig）。平台识别按 tauri 产物文件名中的架构 token：
#   aarch64.app.tar.gz        → darwin-aarch64
#   x64.app.tar.gz            → darwin-x86_64
#   x64_en-US.msi.zip         → windows-x86_64
#   amd64.AppImage.tar.gz     → linux-x86_64
#
# 用法：
#   bash scripts/gen-latest-json.sh <artifacts 目录> <版本> <owner/repo> <输出文件>
#   （版本不含 v 前缀；下载 URL 按 GitHub Releases 固定模式拼装）

set -euo pipefail

if [ "$#" -ne 4 ]; then
    echo "用法: gen-latest-json.sh <artifacts 目录> <版本> <owner/repo> <输出文件>" >&2
    exit 1
fi
artifacts_dir="$1"
version="$2"
repo="$3"
out="$4"

command -v jq >/dev/null 2>&1 || { echo "缺少 jq" >&2; exit 1; }
[ -d "$artifacts_dir" ] || { echo "artifacts 目录不存在: $artifacts_dir" >&2; exit 1; }

base_url="https://github.com/${repo}/releases/download/v${version}"

# platform → 架构 token 的映射；每个平台要求 updater 包与 .sig 恰好各一个。
platform_token() {
    case "$1" in
        darwin-aarch64)   echo "aarch64.app.tar.gz" ;;
        darwin-x86_64)    echo "x64.app.tar.gz" ;;
        windows-x86_64)   echo "x64_en-US.msi.zip" ;;
        linux-x86_64)     echo "amd64.AppImage.tar.gz" ;;
        *) return 1 ;;
    esac
}

# 签名文件转 JSON 字符串（.sig 内容为一行 minisign 签名，保留去尾换行）。
sig_json() {
    jq -Rs 'rtrimstr("\n")' < "$1"
}

entries=""
missing=0
for platform in darwin-aarch64 darwin-x86_64 windows-x86_64 linux-x86_64; do
    token="$(platform_token "$platform")"
    # 精确匹配:darwin x64 用 *x64.app.tar.gz，不会误吞 aarch64（token 不同）。
    pkg="$(find "$artifacts_dir" -maxdepth 1 -type f -name "*_${version}_${token}" -print -quit)"
    sig="$(find "$artifacts_dir" -maxdepth 1 -type f -name "*_${version}_${token}.sig" -print -quit)"
    if [ -z "$pkg" ] || [ -z "$sig" ]; then
        echo "缺 ${platform} 的 updater 产物（pkg=${pkg:-无} / sig=${sig:-无}）" >&2
        missing=1
        continue
    fi
    entry=$(printf '{"signature":%s,"url":"%s/%s"}' \
        "$(sig_json "$sig")" "$base_url" "$(basename "$pkg")")
    entries="${entries:+${entries},}\"${platform}\":${entry}"
done

if [ "$missing" -ne 0 ]; then
    echo "latest.json 未生成：存在缺失的平台产物" >&2
    exit 1
fi

pub_date="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"version":"%s","notes":"","pub_date":"%s","platforms":{%s}}\n' \
    "$version" "$pub_date" "$entries" > "$out"

# 自校验:合法 JSON 且四个平台齐全,失败即门禁红。
jq -e '.platforms | keys | length == 4 and (has("darwin-aarch64") and has("darwin-x86_64") and has("windows-x86_64") and has("linux-x86_64"))' "$out" >/dev/null \
    || { echo "latest.json 平台清单不完整" >&2; exit 1; }
echo "生成 ${out}:"
cat "$out"
