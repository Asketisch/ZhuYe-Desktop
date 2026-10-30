#!/usr/bin/env bash
# 验证分析器正常失败、异常退出和旧报告不会隐藏真实结果。
set -eu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
REAL_NODE="$(command -v node)"
export REAL_NODE
mkdir -p "$TMP/bin" "$TMP/results"
cat > "$TMP/bin/node" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == */analyze.mjs ]]; then
    case "$ANALYZER_TEST_MODE" in
        fail) printf 'PASS\tprobe-pass\nFAIL\tprobe-failure\tactual reason\n' > "$2"; exit 1 ;;
        crash) exit 2 ;;
        pass) printf 'PASS\tprobe-pass\n' > "$2"; exit 0 ;;
    esac
fi
exec "$REAL_NODE" "$@"
EOF
chmod +x "$TMP/bin/node"
export PATH="$TMP/bin:$PATH" RESULT_DIR="$TMP/results"
for mode in fail crash pass; do
    export ANALYZER_TEST_MODE="$mode"
    # 仓库可能有其他发布阻断项，只检查分析器的分类。
    bash "$HERE/run.sh" > "$TMP/$mode.log" 2>&1 || true
done
grep -q 'probe-failure.*actual reason' "$TMP/fail.log"
! grep -q '静态分析器运行' "$TMP/fail.log"
grep -q '静态分析器运行' "$TMP/crash.log"
grep -q 'probe-pass' "$TMP/pass.log"
! grep -q '静态分析器运行' "$TMP/pass.log"
