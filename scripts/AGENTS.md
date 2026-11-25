# scripts/ —— 构建、发版、安装、图标与磁盘治理自动化脚本

> **何时读我**：要新增或修改构建打包、发版打 tag、产物安装、图标再生成、协议类型生成、target/ 磁盘治理这类仓库级脚本时，先读本文。

## 目录职责

本目录是仓库级自动化的唯一脚本集：release 构建、发版流水线、本机安装、图标再生成、生成型 TS 协议类型与 target/ 磁盘治理，不含日常开发命令（见根 AGENTS.md「常用命令」）。本篇正文里的文件路径一律相对仓库根目录。

## 脚本速览（以文件系统为准）

| 脚本 | 干什么 | 关键入口 |
|---|---|---|
| check-render-boundaries.mjs | 检查已迁移渲染与逻辑目录的依赖边界 | `pnpm typecheck` / `pnpm build` |
| build.sh | 按 OS 选默认打包目标的 release 构建 | `--fast` / `--universal` / `--bundles=` / `--no-frontend` / `--frontend-only` / `--sync-app` / `--dry-run`；`pnpm build:native` |
| create_tag.sh | 一站式发版：版本 bump + CHANGELOG 转正 + 提交 + tag + 推送 | `--dry-run` / `--no-push` / `--yes` |
| gc.sh | 磁盘治理：清 target/ 中 cargo 不 GC 的 incremental（全 profile）/ llvm-cov-target / examples | `bash scripts/gc.sh` / `gc-deep` |
| gen-update-keys.sh | 生成 OTA 自更新的 minisign 密钥对（私钥不入库） | 直接运行；公钥填 tauri.conf.json > plugins.updater.pubkey |
| gen-latest-json.sh | 汇总各平台 updater 产物生成更新清单 latest.json（release CI 专用） | `gen-latest-json.sh <目录> <版本> <owner/repo> <输出>` |
| dump-ts-types.sh | Rust 协议类型经 JSON Schema 生成 TS 类型 | `pnpm types:gen` |
| gen-icons.sh | logo.png → 全套应用图标 + favicon；tray.png → 托盘图标 + 侧栏品牌位 | `--check` / `--dry-run` / `--local` / `--tray-keep` / `--no-web`；`pnpm icons` |
| install.sh | 装二进制与 .app 到本机 | `--prefix=` / `--app-dir=` / `--dry-run` |

## 各脚本本地契约

### gen-icons.sh —— 图标双源图契约

- 仓库根 `logo.png` 是**应用图标**源图（与调用目录无关）；产物 = `src-tauri/icons/` 全套 + `public/tauri-icon.png` favicon。
- 仓库根 `tray.png` 是**托盘图标**独立源图（菜单栏徽章，金焰凤凰花环）；`icon32.png` 从它推导：裁内容 bbox → 方形居中 → 32×32（内容 28/32）→ RGB 归黑 + alpha ×1.35（template 只取 alpha，系统按外观着色）。缺失时回落 logo.png 亮度阈值推导（历史行为）。
- 同源第二产物 **`public/brand-mark.png`（侧栏品牌位）**：托盘源图裁 bbox → 方形居中 → 64×64（内容 56/64），**保留原色不归黑**（明暗主题都要显示彩色徽记，与 template 托盘相反）；前端 `AppShell` 品牌位以 `<img src="/brand-mark.png">` 消费。托盘源图缺失时回落应用图标（黑底，亮色主题露底）。
- `--check`（`pnpm icons:check`）只校验不写入：齐全、尺寸、托盘透明底、brand-mark 存在性、logo.png/tray.png 各自比产物新（含 brand-mark 对 tray.png）。
- 引擎降级链：优先 `tauri icon` CLI；缺 CLI 时退 python3 + Pillow（macOS `.icns` 走 `iconutil`）。brand-mark 推导缺 Pillow 时退 `sips -Z 64`。
- 环境变量钩子：`ZHUYE_ICON_SOURCE` / `ZHUYE_TRAY_SOURCE` / `ZHUYE_ICONS_DIR` / `ZHUYE_PUBLIC_ICON` / `ZHUYE_BRAND_MARK`，门禁自测靠它们跑在临时目录。

### build.sh —— 图标新鲜度只 WARN + 前端内嵌保鲜

打包前跑一次 `gen-icons.sh --check`，图标落后于 logo.png 只打 WARN，不改文件、不阻断。默认目标按 OS：macOS→app,dmg / Linux→deb,appimage / Windows→msi。环境变量：`SIGNING_IDENTITY` / `NODE_INSTALLER` / `TAURI_CLI_ARGS`。

前端资产内嵌契约：`generate_context!`（`src-tauri/src/lib.rs`）在编译期把 dist/ 嵌进二进制（.app Resources 无前端文件），且 tauri-build（≤2.7.x）不监听 dist 变化——完整构建也可能嵌旧前端。脚本以 `refresh_embed_if_stale` 守卫两条路径：dist 比目标二进制新即 touch lib.rs 触发嵌前端 crate 重编（依赖全缓存）。

- `--frontend-only`：只跑 `pnpm build` 产出 dist/ 即结束——不编译 Rust、不打包、不签名（cargo/rustc 缺失不阻断，打包相关参数不生效仅 WARN），与 `--no-frontend` / `--sync-app` 互斥。
- `--sync-app`：macOS 前端快速刷新——dist → 增量重编应用壳 → 新二进制换入现有 .app → ad-hoc + entitlements 重签。不重跑打包器、不出 dmg，发版仍走完整构建；`--fast` 有意义（决定 profile 与 .app 路径），`--universal/--bundles/--target` 不生效仅 WARN。cargo 命令**必须带 `--features tauri/custom-protocol`**（与 tauri CLI 同口径）：v2 的 dev 判定是 tauri-macros 编译期常量（feature 链传入），缺了它 `generate_context!` 走 dev 分支——不嵌 dist、运行时指向 devUrl，产出「假发布」二进制。

### create_tag.sh —— 版本四处同步契约

- 版本号四处一致：`package.json`、根 `Cargo.toml` 的 `[workspace.package]`、`src-tauri/tauri.conf.json`（走 workspace 继承）、`Cargo.lock`（由 `cargo check` 刷新，不手改）。
- `versions_consistent()` 与 `tests/static/run.sh` 的 check_versions 同一口径，不一致即拒发。
- 流程：前置校验（main 分支 + 工作区干净 + 不落后远端 + submodule 指针已推上 ZhuYe 远端）→ bump → CHANGELOG「未发布」段转正 → 本地跑静态门禁 → 提交 + annotated tag + 推送。
- 推送 `v*` tag 触发 `.github/workflows/release.yml`：门禁全绿后打包发 GitHub Release。
- 发布前置（一次性，仓库外）：OTA 更新签名的 `TAURI_SIGNING_*` secrets 已配置（生成见 gen-update-keys.sh）—— 未配置时 release.yml 构建硬失败，属预期门禁。

### gc.sh —— 磁盘治理契约

- 两档：`gc`（默认）只清缓存类产物——`target/**/incremental`（dev 已在根 `Cargo.toml` `[profile.dev]` 关增量，但 release-fast 与交叉 target 仍会生成，故清理面覆盖全 profile 与交叉 target）+ `target/llvm-cov-target/`（L3 覆盖率重建树，曾达 32G）+ `target/debug/examples`；保留 deps 的 .rlib 与 .fingerprint，下次构建不全量重编。
- `gc-deep` 再清 `target/debug/deps`（下次构建 ≈ 冷构建），仅磁盘告急时用。
- **有意不删** `target/debug/.fingerprint`（偏离上游 ZhuYe `make gc`，勿「对齐」改回）：对照实验确认删它会让 cargo 把所有单元判为过期、下次构建全量重编依赖，而体积仅 ~38M——省盘收益可忽略、重编代价是整个 deps 树。
- 前置关系：`[profile.dev] incremental = false` 属 profile 变更，本身会使指纹失效，调整 profile 后的首次构建预期为一次冷构建。

### install.sh / dump-ts-types.sh

- install.sh：装 `target/release/zhuye-desktop` 到 `--prefix`（默认 `/usr/local/bin`）+ `ZhuYe.app` 到 `--app-dir`（默认 `~/Applications`）；`ZHUYE_INSTALL_BIN` / `ZHUYE_INSTALL_APP` 供 CI 传入与构建同源的路径。
- dump-ts-types.sh：`cargo run -p zhuye-protocol --example dump_schema` → `npx json2ts` → `src/types/protocol.generated.ts`。产物为生成文件，勿手改；本脚本不是构建依赖，npx 不可用时跳过。

## 禁止事项

- 不要在脚本里新增隐式改宿主状态的步骤（`npm install` / `cargo install` 类必须显式声明或前置探测）。
- 不要新增或改名脚本而不登记上方速览表。
- 不要在发版测试阶段打 tag——annotated tag 只能由 create_tag.sh 在门禁通过后打。
- 不要绕过 logo.png 单一源图契约，直接手改 `src-tauri/icons/` 下的产物。
- 不要让脚本写入 `zhuye-agent/**`（submodule 只读，升级流程见 `../SUBMODULE.md`）。

## 注意事项

- 图标再生成与发布联动的完整口径见根 AGENTS.md「常用命令」；六层门禁定位见根 AGENTS.md「验证矩阵」。
- CHANGELOG 新条目写进顶部「未发布」段，由 create_tag.sh 在发版时转正为版本段。

## 深入阅读

- [../AGENTS.md](../AGENTS.md) —— 根契约：常用命令、验证矩阵、门禁分层
- [../tests/README.md](../tests/README.md) —— 发布门禁套件系统说明（权威）
- [../SUBMODULE.md](../SUBMODULE.md) —— zhuye-agent 子模块升级流程
- [../docs/changelog.md](../docs/changelog.md) —— 版本更新日志与「未发布」段约定
