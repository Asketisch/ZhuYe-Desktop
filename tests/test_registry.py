"""test_registry.py —— ReflectDesktop(Rust + Tauri 桌面端)任务注册表。

任务 ID 与 PLAN.md 第 4 章对应;映射到仓库既有六层入口
(static / frontend / backend / artifact / e2e / live,见 tests/run_all.sh)。
四种证据层次(PLAN §4 开头)由这些层分别承担:

- frontend 层:前端 + mocked IPC(验证 UI 和调用意图)
- backend 层:Tauri mock runtime + 真命令体(验证 Rust 接线)
- e2e 层:真实 Tauri 窗口(系统 WebView、IPC、权限) + 视觉回归
- artifact 层:最终安装包(结构、资源、清洁性)

coverage 语义同 Reflect-Agent。
"""

TASKS: dict[str, dict] = {
    # ---- 公共基座 ----
    "shared.harness": {
        "builtin": "shared.harness",
        "note": "测试基座自检:Python 版本 / 工具链可用性 / 报告目录可写",
    },

    # ---- 静态、单元与组件(PLAN §4.1,D-U01~D-U16) ----
    "desktop.static": {
        # D-U01:L1 静态审查层(命令面 / 文档 / 版本 / 卫生)
        "command": ["tests/run_all.sh", "static"],
        "note": "D-U01:L1 源码与仓库状态审查",
        "timeout_s": 1800,
    },
    "desktop.unit.backend": {
        # D-U02~D-U05:IPC 清单一致 / 类型漂移 / Command 校验 / Runtime 生命周期
        # 由 L3 真后端能力覆盖层承担(mock runtime 驱动真实命令体)
        "command": ["tests/run_all.sh", "backend"],
        "note": "D-U02~D-U05:L3 真后端能力覆盖(mock runtime + 真命令体)",
        "timeout_s": 3600,
    },
    "desktop.component.frontend": {
        # D-U06~D-U16:前端组件 / 状态 / a11y / 路由矩阵(typecheck + vitest 全量)
        "command": ["tests/run_all.sh", "frontend"],
        "note": "D-U06~D-U16:L2 前端行为层(typecheck + vitest,含 a11y 与路由矩阵)",
        "timeout_s": 3600,
    },

    # ---- IPC、后端及 Runtime 集成(PLAN §4.2,D-I01~D-I18) ----
    "desktop.contract.ipc": {
        # D-I01:生产注册入口的真实 command 调用 —— L3 承担
        "command": ["tests/run_all.sh", "backend"],
        "note": "D-I01~D-I06(核心):L3 真命令体;全能力矩阵(D-I07~D-I18)随主分支执行",
        "timeout_s": 3600,
    },
    "desktop.integration.backend": {
        # 与 contract.ipc 同入口;保留独立任务便于 PLAN ID 定向
        "command": ["tests/run_all.sh", "backend"],
        "note": "D-I07~D-I18:后端集成(设置持久化 / 会话生命周期 / 终端 / MCP 等)",
        "timeout_s": 3600,
    },

    # ---- 真实窗口端到端(PLAN §4.3,D-E01~D-E17) ----
    "desktop.e2e.native": {
        # L5:真窗口冒烟(tauri-driver)+ 视觉回归;依赖缺失时整层可跳过
        "command": ["tests/run_all.sh", "e2e"],
        "note": "D-E01~D-E17:L5 真窗口 E2E + 视觉回归;依赖缺失按基础设施错误阻断",
        "timeout_s": 5400,
        "env": {"E2E_REQUIRED": "1"},
        "os": ["linux", "darwin", "windows"],
        "required_on": ["linux", "darwin", "windows"],
    },

    # ---- 原生系统、兼容、视觉与可访问性(PLAN §4.4,D-P01~D-P15) ----
    "desktop.platform": {
        # D-P08/D-P09 等平台矩阵归入 e2e 层执行;独立专项待补
        "command": ["tests/run_all.sh", "e2e"],
        "note": "D-P01~D-P15:Linux 平台矩阵随 L5 真窗口执行;macOS/Windows 原生窗口、DPI/多屏/输入法专项待补",
        "timeout_s": 5400,
    },
    "desktop.visual": {
        # D-P10/D-P11:路由 × 主题截图归视觉回归(L5 内含)
        "command": ["tests/run_all.sh", "e2e"],
        "note": "D-P10/D-P11:视觉回归随 L5;Linux/macOS/Windows 独立基线已接入",
        "timeout_s": 5400,
    },
    "desktop.accessibility": {
        # D-P12/D-P13:键盘全流程与 axe 检查 —— a11y.*.test.tsx 在 L2 执行
        "command": ["tests/run_all.sh", "frontend"],
        "note": "D-P12/D-P13:a11y 键盘与路由矩阵(vitest);真实屏幕阅读器(D-P14)待补",
        "timeout_s": 3600,
    },

    # ---- 安全、故障、性能和最终安装包(PLAN §4.5,D-Q01~D-Q20) ----
    "desktop.security": {
        # D-Q01~D-Q07:IPC 权限 / CSP / Asset 边界 / 密钥泄露 / 测试接口剔除
        # 分散在 L1(静态审查)、L3(IPC 契约)与 L4(产物审查);统一入口 backend+artifact
        "command": ["tests/run_all.sh", "backend"],
        "note": "D-Q01~D-Q06:L3 承担;D-Q07 测试接口剔除见 desktop.release(L4)",
        "timeout_s": 3600,
    },
    "desktop.fault": {
        # D-Q08/D-Q09:坏配置 / 坏历史 / 只读存储 / provider 与 autopilot 失败
        # 已分散在 L2 错误恢复与 L3 真命令体测试;backend 全量保证它们执行。
        "command": ["tests/run_all.sh", "backend"],
        "note": "D-Q08/D-Q09:存储损坏 / 只读 / Runtime 与 provider 故障矩阵",
        "timeout_s": 3600,
    },
    "desktop.performance": {
        "command": ["python", "tests/performance.py"],
        "note": "D-Q10~D-Q12:冷启动 + 前端预算 + 500 会话/5k 回放大数据预算",
        "timeout_s": 3600,
    },
    "desktop.release": {
        # D-Q13/D-Q20:L4 发布产物审查(.app/.dmg/.deb/.msi 结构与内容)
        "command": ["tests/run_all.sh", "artifact"],
        "note": "D-Q07/D-Q13/D-Q20:L4 产物结构 / 签名封印 / 安装升级 / 启动冒烟",
        "uses_artifact": True,
        "timeout_s": 3600,
    },

    # ---- live 层(真实模型,默认 SKIP,需 REFLECT_LIVE=1) ----
    "desktop.live": {
        "coverage": "conditional",
        "command": ["tests/run_all.sh", "live"],
        "note": "L6 实模型演练层(真实 provider + 真实 SSE;需 REFLECT_LIVE=1)",
        "enabled": False,
    },
}

SUITES: dict[str, list[str]] = {
    # PR:静态、前端组件、真命令体、核心 IPC、Linux 真窗口(按平台)
    "pr": [
        "desktop.static", "desktop.component.frontend",
        "desktop.unit.backend", "desktop.contract.ipc",
    ],
    # 冒烟:D-E01/E02/E04/E05/E06/E07/E10 + D-Q07/D-Q13/D-Q14
    "smoke": ["desktop.component.frontend", "desktop.unit.backend", "desktop.e2e.native"],
    # 主分支:三系统核心真窗口与产物 smoke
    "main": [
        "desktop.static", "desktop.component.frontend", "desktop.unit.backend",
        "desktop.contract.ipc", "desktop.integration.backend",
        "desktop.accessibility", "desktop.performance", "desktop.e2e.native",
    ],
    # 夜间:WebView/系统集成、视觉、故障、性能、长稳
    "nightly": [
        "desktop.platform", "desktop.visual", "desktop.security",
        "desktop.fault", "desktop.live",
    ],
    # 发布候选:最终安装包、签名、无测试接口
    "release": ["desktop.static", "desktop.release", "desktop.e2e.native"],
}

CASE_INDEX: dict[str, str] = {
    **{f"B{i:02d}": "shared.harness" for i in range(1, 17)},
    # D-U 静态与组件
    "D-U01": "desktop.static",
    **{f"D-U{i:02d}": ("desktop.unit.backend" if i <= 5 else "desktop.component.frontend")
       for i in range(2, 17)},
    # D-I IPC 与后端集成
    **{f"D-I{i:02d}": ("desktop.contract.ipc" if i <= 6 else "desktop.integration.backend")
       for i in range(1, 19)},
    # D-E 真实窗口
    **{f"D-E{i:02d}": "desktop.e2e.native" for i in range(1, 18)},
    # D-P 平台 / 视觉 / 可访问性
    **{f"D-P{i:02d}": ("desktop.visual" if i in (10, 11)
                        else "desktop.accessibility" if i in (12, 13)
                        else "desktop.platform")
       for i in range(1, 16)},
    # D-Q 安全 / 故障 / 性能 / 发布
    **{f"D-Q{i:02d}": ("desktop.security" if i <= 6 else
                        "desktop.fault" if i <= 9 else
                        "desktop.performance" if i <= 12 else "desktop.release")
       for i in range(1, 21)},
}
