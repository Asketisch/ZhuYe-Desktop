# ZhuYe — Architecture

<p align="center">
  <a href="architecture.md">中文</a> · <b>English</b>
</p>

> **What this covers**: the system-level architecture of the desktop app — top-level layout, IPC contract, build pipeline, state flow, and submodule organization.
> **Audience**: readers who need to understand the internals or do secondary development; for day-to-day "to change X, edit Y" see [codebase-map.md](codebase-map.md).
> **Division of labor**: [README.md](../README.md) covers installation and usage; the root [AGENTS.md](../AGENTS.md) carries the development contracts and layered navigation; [protocol-bridge.md](protocol-bridge.md) is the authoritative wire-format spec.

## 1. Top-level layout

```
ZhuYe-Desktop/
├── zhuye-agent/            # git submodule: ZhuYe agent engine (zhuye-* crates, read-only mirror; see SUBMODULE.md)
├── app-core/               # UI-agnostic domain service layer (app-core/AGENTS.md)
├── src/                    # React 19 + Vite frontend (src/AGENTS.md)
│   ├── features/           # Feature slices: views + controllers/hooks + colocated tests (slice overview in src/features/AGENTS.md)
│   ├── stores/             # Zustand state layer (src/stores/AGENTS.md)
│   ├── utils/              # IPC wrappers (commands/, per domain), i18n runtime, bridge fallback (src/utils/AGENTS.md)
│   ├── services/           # agentEventBus (the single zhuye_event subscription point) + agent.ts compat layer
│   ├── types/              # Hand-written per-domain protocol types; dump-ts-types.sh output is not kept in the worktree
│   ├── styles/             # tokens.css, the single source of truth for design tokens
│   └── components/         # Cross-slice shared components
├── src-tauri/              # Rust backend (Tauri 2; src-tauri/AGENTS.md)
│   └── src/
│       ├── main.rs         # Binary entry point
│       ├── lib.rs          # Tauri builder + setup + invoke_handler! (command registry)
│       ├── state.rs        # AgentThread host (MinimalAgent wrapper; state/ submodules in src-tauri/src/state/AGENTS.md)
│       ├── events.rs       # Single event channel forwarder
│       ├── commands/       # Domain command files + error.rs (src-tauri/src/commands/AGENTS.md)
│       ├── tray.rs / menu.rs / shortcut.rs / dock.rs
│       └── {hook_store,memory_store,shell_sessions,workspace_state}.rs   # Private state helper modules
├── docs/                   # This directory: architecture / protocol / capability matrix / user guide / changelog / gui/ (archived design docs)
├── tests/                  # Layered release gate + app-level suites (tests/AGENTS.md)
├── scripts/                # Build / release / icon scripts (scripts/AGENTS.md)
├── Cargo.toml              # Workspace root
└── package.json            # Frontend manifest (vite + tauri)
```

The full map of slices and files is deliberately not maintained here (hard-coding a mutable set guarantees drift): the feature-slice list lives in the `src/features/AGENTS.md` overview table, and the file-level path mapping lives in [codebase-map.md](codebase-map.md).

## 2. IPC contract

The wire format is exactly `zhuye-protocol::Event` / `Submission` (snake_case JSON), with no custom serializer. The envelope structure, the `Op` → Tauri command mapping, and the event tables live in [protocol-bridge.md](protocol-bridge.md).

The command surface (`#[tauri::command]`) is registered in `src-tauri/src/lib.rs::invoke_handler` and defined per domain in `src-tauri/src/commands/<domain>.rs`; the thin barrel `commands/mod.rs` re-exports the domain modules plus the shared `error` types (`CommandError` / `CommandResult`). On the event side, the single push channel `zhuye_event` is emitted by `events::forward_agent_events`; terminal output goes through the separate channel `zhuye_terminal_output`.

The concrete command list is not registered here: it is guarded by the four-way consistency gate — the backend registry ↔ the frontend `src/utils/commands/` wrappers ↔ `fakeBackend` implementations ↔ [protocol-bridge.md](protocol-bridge.md) coverage (the `tests/static/analyze.mjs` ratchet floor + the `src-tauri/tests/ipc_*.rs` real-backend contracts).

## 3. Build pipeline

```text
                pnpm tauri dev/build
                       │
        ┌──────────────┴──────────────┐
        ▼                              ▼
   Frontend                        src-tauri/
   (Vite + tsc)                   (Tauri 2 + cargo build)
        │                              │
        │  bundled into dist/          │  produces binary + .app/.msi/.deb
        └──────────────┬───────────────┘
                       ▼
            target/release/...
            ├── zhuye-desktop (Mach-O)
            ├── bundle/macos/ZhuYe.app
            └── bundle/{dmg,msi,deb,appimage}/...
```

`scripts/install.sh` consumes the binary + installer packages. Core crates are referenced via the git submodule (`zhuye-agent/`) and upgraded with `git submodule update --remote` (full procedure in `SUBMODULE.md`). The two are independent of each other — no build-time dependency exists between them.

## 4. State flow

```text
┌───────────────── React 19（single Zustand store）─────────────────┐
│ features/shell/AppShell（ActivityBar / Sidebar / Main / Inspector）│
│   ↑                                                                   │
│   │ shell/hooks/{useCommandPaletteShortcut, usePaletteActions,       │
│   │   useThemeCycle}                                                  │
│ features/messages/ChatView（MessageList + Composer re-export）        │
│   ↑                                                                   │
│ features/composer/{Composer, SlashPopup, useComposerInput,         │
│   │   useComposerSubmission, useAttachments, usePromptHistory}       │
│ features/memory/MemoryView ← useMemoryController                     │
│ features/terminal/TerminalView ← useTerminalController               │
│ features/modals/ModalStack（Approval/Question/AskUser/PlanReady）     │
│   ↑                                                                   │
│   │ useAgentStore（stores/agent/store.ts）— single source of truth    │
│   │   dispatcher: stores/agent/reducer.ts                             │
│   │ useAgent（services/agent.ts）— compat re-export                   │
│   │ event fan-out: services/agentEventBus.ts (reference-counted)      │
│   ▼                                                                   │
│ onZhuyeEvent → agentEventBus → reducer（agent/reducer.ts）          │
└─────────────────────────┬─────────────────────────────────────────┘
                          │ Tauri 2 IPC（invoke / listen）
┌─────────────────────────▼─────────────────────────────────────────┐
│ src-tauri/                                                          │
│   bridge: src/utils/bridge.ts（invoke/listen + fallback）             │
│   command barrel: src-tauri/src/commands/mod.rs                      │
│     └─ per-domain command bodies in src-tauri/src/commands/<domain>.rs│
│   state::MinimalAgent                                                │
│     ├─ mpsc Sender<Submission>                                       │
│     ├─ broadcast Receiver<Event> fan-out                             │
│     ├─ shell_sessions / hook_store / memory_store / workspace_state │
│     └─ MinimalAgentInner                                            │
│                                                                       │
│      ↔ zhuye_core::AgentThread                                     │
│     + upstream shared builtin tool table（Bash/Read/Write/Q&A/AST/...）│
│     + ModelRegistry                                                  │
│     + ConfigWatcher                                                  │
│     + zhuye-rollout::JsonlRolloutWriter                            │
└────────────────────────────────────────────────────────────────────┘
```

## 5. Core submodule

`zhuye-agent/` is a **read-only** git submodule mirror of the ZhuYe agent engine's zhuye-* crates (referenced on the desktop via the `zhuye-*` dependency aliases). The submodule model lets the GUI keep its own release cadence, independent of the engine repo's CI, while still receiving bug fixes from zhuye-protocol / zhuye-core and the rest.

Upgrading:

```bash
# Pull the latest core from the ZhuYe engine repository
git submodule update --remote zhuye-agent
git diff --submodule zhuye-agent   # review
git add zhuye-agent
git commit -m "chore: bump zhuye-agent submodule"
```

The submodule intentionally excludes the parts the GUI does not depend on (such as the `zhuye` top-level binary and other TUI/CLI-only artifacts). The full crate set kept in sync is in the root `Cargo.toml`'s `[workspace.dependencies]` and in `SUBMODULE.md`.
