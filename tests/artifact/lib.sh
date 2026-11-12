# tests/artifact/lib.sh —— 产物层共享断言。
#
# 与自测脚本(codesign-entitlements.test.sh)共用:自测跑的是**生产同一
# 份**函数,而不是复制一份逻辑再各改各的 —— 与 L3 夹具驱动生产命令
# 注册表同一道理。

# codesign_entitlements_ok <bundle> <logfile>:
# 断言 bundle 的签名里嵌有授权 blob。
#
# `codesign -d --entitlements :-` 把授权 plist 写到 stdout;签名里没有
# 授权时非零退出。封印校验(--verify --deep --strict)只验完整性,
# Entitlements 接线缺失验不出 —— 要到公证/App Store 审核才炸。输出为空
# (退出 0 但无内容)同样拒绝:那不是有效的授权 blob。
codesign_entitlements_ok() {
    local bundle="$1" log="$2"
    [ -n "$bundle" ] && [ -d "$bundle" ] && [ -n "$log" ] || return 1
    codesign -d --entitlements :- "$bundle" 2>/dev/null > "$log" || return 1
    [ -s "$log" ]
}

# installer_upgrade_ok <repo-root> <binary> <app-bundle>:
# 在隔离 HOME / prefix 中执行两次生产安装脚本，验证二进制与 .app 替换，
# 且第二次安装不会保留旧 bundle 中的陈旧文件。
installer_upgrade_ok() {
    local root="$1" bin_src="$2" app_src="$3"
    local tmp prefix app_dir
    tmp=$(mktemp -d "${TMPDIR:-/tmp}/zhuye-installer.XXXXXX") || return 1
    prefix="$tmp/bin"
    app_dir="$tmp/Applications"
    HOME="$tmp/home" bash "$root/scripts/install.sh" \
        --prefix="$prefix" --app-dir="$app_dir" >/dev/null || {
        rm -rf "$tmp"
        return 1
    }
    if ! cmp -s "$bin_src" "$prefix/reflect-desktop"; then
        echo "已安装二进制与构建产物不一致"
        rm -rf "$tmp"
        return 1
    fi
    if ! cmp -s "$app_src/Contents/Info.plist" "$app_dir/ZhuYe.app/Contents/Info.plist"; then
        echo "已安装 .app 与构建产物不一致"
        rm -rf "$tmp"
        return 1
    fi
    printf 'stale\n' > "$app_dir/ZhuYe.app/stale-upgrade-marker"
    HOME="$tmp/home" bash "$root/scripts/install.sh" \
        --prefix="$prefix" --app-dir="$app_dir" >/dev/null || {
        rm -rf "$tmp"
        return 1
    }
    if [ -e "$app_dir/ZhuYe.app/stale-upgrade-marker" ]; then
        echo "重复安装保留了旧 bundle 文件"
        rm -rf "$tmp"
        return 1
    fi
    rm -rf "$tmp"
    echo "安装与覆盖升级往返通过"
}
