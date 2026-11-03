# ZhuYe (烛夜)

**English** | [简体中文](README.md)

[![CI](https://github.com/Asketisch/ReflectDesktop/actions/workflows/ci.yml/badge.svg)](https://github.com/Asketisch/ReflectDesktop/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Asketisch/ReflectDesktop)](https://github.com/Asketisch/ReflectDesktop/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-orange)]()
[![React 19](https://img.shields.io/badge/React-19-149eca)]()
[![中文](https://img.shields.io/badge/README-中文-red.svg)](README.md)

> A standalone desktop app for the ZhuYe agent: Tauri 2 + React 19, bridging the ZhuYe core through the `reflect-protocol` envelope.

---

## What is this?

The headless mode (`zhuye exec "..."`) of ZhuYe and the SDKs share the same `reflect-core::AgentThread` (the upstream crate was renamed `zhuye-core`; this repo references it under the `reflect-core` alias). The desktop GUI needs to run the same thread inside a Tauri window without coupling Tauri 2 build artifacts into the headless agent tool. ZhuYe desktop therefore keeps all GUI code in this repository and consumes the agent core solely through the `zhuye-agent/` git submodule.

---

## Features

### Sessions & workspaces

- Session sidebar with time grouping: **Now / Today / Yesterday / This week / Earlier** (`useSessions`)
- Resume, replay (`reflect_replay_session`), rename, archive, delete
- Per-thread persisted editor drafts

### Editor & agent controls

- Auto-growing textarea with IME-safe input
- `/` slash-command palette driven by `src/features/composer/slashCommands.ts` (consistent with terminal slash commands)
- `@` file references; drag-and-drop / paste images
- Send: `Cmd+Enter` (macOS) / `Ctrl+Enter` (Linux/Windows)
- Interrupt: `Cmd+.` / `Ctrl+.` → `reflect_interrupt`
- Model picker, effort level, permission mode, approval rules
- The editor lives in `src/features/composer/`; `src/features/messages/Composer.tsx` is a thin re-export layer

### Chat rendering

- `react-markdown` + Shiki code-block highlighting
- Streaming via `AgentMessageDelta` events (single `reflect_event` channel)
- Collapsed consecutive tool calls; `McpToolInvoked` adds a `(via <server>)` badge
- Collapsible thinking blocks (`ThinkingDelta`)

### Approval & user-question modals

- **Approval modal**: tools / hooks / plans — allow once / always allow / deny
- **Question modal**: multiple questions, multiple choice, "other" free text
- **Ask-user modal**: free-text replies
- **Plan-ready modal**: accept / submit changes, with plan Markdown review

### macOS native integration

- Overlay title bar (`macOSPrivateApi: true`, `titleBarStyle: "Overlay"`)
- Dock badge (via `objc2`)
- Close to system tray (hides instead of quitting)
- Global shortcuts (`tauri-plugin-global-shortcut`)

### Backend integration

- **In-process** `Arc<AgentThread>` (no daemon), sharing the same protocol envelope as terminal mode
- Tauri commands split by domain in `src-tauri/src/commands/<domain>.rs`, re-exported by `src-tauri/src/commands/mod.rs`
- Command bodies wrap `reflect_protocol::Op` covering diagnostics / config / tools / sessions / files / Git / Shell / allowlist / workspaces / skills / memory / hooks / search
- Single push-event channel `reflect_event` (payload = `reflect_protocol::Event`)
- `tokio::sync::broadcast` fan-out for multi-subscriber session events

### Settings

- Display (light / dark / system-follow theme, accent color, opacity, wallpaper)
- Editor (Vim mode / output style)
- Providers (default provider + API key placeholder)
- `ConfigForm` covers every section of `zhuye-agent/crates/resources/reflect-config/src/schema.rs`; an advanced raw TOML editor remains as an escape hatch

### Coding plans & quota failover

- Multiple plans per provider via `[[<provider>.credentials]]` entries (label / api_key / base_url / model / quota window), managed in Settings → Coding Plans or the Models page
- One-click default provider switch (`[active].provider`): saving hot-rebuilds the credential pool and force-rebinds the current session — no restart, context preserved
- Within a provider pool, 401 / 429 / 5xx / network errors rotate credentials automatically; `routing` events surface each switch in the status bar
- Cross-provider failover on quota exhaustion: `quota_exhausted` and exhaustion-shaped errors trigger an automatic switch to the next provider with an available plan, with a toast notification (toggleable in Settings, 60s debounce)
- Quota checks via official usage APIs: zhipu / kimi / minimax / zenmux; other providers fall back to local token accounting

---

## Requirements

- Node.js ≥ 20 + pnpm
- Rust toolchain (stable)
- macOS: Xcode command-line tools
- Linux: `webkit2gtk-4.1`, `libayatana-appindicator3-dev`, `librsvg2-dev`
- Windows: WebView2 (bundled with Windows 10+), Microsoft C++ Build Tools

---

## Quick start

### Install a prebuilt build (macOS arm64)

```bash
bash scripts/install.sh
# Installs:
#   /usr/local/bin/reflect-desktop           (binary)
#   ~/Applications/ZhuYe.app                 (launchable bundle)
```

### Build from source

```bash
git clone --recursive https://github.com/Asketisch/ReflectDesktop.git
cd ReflectDesktop
pnpm install
git submodule update --init --recursive
bash scripts/build.sh        # Detects the OS and produces native bundles
bash scripts/install.sh      # macOS: installs .app + binary
```

`scripts/build.sh` detects the current OS and emits the right bundle type:

| OS       | Default bundles | Output path                             |
|----------|-----------------|-----------------------------------------|
| macOS    | `app,dmg`       | `target/release/bundle/macos/`          |
| Linux    | `deb,appimage`  | `target/release/bundle/{deb,appimage}/` |
| Windows  | `msi`           | `target/release/bundle/msi/`            |

Common flags:

```bash
bash scripts/build.sh --fast          # release-fast profile (no LTO, ~2x faster)
bash scripts/build.sh --universal     # macOS universal arm64+x86_64 binary
bash scripts/build.sh --bundles=app   # override bundle list
bash scripts/build.sh --dry-run       # print commands without executing
bash scripts/build.sh --help
```

Equivalent npm scripts: `pnpm build:native`, `pnpm build:universal`, `pnpm build:fast`.

### Development mode

```bash
pnpm tauri dev
# Frontend HMR on :5173, Tauri window opens
```

### Run the verification suite

```bash
pnpm typecheck
pnpm test
cd src-tauri && cargo check
```

---

## Repository layout

```
ReflectDesktop/
├── zhuye-agent/   # git submodule of the Reflect-Agent repo (reflect-* core crates)
│                    # read-only mirror; upgrade via git submodule update --remote
├── app-core/       # shared UI-agnostic reducer & state modules
├── src/            # React 19 + Vite feature-sliced frontend
│   ├── features/   # sliced directories (shell/messages/composer/...)
│   ├── stores/     # agent state store (Zustand), split into agent/ submodules
│   ├── services/   # agent hooks + event bus (compat + refcounted broadcast)
│   ├── utils/      # bridge.ts (low-level invoke/listen) + commands/<domain>.ts
│   │                # + tauri.ts / commands.ts compat barrels + i18n/<domain>/
│   ├── styles/     # tokens.css + base.css + typography.module.css
│   └── types/      # generated from the reflect-protocol schemas
├── src-tauri/      # Tauri 2 Rust backend (binary name: reflect-desktop)
│   └── src/
│       ├── state.rs / events.rs / dock.rs / menu.rs / shortcut.rs
│       │         / tray.rs / mcp.rs        # top-level integration modules
│       ├── commands/mod.rs + commands/<domain>.rs + commands/error.rs
│       └── hook_store.rs / memory_store.rs / shell_sessions.rs
│                     / workspace_state.rs   # private state helpers
├── Cargo.toml      # workspace root (app-core + src-tauri, path refs into the submodule)
├── docs/           # changelog · protocol bridge · code map · architecture · user guide · runbooks
└── scripts/        # install.sh · dump-ts-types.sh · build.sh
```

---

## Tauri IPC command surface

Commands are defined per domain in `src-tauri/src/commands/<domain>.rs`, re-exported via `src-tauri/src/commands/mod.rs`, and registered in `src-tauri/src/lib.rs` through `tauri::generate_handler!`. Commands cover the `reflect_*` family: `Op` submissions, session I/O, config persistence, tool/skill/memory/hook listings, files + Git + Shell + workspaces + allowlist + search, plus `ping` and `reflect_set_dock_badge`.

Frontend wrappers live in `src/utils/commands/<domain>.ts` (canonical); `src/utils/tauri.ts` and `src/utils/commands.ts` remain compat barrels. The low-level `invoke` / `listen` primitives are in `src/utils/bridge.ts`.

Push events: a single channel `reflect_event` carrying `reflect_protocol::Event` (snake_case JSON discriminators covering every `EventMsg` variant).

Full specification: [`docs/PROTOCOL_BRIDGE.md`](docs/PROTOCOL_BRIDGE.md).

---

## Roadmap

| Phase  | Feature slice                                                                                                                                 | Status |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------|--------|
| **M1.x** | Skeleton + protocol bridge + three-pane layout + editor + modals + status bar                                                                | ✅ Done (commits `2c73335` … `76d7717`) |
| **M2.x** | Real AgentThread backend + 4 product integrations (tray/menu/shortcut/Dock) + macOS close-to-tray                                            | ✅ Done (commit `65bff4b`) |
| **M3.x** | 22 built-in tools + Streamdown + context ring + multi-session LRU + recipes + scheduled tasks + deep links                                   | 🔧 In progress |
| **C1..C4** | Tray polish, global hotkeys, Dock + badge, dual-binary install                                                                              | ✅ Partially done |
| **D1..D3** | Remote daemon + iOS app + IM bridge + workflow canvas                                                                                       | 📅 Planned |

Full history: [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

---

## Upgrading the agent core (submodule)

When Reflect-Agent publishes a new version:

```bash
git submodule update --remote zhuye-agent
git diff --submodule zhuye-agent
git add zhuye-agent && git commit -m "chore: bump zhuye-agent submodule"
```

`zhuye-agent/` is a read-only mirror — never edit it in place; submit changes to the Reflect-Agent repo and bump the submodule (full runbook in [`SUBMODULE.md`](SUBMODULE.md)).

Complete runbook: [`docs/multi-agent-sync-runbook.md`](docs/multi-agent-sync-runbook.md).

---

## Documentation map

| Document | Purpose |
|---|---|
| [`docs/codebase-map.md`](docs/codebase-map.md) | Task-oriented "to change X, edit Y" map |
| [`docs/PROTOCOL_BRIDGE.md`](docs/PROTOCOL_BRIDGE.md) | Tauri ↔ reflect-protocol envelope spec |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Top-level layout + state flow |
| [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) | End-user manual |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | Version changelog |
| [`docs/gui/`](docs/gui/) | Historical design docs (M1 snapshot) |
| [`docs/multi-agent-sync-runbook.md`](docs/multi-agent-sync-runbook.md) | Core submodule upgrade checklist |
| [`docs/mobile-ios-tailscale-blueprint.md`](docs/mobile-ios-tailscale-blueprint.md) | iOS + Tailscale setup (planned) |
| [`docs/headless-daemon.md`](docs/headless-daemon.md) | Daemon lifecycle CLI (planned) |
| [`AGENTS.md`](AGENTS.md) | Repo agent contract |
| [`docs/index.html`](docs/index.html) | Rendered docs site (open in a browser) |

---

## License

[Apache-2.0](LICENSE) — please do not report security vulnerabilities through public channels; see [`SECURITY.md`](SECURITY.md).
