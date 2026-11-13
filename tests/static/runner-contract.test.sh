#!/usr/bin/env bash
# 在隔离夹具中验证 backend、e2e、live runner 的依赖和结果传递。
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# 发布流水线把 GATE_STRICT=1 / E2E_REQUIRED=1 导出给整个 step;本自测用
# 逐条内联的 GATE_STRICT / E2E_REQUIRED 控制 runner 模式(普通/严格断言
# 各半),必须先把继承值归零,否则「普通模式允许跳过」类断言在发布环境
# 下全部失真。
export GATE_STRICT=0
export E2E_REQUIRED=0
FIXTURE="$TMP/repo"
mkdir -p "$FIXTURE/tests" "$FIXTURE/src-tauri/tests" "$TMP/bin"
cp "$ROOT/src-tauri/tests/ipc_live_capabilities.rs" "$ROOT/src-tauri/tests/ipc_extensions.rs" "$FIXTURE/src-tauri/tests/"
cp "$ROOT/tests/run_all.sh" "$ROOT/tests/lib.sh" "$FIXTURE/tests/"
cp -R "$ROOT/tests/backend" "$ROOT/tests/e2e" "$ROOT/tests/live" "$FIXTURE/tests/"
cat > "$TMP/bin/cargo" <<'CARGO'
#!/usr/bin/env bash
if [ "${FAKE_CARGO_MODE:-backend}" = backend ]; then
    case "$1" in
        test|llvm-cov)
            [ -n "${CARGO_TEST_MARKER:-}" ] && touch "$CARGO_TEST_MARKER"
            [ "$HOME" != "$OUTSIDE_HOME" ] && [ -f "$HOME/.zhuye/config.toml" ] &&
                [ -z "${ZHUYE_HOME+x}" ] && [ -z "${ZHUYE_HUMAN_INPUT_DIR+x}" ] &&
                [ -z "${ZHUYE_ROLLOUT_BASE+x}" ] && [ -z "${ZHUYE_QUOTA_STATE+x}" ] &&
                [ -n "${CARGO_HOME:-}" ] &&
                [ -n "${RUSTUP_HOME:-}" ] && [ "${INSTA_WORKSPACE_ROOT:-}" = "$FIXTURE" ] &&
                [ "${INSTA_UPDATE:-}" = no ] &&
                [ "${npm_config_offline:-}" = true ] &&
                [ "${npm_config_cache:-}" = "$HOME/.npm" ] &&
                [ "${npm_config_registry:-}" = "http://127.0.0.1:9/" ] &&
                [ "$TMPDIR" -ef "$PWD/tmp" ] &&
                grep -qx 'offline=true' "$HOME/.npmrc" &&
                grep -qx 'registry=http://127.0.0.1:9/' "$HOME/.npmrc" &&
                [ "$(git config --global --get init.defaultBranch)" = master ] || exit 9
            if [ "${FAKE_UNAME:-}" = Darwin ]; then
                case "$HOME" in "$FIXTURE"/.test-results/backend-homes/*) ;; *) exit 10 ;; esac
            fi
            if [ "$1" = test ]; then
                case " $* " in
                    *' --all-targets '*)
                        if [ "${FAKE_MISSING_TARGET:-0}" != 1 ]; then
                            printf ' Running tests/ipc_extensions.rs (/tmp/ipc_extensions-abcd)\n'
                            printf 'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n'
                            printf ' Running tests/ipc_live_capabilities.rs (/tmp/ipc_live_capabilities-abcd)\n'
                            printf 'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n'
                        fi
                        case "${FAKE_IGNORED:-0}" in
                            1)
                                printf ' Running tests/ipc_extensions.rs (/tmp/ipc_extensions-abcd)\n'
                                printf 'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n'
                                printf ' Running tests/ipc_live_capabilities.rs (/tmp/ipc_live_capabilities-abcd)\n'
                                printf 'test live_capability_matrix ... ignored, optional\n'
                                printf 'test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out\n'
                                printf ' Running tests/ipc_live_free_model.rs (/tmp/ipc_live_free_model-abcd)\n'
                                printf 'test live_free_model_practice ... ignored, optional\n'
                                printf 'test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out\n'
                                printf ' Running tests/ipc_task_tools_runtime.rs (/tmp/ipc_task_tools_runtime-abcd)\n'
                                printf 'test model_can_read_task_list_details ... ignored, known regression\n'
                                printf 'test result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out\n'
                                ;;
                            collision)
                                printf ' Running tests/other.rs (/tmp/other-abcd)\n'
                                printf 'test live_free_model_practice ... ignored, unrelated\n'
                                printf 'test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out\n'
                                ;;
                            missing) printf 'test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out\n' ;;
                            *) printf 'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n' ;;
                        esac
                        ;;
                esac
            fi
            ;;
    esac
    exit 0
fi
case "$FAKE_CARGO_MODE" in
    pass|duplicate_scene)
        printf 'test live_free_model_practice ... LIVE_CASE\tfree-model-resolution\tPASS\tmodel\n'
        printf 'LIVE_CASE\tfull-chain-protocol-shape\tPASS\tcomplete\n'
        printf 'test live_capability_matrix ... LIVE_CASE\tlive-capability-matrix\tPASS\tmodel\n'
        awk '/^const SCENARIOS:.*= &\[/ { active=1; next } active && /^\];/ { exit } active && /^[[:space:]]*\("/ { line=$0; sub(/^[[:space:]]*\("/, "", line); sub(/".*/, "", line); status = (ENVIRON["REFLECT_LIVE_SCENARIOS"] == "tool-call" && line != "tool-call") ? "SKIP" : "PASS"; printf "LIVE_CASE\t%s\t%s\tcomplete\n", line, status }' "$FIXTURE/src-tauri/tests/ipc_live_capabilities.rs"
        if [ "$FAKE_CARGO_MODE" = duplicate_scene ]; then printf 'LIVE_CASE\tagent-loop\tPASS\tduplicate\n'; fi
        ;;
    missing_scene)
        printf 'LIVE_CASE\tfree-model-resolution\tPASS\tmodel\nLIVE_CASE\tfull-chain-protocol-shape\tPASS\tcomplete\nLIVE_CASE\tlive-capability-matrix\tPASS\tmodel\n'
        ;;
    incomplete) printf 'LIVE_CASE\tfree-model-resolution\tPASS\tmodel\n' ;;
    malformed) printf 'LIVE_CASE\tfree-model-resolution\tBROKEN\tbad\n' ;;
    empty) echo 'cargo diagnostic preserved' ;;
    crash) printf 'LIVE_CASE\tfree-model-resolution\tPASS\tmodel\n'; exit 7 ;;
esac
CARGO
chmod +x "$TMP/bin/cargo"
cat > "$TMP/bin/uname" <<'UNAME'
#!/usr/bin/env bash
if [ "${FAKE_UNAME:-}" = Darwin ]; then printf 'Darwin\n'; else exec /usr/bin/uname "$@"; fi
UNAME
chmod +x "$TMP/bin/uname"
cat > "$TMP/bin/mktemp" <<'MKTEMP'
#!/usr/bin/env bash
case "${FAKE_MKTEMP_FAIL:-}:$*" in
    home:*reflect-desktop-test-home*) exit 1 ;;
    cwd:*reflect-desktop-test-cwd*) exit 1 ;;
esac
exec /usr/bin/mktemp "$@"
MKTEMP
chmod +x "$TMP/bin/mktemp"
export PATH="$TMP/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export RESULT_DIR="$TMP/results"
export OUTSIDE_HOME="$HOME"
export ZHUYE_HOME="$TMP/outside-data"
export ZHUYE_HUMAN_INPUT_DIR="$TMP/outside-input"
export ZHUYE_ROLLOUT_BASE="$TMP/outside-rollouts"
export ZHUYE_QUOTA_STATE="$TMP/outside-quota"
export FIXTURE

GATE_STRICT=1 bash "$FIXTURE/tests/run_all.sh" backend > "$TMP/backend.log" 2>&1 || { cat "$TMP/backend.log"; fail "可选覆盖率工具缺失不应使严格门禁失败"; }
grep -q $'^INFO\tcargo llvm-cov' "$RESULT_DIR/backend.cases" || fail "应记录未生成可选覆盖率报告"
FAKE_IGNORED=1 bash "$FIXTURE/tests/run_all.sh" backend > "$TMP/backend.log" 2>&1 || fail "普通模式应记录被忽略的测试"
grep -q $'^SKIP\tRust 忽略的测试(model_can_read_task_list_details)' "$RESULT_DIR/backend.cases" || fail "已忽略的回归测试必须记录为跳过"
grep -q $'^INFO\t可选外网演练(live_free_model_practice)' "$RESULT_DIR/backend.cases" || fail "实模型入口必须标明独立演练"
if FAKE_IGNORED=1 GATE_STRICT=1 bash "$FIXTURE/tests/run_all.sh" backend > "$TMP/backend.log" 2>&1; then fail "严格模式不得放过被忽略的回归测试"; fi
grep -q '❌ 严格门禁未通过' "$RESULT_DIR/release-review.md" || fail "部分通过但含跳过的套件在严格模式报告中不能显示通过"
FAKE_IGNORED=collision bash "$FIXTURE/tests/run_all.sh" backend > "$TMP/backend.log" 2>&1 || fail "同名测试在普通模式应记录跳过"
grep -q $'^SKIP\tRust 忽略的测试(live_free_model_practice)' "$RESULT_DIR/backend.cases" || fail "其他二进制的同名测试不能当作可选入口"
if FAKE_IGNORED=missing bash "$FIXTURE/tests/run_all.sh" backend > "$TMP/backend.log" 2>&1; then fail "忽略项明细与汇总不一致必须失败"; fi
printf 'invalid awk syntax }\n' > "$FIXTURE/tests/backend/ignored.awk"
if bash "$FIXTURE/tests/run_all.sh" backend > "$TMP/backend.log" 2>&1; then fail "忽略项解析器异常时必须失败"; fi
grep -q $'^FAIL\tRust 测试忽略项解析器运行' "$RESULT_DIR/backend.cases" || fail "解析器异常必须写入结果"
[ -s "$RESULT_DIR/backend-ignored.log" ] || fail "解析器异常日志必须保留"
cp "$ROOT/tests/backend/ignored.awk" "$FIXTURE/tests/backend/ignored.awk"
if FAKE_MISSING_TARGET=1 bash "$FIXTURE/tests/run_all.sh" backend > "$TMP/backend.log" 2>&1; then fail "未发现的集成测试目标必须失败"; fi
grep -q $'^FAIL\t桌面集成测试目标全部运行' "$RESULT_DIR/backend.cases" || fail "缺失集成测试目标必须写入结果"
FAKE_UNAME=Darwin BACKEND_COVERAGE=0 bash "$FIXTURE/tests/run_all.sh" backend > "$TMP/backend.log" 2>&1 || { cat "$TMP/backend.log"; fail "macOS 隔离环境或可选覆盖率开关异常"; }
grep -q $'^INFO\tcargo llvm-cov.*BACKEND_COVERAGE=0' "$RESULT_DIR/backend.cases" || fail "应记录显式关闭覆盖率报告"
for failure in home cwd; do
    if FAKE_MKTEMP_FAIL="$failure" CARGO_TEST_MARKER="$TMP/unisolated-cargo" BACKEND_COVERAGE=0 \
        bash "$FIXTURE/tests/run_all.sh" backend > "$TMP/backend.log" 2>&1; then
        fail "隔离 $failure 创建失败时必须拒绝运行后端测试"
    fi
    [ ! -e "$TMP/unisolated-cargo" ] || fail "隔离失败后仍执行了 cargo test"
done
printf 'stale\n' > "$RESULT_DIR/e2e-window.log"
printf 'stale\n' > "$RESULT_DIR/e2e-window.png"
if E2E_REQUIRED=1 bash "$FIXTURE/tests/run_all.sh" e2e > "$TMP/e2e.log" 2>&1; then fail "强制 E2E 缺少 pnpm 时必须失败"; fi
[ ! -e "$RESULT_DIR/e2e-window.log" ] && [ ! -e "$RESULT_DIR/e2e-window.png" ] || fail "依赖缺失时不得保留旧窗口日志或截图"
mkdir -p "$FIXTURE/node_modules" "$FIXTURE/tests/visual/__baselines__"
cat > "$TMP/bin/node" <<'NODE'
#!/usr/bin/env bash
exit 0
NODE
cat > "$TMP/bin/pnpm" <<'PNPM'
#!/usr/bin/env bash
case "$*" in
    *'vite build'*) mkdir -p "$FIXTURE/dist-visual"; printf 'test\n' > "$FIXTURE/dist-visual/index.html" ;;
    *'vitest run'*) printf '[visual] 首跑:写入 1 张基线 —— 人工审查后入库\n' ;;
esac
PNPM
chmod +x "$TMP/bin/node" "$TMP/bin/pnpm"
FAKE_UNAME=Darwin E2E_SKIP_WINDOW=1 VISUAL_UPDATE=1 bash "$FIXTURE/tests/run_all.sh" e2e > "$TMP/e2e.log" 2>&1 || fail "生成基线在普通模式应记录跳过"
grep -q $'^SKIP\t视觉基线比对' "$RESULT_DIR/e2e.cases" || fail "生成基线不得标记为已比较"
if FAKE_UNAME=Darwin VISUAL_UPDATE=1 GATE_STRICT=1 bash "$FIXTURE/tests/run_all.sh" e2e > "$TMP/e2e.log" 2>&1; then fail "严格门禁不得放行基线生成"; fi
FAKE_UNAME=Darwin E2E_SKIP_WINDOW=1 bash "$FIXTURE/tests/run_all.sh" e2e > "$TMP/e2e.log" 2>&1 || fail "本地首次生成基线在普通模式应记录跳过"
grep -q $'^SKIP\t视觉基线比对' "$RESULT_DIR/e2e.cases" || fail "本地首次生成也不得视为比较通过"

REFLECT_LIVE=1 FAKE_CARGO_MODE=pass bash "$FIXTURE/tests/run_all.sh" live > "$TMP/live.log" 2>&1 || { cat "$TMP/live.log"; fail "完整实模型结果应通过"; }
grep -q $'^PASS\tfree-model-resolution\t' "$RESULT_DIR/live.cases" || fail "libtest 前缀吞掉了首条结果"
for mode in incomplete malformed empty crash missing_scene duplicate_scene; do
    if REFLECT_LIVE=1 FAKE_CARGO_MODE="$mode" bash "$FIXTURE/tests/run_all.sh" live > "$TMP/live.log" 2>&1; then fail "$mode 不应放行"; fi
    if [ "$mode" = empty ]; then grep -q 'cargo diagnostic preserved' "$RESULT_DIR/live-test.log" || fail "无结果时不能覆盖原始日志"; fi
done
REFLECT_LIVE=1 REFLECT_LIVE_SCENARIOS=tool-call FAKE_CARGO_MODE=pass bash "$FIXTURE/tests/run_all.sh" live > "$TMP/live.log" 2>&1 || fail "筛选场景应标记跳过但允许普通模式通过"
grep -q $'^SKIP\tagent-loop\t' "$RESULT_DIR/live.cases" || fail "筛选场景必须逐项标明未覆盖"
if REFLECT_LIVE=1 REFLECT_LIVE_SCENARIOS=tool-call FAKE_CARGO_MODE=pass GATE_STRICT=1 bash "$FIXTURE/tests/run_all.sh" live > "$TMP/live.log" 2>&1; then fail "严格模式应拒绝筛选后的不完整场景"; fi
echo "runner-contract.test.sh self-test: ok"
