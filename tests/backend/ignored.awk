# 折叠 libtest 忽略项，并用汇总计数校验日志是否完整。
/^[[:space:]]*Running / {
    binary = $0
    sub(/^.*\//, "", binary)
    sub(/-[[:xdigit:]]+\).*$/, "", binary)
}
/^test .* \.\.\. ignored([,[:space:]]|$)/ {
    line = $0
    name = line
    sub(/^test /, "", name)
    sub(/ \.\.\. ignored.*$/, "", name)
    seen++
    optional = (binary == "ipc_live_capabilities" && name == "live_capability_matrix") ||
        (binary == "ipc_live_free_model" && name == "live_free_model_practice") ||
        (binary == "zhuye_tools" && (name == "builtins::web_fetch::tests::fetches_html_and_returns_markdown" || name == "builtins::web_search::tests::real_brave_search"))
    if (optional) printf "INFO\t可选外网演练(%s)\t%s\n", name, binary
    else printf "SKIP\tRust 忽略的测试(%s)\t%s: %s\n", name, binary, line
}
/^test result: (ok|FAILED)\./ {
    summaries++
    line = $0
    sub(/^.*; [0-9]+ failed; /, "", line)
    if (line !~ /^[0-9]+ ignored;/) malformed = 1
    else { split(line, parts, " "); reported += parts[1] }
}
END {
    if (!summaries || malformed || seen != reported)
        printf "FAIL\tRust 测试忽略项统计不完整\t汇总 %d 项，逐条 %d 项，汇总行 %d 条\n", reported, seen, summaries
}
