# 测试实施计划

本文件是桌面端统一调度器的权威任务目录。桌面端必须保留四层证据:前端替身、
真实命令体、真实 Tauri 窗口和最终安装包;低层通过不能替代高层通过。

## 1. 公共基座

非 live 套件使用本地模型、隔离数据目录、真实临时工作区和生产命令注册表。
E2E 由统一 runner 注入 `E2E_REQUIRED=1`,依赖缺失判失败。Linux/Windows 走
Tauri WebDriver,macOS 走 CoreGraphics 原生窗口层;三个平台都必须真跑。

结果状态固定为 `pass`、`fail`、`skip`、`infra_error`、`timeout`、`pending`。
`pending` 与基础设施错误返回 2;断言失败或超时返回 1;dry-run 全部为 `skip`。

## 2. 桌面端任务

| 任务 | 覆盖目标 | 状态 |
|---|---|---|
| `desktop.static` | 命令面、文档、版本、仓库卫生 | 映射 L1 |
| `desktop.component.frontend` | UI 状态、组件、a11y、路由 | 映射 L2 |
| `desktop.unit.backend` / `desktop.contract.ipc` | 真命令体与 IPC 契约 | 映射 L3 |
| `desktop.integration.backend` | 设置、会话、终端、扩展、调度 | 映射 L3 |
| `desktop.e2e.native` | 真窗口、真实 WebView/IPC | Linux/Windows WebDriver + macOS CoreGraphics 窗口层 |
| `desktop.platform` / `desktop.visual` | 平台矩阵、视觉基线 | 随 L5;专项待补 |
| `desktop.accessibility` | 键盘、axe、可访问名称 | 映射 L2 |
| `desktop.security` | IPC 权限、CSP、内容边界 | 核心映射;专项待补 |
| `desktop.performance` | 冷启动、前端预算与大数据回放 | 三层性能门禁映射 |
| `desktop.release` | 最终安装包、资源、清洁性、签名、安装升级 | 映射 L4 |
| `desktop.fault` | 存储损坏 / 只读 / Runtime 故障 | L2 错误恢复 + L3 真后端矩阵 |
| `desktop.live` | 真实 provider 演练 | 条件项 |

`CASE_INDEX` 保留 D 系列编号。mock IPC 只能证明 UI 意图,不能证明 Tauri
capability、真实 WebView 或安装包行为。

## 3. 执行与报告

选集固定为 `pr`、`smoke`、`main`、`nightly`、`release`。PR 包含静态、前端、
真后端和核心 IPC;主分支补完整后端与真实窗口;发布必须跑最终产物并暴露
未覆盖的平台矩阵。报告写入 `.test-runner/`,记录 HEAD、子模块指针、平台、
复现命令、日志、截图路径和 seed。
