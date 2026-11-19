# 规划：内置浏览器控制（submodule 插件 + 桌面面板）

<p align="center">
  <b>中文</b> · <a href="browser-control.en.md">English</a>
</p>

> **状态**：规划定稿，分阶段实施中。
> **目标**：agent 能控制一个浏览器（导航/点击/输入/截屏/读页面结构），桌面端同时把被控页面实时展示在浏览器面板中。
> **关联**：上游 `zhuye-computer-use/src/a11y.rs`（F39 地基）；`todo.md` D1「完整版受控浏览器」；[../capabilities.md](../capabilities.md)。

## 1. 形态决策

**被控端 = 系统 Chrome/Edge/Chromium（headless 新模式），控制通道 = CDP（仅 loopback）**。

- Tauri 自带 webview（WKWebView/WebKitGTK）不支持 CDP，无法作为被控端——排除内嵌 webview 方案。
- headless 运行 + 隔离 profile：无独立 OS 窗口，桌面面板经 CDP `Page.startScreencast` 渲染画面帧，形成「内置」体验；用户主 profile 永不触碰。
- agent 控制（插件 MCP server）与面板显示（桌面 browser_backend）= **两条独立 CDP 连接、同一浏览器实例**（Chrome 支持多 ws 会话）。

## 2. 现状地基

- 上游 computer-use 是完整模板：手写 MCP stdio server（JSON-RPC 2.0 over stdio，不依赖 MCP SDK）、`real` feature 门控重依赖、关闭时优雅 `Unavailable`、`plugins/<name>/bin/` 构建范式。
- `zhuye-computer-use/src/a11y.rs`：`BrowserSecurity`（`loopback_only`/`single_target`/`require_token` + `validate` 已实现带测试）、`A11ySnapshot`/`A11yElement`（`@eN` 引用寻址）、`UiAction`/`verify_action`/`diff_snapshots`——浏览器控制的寻址模型与后验协议已就位。
- 上游无任何 ws 客户端依赖（仅 reqwest HTTP）；CDP 客户端需从零实现。
- 桌面端：静态 iframe 预览（`HtmlPreviewView`）+ LivePorts 端口发现；无第二 WebviewWindow 先例；CSP `img-src data:` 已允许 base64 帧渲染（无需放宽 CSP）。

## 3. 上游改动（ZhuYe 仓库）

1. **新 crate `crates/integrations/zhuye-browser/`**（仿 zhuye-computer-use）：
   - `src/cdp.rs`：极简 CDP 客户端——ws 连接（`tokio-tungstenite`，加进上游根 `[workspace.dependencies]`）、JSON-RPC id 匹配、事件订阅
   - `src/chrome.rs`：浏览器发现（三平台常见路径 + env 覆盖）、launch（隔离 user-data-dir 置于 `$ZHUYE_HOME/browser-profile`，经 `reflect_config::paths`，`--remote-debugging-port=0`）、从 `DevToolsActivePort` 文件解析 ws 端点、attach 已运行实例
   - `src/backend.rs`：`BrowserBackend` trait + CDP 实现（navigate / snapshot / click / type / key / scroll / screenshot / evaluate / close）；复用 `zhuye-computer-use` 的 a11y 类型；连接入口强制 `BrowserSecurity`（v1 启用 loopback_only + single_target；require_token 留接口不启用，理由记录在代码）
   - `src/bin/zhuye-browser-server.rs`：MCP stdio server，工具 `browser_navigate/browser_snapshot/browser_click/browser_type/browser_press_key/browser_scroll/browser_screenshot/browser_close`
   - `Cargo.toml`：`real` feature 默认关（含 ws 依赖），关闭时统一 `Unavailable`
2. **`plugins/browser/`**：`plugin.toml` + `.mcp.json`（`${PLUGIN_ROOT}/bin/zhuye-browser-server`）+ README；`plugins/README.md` 表补行
3. **`scripts/build_browser_plugin.sh`** + 上游 scripts/AGENTS.md 速览表登记
4. **上游门禁**：`tests/functional/` 字段级用例（不可用路径优雅降级）、`tests/COVERAGE.md` 行、`crates/integrations/AGENTS.md` 速览表 + 新 crate 篇 + 根导航表「外部集成」行
5. MCP 工具天然 Prompt 权限 floor（`FloorEnforcingTool`），宿主审批不静默放行

## 4. 桌面改动

1. `app-core/src/browser.rs`：浏览器会话 trait + 配置/状态类型（UI 无关，仿 media.rs；真实实现放 src-tauri，同 media_backend.rs 先例）
2. `src-tauri/src/browser_backend.rs`：launch/attach 共用 `DevToolsActivePort` 发现契约（与插件共享 profile 目录，先到先得、后到 attach）；screencast 帧节流 ~10fps → base64 JPEG → `reflect_browser_frame` 事件推前端
3. `src-tauri/src/commands/browser.rs`：`reflect_browser_status/start/stop`
4. 前端切片 `browser/`（渲染/逻辑分离）：`features/browser/BrowserView.tsx`（薄）→ `logic/browser/useBrowserController.ts` → `render/browser/BrowserPanel.tsx`（URL 栏 + 画面 + 启停 + agent 操作中徽标）；路由 `/browser` + ZRail 入口 + routeMatrix
5. IPC：`src/utils/commands/browser.ts` + fakeBackend + payload 样本（四方一致）
6. 设置：config schema `[browser]`（executable 覆盖、默认 headless）→ advanced 段

## 5. 实施拆分与门禁

- 2a 上游先提交 → `git submodule update --remote zhuye-agent` bump 指针与桌面适配同提交（SUBMODULE.md）
- 上游验证：`cargo fmt` + `clippy -D warnings` + `cargo test --workspace` + `run_all.sh functional`
- 桌面验证：L3 `ipc_browser.rs`（不可用路径/配置往返/事件结构）、L2 切片测试 + 视觉基线重生成、COVERAGE/RUNTIME_COVERAGE 补行
- 文档：`docs/capabilities.md` 能力行、`docs/protocol-bridge.md` 新命令/事件、`docs/changelog.md`

## 6. 风险

- 本机无 Chrome/Chromium：工具层与面板层双降级（Unavailable + 空态引导）。
- 多 CDP 客户端并存是 Chrome 支持的行为，但同一 target 双控制端可能互相干扰——桌面 screencast 连接只读画面不注入输入，规避冲突。
- `require_token` 未启用意味着本机任意进程可连 CDP 端点；loopback + 隔离 profile 已是 v1 边界，token 代理列为后续项。
