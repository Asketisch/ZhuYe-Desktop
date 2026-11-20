# 规划：应用自更新（OTA 热更新）

<p align="center">
  <b>中文</b> · <a href="hot-update.en.md">English</a>
</p>

> **状态**：v1 已落地（桌面提交 9acf91bc）：完整 OTA 回路 + 发布链签名/latest.json。
> **待办**：minisign 密钥生成与 GitHub secrets 配置（`scripts/gen-update-keys.sh`，仓库外手工步骤）；Apple Developer ID 公证与 Windows 签名列为后续项。
> **目标**：用户在应用内完成「检查 → 下载 → 签名校验 → 安装 → 重启」的完整自更新回路，无需手动下载安装包。
> **关联**：[../gui/04-roadmap.md](../gui/04-roadmap.md) M3.x「多平台 auto-update」；[protocol-bridge.md](../protocol-bridge.md) 更新命令面。

## 1. 现状

- `zhuye_check_update`（`src-tauri/src/commands/update.rs`）：curl 探测 GitHub `releases/latest`，纯版本号比较，**只检查不下载不安装**；设置页 UpdatesSection 展示 + 外链浏览器打开 release 页。
- 无 tauri-plugin-updater、无 minisign 签名、无 latest.json 产物；`release.yml` 三平台打包上传 Release 但不产更新元数据。
- macOS `signingIdentity: "-"`（ad-hoc）；版本四处同步（package.json / 根 Cargo.toml / tauri.conf.json / Cargo.lock）已由 `create_tag.sh` + L1 门禁保证。
- 断线：原生菜单 `menu-check-updates` 事件前端无消费者。

## 2. 方案

**插件栈**：`tauri-plugin-updater v2`（下载 + minisign 签名校验 + 安装）+ `tauri-plugin-process v2`（重启）。更新流程在 Rust 侧命令封装，前端不经插件 JS API（遵循「Tauri 调用仅放 `src/utils/commands/`」约定）。

**命令面**（全部走生产测试共用的 `configure()`）：

| 命令 | 职责 |
|---|---|
| `zhuye_check_update` | 保留现状（兼容），作为轻量探测 |
| `zhuye_download_install_update` | updater `check()` → `download_and_install()`，进度经 `zhuye_update_progress` 事件转发（started/progress/finished） |
| `zhuye_relaunch_app` | 薄封装 process 插件 restart |

**配置**：`tauri.conf.json` 增 `plugins.updater`（endpoint 指 GitHub Releases `latest.json`，pubkey 占位待密钥生成后填入）；`capabilities/main.json` 补 `updater:default`、`process:allow-restart`。

**发布链**：`scripts/gen-update-keys.sh` 生成 minisign 密钥对（私钥仅本地 + GitHub secret `TAURI_SIGNING_PRIVATE_KEY`，公钥入库 `tauri.conf.json`）；`release.yml` 注入签名 env，tauri build 产各平台更新包 + 签名，CI 汇总生成 `latest.json`（platform → { signature, url }）上传 Release。

**前端**：`UpdatesSection` 增「立即更新」按钮 → 进度条（监听 `zhuye_update_progress`）→ 完成后「重启应用」引导；自动检查开关（默认关）放同节。

**顺手修复**：`menu-check-updates` 事件接前端监听（跳设置页并触发检查）。

## 3. 签名现实约束

- tauri-plugin-updater 只要求 **minisign** 签名，与 Apple 代码签名/GNU 公证无关。
- ad-hoc 签名应用经 updater 替换文件不触发 quarantine（updater 直接写文件而非浏览器下载），实践可行。
- Apple Developer ID + 公证、Windows 签名（消除 SmartScreen 提示）列为后续项，不阻塞本功能。

## 4. 实施拆分

1. 后端：Cargo.toml 两插件、lib.rs 注册、update.rs 扩展、capabilities、tauri.conf.json
2. 发布链：gen-update-keys.sh + release.yml
3. 前端：updates.ts 包装、UpdatesSection 升级、fakeBackend 同步
4. 门禁与文档：L3 ipc 测试（错误路径/结构）、L2 组件测试、COVERAGE/RUNTIME_COVERAGE 补行、protocol-bridge.md、changelog.md

## 5. 风险

- minisign 密钥与 GitHub secrets 是**仓库外手工步骤**；缺密钥时 CI 签名失败（门禁可见，属预期）。
- `latest.json` 必须与三平台产物同批生成，版本号与四处同步机制联动。
- 更新中途断网：updater 原子性由插件保证（下载完成后才落盘替换）。
