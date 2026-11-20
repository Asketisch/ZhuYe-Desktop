# Plan: SSH Remote Development (desktop agent driving a remote project)

<p align="center">
  <a href="ssh-remote.md">中文</a> · <b>English</b>
</p>

> **Status**: v1 core loop shipped (desktop commit 2ba023d9; bootstrap increment see changelog): host registry + SSH transport (login shell) + handshake + foreground-slot submit routing + event pump + disconnect cleanup + **one-click remote zhuye CLI install**; L3 covered end-to-end with a stub ssh.
> **TODO**: on-device acceptance (one Windows→Linux and one macOS→Linux box); 3b follow-ups (reverse RemoteTool registration, remote file/git panels, sidebar "Remote" group, serve-resume on switch-back, known_hosts first-connect guidance).
> **Goal**: the desktop connects over SSH to a machine and the agent session runs remotely (remote cwd, remote tool execution, remote rollout persistence), while the desktop UI consumes the event stream unchanged.
> **Related**: [../headless-daemon.md](../headless-daemon.md) (isomorphic shape, TCP variant as follow-up); [../capabilities.md](../capabilities.md) §2 "intentionally unwired" serve/remote-tool protocol; [../protocol-bridge.md](../protocol-bridge.md).

## 1. Seam decision

**Session-layer seam**: the remote runs `zhuye serve` (long-lived stdio JSONL service, one process per AgentThread); the desktop becomes a protocol client over an SSH child process.

The other two seams, not chosen:

- Tool layer (BashTool/file tools tunnel through SSH): all 27 builtin tools are local fs/process operations; the sandbox is kernel-level (Seatbelt/Landlock) and cannot be applied across machines; virtualizing the whole ToolContext is the largest change surface with no prior abstraction.
- Host layer (workspace as an `ssh://` URL): `WorkspaceState` / `AgentConfig.workspace` / `ToolContext.workspace` are all a `PathBuf` type chain — major upstream surgery.

Session-layer advantages: the protocol envelope is shared by four runtimes (transport-agnostic), serve IO is already parameterized, **upstream needs zero engine changes in v1** (serve is already a stdio protocol surface), and sandbox/permissions/rollout/memory all close the loop locally on the remote — semantics identical to local runs.

## 1a. Platform matrix & remote install (cross-platform scope)

| Desktop → remote | Status | Notes |
|---|---|---|
| macOS → Linux | ✅ primary design target | macOS ships OpenSSH; key auth + remote zhuye (one-click bootstrap available) |
| Windows → Linux | 🟡 usable, more prerequisites | Windows OpenSSH client is an optional feature (missing binary → actionable error, or `ZHUYE_REMOTE_SSH_BIN` pointing at Git's ssh); passphrase-protected keys require the ssh-agent service |
| macOS/Windows → macOS remote | 🟡 plausible, not verified on device | upstream publishes darwin artifacts; bootstrap applies |
| Any → Windows remote | ⛔ not a target scenario | zhuye serve would theoretically run but is unverified |

**Common prerequisites** (all platforms): BatchMode key auth (no interactive passwords); **known_hosts must already contain the host** before the first connect (BatchMode fails the host-key prompt — guide users to ssh manually once); the remote zhuye CLI can be installed via the one-click bootstrap.

**Remote install (bootstrap, implemented)**: `zhuye_remote_bootstrap` pipes a POSIX sh script over ssh — detect OS/arch → resolve the upstream latest tag → download `zhuye-<version>-<triple>.tar.gz` (curl or wget) → install to `~/.local/bin` (no sudo) → self-verify. Transport pairing: serve/probe run through `sh -lc` (login shell) so the install location is on PATH (non-interactive ssh commands do not include `~/.local/bin` by default).

## 2. Existing foundation

- Upstream: `zhuye serve` reads `Submission` from stdin, writes `Event` to stdout, and emits the `session_configured` handshake; the reverse tool channel is already reserved — `Op::RegisterTools` / `ToolExecutionResponse` + `EventMsg::ToolExecutionRequest` (`ToolSource::Remote` / `RemoteBridge`); desktop `docs/capabilities.md` §2 explicitly records these 2 Ops as "intentionally unwired", which this feature lights up.
- Desktop: the `sshHost` parameter of `zhuye_run_shell` (`ssh -o BatchMode=yes -o ConnectTimeout=10` argv pattern) is reusable as the transport shape; `RemoteConfig` is an in-memory placeholder, the `/remote` route exists (Tailscale probe + status server); `app-core/tailscale.rs` produces `suggested_remote_host`.
- Event routing: the foreground `session_tx` (single `zhuye_event` channel) already handles foreground/background sources keyed by sid; remote session events injected into the same bus are consumed by the reducer unchanged.
- Remote prerequisite: the `zhuye` CLI is installed (version probe at connect; failure surfaces install guidance).

## 3. Backend changes (src-tauri/)

1. **New `src/state/remote.rs`**: `RemoteSessionManager`
   - host registry persisted in `~/.zhuye/config.toml` `[remote_hosts]` (name/host/port/user)
   - transport: `ssh -o BatchMode=yes -o ConnectTimeout=10 <host> -- zhuye serve --cwd <path>` child process stdin/stdout duplex (no new SSH library, key-based auth)
   - `session_configured` handshake confirmation, stderr captured as diagnostic logs, liveness monitoring (process exit → session marked disconnected)
   - events injected into the existing `session_tx` (keyed by sid)
2. **Command surface** (`src/commands/remote.rs` extension, replacing not-implemented placeholders):
   - `zhuye_remote_hosts` (CRUD + connectivity test), `zhuye_remote_connect/disconnect`
   - `state/submit.rs` routes by workspace type: local AgentThread / remote `RemoteAgentClient` (implements the same submit/interrupt command face as local); `ensure_workspace_matches` extended with the remote identity `ssh://host/path`; the protocol's `SessionMeta.workspace` is a String, so the v0 freeze is unaffected
3. **Session lifecycle**: switching away disconnects the serve child process (remote rollout is already persisted, matching "switching away always degrades"); switching back restores via the serve resume path; remote sessions appear in a dedicated "Remote" group in the sidebar

## 4. Frontend changes

- `src/features/remote/` + `src/logic/remote/useRemoteController.ts` extension: host CRUD cards, connection status, bootstrap guidance when the remote zhuye is missing
- Workspace switcher gains a "Remote workspace" entry; sidebar gains the "Remote" group
- Intentional v1 degradation (honest boundary): file browser / editor / git panels show a "remote workspace not yet supported" empty state for remote workspaces

## 5. Follow-ups (not in v1)

- Reverse RemoteTool registration (`Op::RegisterTools`): remote agent drives desktop terminal/file preview — lighting up the remote-tool protocol consumption surface recorded in capabilities.md
- Remote file panel / editor / git panel remote-ization
- TCP/TLS daemon (`headless-daemon.md` shape) replacing the SSH child transport

## 6. Gates & docs

- L3 `ipc_remote.rs`: stub serve process covering handshake / framing / error paths (sandboxed HOME/cwd, same fixture as existing suites)
- L2 `useRemoteController` extension tests; `tests/contracts/` sync (if the protocol surface changes)
- `tests/COVERAGE.md` + `tests/RUNTIME_COVERAGE.md` rows
- `docs/protocol-bridge.md` (remote session routing), `docs/changelog.md`, `docs/capabilities.md` (serve wiring status update)

## 7. Risks

- SSH key auth is a hard prerequisite (BatchMode forbids interactive passwords); auth failures must guide key setup.
- One serve child process per remote session, isomorphic to the "background threads" model but with the process boundary on the remote — network-loss semantics (session marked disconnected + resumable) must be explicit in the UI.
- Remote zhuye version and desktop engine version need compatibility (probe at connect; warn on major mismatch).
