#!/usr/bin/env bash
# 验证子模块状态前缀和已暂存变更的发布审查。
set -eu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
REAL_GIT="$(command -v git)"
export REAL_GIT
mkdir -p "$TMP/bin" "$TMP/results"
cat > "$TMP/bin/git" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == '-C' && "$3" == 'submodule' && "$4" == 'status' ]]; then
    printf '%s%s reflect-agent\n' "$TEST_MARKER" e4560bcedc6bb775eb4f8bf5e14164e3d07e88fc
    exit 0
fi
if [[ "$1" == '-C' && "$3" == 'diff' ]]; then
    [[ " $* " == *' HEAD '* && " $* " == *' --ignore-submodules=none '* ]] || exit 2
    exit "$TEST_DIFF_STATUS"
fi
exec "$REAL_GIT" "$@"
EOF
chmod +x "$TMP/bin/git"
export PATH="$TMP/bin:$PATH" RESULT_DIR="$TMP/results"
for mode in clean changed staged uninitialized; do
    case "$mode" in
        clean) TEST_MARKER=' '; TEST_DIFF_STATUS=0 ;;
        changed) TEST_MARKER='+'; TEST_DIFF_STATUS=1 ;;
        staged) TEST_MARKER=' '; TEST_DIFF_STATUS=1 ;;
        uninitialized) TEST_MARKER='-'; TEST_DIFF_STATUS=0 ;;
    esac
    export TEST_MARKER TEST_DIFF_STATUS
    bash "$HERE/run.sh" > "$TMP/$mode.log" 2>&1 || true
done
grep -q '\[ok\].*能力矩阵与 submodule 版本一致' "$TMP/clean.log"
grep -q '\[ok\].*能力矩阵与 submodule 版本一致' "$TMP/changed.log"
grep -q '\[FAIL\].*submodule 指针已提交' "$TMP/changed.log"
grep -q '\[FAIL\].*submodule 指针已提交' "$TMP/staged.log"
grep -q 'submodule 未初始化或存在冲突' "$TMP/uninitialized.log"
