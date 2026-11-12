# fold_live_cases.awk —— 把 Rust 实模型测试打印的 `LIVE_CASE` 行折叠成
# 门禁用例表(live/run.sh 与自测 live-fold.test.sh 消费**同一份**逻辑,
# 与 artifact/lib.sh 的 codesign 断言同模式:自测跑生产逻辑,不复制)。
#
# 输入:cargo test 输出(混合行中抓 `LIVE_CASE\t<名>\t<状态>\t<原因>`);
# 输出:suite_absorb 兼容的 PASS/FAIL/SKIP 表。
# libtest 的 `test ...` 前缀可能与第一条输出出现在同一行。
index($0, "LIVE_CASE\t") {
    line = substr($0, index($0, "LIVE_CASE\t"));
    count = split(line, fields, "\t");
    name = fields[2]; status = fields[3]; reason = fields[4];
    if (count < 4 || name == "" || (status != "PASS" && status != "FAIL" && status != "SKIP"))
        printf "FAIL\t实模型结果格式错误\t%s\n", line;
    else
        printf "%s\t%s\t%s\n", status, name, reason;
}
