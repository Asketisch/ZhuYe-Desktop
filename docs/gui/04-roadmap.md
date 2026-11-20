# 三阶段路线图（设计稿）

> ⚠️ **归档快照**。当前真实进度见 [`../../changelog.md`](../../changelog.md) + [`../codebase-map.md`](../codebase-map.md)。
>
> 任务规格与决策记录已并入 `../../changelog.md`（版本条目）；文中引用的 `docs/todo/21-gui/` 目录已不存在，相关链接视为历史标记不再有效。

---

## 阶段总览

| 阶段 | 名称 | 工期 | 当前状态 |
|---|---|---|---|
| 第一批 | **MVP** | ~4 周单人 | ✅ M1.1–M1.8 已完成 |
| 第二批 | **增强** | ~4 周单人 | 🔧 M2.x 完成（真后端 + 4 product linkages）；M3.x 部分（Streamdown、Context Ring、Recipe、Cron、Deep Link 等） |
| 第三批 | **差异化** | ~6 周单人 | 📅 待排 |

---

## 第一批：MVP — ✅ 已完成

详见 [`../../changelog.md#0.1.0`](../../changelog.md) 与 `git log`（commits `2c73335` … `76d7717`）。

- ✅ M1.1 基础设施（脚手架 + `ZhuyeAgentApp` 占位 + 5 icon）
- ✅ M1.2 协议桥（19 Tauri command + Event 转发，4/4 E2E）
- ✅ M1.3 三栏布局 + Session 列表
- ✅ M1.4 Chat 渲染 + Composer + Slash popup
- ✅ M1.6 Modal 套件
- ✅ M1.7 状态栏 + Settings 基础
- ✅ M1.8 macOS 体验 + USER_GUIDE

### 第一批 DoD（已达成）

- ✅ `cargo test --workspace` 全绿
- ✅ `cargo clippy --workspace -- -D warnings` 通过
- ✅ `pnpm tauri build` macOS + Linux + Windows 三平台成功
- ✅ USER_GUIDE 发布（`docs/gui/user-guide.md`）
- ✅ binary < 20MB（macOS arm64）

---

## 第二批：增强 — 🔧 进行中

### M2.x 真后端（已落地 · commit `65bff4b`）

- ✅ `MinimalAgent` → `zhuye_core::AgentThread`（stub model + `EchoTool`，无网络依赖）
- ✅ Session event broadcast (`tokio::sync::broadcast` 多订阅 fan-out)
- ✅ 4 product linkages：`tray.rs` / `menu.rs` / `shortcut.rs` / `dock.rs`
- ✅ macOS close-to-tray
- ✅ Dual-binary install 脚本（`scripts/install.sh`）

### M3.x 计划（部分已落地）

- [ ] 22 builtin tools 全接入（M2.x 仅 `EchoTool` 占位）
- [ ] Streamdown 流式 Markdown（M1 已用 `react-markdown`，M3.x 升级）
- [ ] Context Ring + Cost Tracker
- [ ] Fork / Compact / Pin / Archive GUI
- [ ] 多会话 LRU
- [ ] Worktree 自动发现
- [ ] Settings 完善（Skills / Memory / Permissions / Tasks / Shortcuts）
- [ ] Recipe 系统初版
- [ ] Cron 调度 UI
- [ ] Deep Link 协议

---

## 第三批：差异化 — 📅 待排

| 项 | 计划 |
|---|---|
| MCP-Apps iframe widgets | M3.1：inline / fullscreen / PiP / standalone 四模 + Portal 渲染 + CSP 强化 |
| 远程 daemon + Tailscale | 独立 daemon binary + JSON-RPC over TLS + iOS/Android/Web 客户端 |
| IM Bridge | Telegram / Feishu / WeCom / Messenger |
| Workflow 画布 | `@xyflow/react` 节点编辑器 |
| Quick Launcher | 全局 hotkey + 无边框小窗 |
| Nostr 分享 | Session 加密导出 |
| i18n 完整化 | FormatJS `react-intl 10` + 14 locale |
| Enterprise 策略 | Signed Ed25519 策略文件 + Branding / plugin allowlist / OIDC SSO |
| Helm chart 部署 | Deployment / Service / Ingress / Secret / PVC / HPA |

### 第三批 DoD（目标）

- 📅 公开 release v1.0
- 📅 ≥ 1 个企业客户试用 Enterprise 策略
- 📅 iOS app 提交 App Store 审核
- 📅 Web demo URL 公开
- 📅 binary < 25MB（macOS arm64）/ < 30MB（Windows）

---

## ADR（Architecture Decision Records）

### ADR-001: 选用 Tauri 2 而非 Electron ✅

**理由**：体积 ~10MB vs ~100MB；性能（Rust vs Node+Chromium）；与现有 `zhuye-*` Rust crate 同语言，零序列化；macOS vibrancy / private API 原生支持。**代价**：Tauri 2 生态较小、iOS 仍在 beta、调试略复杂。

### ADR-002: 共享 reducer 用 `zhuye-app-core` crate ✅（已演化为 `app-core/`）

**理由**：TUI 与 GUI 共享同一份 reducer → 行为一致；清晰的边界（不依赖 ratatui/crossterm/tauri）。**代价**：新 crate 增加编译单元；抽取工作 ~3 周（实际仅 M1 阶段局部完成，M2.x 通过 vendor mirror 替代）。

### ADR-003: 复用 `zhuye-protocol::EventMsg` 作为 IPC 载荷 ✅

**理由**：稳定、serde-friendly、additive 演化；零序列化成本；TUI 已用多年。**代价**：协议改动需双向同步；不能为了 GUI 破坏性变更协议。

### ADR-004: 前端用 Streamdown（流式升级）而非 react-markdown ✅（M3.x 计划）

**理由**：流式 Markdown 是当前最佳 UX；内置 XSS 加固（rehype-harden）；与 React 19 兼容。**代价**：M1 先用 react-markdown 简单版（M3.x 升级）；Streamdown bundle 较大（按需加载）。

### ADR-005: 进程拓扑 — 单进程 Tauri shim（M1–M3.x）✅

**理由**：当前 Rust 端 `zhuye-core`/`zhuye-*` 仍在快速迭代，强做 daemon 会陷入 envelope + state shape 双重维护。**当前**：GUI 直接 in-process 持有 `AgentThread`。**未来（zhuye-core 冻结后）**：抽 `zhuye-runtime` crate → spawn `zhuye-agent-daemon` → Tauri shim 变 thin RPC client。详见 [`05-decision.md`](05-decision.md) §1 + `docs/todo/21-gui/10-strategy.md`。

---

## 风险登记表（精简 · 当前关注）

| 风险 | 缓解 |
|---|---|
| Markdown XSS 安全漏洞 | 优先 `customUrlTransform` + `wrapHTMLInCodeBlock` |
| 流式大量消息性能 | 虚拟列表 (`@tanstack/react-virtual` 已装) + 批渲染 + 节流 |
| 远程 daemon TLS 复杂度 | TLS pinning + self-signed cert 流程（M3.2） |
| 多平台 auto-update 失败 | Tauri `tauri-plugin-updater` 完整测试（M3.x） |
| ZhuYe 主版本协议变更 | 严格 additive 演进，Serde `untagged` 容错 |

---

## 度量指标（M3.x 末目标）

| 指标 | 目标 |
|---|---|
| DAU | ≥ 50（内部） |
| 平均 session 长度 | ≥ 10 minutes |
| 启动时间 | < 1.5s |
| 崩溃率 | < 0.1% |
| 用户反馈满意度 | ≥ 4/5 |
| TUI 切换到 GUI 比例 | ≥ 30% |
| GUI 切换回 TUI 比例 | < 10% |

实时进度以 [`../../changelog.md`](../../changelog.md) 为准。