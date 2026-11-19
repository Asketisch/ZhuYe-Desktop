# Plan: Application Self-Update (OTA Hot Update)

<p align="center">
  <a href="hot-update.md">中文</a> · <b>English</b>
</p>

> **Status**: v1 shipped (desktop commit 9acf91bc): full OTA loop + release-chain signing/latest.json.
> **TODO**: minisign key generation and GitHub secrets setup (`scripts/gen-update-keys.sh`, manual step outside the repo); Apple Developer ID notarization and Windows signing are follow-ups.
> **Goal**: let the user complete the full self-update loop — check → download → signature verification → install → relaunch — inside the app, without manually downloading installers.
> **Related**: [../gui/04-roadmap.md](../gui/04-roadmap.md) M3.x "multi-platform auto-update"; [protocol-bridge.md](../protocol-bridge.md) update command surface.

## 1. Current state

- `reflect_check_update` (`src-tauri/src/commands/update.rs`): probes GitHub `releases/latest` via curl, compares version numbers only — **check-only, no download or install**; the UpdatesSection in Settings displays it with a link out to the release page.
- No tauri-plugin-updater, no minisign signing, no latest.json artifact; `release.yml` builds and uploads per-platform bundles to Releases but produces no update metadata.
- macOS `signingIdentity: "-"` (ad-hoc); four-way version sync (package.json / root Cargo.toml / tauri.conf.json / Cargo.lock) is already enforced by `create_tag.sh` + the L1 gate.
- Broken wire: the native menu emits `menu-check-updates` but no frontend consumer exists.

## 2. Approach

**Plugin stack**: `tauri-plugin-updater v2` (download + minisign verification + install) + `tauri-plugin-process v2` (relaunch). The update flow is wrapped in Rust-side commands; the frontend does not use the plugin JS API (per the "Tauri calls live only in `src/utils/commands/`" convention).

**Command surface** (all registered through the shared `configure()` used by production and tests):

| Command | Responsibility |
|---|---|
| `reflect_check_update` | kept as-is (compat), lightweight probe |
| `reflect_download_install_update` | updater `check()` → `download_and_install()`, progress forwarded via `reflect_update_progress` events (started/progress/finished) |
| `reflect_relaunch_app` | thin wrapper over the process plugin restart |

**Configuration**: `tauri.conf.json` gains `plugins.updater` (endpoint pointing at GitHub Releases `latest.json`, pubkey placeholder filled after key generation); `capabilities/main.json` gains `updater:default` and `process:allow-restart`.

**Release chain**: `scripts/gen-update-keys.sh` generates a minisign keypair (private key stays local + GitHub secret `TAURI_SIGNING_PRIVATE_KEY`; public key committed into `tauri.conf.json`); `release.yml` injects signing env, tauri build produces per-platform update bundles + signatures, CI assembles `latest.json` (platform → { signature, url }) and uploads it to the Release.

**Frontend**: UpdatesSection gains an "Update now" button → progress bar (listening to `reflect_update_progress`) → "Relaunch" prompt on completion; an auto-check toggle (default off) lives in the same section.

**Drive-by fix**: wire the frontend listener for the `menu-check-updates` event (navigate to Settings and trigger a check).

## 3. Signing constraints in practice

- tauri-plugin-updater requires only a **minisign** signature — independent of Apple codesigning/notarization.
- An ad-hoc signed app updated in place by the updater does not gain a quarantine attribute (the updater writes files directly, not via a browser download); this works in practice.
- Apple Developer ID + notarization and Windows signing (removing SmartScreen warnings) are follow-ups and do not block this feature.

## 4. Implementation breakdown

1. Backend: the two plugins in Cargo.toml, lib.rs registration, update.rs extensions, capabilities, tauri.conf.json
2. Release chain: gen-update-keys.sh + release.yml
3. Frontend: updates.ts wrappers, UpdatesSection upgrade, fakeBackend sync
4. Gates & docs: L3 ipc tests (error paths/structure), L2 component tests, COVERAGE/RUNTIME_COVERAGE rows, protocol-bridge.md, changelog.md

## 5. Risks

- The minisign keypair and GitHub secrets are **manual steps outside the repo**; CI signing fails visibly (expected) when keys are missing.
- `latest.json` must be generated in the same batch as the three platform bundles, with versions tied into the four-way sync mechanism.
- Mid-update network loss: atomicity is guaranteed by the plugin (files are replaced only after the download completes).
