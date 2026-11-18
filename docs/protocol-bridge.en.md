# Protocol Bridge (Tauri ↔ ZhuYe Protocol)

<p align="center">
  <a href="protocol-bridge.md">中文</a> · <b>English</b>
</p>

> **The wire format is the `reflect_protocol::Event` / `Submission` passed through directly (snake_case JSON).** On the desktop side, `reflect_protocol` is the Cargo alias of the upstream `zhuye-protocol` package; the same envelope is shared with the upstream TUI and `zhuye exec`.
>
> Reading order: §1 Envelope → §2 Submissions (UI → backend) → §3 Events (backend → UI) → §4 ID pairing → §5 Version compatibility → §6 Frontend TypeScript interfaces.

---

## 1. Envelope

```rust
// zhuye-agent/crates/protocol/zhuye-protocol/src/event.rs
pub struct Event {
    pub id: String,     // matches Submission.id; EVENT_ID_NONE = "" for lifecycle
    pub msg: EventMsg,  // serde-tagged enum (snake_case)
}
```

Two channels:

- **UI → backend**: `invoke('reflect_submit', { submission })` where `submission: Submission = { id, op, ... }`.
- **backend → UI**: `listen('reflect_event', handler)` with the payload being an `Event`. **Single channel name**; dispatch on `msg.type` (snake_case discriminator).

> The frontend never wraps things in an envelope of its own. Tauri command names are the only framework.

---

## 2. Submissions (UI → backend)

`Op` variants are listed in `zhuye-agent/crates/protocol/zhuye-protocol/src/op.rs`; each maps 1:1 to a Tauri command whose body lives in `src-tauri/src/commands/<domain>.rs` (re-exported by `src-tauri/src/commands/mod.rs`). The full set is in the §2.0 table below; the canonical Op→command mapping is the single source of truth and should be regenerated when `reflect-protocol/src/op.rs` changes.

> **Note**: except for `UserInput`, which `reflect_submit` accepts as a full `Submission`, the backend of every other Op command
> constructs the `Op` internally inside `commands/<domain>.rs` and delivers it via `MinimalAgent::submit_op`.
> All Op commands return a `string` (the submission id, for frontend pairing/debugging).

> **v1.4 steering / subagent bridging**: `steer` (mid-turn steering) and `query_subagents`
> (subagent status query, answered by the `subagent_status` event) are bridged via `reflect_steer` /
> `reflect_query_subagents` (`commands/agent.rs`); the frontend IPC wrappers live in
> `src/utils/commands/agent.ts`. Steer injection is harvested by the engine at pre_loop safe points,
> **no protocol event is emitted** (recorder only), and the GUI renders the interjection optimistically
> inside `store.steer`.

> **Goal mode (v1.2 P1)**: `enter_goal_mode { goal, verify_command?, token_budget? }` /
> `exit_goal_mode` map to `reflect_enter_goal_mode` / `reflect_exit_goal_mode`
> (`commands/goal.rs` / `commands/goal.ts`). After goal mode is entered, the core-side
> `GoalController` self-verifies at the end of every turn (LM judge + optional verify command) and
> continues automatically via steering when incomplete — **no new user submission needed**; the GUI
> renders the multi-turn continuation through regular turn/streaming events, with no goal-specific
> event variants. Observability goes through a **read port** rather than events:
> `reflect_goal_snapshot` (v1.7) reads `AgentThread::goal_snapshot()` directly
> (upstream `GoalController::snapshot()`), returning `GoalState | null` (snake_case
> on the wire) — consumed by the Composer goal badge tooltip and the `goalActive` projection calibration;
> trigger points: after session hydrate, and at goal turn completion (`turn_complete` with goalActive).

### 2.0 Commands outside Op (diagnostics / config / domain I/O)

These commands do not correspond to `Op` variants; they coexist with Op-derived commands in the same domain modules:

| Command | Payload | Returns | Location (Rust) / Location (TS) |
|---|---|---|---|
| `ping` | `null` | `{ msg, version }` | `src-tauri/src/commands/agent.rs` (barrel) / `src/utils/commands/health.ts` |
| `reflect_submit` | `{ submission }` | `string` (submission id) | `commands/agent.rs` / `commands/agent.ts`. **Image attachment normalization**: images in the frontend Composer are data-URL (base64) strings, while protocol `UserInputItem::Image.data` is `Vec<u8>` (serde requires a numeric array); the application layer decodes the string data (data-URL or raw base64) of `type:"image"` entries into byte arrays before serde deserialization. The wire format stays compact and the protocol layer unchanged |
| `reflect_agent_status` | `null` | `{ ready, has_model, model, workspace, degraded_reason }` | `commands/agent.rs` / `commands/agent.ts` |
| `reflect_get_config` | `null` | `string` (TOML) | `commands/config.rs` / `commands/config.ts` |
| `reflect_save_config` | `{ toml }` | `null` | `commands/config.rs` / `commands/config.ts`. Validated via `load_from_str` before writing; when provider-related sections (`active` / `anthropic` / `openai` / `ollama` / `routing` / **`model_discovery`**) change, the ModelRegistry + QuotaTracker are rebuilt and the current session force-rebound (coding plan switching needs no restart, see `state/reload.rs`). A `[model_discovery]` change also triggers a reload — it decides which model `model = "free"` picks from the catalog (switch / preference / free-detection rules). When config was written but model resolution failed, **the save is not reported as failed** (that would mislead users into retrying); the failure reason goes into `agent_status.degraded_reason` (visible as the status bar yellow dot) |
| `reflect_set_model` | `{ provider, model, label? }` | `string` (**resolved** full spec; empty string when no explicit model) | `commands/config.rs` / `commands/config.ts`. Runtime model switching / pinning a coding plan (no `SetModel` `Op`): writes `[active].provider` + `[active].credential` (when `label` is non-empty, pins that credential entry) → reuses the same write path as `reflect_save_config` + `hot_reload_provider_stack` (rebuild registry + force rebind), effective from the next turn. `provider` accepts only `anthropic \| openai \| ollama`; when `label` matches a `[[<provider>.credentials]]` entry, model is written to the entry itself (entry model takes precedence over section level); missing/`'default'` label (no array entries) uses section-level `[<provider>].model`; an explicit `label` with no matching entry errors. Upstream `resolve_model` resolves honestly (env > pinned entry model > section level) and **fabricates no built-in default** when nothing is configured → returns an empty string and the UI shows "no model configured". **Dynamic values**: when model is `"free"` (runtime picks a free model from the provider catalog), the return value is the **resolved real id** (e.g. `openai/union-alpha`), not the placeholder `openai/free`; resolution failure (catalog unreachable / no free model / `[model_discovery] enabled = false`) → the command errors and the reason is reported honestly. Consumed by the Composer inline model picker and the Models page plan cards |
| `reflect_query_plan_quota` | `{ baseUrl, apiKey, checkVia }` | `PlanQuotaSnapshot` (`{ success, error, utilization, remaining_tokens, max_tokens, resets_at }`) | `commands/config.rs` / `commands/config.ts`. Manual coding plan usage query (Settings → Coding Plans "query usage" button; only for coding plans / token plans with `quota.check_via` configured): `checkVia` (`kimi \| zhipu \| minimax \| zenmux`) instantiates `reflect_llm::QuotaProvider` through the same mapping in `state/quota.rs::make_provider`, querying the vendor usage API (endpoints match cc-switch), sharing the implementation with the runtime failover check. Takes explicit `baseUrl`/`apiKey` (not provider+label), so unsaved in-editing forms can also test-query. `volcengine` / `anthropic_usage` / `open_a_i_usage` not yet implemented → the command errors; transient network failures collapse into `success=false` (same shape as deterministic failures, uniform UI handling) |
| `reflect_get_effort` | `null` | `string` (`low \| medium \| high \| max \| ultra`; new tiers from upstream v1.x) | `commands/effort.rs` / `commands/permissions.ts`. Reads `AgentConfig::current_effort()` from the thread directly (no effort readback event in the protocol); falls back to `low` when the thread is not installed. Used to initialize the Composer inline thinking-depth control and the Models page segmented control |
| `reflect_goal_snapshot` | `null` | `GoalSnapshotPayload \| null` (snake_case, mirrors Rust `reflect_goal::GoalState`) | `commands/agent.rs` / `commands/goal.ts`. **Goal mode state snapshot** (v1.7): reads `AgentThread::goal_snapshot()` directly; goal mode has no protocol event, so this read port is the single authoritative source for "active or not / which round / LM verdict / accumulated tokens". Returns `null` when goal mode is not active (same when rebind lost the controller). The frontend store's `syncGoalSnapshot` pulls after session hydrate and at goal turn completion, calibrating the `goalActive` projection and feeding the Composer goal badge tooltip with round / token / status |
| `reflect_list_tools` | `null` | `Vec<{ name, description }>` | `commands/agent.rs` / `commands/agent.ts` |
| `reflect_list_plugin_commands` | `null` | `Vec<PluginCommandInfo>` (`{ name, description? }`) | `commands/plugins.rs` / `commands/plugins.ts`. Read-only snapshot of slash commands from mounted plugins (candidate source for the composer popup): takes the plugin runtime's `CommandRegistry.list()`; returns an empty list when not mounted (placeholder thread / no enabled plugins / missing HOME). `name` is the full command name (`plugin:ns:name`); the frontend submits `/name args`, expansion is still done uniformly by the backend submit boundary `expand_submission` — this command performs no file IO |
| `reflect_credential_pool_status` / `reflect_recovery_state` / `reflect_config_info` | `null` | `CredentialPoolStatus[]` / `SubagentCallRecord[]` / `ConfigInfo` (all camelCase) | `commands/runtime_status.rs` / `commands/runtimeStatus.ts`. Credential pool health, completed subagent calls, config location and analytics health. |
| `reflect_memory_sections` | `{ expectedContext? }` | `MemorySectionInfo[]` (camelCase) | Uses core `split_sections` to parse the disk memory of the current workspace and active agent, returning section titles, bodies, in-file order and body length. Rejects the query when `expectedContext: { workspace, agent }` does not match; sections are candidates — actual injection also depends on enabled scopes and the query. |
| `reflect_list_plugins` / `reflect_list_marketplaces` / `reflect_toggle_plugin` / `reflect_uninstall_plugin` / `reflect_install_plugin` | `null` / `null` / `{ id, enabled }` / `{ id, scope }` / `{ path, marketplace, scope }` | `PluginInfo[]` / `MarketplaceInfo[]` / `null` / `null` / `null` (outer fields camelCase; `scope` on the wire is the lowercase enum `managed`/`user`/`project`/`local`) | `list_plugins` returns installed items, config-enabled state and `runtime` (`PluginLoadedEvent` when the current session loaded successfully, otherwise null; internal event fields are snake_case). `list_marketplaces` returns the configured sources. `toggle` updates config and syncs the runtime; `uninstall` / `install` update the install manifest via the core `PluginManager`, then refresh the current session's plugin runtime. Refresh failure returns an error; the install manifest may already be updated. Consumed by the Collaboration view PluginsPanel. |
| `reflect_browse_marketplace` / `reflect_install_from_marketplace` | `{ name }` / `{ marketplace, plugin }` | `MarketplacePluginInfo[]` / `null` (outer fields camelCase) | v1.11 desktop#2 plugin marketplace: `browse` reads the cached directory of that marketplace in known_marketplaces.json and parses `.claude-plugin/marketplace.json`, returning plugin metadata per entry (name/description/version/category/tags/source); a structured error is returned when the marketplace is unregistered or the cache is not materialized. `install_from_marketplace` installs via the core `PluginManager::install_from_marketplace` (DepResolver post-order dependency install) then refreshes the runtime. Consumed by the PluginsPanel marketplace rows. |
| `reflect_install_skill` | `{ repo }` | `String` (rescan submission id) | v1.11 desktop#1 skill marketplace: installs a skill from a GitHub repo (`owner/repo` with SKILL.md at root) into the user-level `~/.zhuye/skills/`, then triggers `Op::RescanExtensions`. Repo shape validation precedes the network. Consumed by SkillsView marketplace rows. |
| `reflect_import_discover` / `reflect_import_sessions` | `{ kind }` / `{ kind, force, dryRun, includeThinking, keepInjected }` | `ImportSourceInfo[]` / `ImportRunResult` (outer fields camelCase; `kind` on the wire is `claude_code` / `codex` / `zcode`) | v1.11 D9 external agent import: `discover` lists importable sources by kind (no persistence); `sessions` batch-imports via the `reflect-import` engine into the local rollout base; a single-source failure does not abort the batch (failures returned item by item). Imported sessions appear in the existing session list / replay naturally. Consumed by ImportView. |
| `reflect_set_workspace_dirs` / `reflect_current_workspace_dirs` | `{ main, additional }` / `{}` | `null` / `WorkspaceDirsInfo { main, additional }` (camelCase) | v1.11 desktop#5 multi-directory composite workspace: the main workspace is validated for existence + is-a-directory; additional directories are deduplicated, entries equal to the main are skipped, and all are appended to `AgentConfig.sandbox_writable` (sandbox boundary for file tools). Takes effect for newly bound sessions. Consumed by the WorkspacesView additional-directories editor. |
| `reflect_status_server_start` / `reflect_status_server_state` / `reflect_status_server_stop` | `{ port? }` / `{}` / `{}` | `u16` (bound port) / `u16 | null` / `null` | v1.11 infra#12 remote web status page: hand-written HTTP/1.1 `GET /status` read-only diagnostic JSON (reachable directly from tailnet device browsers); enforced when `auth_token` is non-empty (`?token=` or Bearer). Idempotent replacement; stop is a no-op when not running. Consumed by RemoteView start/stop controls. |
| `reflect_list_provider_models` | `{ baseUrl, apiKey, endpoint }` | `ProviderModelsResult` (`{ endpoint, models: [{ id, display_name, supports_vision, is_free, context_window }] }`) | `commands/models.rs` / `commands/models.ts`. Fetches the available model list against base_url + api_key: `openai` → `GET {base}/models` (Bearer), `anthropic` → `GET {base}/v1/models` (`x-api-key` + `anthropic-version`). `supports_vision` comes from the OpenRouter-style `architecture.input_modalities` / `input_modalities` (contains `image` = vision), `null` when official APIs don't return it → user judges. `is_free` = free-detection (`true` / `false` decided, `null` = **unknown**: the vendor didn't state and no rule matched — cannot assert free), rules taken from the **currently effective** `[model_discovery]` section (`always_free` / `free_id_patterns`, built-in defaults when empty) — the same rules the engine uses when running `model = "free"`. `context_window` comes from `context_window` → `context_length` → `top_provider.context_length` (same口径 as upstream `reflect_llm`). Consumed by the Composer model picker and Coding Plans form; Composer option rows append a "free" badge. **Doubles as a zero-token connectivity test** (Plans form "test connection") |
| `reflect_test_provider_chat` | `{ baseUrl, apiKey, endpoint, model }` | `{ reply }` | `commands/models.rs` / `commands/models.ts`. Sends the test message "你好" to verify auth/network/inference: a single user message, **deliberately no system prompt and no tools definitions**, `max_tokens = 32` to keep waste down. `openai` → `POST {base}/chat/completions`; `anthropic` → `POST {base}/v1/messages` (reply joined from `content[]` text blocks). Consumed by the Plans form "send test message" button |
| `reflect_list_sessions` / `reflect_rename_session` / `reflect_delete_session` / `reflect_replay_session` | `{ workspace?, limit?, offset? }` / — / — / — | `SessionInfo[]` / — / — / — | `commands/sessions.rs` / `commands/sessions.ts`. `workspace` is an optional filter (exact match against `SessionInfo.workspace`; legacy sessions with `workspace = None` appear only in the unfiltered list) |
| `reflect_create_session` | `null` | `string` (ThreadId) | `commands/sessions.rs` / `commands/sessions.ts`. Pure ID allocation (New Chat gets a routing id first); no backend binding is triggered; the session file is materialized by the backend on the first `UserInput`, writing `SessionMeta.workspace` (the workspace value comes from the top-level `workspace` of the first `Submission` of any type, falling back to `cfg.current_workspace()`) |
| `reflect_bind_session` | `{ id }` | `string` (the bound thread's PermissionMode, e.g. `"plan"`) | `commands/sessions.rs` / `commands/sessions.ts`. Rebinds the backend `AgentThread` to the given session id: replays the id's JSONL → `records_to_preload` → rebuilds the thread (`with_session_id` + M4 recorder with the same id). **Permission mode binds to the session**: the last `PermissionModeChanged` in the audit trail is restored as the new thread's initial mode via `with_initial_permission_mode` (`Bypass` downgraded to `Prompt` per the v1.3 security baseline; default `Auto` when no record), while provider-hot-reload force rebinds pass through the old thread's current mode. **Idempotent on the backend** (same id short-circuits, still returns the thread's actual mode); unknown ids (just allocated by `reflect_create_session`, not yet persisted) take the empty-history branch without error. ChatView calls it once per session mount (bind → `syncPermissionMode(return value)` → replay → hydrate sequence); the old thread is drained with bounds via `cancel_token`, and the cron driver restarts after swapping senders (job uuid preserved) |
| `reflect_fork_session` | `{ id, branch?, upToTurnId? }` | `string` (child session id) | `commands/sessions.rs` / `commands/sessions.ts`. GUI entry for CLI `reflect session fork`: `rollout_index::fork_with_history` copies the parent session JSONL (`upToTurnId` up to and including a turn, `None` = full) into a new child session, appends a `Fork` lineage marker to the parent file, and the child inherits the parent SessionMeta model while writing `branch` (default `manual`) as a custom name (`_names`). Pure file operation that does not touch a running AgentThread (sync IO wrapped in `spawn_blocking`); the frontend routes to the child id itself (ChatView mount → bind + replay yields full history). "Fork" entry in the session list kebab menu (shared by Sidebar + ThreadsView) |
| `reflect_archive_session` / `reflect_unarchive_session` / `reflect_list_archived_sessions` | `{ id }` / `{ id }` / `null` | `null` / `null` / `SessionInfo[]` | `commands/sessions.rs` / `commands/sessions.ts` (archive tree `~/.zhuye/sessions-archive`, whole-tree move with relative paths unchanged) |
| `reflect_generate_session_title` | `{ id, force? }` | `string` (final title) | `commands/sessions.rs` / `commands/sessions.ts`. AI-generated session title: replay takes the first User + Assistant text → one-shot call through MinimalAgent's SharedModelRegistry (routing.main model) → `derive_title` cleanup (≤48 chars) → writes `~/.zhuye/sessions/_titles/<id>.title`. Title precedence: custom name (`_names`) > AI (`_titles`) > derived from first message — when a custom name exists it returns directly without calling the model; `force = false` (default, auto-triggered at turn completion) idempotently returns the existing AI title; `force = true` (menu "AI rename") regenerates and overwrites. Archive/delete moves/cleans `_names` in sync |
| `reflect_export_session` / `reflect_export_session_markdown` | `{ id }` / `{ id }` | `string` (path) / `string` (markdown) | `commands/export.rs` / `commands/sessions.ts` |
| `reflect_git_status` / `reflect_git_diff` / `reflect_git_log` | — | `GitStatus` / `string` / `Vec<GitLogEntry>` | `commands/git.rs` / `commands/git.ts`. `GitStatusEntry.staged: bool` is derived from the index column of the two-char porcelain code (`"M "` staged vs `" M"` working-tree-only — the `status` field is a trimmed code, both collapse into the same "M"; staged/working tab split must use `staged`) |
| `reflect_git_stage` / `reflect_git_unstage` / `reflect_git_commit` | `{ paths: string[] }` / `{ paths: string[] }` / `{ message }` | `null` / `null` / `string` (short hash) | `commands/git.rs` / `commands/git.ts`. P3 Git operationalization: `git add --` (empty paths = `add --all`) / `git reset HEAD --` / `git commit -m` (non-empty validation). No push/pull (remote credentials stay in the terminal) |
| `reflect_gh_pr_list` | `{ limit? }` | `GhPullRequest[]` | `commands/git.rs` / `commands/git.ts`. Shells out to `gh pr list --json`; gh missing / not a repo / not logged in → Err with reason (frontend empty state, non-interrupting) |
| `reflect_search_sessions` | `{ query, limit? }` | `SessionSearchHit[]` | `commands/sessions.rs` / `commands/sessions.ts`. P1 cross-session content search: ASCII-folded case-insensitive substring matching, grepping user/assistant text of session JSONL; covers the active tree + archive tree, scans by recency with an upper bound of 120 sessions, stops on `limit` hits (default 20); returns the first hit snippet (~60 chars of context, whitespace collapsed) |
| `reflect_run_shell` | `{ cmd, sshHost? }` | `ShellSession { id, command, cwd }` | `commands/shell.rs` / `commands/terminal.ts`; the `reflect_terminal_output` event streams output. v1.11 infra#7: when `sshHost` is non-empty the command runs remotely via `ssh <host> <cmd>` (`BatchMode=yes` + `ConnectTimeout=10`, non-interactive to prevent hangs), and the session `cwd` is annotated `ssh:<host>` so the frontend can tell local/remote; the frontend strips the `ssh <host>` prefix before passing |
| `reflect_pty_start` / `reflect_pty_write` / `reflect_pty_resize` / `reflect_pty_close` | `{ id, cols, rows }` / `{ id, data }` / `{ id, cols, rows }` / `{ id }` | `()` | Interactive pseudo-terminal of the system shell; `reflect_pty_output` sends `{ id, data: number[] }` bytes, `reflect_pty_exit` sends the id. |
| `reflect_kill_shell` | `{ session_id }` | `null` | `commands/shell.rs` / `commands/terminal.ts` |
| `reflect_list_shell_sessions` | `null` | `string[]` | `commands/shell.rs` / `commands/terminal.ts` |
| `reflect_list_dir` / `reflect_read_file` / `reflect_search_files` | `{ path?, maxDepth? }` / `{ path }` / `{ query, path?, maxResults?, rank? }` | `DirListing` / `FileReadResult` / search results | `commands/files.rs` / `commands/files.ts`; `commands/search.rs` / `commands/search.ts`. `rank` defaults to `substring`; `bm25` uses **relevance ranking** — reusing core `reflect_tools::bm25::{tokenize, rank_lines}` (`k1=1.2` / `b=0.75`, verbatim identical to the core grep tool), so GUI search is no longer weaker than the agent's own grep |
| `reflect_write_file` | `{ path, content }` | `string` (the absolute path written) | `commands/files.rs` / `commands/files.ts`. Writes a text file back inside the workspace sandbox; called when the editor's Reject restores the original via inverse-patch reconstruction; creates the file (including parent dirs) when missing |
| `reflect_read_image_base64` | `{ path }` | `ImageBase64Result { path, mime_type, base64, size }` | `commands/files.rs` / `commands/files.ts`. Composer drag-and-drop image attachment pipeline: reads an image file at any path (**no workspace sandbox**, drag sources are arbitrary) and returns base64; the frontend builds a data-URL as an inline `Image` item (core's `LocalImage` item is not wired yet). Extension whitelist png/jpg/jpeg/gif/webp/bmp, 20 MiB cap |
| `reflect_lsp_set_enabled` / `reflect_lsp_status` / `reflect_lsp_warmup` | `{ enabled }` / `null` / `{ path }` | `LspStatus` (`{ enabled, servers }`) / same / `{ warmed, server }` | `commands/lsp.rs` / `commands/lsp.ts`. LSP is **manually enabled per workspace** (off by default): enabling bootstraps `[lsp_servers]` (registers the `lsp` tool + starts servers, idempotent), disabling unregisters the tool + stops all servers; the `lsp` tool is not injected when disabled. `warmup` calls `ensure_open` (didOpen builds the index) on matching servers — triggered when the editor opens a code file; `warmed = false` without error when disabled / no matching server. Persistence of the enable preference (localStorage, per workspace path) lives in the GUI layer |
| `reflect_load_allowlist` / `reflect_save_allowlist` / `reflect_check_allowlist` | — | allowlist payload | `commands/allowlist.rs` / `commands/allowlist.ts` |
| `reflect_list_workspaces` / `reflect_set_workspace` / `reflect_current_workspace` / `reflect_remove_workspace` | `set_workspace` takes optional `{ unhide?: bool }` (default `null` = keep existing `hidden`; `true` = explicitly restore) | workspace payloads (`WorkspaceInfo { path, label, last_used, session_count, hidden }`, history persisted in `~/.zhuye/workspaces.json`) | Remove only hides the entry, keeping files and sessions (v1.x: matches all variants by normalized path and cleans `/`, `.` placeholder entries). Since v1.x regular switching **no longer auto-revives** removed entries (clicking an old session of that project only follows the cwd); the only restore path is `unhide: true` (the "removed workspaces" section of the workspace management page). |
| `reflect_pick_workspace_folder` | `null` | `string?` (native directory picker, cancel → `null`; via the `tauri-plugin-dialog` Rust API, not JS IPC) | `commands/workspaces.rs` / `commands/workspaces.ts` |
| `reflect_reveal_path` | `{ path }` | `null` (locates in Finder / Explorer / xdg-open) | `commands/workspaces.rs` / `commands/workspaces.ts` |
| `reflect_list_skills` | `null` | `SkillEntry[]` | `commands/skills.rs` / `commands/skills.ts` |
| `reflect_rescan_extensions` | `{ skills?, commands? }` (defaults `skills=true` / `commands=false`) | `string` (submission id) | `commands/skills.rs` / `commands/skills.ts`. `Op::RescanExtensions`-derived command (v1.x, submodule main): the runtime rescans extension directories so new/changed `.zhuye/skills/` (workspace + user level) take effect without restart. Opens no turn; answered by the `extensions_rescanned` event (§3.11) pushing the total skills count. The `commands` bit is currently always `false` (runtime rescan of the upstream commands index is not wired; the command body reads disk in real time). GUI consumption pending (capability matrix 🟡) |
| `reflect_query_guard_stats` | `—` (no args) | `string` (submission id) | `commands/skills.rs` / `commands/skills.ts`. F01-derived command (additive): queries prompt_guard verdict stats (definition-side/output-side block and review, four counts). Opens no turn; answered by the `guard_stats` event pushing a snapshot; the reducer writes `guardStats` (process level), shown by the settings GuardStatsCard. |
| `reflect_scan_local_ports` | `{ ports?, recent_output? }` (defaults to probing the common dev set) | `PortProbe[]` (`port`/`open`/`url`) | `commands/preview.rs` / `commands/preview.ts`. F50-derived command (not an Op — pure local probing, not protocol traffic): TCP connect_timeout probing of 127.0.0.1 (loopback only), also probing ports extracted from recent agent output. Consumed by the live preview block (HtmlPreviewView, 15s polling). |
| `reflect_list_memory` / `reflect_add_memory` / `reflect_remove_memory` | `{ expectedContext? }` / `{ scope, key, value, createOnly?, replaceDocument?, expectedContext?, expectedValue? }` / `{ scope, key, replaceDocument?, expectedContext?, expectedValue? }` | `MemoryEntry[]` / `null` / `null` | `commands/memory.rs` / `commands/memory.ts`. Lists and updates entries by `##` heading; legacy documents without headings or with ambiguous headings are represented by `wholeDocument: true`, and editing or deleting them requires explicit `replaceDocument: true`; `createOnly: true` rejects existing entries. Operations are rejected when `expectedContext: { workspace, agent }` does not match the current workspace or active agent; updates and deletes are rejected when `expectedValue` does not match the current entry or document. Validation and the desktop memory commands are guarded by the same lock; external writes are not covered by that lock. Omitted optional fields stay compatible with the original call payloads. |
| `reflect_list_hooks` / `reflect_toggle_hook` | `null` / `{ name, enabled }` | `HookInfo[]` / `null` | Lists hooks registered in the current thread and plugin engine; toggling modifies the engine and persists the enable preference; unregistered names error. Plugin hooks are paused during plugin reload; failing to restore a disable preference unloads the plugin and reports an error. The first input and plugin SessionStart wait to be mounted; legacy plugins receive one SessionEnd before unloading. Hook config changes trigger a rebind when a session is bound, or take effect on next bind otherwise. |
| `reflect_check_update` | `null` | update info | `commands/update.rs` / `commands/updates.ts` |
| `reflect_list_tasks` / `reflect_create_task` / `reflect_get_task` / `reflect_update_task` / `reflect_claim_task` / `reflect_delete_task` | `{ list }` / `{ list, subject, description, active_form?, owner?, metadata? }` / `{ list, id }` / `{ list, id, patch }` / `{ list, claimer }` / `{ list, id }` | `Task[]` / `Task` / `Task` / `{ task, updatedFields, statusChange? }` / `Task?` / `null` | `commands/tasks.rs` (Phase 1 multi-agent) / `commands/tasks.ts` |
| `reflect_list_teams` / `reflect_upsert_team` / `reflect_get_team` / `reflect_delete_team` | `null` / `{ team }` / `{ name }` / `{ name }` | `TeamFile[]` / `null` / `TeamFile` / `null` | `commands/tasks.rs` (Phase 1 multi-agent) / `commands/teams.ts` |
| `reflect_list_schedules` / `reflect_add_schedule` / `reflect_update_schedule` / `reflect_remove_schedule` / `reflect_get_schedule_status` | `null` / `{ schedule, prompt, name? }` / `{ id, schedule?, prompt?, name?, enabled? }` / `{ id }` / `null` | `CronJobSpec[]` / `CronJobSpec` / `CronJobSpec` / `bool` / `{ status, line, total, enabled }` | `commands/schedule.rs` (Phase 1 item 2) / `commands/schedule.ts` |
| `reflect_list_agent_defs` / `reflect_get_agent_def` / `reflect_save_agent_def` / `reflect_delete_agent_def` / `reflect_parse_agent_md` | `null` / `{ name }` / `{ def, createOnly? }` / `{ name }` / `{ text }` | `AgentDefinition[]` / `AgentDefinition` / `AgentDefinition` / `bool` / `AgentDefinition` | `commands/agents.rs` / `commands/agents.ts`. Saving supports optional `createOnly: true` for exclusive creation that does not overwrite an existing file; omitting it preserves the original create-or-update semantics. File-based definitions have `source: custom`; `builtin_default` is only for the engine's built-in default agent. |
| `reflect_get_active_agent` / `reflect_set_active_agent` | `null` / `{ name }` | `ActiveAgentInfo` (camelCase) | `commands/agents.rs` / `commands/agents.ts`. **Active agent** — decides which agent definition the runtime loads, and the memory directory (`.zhuye/agent-memory/<agent>/`). The desktop previously hardcoded `"desktop"`, making the GUI's Agents view a dead end (definitions editable but never loaded at runtime) and memory written by the GUI unreadable by the agent. Now decided by the desktop preference (`~/.zhuye/desktop.json`, default `"default"` matching the CLI); `set` replays the current session history and force-rebinds (new definition effective immediately, same semantics as provider hot reload). `ActiveAgentInfo` includes `defFound` / `memoryScopes` (empty = no memory loaded, GUI writes will not be injected) / `injectBudgetChars` (core `MAX_MEMORY_INJECT_CHARS`) / `memoryPaths` |
| `reflect_start_side_channel` / `reflect_cancel_side_channel` / `reflect_list_side_channels` / `reflect_get_side_channel` | `{ agent_name, prompt }` / `{ id }` / `null` / `{ id }` | `StartSideChannelResult` / `bool` / `SideChannelInfo[]` / `SideChannelInfo` | `commands/side_channel.rs` / `commands/side_channel.ts`. **Engine-native implementation (v1.x WP9, develop fold-in)**: commands submit `Op::StartSideChannel` / `Op::CancelSideChannel` / `Op::QuerySideChannels` into the `AgentThread`, executed by the `SideChannelDriver` (constructed and injected by `state/thread_factory.rs`, registry shared process-wide) running an independent agent (recorder = None, no main-history writes); replies come back via `SideChannelStarted` / `SideChannelFinished` / `SideChannelStatus` events paired with the submission id (see §3.13) and fan out to the session broadcast. start waits for the paired Started to get the id (Error replies become command errors); cancel snapshots first to preserve boolean semantics (unknown / already-terminal → `false`); driver unconfigured / factory failure / concurrency full (8) are answered honestly with Error events |
| `reflect_get_remote_config` / `reflect_update_remote_config` / `reflect_get_remote_status` | `null` / `{ host, port?, authToken?, autoConnect? }` (Tauri reads Rust params `auth_token` / `auto_connect` as camelCase) / `null` | `RemoteConfigSnapshot { host, port, authToken, autoConnect, endpoint, isReady }` (`#[serde(rename_all = "camelCase")]`) / same snapshot / `RemoteStatus { state, message, endpoint, sinceMs }` | `commands/remote.rs` (Phase 2 item 2) / `commands/remote.ts` |
| `reflect_tailscale_status` / `reflect_tailscale_daemon_command_preview` / `reflect_tailscale_daemon_start` / `reflect_tailscale_daemon_stop` / `reflect_tailscale_daemon_status` | `null` (all) | `TailscaleStatus { installed, running, version, dnsName, hostName, tailnetName, ipv4, ipv6, suggestedRemoteHost, message }` (camelCase) / `string` / `string` / `string` / `{ running, pid }` | `commands/remote.rs` (Phase 2 item 2) / `commands/remote.ts` |
| `reflect_kms_list` / `reflect_kms_create` / `reflect_kms_delete` / `reflect_kms_list_pages` / `reflect_kms_get_page` / `reflect_kms_save_page` / `reflect_kms_search` / `reflect_dream` | `null` / `{ name, description? }` / `{ name }` / `{ wiki }` / `{ wiki, page }` / `{ wiki, page, content, title?, tags?, createOnly?, expectedContent? }` / `{ query }` / `{ insights, sessionsAnalyzed }` | `WikiInfo[]` / `WikiInfo` / `null` / `Page[]` / `Page` / `Page` / `SearchResult[]` / `DreamResult` | `commands/kms.rs` / `commands/kms.ts`. `Page.content` contains the full file; when saving without a title and with empty tags it is written as-is to preserve existing frontmatter. When `createOnly` is true only new pages are created; `expectedContent` requires the original page content to match — the two cannot be used together. |

KMS listing and search return command errors when the directory or page read fails; unreadable pages are not treated as empty results. Non-regular-file entries such as links are not read.
Writes within one KMS manager are serialized; external processes do not share that lock and may still modify files between the content check and the replacement.

Deleting or archiving a session closes that session's recorder and waits for in-flight writes; if the session is currently bound, its thread is also cancelled. On failure the operation attempts to restore the active session from remaining records, and explains in the command error if restoration fails. Rebinding the same ID creates a new recorder.
Restoring an archive is serialized with session bind / delete / archive operations; if the same session is active it must be switched away first.
Fork holds the parent session's file-operation gate; delete or archive waits for a fork to finish so old operations cannot re-create parent session records.
Async-generated titles re-confirm the session and input before writing; manual names always win, non-forced generation keeps existing titles, and late results after delete/archive are not persisted.
Manual renames share the session operation lock with deletion, archiving, restoration and title persistence.
| `reflect_get_autopilot_config` / `reflect_update_autopilot_config` / `reflect_autopilot_history` | `null` / `{ config }` / `null` | `AutopilotConfig` / `null` / `AutopilotRun[]` | `commands/autopilot.rs` / `commands/autopilot.ts`. The desktop background driver submits due tasks to the current `AgentThread` per cron and backfills history by turn outcome; when `config.agent` is non-empty, execution is isolated via the engine side-channel with the specified agent definition |
| `reflect_list_activity` / `reflect_search_activity` / `reflect_clear_activity` / `reflect_activity_count` | `{ filter? }` / `{ query }` / `null` / `null` | `ActivityEvent[]` (camelCase; `id`, `tsMs`, `kind`, `actor`, `summary`, `taskId?`, `teamName?`, `level`) / `ActivityEvent[]` / `null` / `number` | `commands/activity.rs` (Phase 3 item 9) / `commands/activity.ts` |
| `reflect_list_squads` / `reflect_create_squad` / `reflect_get_squad` / `reflect_delete_squad` / `reflect_delegate_next` / `reflect_assign_squad_task` | `null` / `{ spec }` / `{ name }` / `{ name }` / `{ name, leaderActorId }` / `{ name, taskId, assignee? }` | `SquadSpec[]` / `null` / `SquadSpec` / `null` / `Task?` / `Task` | `commands/squad.rs` (Phase 3 item 11) / `commands/squad.ts` |
| `reflect_list_media` / `reflect_image_process` / `reflect_screenshot` / `reflect_computer_use` / `reflect_media_capabilities` | `{ dir }` / `{ spec }` / `null` / `{ action }` / `null` | `MediaAsset[]` / `ImageProcessResult` / `string` (base64 PNG) / `null` / `MediaCapabilities` | `commands/media.rs` (Phase 3 item 13) / `commands/media.ts` |
| `reflect_list_traces` / `reflect_get_trace` | `{ limit? }` / `{ id }` | `TraceSessionSummary[]` (camelCase) / `TraceCall[]` (camelCase) | `commands/traces.rs` / `commands/traces.ts`. GUI counterparts of CLI `reflect traces ls / show`: read-only queries over the sanitized JSONL of `~/.zhuye/traces/model-io/` (`reflect-telemetry`). The list is newest-first with rollout title fallback; `id` accepts a full UUID or a unique 8-char prefix. Consumed by the Traces view (`/traces`) |
| `reflect_list_discussions` / `reflect_run_discussion` / `reflect_cancel_discussions` | `{ discussionId? }` / `{ configPath }` / `null` | `DiscussionSessionInfo[]` (camelCase) / `DiscussionRunOutcome` (camelCase) / `number` | `commands/discussion.rs` / `commands/discussion.ts`. GUI counterparts of CLI `reflect discussion ls / run`: logic in `app-core/src/discussion.rs` (reassembles `reflect-discussion`'s LLM assembly, degrades to `run_noop` when providers are unavailable). While running, Collab* events bridge into the MinimalAgent session broadcast via `event_sink` (envelope `id = EVENT_ID_NONE`), rendered live by the frontend collab_* reducer; the cancel command triggers cascading cancellation of running participants and produces `collab_finished { outcome: "cancelled" }`; `ls` scans `DiscussionTranscript` records in rollout JSONL. Consumed by the Collaboration view |
| `reflect_run_team_pipeline` / `reflect_run_pipeline` | `{ teamName, topic }` / `{ configPath, topic, failurePolicy?, inputs? }` | `PipelineReport` (snake_case, submodule types passed through) | `commands/pipeline.rs` / `commands/pipeline.ts`. GUI counterparts of CLI `reflect pipeline team / run -c`: logic in `app-core/src/pipeline.rs` (registry bootstrapped from config, `REFLECT_MODEL=mock` runs offline). The team preset = plan → prd → exec → verify in four stages; TOML paths run arbitrary DAGs. Shared `~/.zhuye/tasks\|teams/` storage (same source as the Squad view). Consumed by the Collaboration view |
| `reflect_validate_pipeline` / `reflect_list_pipeline_configs` / `reflect_save_pipeline_config` | `{ tomlSrc }` / `null` / `{ name, tomlSrc }` | `PipelineConfigSummary` (camelCase: `name` / `failurePolicy` / `nodes` / `nodeCount` / `missingTeams` / `valid` / `error?`) / `PipelineConfigFile[]` / `PipelineConfigFile` | `commands/pipeline.rs` / `commands/pipeline.ts`. **Pipeline config editing** — previously the GUI could only run an existing TOML file (hand-written). `validate` goes through the core `Pipeline::from_toml` (the **same validation path as actual runs**, returning both config-level and wiring-level errors honestly); the structure summary reads only the top-level `nodes` table (no core schema replication); `save` persists to `~/.zhuye/pipelines/<name>.toml`, **validated before write, invalid never lands**. Consumed by the Collaboration view Pipeline editor |
| `reflect_run_security_scan` | `null` | `SecurityScanResult` (camelCase: `ran` / `exitCode?` / `output` / `summary`) | `commands/security.rs` / `commands/security.ts`. Runs one `cargo audit` in the current workspace — the **real implementation** of core `reflect_integration::security_scan::run_cargo_audit` (30s timeout, drained pipes, IO errors become structured reports instead of panics). The blocking call is wrapped in `spawn_blocking` (may run 30s, does not occupy async workers). Consumed by Settings → Advanced "security scan" card |
| `reflect_pick_file` | `{ extensions? }` | `string?` (native file picker, cancel → `null`; `tauri-plugin-dialog` Rust API with optional extension whitelist) | `commands/workspaces.rs` / `commands/workspaces.ts`. TOML config entry for discussion / pipeline |
| `reflect_prompt_command` | `{ action }` | `string` | Queries, rescans, selects the session prompt set or saves a shared default, returning results through events. |
| `reflect_get_effective_prompt` | `null` | `EffectivePrompt` | Resolves the system prompt and registered tool descriptions according to the current session's selection and model. |
| `reflect_session_stats` / `reflect_all_model_usage` | `{ id }` / `null` | `SessionStats?` / `ModelUsage[]` (both camelCase) | `commands/stats.rs` / `commands/stats.ts`. Read-only scan of rollout JSONL (`~/.zhuye/sessions/`) for **model-level token stats**: reuses `reflect-rollout::index::session_stats` / `all_model_usage` (same source as CLI `reflect session stats`, no desktop-side re-implementation). `SessionStats` includes totals + `perModel` breakdown + pre/post-compaction tokens (`compactionTokensSaved`) + memory read/write counts + cache hit rate; `null` when the session has no persisted records yet. Consumed by the `/usage` view |
| `reflect_model_rate_cards` | `{ models }` | `RateCard[]` (camelCase) | `commands/stats.rs` / `commands/stats.ts`. Model **rate cards** — making costs explainable in the GUI. Reads the core's public pricing table directly (`reflect_llm::providers::pricing_table` / `rate_cards`, develop fold-in) for per-1M-token input/output/cache-read/cache-write prices; the GUI follows automatically when the table updates. Models not in the table → `priced: false`, no fabricated numbers |
| `reflect_list_worktrees` | `null` | `WorktreeInfo[]` (camelCase) | `commands/git.rs` / `commands/git.ts`. Lists repository worktrees, flagging the **changes stranded in an isolated worktree** risk. The core's worktree state lives in `ToolContext` (in-process, unreadable), but worktrees are filesystem-visible — `git worktree list --porcelain` + core `reflect_tools::worktree::worktree_dirty` for dirtiness. `isolated` = non-main working tree; `stranded` = isolated + uncommitted changes (**changes not yet landed back to the main branch**, lost-work risk). Consumed by the Git view "Worktrees" panel |
| `reflect_list_mcp_resources` / `reflect_list_mcp_prompts` | `null` | `McpResourceInfo[]` / `McpPromptInfo[]` (camelCase) | `commands/mcp.rs` / `commands/mcp.ts`. Of MCP's three primitives only tools were user-reachable before — resources / prompts could only be invoked by the LLM, with no path for users to reuse a server's resources or prompt templates. Asks the rmcp peer directly (`list_all_resources()` / `list_all_prompts()`), same source as core `ListMcp*Tool` |
| `reflect_list_subagent_specs` / `reflect_get_subagent_spec` / `reflect_save_subagent_spec` / `reflect_delete_subagent_spec` | `null` / `{ role }` / `{ role, markdown }` / `{ role }` | `SubagentSpecInfo[]` / `string?` / `null` / `null` (all camelCase) | `commands/subagents.rs` / `commands/subagents.ts`. **Subagent specs** (the source of `call_<role>` tools, `~/.zhuye/subagents/*.md` or the workspace's same-named directory) — a separate system from agent definitions (`~/.zhuye/agents/*.md`), previously with **no editing surface at all**. Merge order matches the runtime (TOML `[[subagents]]` > workspace md > home md > hardcoded explorer). `markdown` is the complete file content (frontmatter + body), validated by the backend `parse_subagent_str` before writing; invalid never lands |
| `reflect_list_hook_events` | `null` | `HookEventInfo[]` (camelCase: `kind` / `description` / `decisions`) | Lists the 12 events and the decisions the calling side currently handles; `decisions: []` means notification-only. Task lifecycle events are forwarded to the current thread's HookEngine; the tasks themselves are unaffected by returned decisions. |
| `reflect_list_permission_rules` | `null` | `PermissionRuleInfo[]` (camelCase) | `commands/permissions.rs` / `commands/permissions.ts`. **Effective rules of the core three-layer permission store** (read-only): `config` (`[permissions]` in `config.toml`) > `project` (`<workspace>/.zhuye/permissions.toml`) > `user` (`~/.zhuye/permissions.toml`). Array order is match order (first-match-wins, deny first). Consumed by Settings → Permissions. **Runtime isomorphism**: the desktop thread construction mounts the resolver the same way as the CLI (`reflect-exec`'s `apply_permission_layers`) — previously the desktop did not mount it, so CLI-effective deny rules were silently ignored |
| `reflect_lsp_diagnostics` | `{ path }` | `LspDiagnostic[]` (camelCase; line/column 1-based) | `commands/lsp.rs` / `commands/lsp.ts`. **LSP diagnostics** for a file (compiler / checker feedback) — reads core `LspConnectionManager::diagnostics()` → `DiagnosticRegistry::get(uri)`. Semantics match the core `LspTool`: **read-only passive cache** (server pushes `textDocument/publishDiagnostics`, the client never pulls); empty list when the file is not warmed or LSP is disabled. `LspStatus` gains a `diagnostics` aggregate (document count / entry count / status description). Consumed by the Files view Problems panel |
| `reflect_list_mcp_servers` / `reflect_mcp_catalog` / `reflect_upsert_mcp_server` / `reflect_delete_mcp_server` | `null` / `null` / `{ name, entry }` / `{ name }` | `McpServerInfo[]` / `McpCatalogEntry[]` / `null` / `null` (all camelCase) | `commands/mcp.rs` / `commands/mcp.ts`. **MCP server management** — previously the GUI could only observe, adding a server required hand-editing `config.toml`'s `[mcp_servers.<name>]`. `list` returns configured servers + transport + launch command + **running status**; `catalog` returns the core's curated offline list + install hints (`reflect_mcp::registry`); `upsert` / `delete` modify in-memory `ReflectConfig.mcp_servers` → **compiled via the core `mcp_server_configs()` validation** (invalid config never lands) → persisted → runtime start/stop (registering/unregistering their tools, same path as the startup `bootstrap_mcp`). The transport wire field of `entry` is **`type`** (written as `type = "stdio"` in config). Consumed by the Collaboration view McpManager panel |
| `reflect_get_task_output` / `reflect_stop_task` / `reflect_release_task` | `{ list, id }` | `string` / `TaskUpdateResult` / `TaskUpdateResult` | `commands/tasks.rs` / `commands/tasks.ts`. Task **output / stop / release** — same semantics as core tools (guards in the command layer, not re-implemented in the frontend): `get_task_output` reads the file pointed to by the task's `output_path` (**non-blocking**, returns an empty string when output is not yet written); `stop_task` guards `status == in_progress`, returning to `pending` + clearing `owner` (same as `TaskStopTool`); `release_task` guards an existing `claimed_by`, returning to `pending` + clearing `claimed_by` / `claimed_at` (same as `TaskReleaseTool`). Consumed by the task board detail drawer + inline buttons |
| `reflect_list_session_notes` / `reflect_list_note_sessions` | `{ id }` / `null` | `SessionNoteInfo[]` / `NoteSessionInfo[]` (camelCase) | `commands/notes.rs` / `commands/notes.ts`. Reads `<notes_home>/session-notes/<thread_id>.jsonl`, showing the most recent valid notes per the core's rebuild window and validation rules while keeping original timestamps; the session list count matches the readable notes. Empty list when the file is missing; error for other read failures. Consumed by the Memory view "session notes" panel. |
| `reflect_list_span_logs` / `reflect_read_span_log` | `{ days? }` / `{ day, sessionId? }` | `SpanLogFile[]` / `TraceSpan[]` (camelCase) | `commands/traces.rs` / `commands/traces.ts`. **Span logs** (`~/.zhuye/traces/log/reflect-YYYY-MM-DD.jsonl`) — the parent-child span chain of turn → model → tool (with durations, statuses, `reflect_goal` events). The sibling of model-io: model-io gives "the full request/response of each call", spans give "the structure and timing attribution of a turn". `TraceSpan.depth` is derived from the `parentSpanId` chain (guarded against missing parents and cycles). Consumed by the Traces view "Span tree" page |
| `reflect_sandbox_status` | `null` | `SandboxStatus` (camelCase) | `commands/sandbox.rs` / `commands/sandbox.ts`. **Effective OS sandbox state**: `status` (disabled / seatbelt / landlock / no_backend), `active`, `backend`, the core's `statusLine`. Uses `OsSandbox::from_env()` — the same logic path as `BashTool::execute` reading env, so what the status bar shows matches which sandbox bash actually runs in |
| `reflect_set_dock_badge` | `{ count? }` | `null` | `src-tauri/src/dock.rs` (macOS) / `src/utils/tauri.ts` (compat) |

**`reflect_terminal_output` event** (B8-01):

```ts
interface ReflectShellOutputChunk {
  session_id: string;
  stream: 'stdout' | 'stderr' | 'exit' | 'error';
  data: string;     // text line (the exit-code string when stream is exit)
  seq: number;      // monotonically increasing per session
}
```

`Submission` wraps the op:

```rust
pub struct Submission {
    pub id: String,
    pub op: Op,
    pub client_user_message_id: Option<String>,
    pub trace: Option<TraceContext>,
    pub workspace: Option<String>,   // v1.x: session ownership (written to SessionMeta.workspace on first UserInput)
    pub source_command: Option<String>, // v1.x: plugin slash-command origin annotation (written by the backend on expansion; the frontend never constructs it)
}
```

`workspace` carries `#[serde(default, skip_serializing_if = "Option::is_none")]` — the legacy wire format omits the key,
and the backend falls back to `cfg.current_workspace()`; on the GUI side `useCurrentWorkspace` injects the active workspace.
`source_command` is likewise optional, annotated by the backend when expanding plugin commands (`/plugin:ns:name args` → command body,
`state/plugins.rs::expand_submission`), used only as rollout / telemetry provenance — the frontend neither reads nor writes it.

### 2.1 `UserInputItem` (`zhuye-agent/crates/protocol/zhuye-protocol/src/item.rs`)

| Variant | Fields | Frontend source |
|---|---|---|
| `Text` | `text: String` | Composer text |
| `Image` | `data: Vec<u8>, mime_type: String` | Drag-and-drop or paste (frontend base64-decodes) |
| `LocalImage` | `path: PathBuf` | File picker (backend reads from disk) |
| `Skill` | `name: String, args: Option<JSON>` | `/skill name` or the skill picker |
| `QuestionAnswer` | `request_id, answers` | Reply to an LLM question (alternate path of `AskUserQuestionResponse`) |
| `File` | `path: String, range?: FileRange` | Composer `@` file popup (`MentionPicker`). `path` is a workspace-relative POSIX path; `FileRange { start_line, end_line }` optional. Core-side `user_input_items_to_messages` expands it into `@<path>` / `@<path>:L<n>-L<m>` text blocks; actual reading is triggered on demand by the LLM's `/read` tool |

`File` is a purely additive variant (legacy readers unaffected); `SessionInfo.workspace` / `RolloutRecord::SessionMeta.workspace`
carry the same serde-compatibility annotations — legacy JSONL deserializes to `None`, and the frontend shows "unassigned".

### 2.2 Submission ID lifecycle

- The frontend generates a UUID v4 → `Submission.id`.
- The backend returns the same id from `reflect_submit` (echo).
- The frontend associates inbound `Event.id` with the original `Submission.id` to unlock the composer / mark turn completion.
- `EVENT_ID_NONE = ""` events (lifecycle: `SessionConfigured`, `ShutdownComplete`, `PermissionModeChanged` …) have no matching submission.
- `SessionConfigured.session_id` (since v1.x) equals the thread's pre-allocated id: consistent with the rollout file name
  (`~/.zhuye/sessions/YYYY/MM/DD/<id>.jsonl`), `SessionMeta.session_id` and the frontend routing id
  (`reflect_bind_session` injects via `with_session_id`, and `submission_loop` overwrites
  `sc.session_id = session_id` after `SessionConfiguredEvent::new`). Older versions emitted a random
  UUID used only as a turn event identifier.

### 2.3 `ThreadSettingsOverrides` — fields stamped by the backend

Two fields inside `Op::UserInput.thread_settings` (`ThreadSettingsOverrides`) are
**decided by the backend** — whatever the frontend sends does not count:

| Field | Desktop behavior |
|---|---|
| `sandbox_policy` | **Unconditionally overridden** with the value derived from backend config (`OsSandbox` = OS sandbox on, `WorkspaceOnly` = off). Sandboxing is a security setting; the source of truth can only be the backend's config snapshot. See `docs/capabilities.md` §3.19. |
| `model` / `approval_policy` / `max_tool_concurrency` | Passed through as-is. The frontend sends `prompt`, `auto_approve` or `full_access` per session; this approval policy is independent of Plan. Explicit deny rules and sandbox settings still apply. `max_tool_concurrency` caps per-turn tool-call concurrency. |

The core maps these fields into real per-turn behavior (`reflect-core/src/submission_loop.rs`):
`sandbox_policy` → `ToolContext.os_sandbox` (`OsSandbox` → `Some(true)`,
otherwise `Some(false)`) → read by both the foreground `BashTool` and the background bash path.

---

## 3. Events (backend → UI)

`EventMsg` uses `#[serde(tag = "type", rename_all = "snake_case")]` (variant list in `zhuye-agent/crates/protocol/zhuye-protocol/src/event_msg/mod.rs`).

> **Naming**: the Rust `enum` uses **PascalCase struct variants** (e.g. `TurnStarted(TurnStartedEvent)`), but serde emits **snake_case** discriminators (`turn_started`) for the frontend. The frontend TypeScript uses the snake_case forms.

### 3.1 Lifecycle (7)

| Variant | Trigger | UI effect |
|---|---|---|
| `session_configured` | First turn of a thread | Show banner; persist `session_id` |
| `turn_started` | `Op::UserInput` accepted | Spinner on; clear composer draft |
| `turn_complete` | LLM turn finished | Spinner off; unlock composer; accumulate cost |
| `turn_aborted` | `Op::Interrupt` / error | Red toast |
| `turn_rewound` | `Op::Rewind` success | Truncate local scrollback; redraw |
| `submission_closed` | v1.3 SDK serve-mode per-submission channel drain marker | none — the Desktop's embedded AgentThread never emits it; the TS type union includes it, the reducer is a no-op for exhaustiveness |
| `shutdown_complete` | `Op::Shutdown` | Quit / hide |

### 3.2 LLM output (4)

| Variant | Fields | UI |
|---|---|---|
| `agent_message` | `text: String` | Non-streaming final bubble |
| `agent_message_delta` | `delta: String` | Stream chunk → append to last assistant bubble |
| `thinking_delta` | `delta: String`, `kind?: "raw" \| "summary" \| "unknown"` (v1.x additive, upstream `#[serde(default)]` for legacy-event compatibility; `raw` = default token-level streaming, `summary` = reasoning summary) | Reasoning block (collapsible); `kind` is registered in frontend types, rendering does not yet distinguish (same as before) |
| `token_count` | `TokenCountEvent` (info) | StatusBar token/cost indicator + Inspector "Token Usage" section (input/output/cached/cache_write/total/cost/provider/credential/model). `TokenCountEvent` fields: `input_tokens`, `output_tokens`, `cached_tokens`, `cache_write_tokens` (M8, a subset of input, not counted into total), `total_tokens`, `cost_usd?`, `provider?`, `credential_label?`, `model?` (v1.x model-level stats: the model spec actually hit this turn such as `"openai/gpt-4o"`; older engines don't report → absent by default) |

### 3.3 Tools (5)

| Variant | Fields | UI |
|---|---|---|
| `tool_call_begin` | `ToolCallBeginEvent` | Tool row running indicator |
| `tool_call_args_delta` | `ToolCallArgsDeltaEvent` (v1.5 additive) | Accumulates into the matching tool row's `argsStream` by `call_id`: while the model is still generating arguments, the ToolCell header shows received fragments (truncated to 80 chars), expanding reveals the full accumulated JSON; switches back to the structured summary once the JSON completes. Whole-payload providers (Ollama native format) never emit it |
| `tool_call_end` | `ToolCallEndEvent` | Tool row done / failed / cancelled; when `tool_name == "TodoWrite"`, additionally takes `output.metadata.todos` → Inspector "Todo list" panel (`{ content, status, activeForm }`, `activeForm` in camelCase) |
| `tool_call_output_delta` | `ToolCallOutputDeltaEvent` (v1.4 A3) | none — incremental stdout/stderr previews during long tool executions (the full output remains authoritative in `tool_call_end`); the reducer is a no-op for exhaustiveness, avoiding high-frequency re-renders |
| `tool_execution_request` | `ToolExecutionRequestEvent` (v1.3 SDK) | none — in serve mode the core asks the client to locally execute remote tools it registered via `Op::RegisterTools` (receipt `Op::ToolExecutionResponse`, paired by `call_id`). The Desktop's embedded AgentThread registers no remote tools; the reducer is a no-op for exhaustiveness |

### 3.4 Approvals / AskUser (4)

| Variant | Frontend response | Paired Op |
|---|---|---|
| `approval_request` (Tool/Hook/Plan) | Open `ApprovalModal` | `tool_approval` / `hook_approval` |
| `ask_user_question` | Open `QuestionModal` (multi-Q) | `ask_user_question_response` (id = request_id) |
| `ask_user_input` | Open `AskUserModal` (free text; masked when `secret`) | `ask_user_input_response` |
| `permission_bubble` | Non-blocking toast (Bubble mode) | none |

### 3.5 Compaction / Errors (3)

| Variant | UI |
|---|---|
| `context_compacted` | "Compacting..." badge → fade |
| `error` | Red error bubble (recoverable) |
| `stream_error` | Retry countdown |

### 3.6 Config / Routing / Collab (5)

| Variant | UI |
|---|---|
| `config_reloaded` | Toast "Config reloaded" |
| `routing` | Status bar provider-switch indicator. `kind` enum: `switched` (credential change within the same pool) / `failed_over` / `cooldown_started` / `cooldown_cleared` / `spec_fallback` (v1.7 R3, cross-model degradation — every credential in the current spec's pool unavailable, switched to the fallback spec; `from_credential` / `to_credential` then carry a `"provider/model"`-shaped spec) |
| `collab_started` / `collab_message` / `collab_finished` | Collab sidebar / timeline; `collab_finished.outcome` also supports `failed` / `cancelled`, pending upstream fixes not yet in the current submodule |

**`routing.kind` values** (mirror Rust `RoutingEventKind`, snake_case):
`switched` (credential change within the same pool) / `failed_over` (all candidates failed) /
`cooldown_started` / `cooldown_cleared` /
**`spec_fallback`** (v1.7 R3: every credential in the current spec's pool unavailable → switched to the
fallback spec, a **cross-model degradation**).

> The difference between `spec_fallback` and `switched`: the latter changes the credential **within the same pool**
> (`from_credential` / `to_credential` are credential labels), while the former carries a **spec** shaped `"provider/model"`.
> The frontend `RoutingPayload.kind` / `RoutingSnapshot.kind` unions already include the variant (unknown variants must
> degrade without crashing per Protocol v0).

> **Coding plan auto-failover**: the frontend `stores/agent/planFailover.ts` consumes
> `quota_exhausted` (see §3.12 plugin/quota group) and `error` events with exhaustion signatures,
> automatically rewriting `[active].provider` and calling `reflect_save_config` (triggering the §2.0 hot
> reload chain), with a toast announcing the result.

### 3.7 MCP (3)

| Variant | UI |
|---|---|
| `mcp_server_started` | Status bar MCP segment |
| `mcp_server_failed` | Error toast |
| `mcp_tool_invoked` | Tool row "(via mcp:server)" badge |

### 3.8 LSP (2) — v0.5+

| Variant | UI |
|---|---|
| `lsp_server_started` | Status bar LSP segment |
| `lsp_server_failed` | Error toast |

### 3.9 Plan (7)

| Variant | UI |
|---|---|
| `plan_request` | "Enter plan mode?" confirm modal |
| `plan_ready` | Plan markdown modal (auto mode / manual approval / revise) |
| `plan_approved` | Status bar plan badge |
| `plan_rejected` | Status hint |
| `plan_draft_updated` | none — draft body is refreshed overwrite-style (the TUI uses it for preview); the GUI decision path goes through `plan_ready` → PlanReadyModal, the reducer is a no-op for exhaustiveness |
| `plan_step` | Plan view "execution progress" checklist — the core reports per step while the agent executes an approved plan; the reducer updates or appends in place by `index` (isomorphic with the core TUI semantics), and clears the previous list when `plan_ready` arrives |
| `permission_mode_changed` | Status bar mode badge updates |

### 3.10 Subagent observability (2) — v1.4+

| Variant | Fields | UI |
|---|---|---|
| `subagent_progress` | `SubagentProgressEvent` (channel one: push) | Rolling feed in the Inspector subagent section (capped at 200 entries) — intermediate subagent progress (message / tool_begin / tool_end) forwarded by the parent's `CallSubAgentTool` |
| `subagent_status` | `SubagentStatusEvent` (channel two: query reply) | Status snapshot in the Inspector subagent section (initiated by `reflect_query_subagents`; auto-refreshed at turn completion when the feed is non-empty, manually otherwise) |

### 3.11 Prompt layers / extensions rescan (3) — v1.6.1 / v1.x
Prompts auto-matched per model are externalized to `.zhuye/prompts/*.md` (the `.zhuye/prompts/` user-directory layer + built-in vendor layers, with a three-level fallback default → vendor → exact model name). The engine exposes queries and rescan via `Op::PromptCommand`; both actions **open no turn** — reply events arrive over both the per-submission channel and the session fan-out. Since v1.x (submodule main), `Op::RescanExtensions` brings the same "edit-and-it-works" behavior to the skills directory, answered by `extensions_rescanned`.

| Variant | Fields | UI |
|---|---|---|
| `prompt_list` | `PromptListEvent`: `available: Vec<String>` (bindable layer file names without `.md`), `current_spec: String` (current model spec), `active_layers: Vec<String>` (user layers actually matched by the current spec; embedded vendor layers are not listed) | `PromptLayersModal` shows "current model / active layers / available layers"; expanded by the `/prompt` slash (initiated via the `list` action of `reflect_prompt_command`). The reducer writes `store.prompt` (**process level** — the prompt library does not reset on session switch) |
| `prompt_switched` | `PromptSwitchedEvent`: `action: String` (`"reload"`; reserved for future focused layer switching), `active_layers: Vec<String>` (the effective user layers of the current spec after rescan) | Toast "prompts refreshed" showing the newly matched layers; the reducer updates `store.prompt.activeLayers` + records `switchedAt`. The "rescan" button initiates the `switch` action (making edits to `.zhuye/prompts/*.md` take effect immediately) |
| `extensions_rescanned` | `ExtensionsRescannedEvent`: `skills: usize` (total entries after rescan, file-based + plugin-based; 0 when not requested), `commands: bool` (whether the commands rescan was processed, currently always `false`) | The reply to `reflect_rescan_extensions` (§2); the reducer toasts "skills refreshed" with the total count. GUI trigger button pending (capability matrix 🟡) |

### 3.12 Plugin / Quota (2)

| Variant | Fields | UI |
|---|---|---|
| `plugin_loaded` | `PluginLoadedEvent`: `plugin: String`, `scope: String`, `version: String`, `skill_count: usize`, `command_count: usize` | Emitted when a plugin loads successfully. The frontend event store keeps the most recent load record; the current runtime state is queried via the `runtime` snapshot of `reflect_list_plugins`. |
| `quota_exhausted` | `QuotaExhaustedEvent`: `provider: String`, `label: String`, `used_tokens: u64`, `max_tokens: u64`, `window_ends_secs: u64` | Warning toast "quota exhausted" + coding plan auto-failover (consumed by `stores/agent/planFailover.ts`) |

### 3.13 Side-channel agent (3) — v1.x WP9

User-driven bypass agents (initiated via `Op::StartSideChannel`, executed by the engine's `SideChannelDriver`, with independent cancellation tokens, no main-history writes). Events arrive over both the per-submission channel and the session fan-out. **Terminal-state re-emission**: the engine driver's Done / Cancelled / Error only advance the in-process registry (no protocol events; `SideChannelFinished` only covers the startup-failure path); the desktop's `state/side_channel_forwarder.rs` subscribes to the shared registry's broadcast and re-emits terminal states onto `reflect_event` with the outer id `EVENT_ID_NONE` (`Started` is emitted by the submission_loop with the submission id, and is not re-emitted to avoid double counting).

| Variant | Fields | UI |
|---|---|---|
| `side_channel_started` | `SideChannelEvent` (tagged enum, `kind: "started"`): `id`, `agent_name`, `prompt`, `started_at_ms` | The reducer increments `store.sideChannels.revision`; SideChannelView subscribes and immediately invalidates the query cache to refresh the list |
| `side_channel_finished` | Same, `kind: "done \| cancelled \| error"`: `id`, `finished_at_ms`, `summary?` / `message?` | Same; terminal semantics are presented via the query snapshot (`status`) |
| `side_channel_status` | `SideChannelStatusSnapshot` (camelCase): `channels: SideChannelInfo[]` (`id` / `agentName` / `prompt` / `startedAtMs` / `status` / `durationMs`) | The pull-style reply to `Op::QuerySideChannels`; the reducer writes `store.sideChannels.lastSnapshot` (a process-level projection, not reset per session) |

---

## 4. ID pairing rules

| Event | Triggering Op | Field | Notes |
|---|---|---|---|
| `approval_request` (tool) | `tool_approval` | `id = request_id` | |
| `approval_request` (hook) | `hook_approval` | `id = request_id` | |
| `approval_request` (plan) | `plan_approval` | `id = request_id` | |
| `ask_user_question` | `ask_user_question_response` | `id = request_id` | One request may contain multiple questions; each answer uses a `selected` index and optional `custom` |
| `ask_user_input` | `ask_user_input_response` | `id = request_id` | |
| `plan_request` | `plan_approval` | `id = plan_id` | Initiated by `enter_plan_mode`; entering uses `manual_approve`, deferring uses `revise` |
| `plan_ready` | `plan_approval` | `id = plan_id` | |
| `*_delta` / `*_complete` | (any user action) | `id = submission.id` | Streaming chunks share the submission id |

---

## 5. Version compatibility

- **Additive evolution**: new variants never break existing code (deserializers ignore unknown fields).
- **Snake_case tags** prevent Rust rename refactors from leaking into the wire format.
- **`#[serde(default)]`** on optional fields protects the frontend from missing keys during rollouts.
- **Frontend type regeneration**: when `reflect-protocol` changes, run:

  ```bash
  # In the ZhuYe (engine) repository:
  cargo run -p reflect-protocol --example dump_schema > /tmp/reflect-schema.json
  # In the ZhuYe Desktop repository:
  npx json2ts /tmp/reflect-schema.json -o src/types/protocol.ts
  ```

- **Submodule upgrade**: `git submodule update --remote zhuye-agent` pulls the latest core crates (see `SUBMODULE.md`). After upgrading, re-run the dump → json2ts pipeline.

---

## 6. Frontend TypeScript interfaces

`src/types/protocol/` is the canonical mirror; the following lists the protocol outline — full fields defer to the corresponding type files.

```ts
// Submission side (UI → backend)
export type ReflectSubmission = {
  id: string;
  op: ReflectOp;
  client_user_message_id?: string;
  trace?: TraceContext;
  workspace?: string;
};

export type ReflectOp =
  | { type: 'user_input'; items: ReflectItem[]; thread_settings?: ThreadSettingsOverrides }
  | { type: 'compact' }
  | { type: 'interrupt'; child_id?: string | null }
  | { type: 'shutdown' }
  | { type: 'rewind'; to_turn_id?: string }
  | { type: 'steer'; priority?: 'attachment' | 'now'; items: ReflectItem[] }   // v1.4 A2 → reflect_steer
  | { type: 'query_subagents'; child_id?: string }                              // v1.4 C1 → reflect_query_subagents
  | { type: 'start_side_channel'; agent: string; prompt: string }               // v1.x WP9 → reflect_start_side_channel
  | { type: 'cancel_side_channel'; id: string }                                 // v1.x WP9 → reflect_cancel_side_channel
  | { type: 'query_side_channels'; id?: string }                                // v1.x WP9 → reflect_list/get_side_channel
  | { type: 'tool_approval'; id: string; decision: ReviewDecision }
  | { type: 'hook_approval'; id: string; decision: ReviewDecision }
  | { type: 'enter_plan_mode'; task: string }
  | { type: 'exit_plan_mode' }
  | { type: 'enter_goal_mode'; goal: string; verify_command?: string; token_budget?: number }
  | { type: 'exit_goal_mode' }
  | { type: 'plan_approval'; id: string; choice: PlanApprovalChoice }
  | { type: 'prompt_command'; action: { type: 'list' } | { type: 'switch'; layer?: string | null } }
  | { type: 'rescan_extensions'; skills: boolean; commands: boolean }
  | { type: 'register_tools'; tools: RemoteToolSpec[] }
  | { type: 'tool_execution_response'; call_id: string; output: ToolOutput }
  | { type: 'set_effort'; effort: ReasoningEffort }
  | { type: 'ask_user_question_response'; id: string; answers: AskUserAnswer }
  | { type: 'ask_user_input_response'; id: string; text: string }
  | { type: 'set_permission_mode'; mode: PermissionMode }
  | { type: 'cycle_permission_mode' };

// Event side (backend → UI)
export type ReflectEvent = { id: string; msg: ReflectEventMsg };

export type ReflectEventMsg =
  | { type: 'session_configured'; /* ... */ }
  | { type: 'turn_started'; /* ... */ }
  | { type: 'turn_complete'; /* ... */ }
  // ... variant union, snake_case discriminators
  | { type: 'permission_mode_changed'; from: PermissionMode; to: PermissionMode };
```

### 6.1 Bridging pattern

The frontend IPC layer has three roles:

1. **Low-level bridge** — `src/utils/bridge.ts` exports `invoke` / `listen`, with Tauri-context fallback and the `isMissingTauriInvokeError` guard.
2. **Domain wrappers** — `src/utils/commands/{health,agent,approvals,plan,permissions,questions,config,sessions,events,workspaces,skills,memory,hooks,git,terminal,files,allowlist,updates,search}.ts` re-export typed wrappers. `src/utils/commands/index.ts` aggregates them in a barrel.
3. **Compat barrel files** — `src/utils/tauri.ts` and `src/utils/commands.ts` re-export from `./bridge`, `./commands`, `./types` so existing `@/utils/tauri` and `@/utils/commands` imports keep working. **New code should import directly from `@/utils/commands/{domain}` or `@/utils/bridge`.**

```ts
// src/utils/bridge.ts (low-level)
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';

function isMissingTauriInvokeError(e: unknown): boolean { /* ... */ }

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> { /* ... */ }
export async function listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<UnlistenFn> { /* ... */ }
```

```ts
// src/utils/commands/agent.ts (per-domain wrapper)
import { invoke } from '../bridge';

export async function reflect_submit(s: ReflectSubmission): Promise<string> {
  return await invoke<string>('reflect_submit', { submission: s });
}

export async function onReflectEvent(handler: (e: ReflectEvent) => void) {
  return await listen<ReflectEvent>('reflect_event', (ev) => handler(ev.payload));
}
```

### 6.2 Reducer pattern

`src/services/agentEventBus.ts` (a reference-counted bus) forwards to `src/stores/agent/reducer.ts` — the canonical reducer for `ReflectEventMsg`. `src/services/agent.ts` remains a compatibility re-export forwarding `useAgent` / `handle_event` to the store. `src/stores/agentStore.ts` is the user-facing compat facade re-exporting `useAgentStore` / `reduceEvent` / types from `./agent`. Adding a variant:

1. Add the `ReflectEventMsg` branch in `src/types/protocol.ts`.
2. Add `case 'new_variant':` in `src/stores/agent/reducer.ts`.
3. Cover it in `src/stores/agentStore.test.ts` and/or the bus tests.

---

## 7. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Frontend receives `unknown variant` | Protocol updated but TS not regenerated | Re-run `dump_schema` + `json2ts` |
| Submission silently dropped | Backend deserialization error | Check `tracing` logs in `src-tauri/src/commands/<domain>.rs` |
| Event carries a stale id | Submission id overwritten | Use `crypto.randomUUID()` only |
| Approval modal never closes | Frontend forgot to dispatch the `*_approval` Op | Check `src/features/modals/ModalShell.tsx` `onSubmit` |
| `EVENT_ID_NONE` paired with a submission | Lifecycle events matched by id | Filter `e.id === ''` in `src/stores/agent/reducer.ts` |

---

## 8. References

- Rust source of truth: `zhuye-agent/crates/protocol/zhuye-protocol/src/{event.rs,event_msg/mod.rs,op.rs,item.rs,submission.rs}`
- TS mirror: `src/types/protocol.ts`
- Tauri command registry: `src-tauri/src/lib.rs` (handler list) + `src-tauri/src/commands/mod.rs` (barrel) + per-domain bodies in `src-tauri/src/commands/<domain>.rs`
- Event forwarder: `src-tauri/src/events.rs::forward_agent_events`
- Frontend event fan-out: `src/services/agentEventBus.ts` → `src/stores/agent/reducer.ts`; compat re-exports in `src/services/agent.ts`
- Low-level IPC bridge: `src/utils/bridge.ts`
- IPC wrappers (canonical, per domain): `src/utils/commands/<domain>.ts` aggregated by `src/utils/commands/index.ts`
- IPC compat barrels: `src/utils/tauri.ts`, `src/utils/commands.ts`
