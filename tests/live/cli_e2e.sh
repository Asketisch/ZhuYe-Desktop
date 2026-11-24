#!/usr/bin/env bash
# tests/live/cli_e2e.sh —— CLI 真模型端到端演练(可选,独立于 L6 门禁)。
#
# ## 这一层测什么
#
# tests/live/run.sh(L6)把免费模型池接进**桌面端 IPC 链路**测协议形状;
# 本脚本把**用户配置的真实模型**接进 **CLI headless 链路**测完整 agent
# 工作流 —— 复刻一次人工验证的全过程:
#
#   实际构建 → 隔离工作区 + plan 模式启动 → agent 出具 plan
#   → 确认 plan(自动批准)→ 正常开发 → git init + commit → 断言产物
#
# 这是沙箱 / 压缩 / plan 门控 / 审批流 / 工具执行**在真实模型下的端到端
# 证据**:桌面 sess_99d9bf0a 实测发现的「沙箱 .git 保护堵死 git init /
# commit」「幽灵压缩误触熔断」两类缺陷,单测各能覆盖一半,只有这个
# 脚本能把整条链一次走通。
#
# ## 默认跳过
#
# 未设 `ZHUYE_LIVE=1` 时整层 SKIP —— 不发任何网络请求。真实模型从
# `~/.zhuye/config.toml` 的活跃模型组解析(可用 `ZHUYE_E2E_CONFIG` 指定
# 其它配置);端点不可达判 **SKIP** 而非失败 —— 测的是代码,不是网络。
#
# 跑法:
#   ZHUYE_LIVE=1 bash tests/live/cli_e2e.sh
#
# 环境变量:
#   ZHUYE_E2E_BIN           二进制路径(默认按需 cargo build -p zhuye-cli)
#   ZHUYE_E2E_CONFIG        配置文件来源(默认 ~/.zhuye/config.toml)
#   ZHUYE_E2E_EFFORT        思考强度(默认 xhigh)
#   ZHUYE_E2E_TASK_FILE     自定义任务提示词(覆盖内置夹具)
#   ZHUYE_E2E_PHASE_TIMEOUT 单阶段超时秒数(默认 1200)
#   ZHUYE_E2E_KEEP          设 1 保留临时目录(调试用,默认清理)
#
# ## 断言口径
#
# 只断言**协议形状 + 产物存在性**:plan markdown 非空、审批后权限切换、
# 全程无结构性错误(尤其 compact_rapid_refill)、工作区产物齐、git 提交
# 由 agent 在沙箱内完成。不断言模型文本。
#
# ## 隔离
#
# mktemp 假 HOME + ZHUYE_HOME:配置从真实 config.toml 拷贝,rollout /
# session notes / token 全落临时目录,不污染真实 ~/.zhuye。git 身份经
# 假 HOME 的 .gitconfig 提供(沙箱内可读)。

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib.sh"

suite_begin "live-cli-e2e"

if [ "${ZHUYE_LIVE:-}" != "1" ]; then
    tskip "CLI 真模型端到端" "未设 ZHUYE_LIVE=1 —— 默认不发网络请求"
    tfinish
    exit 0
fi

# ── 0. 定位 / 构建二进制 ────────────────────────────────────────────────────
BIN="${ZHUYE_E2E_BIN:-$ROOT/zhuye-agent/target/debug/zhuye}"
if [ ! -x "$BIN" ]; then
    echo "  未找到 $BIN,执行 cargo build -p zhuye-cli …"
    if ! (cd "$ROOT/zhuye-agent" && cargo build -p zhuye-cli) > "$RESULT_DIR/cli-e2e-build.log" 2>&1; then
        tail -30 "$RESULT_DIR/cli-e2e-build.log" | sed 's/^/         │ /'
        tcase "构建 zhuye-cli" false
        tfinish
        exit 1
    fi
fi
[ -x "$BIN" ] || { tcase "zhuye 二进制可执行" false; tfinish; exit 1; }

# ── 1. 隔离环境:假 HOME + 配置拷贝 + git 身份 ─────────────────────────────
WORK="$(mktemp -d /tmp/zhuye-cli-e2e.XXXXXX)"
KEEP="${ZHUYE_E2E_KEEP:-0}"
cleanup() {
    if [ "$KEEP" = "1" ]; then
        echo "  [keep] 临时目录保留:$WORK"
    else
        rm -rf "$WORK"
    fi
}
trap cleanup EXIT

CONFIG_SRC="${ZHUYE_E2E_CONFIG:-$HOME/.zhuye/config.toml}"
if [ ! -f "$CONFIG_SRC" ]; then
    tskip "CLI 真模型端到端" "找不到配置 $CONFIG_SRC"
    tfinish
    exit 0
fi
mkdir -p "$WORK/home/.zhuye"
cp "$CONFIG_SRC" "$WORK/home/.zhuye/config.toml"
# git 身份:agent 在沙箱内 commit 时读取(真实 ~/.gitconfig 不进沙箱环境)。
cat > "$WORK/home/.gitconfig" << 'EOF'
[user]
    name = zhuye-e2e
    email = zhuye-e2e@example.com
[commit]
    gpgsign = false
EOF
WS="$WORK/ws"
mkdir -p "$WS"

# ── 2. 端点预检:活跃模型组的 base_url 不可达 → SKIP(不烧超时)──────────
# 解析不依赖 tomllib(系统 python 可能 < 3.11):行级扫描 [active].group
# 与对应 [[model_group]] 块的 base_url。
ENDPOINT=$(python3 - "$WORK/home/.zhuye/config.toml" << 'PYEOF'
import re
import sys

text = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'\[active\][^[]*?group\s*=\s*"([^"]+)"', text, re.S)
if not m:
    sys.exit(0)
active = m.group(1)
for block in re.split(r"(?m)^\[\[model_group\]\]", text)[1:]:
    idm = re.search(r'(?m)^\s*id\s*=\s*"([^"]+)"', block)
    if idm and idm.group(1) == active:
        urlm = re.search(r'(?m)^\s*base_url\s*=\s*"([^"]+)"', block)
        if urlm:
            print(urlm.group(1), end="")
        break
PYEOF
)
if [ -z "$ENDPOINT" ]; then
    tskip "CLI 真模型端到端" "配置里解析不出活跃组的 base_url"
    tfinish
    exit 0
fi
# 可达性 = 有任何 HTTP 响应(鉴权 401 也算可达 —— 只关心连通,不关心配额)。
HTTP_CODE=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$ENDPOINT/models" 2>/dev/null)
if [ -z "$HTTP_CODE" ] || [ "$HTTP_CODE" = "000" ]; then
    tskip "CLI 真模型端到端" "模型端点不可达($ENDPOINT)—— 环境问题,不判失败"
    tfinish
    exit 0
fi
echo "  端点可达:$ENDPOINT (http=$HTTP_CODE)"

# ── 3. 任务夹具:小而完整(读 README → 单页介绍页 → git init + commit)─────
cat > "$WS/README.md" << 'EOF'
# 烽火 Fanfire

烽火是一个(虚构的)高性能日志采集器,单二进制、零依赖、吞吐 100 万行/秒。

## 特性
- 单二进制分发,开箱即用
- 内存占用 < 30MB
- 内置 Prometheus 指标端点

## 快速开始
fanfire --config fanfire.toml
EOF
cat > "$WORK/task.txt" << 'EOF'
阅读本工作区的 README.md,为「烽火 Fanfire」制作一个单页介绍站:创建 index.html(内联 CSS 的原生单文件,不引任何外部依赖),内容需包含产品名、定位一句话、三个特性、快速开始命令。完成后把工作区初始化为 git 仓库(git init -b main)并把 README.md 与 index.html 一起提交(提交信息用「feat: 烽火介绍单页」;git 身份用 -c user.name/-c user.email 参数传入,不要依赖全局配置)。不要做 README 之外的事。
EOF
cat > "$WORK/continue.txt" << 'EOF'
如果 git init / commit 尚未完成请继续完成它(index.html 与 README.md 都要在提交里);已全部完成则直接给出最终答复。
EOF

# ── 4. 驱动(阶段超时默认 1200s,真实模型 + xhigh 思考需要余量)────────────
EVENTS="$RESULT_DIR/cli-e2e-events.jsonl"
RESULT_JSON="$RESULT_DIR/cli-e2e-result.json"
python3 "$HERE/cli_e2e_driver.py" \
    --bin "$BIN" \
    --workspace "$WS" \
    --home "$WORK/home" \
    --task-file "$WORK/task.txt" \
    --continue-file "$WORK/continue.txt" \
    --effort "${ZHUYE_E2E_EFFORT:-xhigh}" \
    --events "$EVENTS" \
    --result "$RESULT_JSON" \
    --phase-timeout "${ZHUYE_E2E_PHASE_TIMEOUT:-1200}" \
    > "$RESULT_DIR/cli-e2e-summary.json" 2> "$RESULT_DIR/cli-e2e-driver.err"
DRIVER_STATUS=$?

# ── 5. 断言(结构化;产物与 git 状态直接对工作区验)────────────────────────
if [ "$DRIVER_STATUS" -eq 2 ]; then
    # 环境性跳过(端点不可达):折成 SKIP,不算失败。
    tskip "CLI 真模型端到端" "模型端点不可达(见 $RESULT_JSON)"
    tfinish
    exit 0
fi

if [ ! -s "$RESULT_JSON" ]; then
    echo "  驱动器没有产出结果 JSON"
    tail -30 "$RESULT_DIR/cli-e2e-driver.err" | sed 's/^/         │ /'
    tcase "结果 JSON 产出" false
    tfinish
    exit 1
fi

# 分项断言,各读结果 JSON 的一个键。
tcase "会话配置(模型解析成功)" python3 -c "
import json, sys
r = json.load(open('$RESULT_JSON'))
sys.exit(0 if r.get('model') else 1)"
tcase "plan 正式产出(markdown 非空)" python3 -c "
import json, sys
r = json.load(open('$RESULT_JSON'))
sys.exit(0 if r.get('plan_ready') and r.get('plan_markdown_chars', 0) > 0 else 1)"
tcase "plan 审批生效(进入开发模式)" python3 -c "
import json, sys
r = json.load(open('$RESULT_JSON'))
sys.exit(0 if r.get('plan_approved') and any('accept_edits' in p for p in r.get('permission_flow', [])) else 1)"
tcase "全程无结构性错误(含 compact_rapid_refill)" python3 -c "
import json, sys
r = json.load(open('$RESULT_JSON'))
bad = {'compact_rapid_refill', 'invalid_submission', 'prompt_rejected'}
sys.exit(0 if not (set(r.get('error_codes', [])) & bad) else 1)"
tcase "回合终态 success" python3 -c "
import json, sys
r = json.load(open('$RESULT_JSON'))
sys.exit(0 if r.get('status') == 'PASS' else 1)"
tcase "产物存在(index.html)" test -s "$WS/index.html"
tcase "git 仓库含 agent 提交(沙箱回归核心断言)" bash -c '
    git -C "'"$WS"'" rev-parse --verify HEAD >/dev/null 2>&1 &&
    git -C "'"$WS"'" log --format=%s | grep -q "feat: 烽火介绍单页"'

echo
echo "  事件留档:$EVENTS"
echo "  结果 JSON:$RESULT_JSON($([ "$KEEP" = 1 ] && echo "临时目录保留:$WORK" || echo "临时目录已清理,ZHUYE_E2E_KEEP=1 可保留"))"
tfinish
