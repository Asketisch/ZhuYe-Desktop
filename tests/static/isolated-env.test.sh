#!/usr/bin/env bash
# 隔离目录创建失败时，不得切换到或清理非测试数据。
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/home-parent"
source "$ROOT/tests/lib.sh"

original_home="$HOME"
original_cwd="$PWD"
export ZHUYE_HOME="$fixture/real-data"
export ZHUYE_HUMAN_INPUT_DIR="$fixture/real-data"
export ZHUYE_ROLLOUT_BASE="$fixture/real-data"
export ZHUYE_QUOTA_STATE="$fixture/real-data/quota.json"
mkdir -p "$ZHUYE_HOME"
printf 'preserve' > "$ZHUYE_HOME/sentinel"

# 第一处 mktemp 失败，不能改变 HOME、cwd 或 ZHUYE_HOME。
export TMPDIR="$fixture/missing-parent"
if make_isolated_env; then
    echo '隔离 HOME 创建失败时必须返回错误' >&2
    exit 1
fi
[ "$HOME" = "$original_home" ] && [ "$PWD" = "$original_cwd" ] &&
    [ "$ZHUYE_HOME" = "$fixture/real-data" ] || exit 1
[ "$(cat "$ZHUYE_HOME/sentinel")" = preserve ] || exit 1

# HOME 创建成功但 cwd 创建失败，必须删除新 HOME 并保留原环境。
if make_isolated_env "$fixture/home-parent"; then
    echo '隔离 cwd 创建失败时必须返回错误' >&2
    exit 1
fi
[ "$HOME" = "$original_home" ] && [ "$PWD" = "$original_cwd" ] &&
    [ "$ZHUYE_HOME" = "$fixture/real-data" ] || exit 1
[ -z "$(ls -A "$fixture/home-parent")" ] || {
    echo '隔离失败后遗留临时 HOME' >&2
    exit 1
}
[ "$(cat "$ZHUYE_HOME/sentinel")" = preserve ] || exit 1

# 成功隔离时必须移除所有覆盖目录及真实 provider 凭证。
export TMPDIR="$fixture/"
export OPENAI_API_KEY="test-only-value"
make_isolated_env "$fixture/home-parent" || exit 1
case "$ISO_HOME:$ISO_CWD" in *'//'*) echo '隔离路径不应有多余斜杠' >&2; exit 1 ;; esac
[ -z "${ZHUYE_HOME+x}" ] && [ -z "${ZHUYE_HUMAN_INPUT_DIR+x}" ] &&
    [ -z "${ZHUYE_ROLLOUT_BASE+x}" ] && [ -z "${ZHUYE_QUOTA_STATE+x}" ] &&
    [ -z "${OPENAI_API_KEY+x}" ] || {
    echo '隔离后仍继承外部数据目录或凭证' >&2
    exit 1
}
[ "$(cat "$fixture/real-data/sentinel")" = preserve ] || exit 1
cd "$original_cwd" || exit 1
cleanup_isolated_env
echo 'isolated-env.test.sh self-test: ok'
