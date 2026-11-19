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
        app)      continue ;;
        dmg)      dir=dmg; pattern='*.dmg'; updir=macos;   upattern='*.app.tar.gz*' ;;
        deb)      dir=deb; pattern='*.deb'; updir=deb;     upattern='' ;;
        appimage) dir=appimage; pattern='*.AppImage'; updir=appimage; upattern='*.AppImage.tar.gz*' ;;
        msi)      dir=msi; pattern='*.msi'; updir=msi;     upattern='*.msi.zip*' ;;
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
    # updater 产物（OTA 自更新）:有签名密钥时 tauri 才生成,随安装包一起暂存。
    # macOS 的 .app.tar.gz 落在 bundle/macos（与 .app 同目录）;每个 glob 命中
    # 至多一个（包 + .sig 成对），为 0 表示本次构建未启用 updater 产物。
    if [ -n "$upattern" ]; then
        ups=$(find "$bundle_root/$updir" -maxdepth 1 -type f -name "$upattern" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$ups" -gt 2 ]; then
            echo "$type 的 updater 产物多于一对（$ups 个），疑似残留" >&2
            exit 1
        fi
        for f in $(find "$bundle_root/$updir" -maxdepth 1 -type f -name "$upattern" 2>/dev/null); do
            packages+=("$f")
        done
    fi
done
[ "$package_count" -gt 0 ] || { echo "没有可交付的安装包" >&2; exit 1; }
for package in "${packages[@]}"; do
    printf '%s\n' "$package"
    cp "$package" "$staging/" || exit 1
done
