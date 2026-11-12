#!/usr/bin/env bash
# 只暂存当前目标中审查过的安装包；所有类型通过检查后才开始复制。
set -u
if [ "$#" -ne 3 ]; then
    echo "用法: stage.sh <bundle 目录> <逗号分隔类型> <暂存目录>" >&2
    exit 2
fi
bundle_root="$1"
bundle_types="$2"
staging="$3"
case "$bundle_types" in ''|,*|*,|*,,*) echo "产物类型清单无效" >&2; exit 1 ;; esac
mkdir -p "$staging" || exit 1
if [ -n "$(find "$staging" -mindepth 1 -print -quit)" ]; then
    echo "产物暂存目录非空，拒绝上传未审查文件" >&2
    exit 1
fi
IFS=',' read -ra types <<< "$bundle_types"
packages=()
package_count=0
seen=','
for type in "${types[@]}"; do
    case "$seen" in *",$type,"*) echo "重复产物类型:$type" >&2; exit 1 ;; esac
    seen="$seen$type,"
    case "$type" in
        app) continue ;;
        dmg) dir=dmg; pattern='*.dmg' ;;
        deb) dir=deb; pattern='*.deb' ;;
        appimage) dir=appimage; pattern='*.AppImage' ;;
        msi) dir=msi; pattern='*.msi' ;;
        *) echo "未知产物类型:$type" >&2; exit 1 ;;
    esac
    count=$(find "$bundle_root/$dir" -maxdepth 1 -type f -name "$pattern" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$count" != 1 ]; then
        echo "$type 预期恰好一个安装包，实际 $count 个" >&2
        exit 1
    fi
    package=$(find "$bundle_root/$dir" -maxdepth 1 -type f -name "$pattern" -print -quit)
    [ -f "$package" ] || { echo "已审查的 $type 安装包不存在" >&2; exit 1; }
    packages+=("$package")
    package_count=$((package_count + 1))
done
[ "$package_count" -gt 0 ] || { echo "没有可交付的安装包" >&2; exit 1; }
for package in "${packages[@]}"; do
    printf '%s\n' "$package"
    cp "$package" "$staging/" || exit 1
done
