# 安全策略

> ReflectDesktop 的安全漏洞报告与处理流程。本文档面向所有希望负责任地披露
> 漏洞的研究员、用户与贡献者。

---

## 支持的版本

下表列出当前获得安全更新的 ReflectDesktop 版本。

| 版本    | 是否支持 |
|---------|----------|
| 0.1.x   | ✅ 是    |
| < 0.1.0 | ❌ 否    |

> 0.1.0 之前的内部开发版本未对外发布,不在公开支持范围。请升级到 0.1.0
> 或更新版本。

---

## 报告漏洞

如果你在 ReflectDesktop 中发现安全漏洞,**请不要**通过 GitHub Issues、
Discussions 或公开 PR 提交,以免在补丁发布前被恶意利用。

桌面端尤其关注以下风险面:

- Tauri IPC 命令注入 / 越权调用(命令表 → AgentThread 的边界)
- CSP 或 WebView 相关的代码执行面
- 文件 / Git / Shell / 终端命令的路径穿越与命令注入
- 工作区(项目目录)切换导致的能力逃逸
- 审批(allowlist)绕过
- 本地持久化数据(会话、内存、token)的泄露或篡改

### 私下报告通道

请通过以下任一方式私下联系维护者:

- **GitHub Security Advisory**:
  [新建私密报告](https://github.com/Asketisch/ReflectDesktop/security/advisories/new)(首选)
- **邮箱**:`security@zhuye-agent.dev`
- **主题前缀**:`[SECURITY]`(便于邮件过滤)

### 报告应包含的信息

为帮助我们快速复现与修复,请尽量提供:

1. **漏洞类型与影响范围**(例如:命令注入、路径穿越、审批绕过、信息泄露)
2. **受影响的组件 / 文件 / 函数 / Tauri 命令**
3. **触发条件与最小复现步骤**(含完整命令、输入、配置)
4. **受影响版本**(根据上表标注的版本号)与操作系统
5. **已知缓解措施**(若有,包括临时绕过方案)
6. **是否已在公开环境利用**(如已利用,影响面如何)
7. **你的联系方式**(便于后续澄清细节)

### 我们的承诺

- 在收到报告后 **72 小时内** 确认收到
- 在合理时间内(通常 7–30 天,视复杂度)修复并发布补丁
- 修复后通过
  [GitHub Security Advisory](https://github.com/Asketisch/ReflectDesktop/security/advisories)
  公开披露(除非你明确要求匿名)
- 致谢报告者(如果你愿意在公告中署名)
- 修复前不公开披露任何细节

---

## 凭据与隐私

**绝不要**在 issue、PR、commit message、Discussion 或聊天群组中包含:

- 任何 LLM provider 的 API key(OpenAI、Anthropic、Ollama 等)
- 任何 GitHub / GitLab / 平台的个人访问令牌(PAT)
- 任何用户的真实姓名、邮箱、IP、token
- 任何 session / rollout 文件内容(可能含敏感上下文)

核心引擎(Reflect-Agent)自带 `secret-sanitize` 工具,会在落盘前自动检测并
脱敏常见凭据模式(`sk-...`、`ghp_...`、Bearer 头、配置 `api_key` 字段等)。
但请**不要依赖**自动检测 —— 自觉遵守永远是最稳妥的防线。

---

## 公开披露政策

我们遵循 [负责任披露](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure)
原则:

- 收到报告 → 确认 → 调查 → 修复 → 协调公开披露时间
- 默认给报告者 **90 天** 披露窗口期(可协商延长或缩短)
- 若 90 天内未修复且无进展,报告者可自行公开披露(我们鼓励继续协作)

---

## 安全相关更新

- 关注本仓库的
  [GitHub Releases](https://github.com/Asketisch/ReflectDesktop/releases)
  与 [Security Advisories](https://github.com/Asketisch/ReflectDesktop/security/advisories)
  获取安全公告
- 每周一自动运行 `cargo audit`(RustSec 数据库)扫描依赖漏洞
- 升级到最新版本是规避已知漏洞的最简单方式

---

## 致谢

感谢所有负责任地披露漏洞、为 Reflect 安全性做出贡献的研究员与用户。

> 本策略参考 [GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories)、
> [Apache 2.0 安全披露最佳实践](https://www.apache.org/security/) 与
> [CNCF Security TAG](https://github.com/cncf/tag-security) 编写。
