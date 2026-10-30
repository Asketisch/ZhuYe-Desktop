#!/usr/bin/env bash
# tests/e2e/run.sh —— 真窗口 E2E + 视觉回归层(发布门禁 L5)。
#
# 这一层补 L1–L4 都覆盖不到的「最后一公里」:
#   A. **WebDriver 冒烟**(真进程/真后端/真窗口):tauri-driver +
#      WebKitWebDriver(Linux)驱动**构建出的调试二进制**,断言 webview
#      加载了前端、壳层挂载、状态条由真 agent_status 渲染,截图落盘。
#      macOS 无 WKWebView WebDriver(Tauri 官方口径)→ 本机 tskip。
#   B. **视觉回归**(浏览器态):`vite build --config vite.config.visual.ts`
#      把真实前端 + fakeBackend shim 打成 dist-visual/,Playwright(Chromium
#      headless)对全部路由 × dark/light 截图比对基线。基线缺失 = 首跑
#      落盘(报告写明);有基线时逐像素比对,回归零容忍。
#
# 依赖齐备才真跑,缺任一依赖 → 对应用例 tskip,整层不算失败(与
# artifact 层的「产物缺失跳过」同理)。要强制依赖齐备(发布流水线):
#   E2E_REQUIRED=1 bash tests/run_all.sh e2e
#
# 环境变量:
#   E2E_REQUIRED=1     依赖缺失时判失败而不是跳过
#   E2E_SKIP_WINDOW=1  只跑视觉回归(本机调试;Windows 默认只跑这半)
#   E2E_SKIP_VISUAL=1  只跑窗口冒烟
#   VISUAL_UPDATE=1    重生成全部视觉基线(人工审查后入库)
#
# 退出码 0 = 全部通过(或全部合理跳过)。

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib.sh"

cd "$ROOT"

suite_begin "e2e"

PLATFORM="$(uname -s)"
MISSING_REQUIRED=0

# require_or_fail <名> <依赖检测命令...>:依赖缺失时按 E2E_REQUIRED 决定
# tskip 还是记失败(发布流水线不允许「没真正审过」静默通过)。
require_or_fail() {
    local name="$1"
    shift
    if require_cmd "$@"; then
        return 0
    fi
    if [ "${E2E_REQUIRED:-0}" = "1" ]; then
        MISSING_REQUIRED=1
        tcase "$name(依赖齐备)" false
        echo "         │ 缺:$*(E2E_REQUIRED=1 时不允许跳过)"
    else
        tskip "$name" "缺依赖:$*(装好后自动真跑)"
    fi
    return 1
}

# ── 前置:node_modules(pnpm 安装面)────────────────────────────────────
if ! require_cmd pnpm || ! require_node_deps; then
    tskip "e2e" "缺 pnpm / node_modules(先 pnpm install)"
    tfinish
    exit 0
fi

# ── A. 视觉回归(全平台可跑,Chromium headless)───────────────────────────
run_visual() {
    # 1) 构建浏览器态前端(fakeBackend shim 注入)。
    tcase_log "视觉层前端构建(vite build --config vite.config.visual.ts)" \
        "$RESULT_DIR/e2e-visual-build.log" \
        pnpm exec vite build --config vite.config.visual.ts
    if [ ! -s "$ROOT/dist-visual/index.html" ]; then
        echo "         │ dist-visual/ 未产出,视觉回归无法继续"
        return 1
    fi
    # 2) 基线策略:VISUAL_UPDATE=1 → 清空基线目录(重生成);否则比对。
    if [ "${VISUAL_UPDATE:-0}" = "1" ]; then
        rm -rf "$HERE/__baselines__"
        echo "  ↳ VISUAL_UPDATE=1 —— 基线将全部重生成(人工审查后入库)"
    fi
    # 3) Playwright(仅下载 Chromium;core 包免 postinstall 浏览器全家桶)。
    if ! node -e "require.resolve('playwright-core/package.json')" >/dev/null 2>&1; then
        if [ "${E2E_REQUIRED:-0}" = "1" ]; then
            echo "         │ E2E_REQUIRED=1:playwright 未安装,判失败"
            return 1
        fi
        echo "  ↳ playwright 未安装(先: pnpm install --with-playwright 或 pnpm dlx playwright install chromium)—— 视觉回归跳过"
        return 0
    fi
    # 4) 用 vitest 跑视觉 spec(复用仓库的 vitest 基建;--config 指向
    #    视觉专用 vitest 配置,与常规测试隔离)。
    tcase_log "视觉回归(全路由 × dark/light 基线比对)" \
        "$RESULT_DIR/e2e-visual.log" \
        pnpm exec vitest run --config tests/visual/vitest.config.ts tests/visual/visual.spec.ts
    local rc=$?
    # 首跑写基线不算失败:检测基线是否为本轮新生成。
    return $rc
}

if [ "${E2E_SKIP_VISUAL:-0}" != "1" ]; then
    run_visual
else
    tskip "视觉回归" "E2E_SKIP_VISUAL=1"
fi

# ── B. WebDriver 冒烟(仅 Linux;mac/Windows 跳过)────────────────────────
if [ "$PLATFORM" = "Linux" ] && [ "${E2E_SKIP_WINDOW:-0}" != "1" ]; then
    if command -v tauri-driver >/dev/null 2>&1 && command -v WebKitWebDriver >/dev/null 2>&1; then
        # 1) 调试二进制(无 bundle,tauri:options.application 指向它)。
        if [ ! -x "$ROOT/target/debug/reflect-desktop" ]; then
            tcase_log "构建调试二进制(cargo build -p reflect-desktop)" \
                "$RESULT_DIR/e2e-window-build.log" \
                cargo build -p reflect-desktop
        fi
        APP_BIN="$ROOT/target/debug/reflect-desktop"
        if [ ! -x "$APP_BIN" ]; then
            tcase "调试二进制存在" false
        else
            # 2) 隔离环境(不碰开发者的 ~/.zhuye)。
            make_isolated_env
            # 3) 起 tauri-driver(默认端口 4444)。
            tauri-driver > "$RESULT_DIR/e2e-tauri-driver.log" 2>&1 &
            DRIVER_PID=$!
            # 4) xvfb 包住整个驱动+被测进程;webdriver 客户端在 vitest 里建会话。
            run_window_smoke() {
                TAURI_APP_BIN="$APP_BIN" pnpm exec vitest run \
                    --config tests/e2e/vitest.config.ts tests/e2e/window.smoke.test.ts
            }
            if command -v xvfb-run >/dev/null 2>&1; then
                xvfb-run -a bash -c "true"   # 预热:确认 xvfb 可用
                (
                    cd "$ROOT"
                    TAURI_APP_BIN="$APP_BIN" xvfb-run -a pnpm exec vitest run \
                        --config tests/e2e/vitest.config.ts tests/e2e/window.smoke.test.ts
                ) > "$RESULT_DIR/e2e-window.log" 2>&1 && rc=0 || rc=$?
            else
                (
                    cd "$ROOT"
                    TAURI_APP_BIN="$APP_BIN" pnpm exec vitest run \
                        --config tests/e2e/vitest.config.ts tests/e2e/window.smoke.test.ts
                ) > "$RESULT_DIR/e2e-window.log" 2>&1 && rc=0 || rc=$?
            fi
            kill "$DRIVER_PID" 2>/dev/null || true
            wait "$DRIVER_PID" 2>/dev/null || true
            cleanup_isolated_env
            if [ "$rc" -eq 0 ]; then
                PASS_COUNT+=1
                echo "  [ok]   窗口冒烟(tauri-driver + WebKitWebDriver,截图落 .test-results/e2e-window.png)"
                printf 'PASS\t窗口冒烟(真进程/真后端/真窗口)\n' >> "$RESULT_DIR/$SUITE_NAME.cases"
            else
                FAIL_COUNT+=1
                FAIL_NAMES+=("窗口冒烟")
                echo "  [FAIL] 窗口冒烟"
                tail -30 "$RESULT_DIR/e2e-window.log" 2>/dev/null | sed 's/^/         │ /'
                printf 'FAIL\t窗口冒烟(真进程/真后端/真窗口)\n' >> "$RESULT_DIR/$SUITE_NAME.cases"
            fi
        fi
    else
        require_or_fail "窗口冒烟(tauri-driver + WebKitWebDriver)" tauri-driver WebKitWebDriver || true
        if [ "$MISSING_REQUIRED" -eq 0 ] && [ "${E2E_REQUIRED:-0}" != "1" ]; then
            tskip "窗口冒烟" "缺 tauri-driver / WebKitWebDriver(cargo install tauri-driver; apt install webkit2gtk-driver)"
        fi
    fi
else
    if [ "$PLATFORM" != "Linux" ]; then
        tskip "窗口冒烟" "tauri-driver 直连仅 Linux/Windows 有原生桥;macOS 无 WKWebView WebDriver(Tauri 官方口径)—— 视觉回归覆盖 UI 面"
    else
        tskip "窗口冒烟" "E2E_SKIP_WINDOW=1"
    fi
fi

tfinish
