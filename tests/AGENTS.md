# tests/ —— 发布门禁与应用级测试套件

> **何时读我**：要改动门禁分层、新增或调整测试用例、动 mock 替身/契约证据/视觉基线，或同步覆盖口径文档时，先读本文。

## 目录职责

本目录承载两部分：分层发布门禁（`run_all.sh` 六层）与驱动真实前端的应用级 vitest 套件，合起来构成完整功能面证据。

## 分区速览（以文件系统为准）

| 分区 | 内容 |
|---|---|
| `run_all.sh` + `lib.sh` | 门禁入口 + 公共助手（断言 / HOME 隔离 / 便携超时 / 结果落盘） |
| `static/` | L1 静态审查：命令面四方一致、版本一致、大小预算棘轮、仓库品牌名卫生（自有代码禁第三方 agent 产品名，豁免导入线格式/真实模型 id/格式名/changelog 史实/submodule，见 `static/run.sh` 的 `check_brand_names`）等校验器（`*.mjs`）+ 自测（`*.test.sh`） |
| `frontend/` | L2 前端行为：`pnpm typecheck` + vitest 全量（模拟后端） |
| `backend/` | L3 真后端：cargo fmt / clippy / test（+ 可选 llvm-cov 行覆盖报告，重建树落 `target/llvm-cov-target/`，报告型无门槛，可经 `scripts/gc.sh` 回收） |
| `artifact/` | L4 发布产物：.app / .deb / .AppImage / .msi 解包深度校验 + `stage.sh` |
| `e2e/` | L5：WebDriver 真窗口冒烟 + 视觉回归（`run_visual()` 在此层内执行） |
| `visual/` | 视觉回归 spec + `shims/` + `__baselines__/{linux,macos,windows}/` |
| `live/` | L6 实模型演练（默认跳过）：`run.sh` 走桌面 IPC 链路 × 免费模型池。CLI headless 链路 × 真实模型的完整工作流演练（plan → 确认 → 开发 → git commit）**在上游**：`zhuye-agent/tests/live/cli_e2e.sh`（**本地专用，不进 CI**，配置模板 `cli_e2e.example.toml` + gitignore 的本地 `cli_e2e.toml`，直接对上游仓库运行，`ZHUYE_E2E_BIN` 可指桌面构建的二进制验 pin 态） |
| tests 根 `*.test.ts(x)` | 19 个应用级用例（分类见下表） |
| `helpers/` | `fakeBackend.ts` / `appHarness.tsx` / `routeMatrix.ts` |
| `fixtures/` | lsp / mcp stdio 模拟服务器 |
| `contracts/` | ops / events / payloads / roundtrips 四份线格式契约 JSON |
| `runner.py` 等 | 统一调度器（`runner.py` / `test_registry.py` / `test_runner.py` / `performance.py`） |
| `verification/` | diff 触发的可靠性增量选择器（独立工具，非门禁必需） |
| 文档 | `README.md` / `COVERAGE.md` / `RUNTIME_COVERAGE.md` / `PLAN.md` |

## 应用级用例分类（tests 根，全登记）

| 类别 | 用例 |
|---|---|
| a11y | a11y.keyboard / a11y.route-matrix |
| 协议与 IPC | agent.protocol-events / ipc.command-contract / ipc.event-contract / ipc.payload-contract / ipc.roundtrip-contract |
| 聊天与输入 | chat.full-flow / composer.slash-history-attachments / flows.chat-plan-goal-edit / modals.approvals-questions |
| 会话与设置 | sessions.lifecycle / settings.config |
| 视图矩阵 | views.route-matrix / views.untested-slices |
| 健壮性 | errors.boundary / errors.resilience |
| 渲染替换 | renderer.swap（主壳、聊天、输入框与设置页替代实现） |
| 性能与外壳 | perf.budgets / session-shell |

## 本地契约

### 六层的实际口径

- 层级名单以 `run_all.sh` 的 `ALL_SUITES=(static frontend backend artifact e2e live)` 为准，共 6 层；**没有独立的 visual 层**——视觉回归是 e2e 层 `run_visual()` 的一部分（`vite build --config vite.config.visual.ts` 产 `dist-visual/` → Playwright/Chromium + vitest 跑 `visual/`）。各层职责表述见根 AGENTS.md「验证矩阵」。
- `GATE_STRICT=1` 时整层跳过或层内跳过均判失败；结果目录以 `.release-gate.lock` 互斥；报告统一落 `.test-results/release-review.md`。
- live 层需 `ZHUYE_LIVE=1` 显式开启，默认跳过且不发任何网络请求；上游限流/地区门判为跳过而非失败。

### 改 tests/ 要遵守什么

- Shell 用例一律 source `lib.sh`，用 `tcase` / `tcase_log` / `tfinish` / `assert_*` 助手；mktemp HOME 隔离，不污染真实 `~/.zhuye`。
- `helpers/fakeBackend.ts` 依赖 `../src/test/setup.tsx` 的 `mockInvoke` / `emitMockEvent`——改 IPC mock 面时两处联动。
- `contracts/` 四份 JSON 是线格式契约证据，协议变更须同步更新（上游规范见 `../docs/protocol-bridge.md`）。
- **视觉基线按平台三份**（linux / macos / windows），重写必须 `VISUAL_UPDATE=1` 显式声明；路由矩阵以 `helpers/routeMatrix.ts` 的 `ROUTES` 表为唯一源，新增路由三处（行为 / axe / 视觉）自动跟进。
- **⚠️ 像素判定当前关闭**：`visual/visual.spec.ts` 的 `VISUAL_DIFF_DETECTION = false` —— v3 harness 界面高频改版，逐像素判定带来的基线重生成 churn 大于收益。现行行为：**只出图、不判定**（截图写 `.test-results/visual-current/` 供人工翻看，基线保持原样、绝不被悄悄覆盖；缺基线/陈旧基线也不点名）。界面稳定后把开关改回 `true` 即恢复判定，基线用 `VISUAL_UPDATE=1` 重生成。
- **会话侧栏交互实浏览器断言**：`visual/visual.spec.ts` 检查菜单锚点与视口边界、工作区折叠、单击主题切换及跟随系统变化，附菜单截图供人工审查。
- **交互面（弹窗）也要进视觉门禁**：`visual/visual.spec.ts` 的 `SURFACES` 表登记「非路由的可见界面」（v3 起：设置弹窗）。路由矩阵只覆盖「一页一面」，弹窗对门禁隐形 —— 设置弹窗曾整页空白而路由基线张张正常。基线集合完整性校验的口径是「路由矩阵 + 交互面」× 双主题**恰好相等**。
- 视觉构建入口 `visual/main.tsx` **必须引入被测应用的真实样式表**（v3 起为 `src/render/styles/harness.css`）——只引 `tokens.css`/`base.css` 会拍到无布局骨架的空页面，基线从此失真。`visual.spec.ts` 有守卫断言「构建入口引入了 harness.css」，漏引即红。
- 主题在**应用启动前**注入：`page.addInitScript` 必须在应用脚本执行前写 `localStorage['zhuye-theme']`，否则 `getTheme()` 读不到当轮主题，亮/暗基线会整体颠倒且跨用例互相污染。
- **基线必须与消费它的 CI job 同平台生成**：字体渲染差异会逐像素失配。macOS 基线本机生成，linux / windows 走 `.github/workflows/visual-baselines.yml`（`workflow_dispatch` → 下载 artifact 覆盖入库），不要拿本机产物冒充。
- e2e 真窗口路径分平台：Linux（tauri-driver + WebKitWebDriver）与 Windows（msedgedriver）走 WebDriver；macOS 无 WKWebView WebDriver，走系统窗口层冒烟（`e2e/macos_window_smoke.sh`）；Vite 在仓库根运行，应用必须在 `ISO_CWD` 启动以隔离工作区数据。
- 仓库根 `vitest.config.ts` 收集 `src/**` + `tests/**`，但排除 `tests/e2e/**` 与 `tests/visual/**`（L5 各自用独立 vitest.config.ts 跑）。
- 无法自动测试的后端命令在 `command-test-exclusions.json` 登记原因；无测试且无登记会被静态门禁拒绝。
- 新增能力域时同步补 `COVERAGE.md`（能力→套侧行）与 `RUNTIME_COVERAGE.md`（三证据清单行）。

## 禁止事项

- 不要让 mock 层依赖外网或 API key。
- 不要绕过 lib.sh 断言助手自造结果落盘与汇总格式。
- 不要把应用级用例写进 `e2e/` 或 `visual/`（它们不在默认 vitest 全量收集里）。
- 不要改动静态校验器（`static/*.mjs`）而不补或更新对应 `*.test.sh` 自测。
- 不要手改 `__baselines__` 基线截图——重生成走 `VISUAL_UPDATE=1`。
- 不要把 live 层或依赖缺失的跳过折算成通过。

## 注意事项

- 套件系统机制的权威说明是 `README.md`，覆盖口径权威是 `COVERAGE.md`；本文只规定「改 tests/ 要遵守什么」，不复述系统说明。
- `PLAN.md` 是统一调度器的任务目录；入口 `python tests/runner.py list` / `run --suite <名>`。

## 深入阅读

- [README.md](README.md) —— 套件系统说明（权威）
- [COVERAGE.md](COVERAGE.md) —— 能力→套件映射与显式排除理由
- [RUNTIME_COVERAGE.md](RUNTIME_COVERAGE.md) —— 前端替身 / 真实后端 / 实模型三证据清单
- [../AGENTS.md](../AGENTS.md) —— 根契约：验证矩阵与门禁分层
