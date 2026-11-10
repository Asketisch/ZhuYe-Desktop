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
    if ! tcase_log "视觉层前端构建(vite build --config vite.config.visual.ts)" \
        "$RESULT_DIR/e2e-visual-build.log" \
        pnpm exec vite build --config vite.config.visual.ts; then
        return 1
    fi
    if [ ! -s "$ROOT/dist-visual/index.html" ]; then
        tcase "视觉层前端构建产物(dist-visual/index.html)" false
        echo "         │ dist-visual/ 未产出,视觉回归无法继续"
        return 1
    fi
    # 2) 基线策略:VISUAL_UPDATE=1 → 清空基线目录(重生成);否则比对。
    #    基线在视觉 spec 旁的 tests/visual/__baselines__/(不是本目录)。
    if [ "${VISUAL_UPDATE:-0}" = "1" ]; then
        rm -rf "$ROOT/tests/visual/__baselines__"
        echo "  ↳ VISUAL_UPDATE=1 —— 基线将全部重生成(人工审查后入库)"
    fi
    # 3) Playwright(仅下载 Chromium;core 包免 postinstall 浏览器全家桶)。
    #    依赖缺失必须**记录成用例**(tskip / 失败),不能只 echo —— 否则
    #    E2E_REQUIRED=1 的发布流水线里"该跑没跑"与"跑了"无法区分。
    if ! node -e "require.resolve('playwright-core/package.json')" >/dev/null 2>&1; then
        if [ "${E2E_REQUIRED:-0}" = "1" ]; then
            tcase "视觉回归(playwright 依赖齐备)" false
            echo "         │ E2E_REQUIRED=1:playwright-core 未安装,判失败(先: pnpm exec playwright-core install chromium)"
            return 1
        fi
        tskip "视觉回归" "playwright-core 未安装(先: pnpm install --with-playwright 或 pnpm dlx playwright install chromium)"
        return 0
    fi
    # 4) 用 vitest 跑视觉 spec(复用仓库的 vitest 基建;--config 指向
    #    视觉专用 vitest 配置,与常规测试隔离)。
    tcase_log "视觉回归(全路由 × dark/light 基线比对)" \
        "$RESULT_DIR/e2e-visual.log" \
        pnpm exec vitest run --config tests/visual/vitest.config.ts tests/visual/visual.spec.ts
}

if [ "${E2E_SKIP_VISUAL:-0}" != "1" ]; then
    # 之前这里丢弃返回值:run_visual 内部判失败后整层照样"通过"。
    if ! run_visual; then
        FAIL_COUNT+=1
        FAIL_NAMES+=("视觉回归(编排失败)")
        printf 'FAIL\t视觉回归(编排失败)\n' >> "$RESULT_DIR/$SUITE_NAME.cases"
    fi
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
        # 调试二进制按 devUrl(http://localhost:5173)加载前端,没有内嵌
        # 资源 —— 必须先起 vite dev server 并等就绪,否则 webview 显示的是
        # WebKit 的 "Could not connect to localhost" 错误页(实拍见
        # .test-results/e2e-window.png)。app_served 由收尾分支读取。
        start_dev_server() {
            (
                cd "$ROOT"
                pnpm dev > "$RESULT_DIR/e2e-vite.log" 2>&1
            ) &
            VITE_PID=$!
            local i
            for i in $(seq 1 60); do
                curl -fsS http://localhost:5173/ >/dev/null 2>&1 && return 0
                sleep 0.5
            done
            return 1
        }
        app_served=0
        if [ ! -x "$APP_BIN" ]; then
            tcase "调试二进制存在" false
        elif ! start_dev_server; then
            tcase "vite dev server 就绪(30s)" false
            tail -15 "$RESULT_DIR/e2e-vite.log" 2>/dev/null | sed 's/^/         │ /'
        else
            app_served=1
            # 2) 隔离环境(不碰开发者的 ~/.zhuye)。
            make_isolated_env
            # 3) 起 tauri-driver(默认端口 4444)。**必须自己跑在 xvfb 下**:
            #    WebKitWebDriver 会派生被测应用,应用开窗口需要 DISPLAY ——
            #    旧实现只把 vitest(HTTP 客户端,无需显示)包进 xvfb,应用侧
            #    反而没有显示,会话永远 ready 不了,beforeAll 60s 超时。
            #    另因 CI 无 GPU,WebKit 合成器必须走软件渲染,否则 webview
            #    首帧可能卡死(WebView 官方 CI 同款环境变量)。setsid 让
            #    driver 树自成进程组,收尾时可整组击杀(xvfb-run 不转发
            #    信号给子命令,只 kill 它会留下孤儿 driver 占着 4444)。
            setsid env WEBKIT_DISABLE_COMPOSITING_MODE=1 xvfb-run -a \
                tauri-driver > "$RESULT_DIR/e2e-tauri-driver.log" 2>&1 &
            DRIVER_PID=$!
            # 3.5) 等驱动就绪:tauri-driver 后台启动,绑定 4444 需要一点
            #      时间 —— 旧实现起完就跑客户端,首连撞上绑定窗口就是
            #      ECONNREFUSED(v0.0.1 tag 门禁实测翻车,前几轮全靠运气)。
            #      /dev/tcp 探端口(bash 内建,不引入 curl 依赖);驱动进程
            #      死掉立即短路,不空等 30s。
            driver_ready=0
            for _ in $(seq 1 60); do
                if (exec 3<>/dev/tcp/127.0.0.1/4444) 2>/dev/null; then
                    driver_ready=1
                    break
                fi
                kill -0 "$DRIVER_PID" 2>/dev/null || break
                sleep 0.5
            done
            # 4) webdriver 客户端(vitest)只与 tauri-driver 走 HTTP,无需显示;
            #    显示由驱动侧的 xvfb 提供。
            run_window_smoke() {
                TAURI_APP_BIN="$APP_BIN" pnpm exec vitest run \
                    --config tests/e2e/vitest.config.ts tests/e2e/window.smoke.test.ts
            }
            rc=0
            if [ "$driver_ready" -ne 1 ]; then
                rc=1
                echo "         │ tauri-driver 30s 未监听 4444 —— 驱动日志:"
                tail -15 "$RESULT_DIR/e2e-tauri-driver.log" 2>/dev/null | sed 's/^/         │ /'
            elif command -v xvfb-run >/dev/null 2>&1; then
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
            # 整组击杀 driver 树(tauri-driver / WebKitWebDriver / 被测应用)。
            kill -- -"$DRIVER_PID" 2>/dev/null || true
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
        # vite dev server 无论冒烟成败都要收(随套件退出,不留给下一个套件)。
        if [ "${app_served:-0}" -eq 1 ] && [ -n "${VITE_PID:-}" ]; then
            kill "$VITE_PID" 2>/dev/null || true
            wait "$VITE_PID" 2>/dev/null || true
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
