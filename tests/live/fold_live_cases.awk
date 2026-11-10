# fold_live_cases.awk —— 把 Rust 实模型测试打印的 `LIVE_CASE` 行折叠成
# 门禁用例表(live/run.sh 与自测 live-fold.test.sh 消费**同一份**逻辑,
# 与 artifact/lib.sh 的 codesign 断言同模式:自测跑生产逻辑,不复制)。
#
# 输入:cargo test 输出(混合行中抓 `LIVE_CASE\t<名>\t<状态>\t<原因>`);
# 输出:suite_absorb 兼容的 PASS/FAIL/SKIP 表。
# 除 PASS/FAIL 外一律折为 SKIP —— 「模型不配合 / 上游限流」不是产品缺陷
# (live/run.sh 的纪律:断言只到协议形状)。
/^LIVE_CASE\t/ {
    status = $3; name = $2; reason = $4;
    if (status == "PASS")      printf "PASS\t%s\t%s\n", name, reason;
    else if (status == "FAIL") printf "FAIL\t%s\t%s\n", name, reason;
    else                       printf "SKIP\t%s\t%s\n", name, reason;
}
