# 发布审查报告

生成时间:2026-11-17 20:21:22 CST
提交:0a5d245
分支:develop
工作区(运行前):干净
工作区(运行后):有未提交或未跟踪变更
submodule: 7196d3c5edd2d045e520a9033d0c9fcb2a31307e zhuye-agent (v0.1.14-103-g7196d3c5)

## 分层结果

| 层 | 套件 | 结果 | 摘要 |
|---|---|---|---|
| 1 | `static` | ❌ 失败 | 24 passed / 2 failed / 0 skipped |

**结论:存在阻断项 —— 禁止发布。**

> 「⏭ 跳过」= 该层因依赖缺失而**没有真正跑**(如本地未构建产物时的
> 产物审查层)。发布流水线里产物审查是必跑的,不会跳过;
> GATE_STRICT=1 时任何跳过(整层或层内)都判失败。

## 层内跳过明细

(无)

## 逐用例明细

### `static`

```
PASS	registry-no-orphan	207 个已注册命令全部有前端消费面
PASS	backend-all-registered	206 个后端命令体全部已注册
PASS	frontend-no-phantom	207 个前端包装全部有后端实现
PASS	fakebackend-parity	fakeBackend 实现了全部 207 个已注册命令
PASS	registry-size-floor	注册表 207 个命令(下限 105)
PASS	payload-sample-complete	206 条命令全部有线格式契约样本
PASS	protocol-doc-coverage	PROTOCOL_BRIDGE 覆盖 92.2%(下限 91.9%)
PASS	route-view-exists	38 个路由组件全部有对应文件
PASS	file-size-budget	无新增超 500 行文件(存量 8 个已登记基线)
PASS	no-debug-leftover	461 个生产文件无调试残留
PASS	i18n-namespace-merged	48 个命名空间全部并入 STRINGS
PASS	commands-barrel-complete	48 个领域模块全部从 barrel 导出
PASS	no-hardcoded-secret	生产源码未发现硬编码密钥
PASS	capability-command-coverage	后端测试源码引用 202/206 条命令(下限 181;非执行覆盖)
PASS	registered-command-has-test	206 条命令均有测试引用或显式环境排除
PASS	版本号四处一致(package.json / Cargo.toml / src-tauri / tauri.conf.json)	版本一致:0.0.5(package.json / Cargo.toml / src-tauri / tauri.conf.json)
PASS	CHANGELOG 覆盖当前版本	CHANGELOG 含 0.0.5 条目
FAIL	能力矩阵与 submodule 版本一致
PASS	submodule 清单奇偶一致(workspace.dependencies 继承键)	根清单镜像子模块 11 个 clippy allow 继承键
PASS	事件面三方奇偶(EventMsg 变体 = TS 联合 = 契约样本)	事件面一致:51 个变体(Rust enum = TS EventMsgType = events.json)
PASS	提交操作奇偶(Rust Op = TS 联合 = 样本)	提交操作一致: 27 个 Rust Op = OpType = ReflectSubmissionOp = ops.json
PASS	submodule 指针已提交	zhuye-agent submodule 指针已提交
PASS	无垃圾文件入库(node_modules / .DS_Store / dist / target)	无垃圾文件入库
PASS	发布必备文档齐备	协议 / 能力 / 地图 / 变更日志四份文档齐备
PASS	工具链锁定	工具链已锁定(rust-toolchain.toml + package.json)
FAIL	门禁自测脚本(*.test.sh 全量执行)
```

---

逐层日志见 `/Users/admin/Code/CNB/ZhuYe-Family/ZhuYe-Desktop/.test-results-static/`;覆盖口径见 [tests/COVERAGE.md](tests/COVERAGE.md)。
