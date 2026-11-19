# scripts/ —— 构建、发版、安装与图标自动化脚本

> **何时读我**：要新增或修改构建打包、发版打 tag、产物安装、图标再生成、协议类型生成这类仓库级脚本时，先读本文。

## 目录职责

本目录是仓库级自动化的唯一脚本集：release 构建、发版流水线、本机安装、图标再生成与生成型 TS 协议类型，不含日常开发命令（见根 AGENTS.md「常用命令」）。本篇正文里的文件路径一律相对仓库根目录。

## 脚本速览（以文件系统为准）

| 脚本 | 干什么 | 关键入口 |
|---|---|---|
| check-render-boundaries.mjs | 检查已迁移渲染与逻辑目录的依赖边界 | `pnpm typecheck` / `pnpm build` |
| build.sh | 按 OS 选默认打包目标的 release 构建 | `--fast` / `--universal` / `--bundles=` / `--no-frontend` / `--dry-run`；`pnpm build:native` |
| create_tag.sh | 一站式发版：版本 bump + CHANGELOG 转正 + 提交 + tag + 推送 | `--dry-run` / `--no-push` / `--yes` |
| gen-update-keys.sh | 生成 OTA 自更新的 minisign 密钥对（私钥不入库） | 直接运行；公钥填 tauri.conf.json > plugins.updater.pubkey |
| gen-latest-json.sh | 汇总各平台 updater 产物生成更新清单 latest.json（release CI 专用） | `gen-latest-json.sh <目录> <版本> <owner/repo> <输出>` |
| dump-ts-types.sh | Rust 协议类型经 JSON Schema 生成 TS 类型 | `pnpm types:gen` |
| gen-icons.sh | logo.png → 全套应用图标 + favicon | `--check` / `--dry-run` / `--local` / `--tray-keep`；`pnpm icons` |
| install.sh | 装二进制与 .app 到本机 | `--prefix=` / `--app-dir=` / `--dry-run` |
| render-display-png.py | 纯 Python 渲染设置页截图证据 | 直接运行，产物落 docs/screenshots/ |

## 各脚本本地契约

### gen-icons.sh —— 图标单一源图契约

- 仓库根 `logo.png` 是唯一源图（与调用目录无关）；产物 = `src-tauri/icons/` 全套 + `public/tauri-icon.png` favicon。
- `--check`（`pnpm icons:check`）只校验不写入：齐全、尺寸、托盘透明底、是否比源图旧。
- `icon32.png` 按源图亮度阈值推导托盘透明剪影——`src-tauri/src/tray.rs` 以 template 图片使用它，必须保持透明底。
- 引擎降级链：优先 `tauri icon` CLI；缺 CLI 时退 python3 + Pillow（macOS `.icns` 走 `iconutil`）。
- 环境变量钩子：`ZHUYE_ICON_SOURCE` / `ZHUYE_ICONS_DIR` / `ZHUYE_PUBLIC_ICON`，门禁自测靠它们跑在临时目录。

### build.sh —— 图标新鲜度只 WARN

打包前跑一次 `gen-icons.sh --check`，图标落后于 logo.png 只打 WARN，不改文件、不阻断。默认目标按 OS：macOS→app,dmg / Linux→deb,appimage / Windows→msi。环境变量：`SIGNING_IDENTITY` / `NODE_INSTALLER` / `TAURI_CLI_ARGS`。

### create_tag.sh —— 版本四处同步契约

- 版本号四处一致：`package.json`、根 `Cargo.toml` 的 `[workspace.package]`、`src-tauri/tauri.conf.json`（走 workspace 继承）、`Cargo.lock`（由 `cargo check` 刷新，不手改）。
- `versions_consistent()` 与 `tests/static/run.sh` 的 check_versions 同一口径，不一致即拒发。
- 流程：前置校验（main 分支 + 工作区干净 + 不落后远端 + submodule 指针已推上 ZhuYe 远端）→ bump → CHANGELOG「未发布」段转正 → 本地跑静态门禁 → 提交 + annotated tag + 推送。
- 推送 `v*` tag 触发 `.github/workflows/release.yml`：门禁全绿后打包发 GitHub Release。
- 发布前置（一次性，仓库外）：OTA 更新签名的 `TAURI_SIGNING_*` secrets 已配置（生成见 gen-update-keys.sh）—— 未配置时 release.yml 构建硬失败，属预期门禁。

### install.sh / dump-ts-types.sh / render-display-png.py

- install.sh：装 `target/release/reflect-desktop` 到 `--prefix`（默认 `/usr/local/bin`）+ `ZhuYe.app` 到 `--app-dir`（默认 `~/Applications`）；`ZHUYE_INSTALL_BIN` / `ZHUYE_INSTALL_APP` 供 CI 传入与构建同源的路径。
- dump-ts-types.sh：`cargo run -p zhuye-protocol --example dump_schema` → `npx json2ts` → `src/types/protocol.generated.ts`。产物为生成文件，勿手改；本脚本不是构建依赖，npx 不可用时跳过。
- render-display-png.py：纯 Python（zlib + struct，无原生依赖）渲染 `docs/screenshots/display-section.png`，配色镜像 `src/render/styles/tokens.css`。

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
