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
