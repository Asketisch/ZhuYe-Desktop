# Plan: Built-in Browser Control (submodule plugin + desktop panel)

<p align="center">
  <a href="browser-control.md">中文</a> · <b>English</b>
</p>

> **Status**: plan finalized, phased implementation in progress.
> **Goal**: the agent can control a browser (navigate / click / type / screenshot / read page structure), while the desktop simultaneously shows the controlled page live in a browser panel.
> **Related**: upstream `zhuye-computer-use/src/a11y.rs` (F39 foundation); `todo.md` D1 "full controlled browser"; [../capabilities.md](../capabilities.md).

## 1. Form-factor decision

**Controlled target = system Chrome/Edge/Chromium (new headless mode); control channel = CDP (loopback only).**

- Tauri's own webview (WKWebView/WebKitGTK) does not support CDP and cannot be the controlled target — the embedded-webview option is excluded.
- Headless + isolated profile: no separate OS window; the desktop panel renders screencast frames via CDP `Page.startScreencast`, creating the "built-in" experience; the user's main profile is never touched.
- Agent control (plugin MCP server) and panel display (desktop browser_backend) = **two independent CDP connections to the same browser instance** (Chrome supports multiple ws sessions).

## 2. Existing foundation

- Upstream computer-use is the complete template: hand-written MCP stdio server (JSON-RPC 2.0 over stdio, no MCP SDK dependency), `real` feature gating for heavy deps, graceful `Unavailable` when off, `plugins/<name>/bin/` build convention.
- `zhuye-computer-use/src/a11y.rs`: `BrowserSecurity` (`loopback_only` / `single_target` / `require_token` + implemented, tested `validate`), `A11ySnapshot` / `A11yElement` (`@eN` ref addressing), `UiAction` / `verify_action` / `diff_snapshots` — the addressing model and post-verification protocol for browser control are already in place.
- Upstream has no ws client dependency (only reqwest HTTP); the CDP client must be built from scratch.
- Desktop: static iframe preview (`HtmlPreviewView`) + LivePorts discovery; no second WebviewWindow precedent; CSP `img-src data:` already allows base64 frame rendering (no CSP relaxation needed).

## 3. Upstream changes (ZhuYe repository)

1. **New crate `crates/integrations/zhuye-browser/`** (modeled on zhuye-computer-use):
   - `src/cdp.rs`: minimal CDP client — ws connection (`tokio-tungstenite`, added to the upstream root `[workspace.dependencies]`), JSON-RPC id matching, event subscription
   - `src/chrome.rs`: browser discovery (common paths on three platforms + env override), launch (isolated user-data-dir under `$ZHUYE_HOME/browser-profile` via `reflect_config::paths`, `--remote-debugging-port=0`), ws endpoint parsed from the `DevToolsActivePort` file, attach to a running instance
   - `src/backend.rs`: `BrowserBackend` trait + CDP implementation (navigate / snapshot / click / type / key / scroll / screenshot / evaluate / close); reuses a11y types from `zhuye-computer-use`; `BrowserSecurity` enforced at connect (v1 enables loopback_only + single_target; require_token interface kept but off, rationale recorded in code)
   - `src/bin/zhuye-browser-server.rs`: MCP stdio server with tools `browser_navigate / browser_snapshot / browser_click / browser_type / browser_press_key / browser_scroll / browser_screenshot / browser_close`
   - `Cargo.toml`: `real` feature off by default (includes ws deps), unified `Unavailable` when off
2. **`plugins/browser/`**: `plugin.toml` + `.mcp.json` (`${PLUGIN_ROOT}/bin/zhuye-browser-server`) + README; row added to `plugins/README.md`
3. **`scripts/build_browser_plugin.sh`** + registration in the upstream scripts/AGENTS.md table
4. **Upstream gates**: field-level cases in `tests/functional/` (graceful degradation when unavailable), `tests/COVERAGE.md` row, `crates/integrations/AGENTS.md` table + new crate page + root nav "external integrations" row
5. MCP tools get the Prompt permission floor automatically (`FloorEnforcingTool`) — host approval, never silent

## 4. Desktop changes

1. `app-core/src/browser.rs`: browser session trait + config/status types (UI-agnostic, modeled on media.rs; real implementation in src-tauri, same precedent as media_backend.rs)
2. `src-tauri/src/browser_backend.rs`: launch/attach share the `DevToolsActivePort` discovery contract (shared profile dir with the plugin, first launch wins, later parties attach); screencast frames throttled to ~10fps → base64 JPEG → `reflect_browser_frame` events to the frontend
3. `src-tauri/src/commands/browser.rs`: `reflect_browser_status/start/stop`
4. Frontend slice `browser/` (render/logic separation): `features/browser/BrowserView.tsx` (thin) → `logic/browser/useBrowserController.ts` → `render/browser/BrowserPanel.tsx` (URL bar + picture + start/stop + agent-acting badge); route `/browser` + ZRail entry + routeMatrix
5. IPC: `src/utils/commands/browser.ts` + fakeBackend + payload samples (four-way consistency)
6. Settings: config schema `[browser]` (executable override, default headless) → advanced section

## 5. Implementation breakdown & gates

- 2a commits upstream first → `git submodule update --remote zhuye-agent` bumps the pointer in the same commit as desktop adaptation (SUBMODULE.md)
- Upstream verification: `cargo fmt` + `clippy -D warnings` + `cargo test --workspace` + `run_all.sh functional`
- Desktop verification: L3 `ipc_browser.rs` (unavailable paths / config roundtrip / event structure), L2 slice tests + visual baseline regeneration, COVERAGE/RUNTIME_COVERAGE rows
- Docs: `docs/capabilities.md` capability row, `docs/protocol-bridge.md` new commands/events, `docs/changelog.md`

## 6. Risks

- No Chrome/Chromium on the machine: dual degradation (tool layer + panel layer; Unavailable + empty-state guidance).
- Multiple concurrent CDP clients are supported by Chrome, but two controllers on the same target can interfere — the desktop screencast connection is read-only (frames, no input injection) to avoid conflicts.
- Without `require_token`, any local process could connect to the CDP endpoint; loopback + isolated profile is the v1 boundary, a token proxy is a follow-up.
