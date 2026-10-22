# 免费模型实践测试指南（桌面端）

用**免费模型池**跑 ReflectDesktop 的完整 agent 链路 —— 不需要任何 API Key，
也不产生费用。

> 上游同源文档：`reflect-agent/docs/FREE_MODEL_PRACTICE.md`（TUI / CLI 侧）。
> 两边同口径，本篇只讲**桌面端**特有的接法（GUI 入口、门禁层 L6、
> Tauri IPC 链路）。

## 目录

- [为什么需要它](#为什么需要它)
- [两条车道](#两条车道)
- [配置模板](#配置模板)
- [跑起来](#跑起来)
- [GUI 里怎么配](#gui-里怎么配)
- [已知限制](#已知限制)
- [排障](#排障)

---

## 为什么需要它

发布门禁的六层里：

| 层 | 后端 | 模型 |
|---|---|---|
| L2 前端行为层 | **模拟**（`fakeBackend`） | 模拟 |
| L3 真后端能力覆盖层 | **真** | **假**（wiremock / 本地 mock LLM） |
| L6 实模型演练层 | **真** | **真**（免费模型池） |

L3 的假模型永远测不到：真实 SSE 帧的形状、真实模型的思考过程、真实限流
（429）、真实截断续作、真实 provider 的工具调用质量。免费模型池让这些
**零成本**地跑起来。

L6 是**可选演练层**：默认跳过、不进 CI 门禁（免费池配额是全局的，CI 上
跑只会制造噪声）。

---

## 两条车道

| 车道 | 端点 | 凭据 | 前置条件 |
|---|---|---|---|
| **Kilo 免费池**（默认） | `https://api.kilo.ai/api/gateway` | **免 Key** | 无 |
| **dsh 本地网关**（OpenCode 车道） | `http://127.0.0.1:18900` | `Bearer <forwardKey>` | 网关在跑 |
| **本地 Ollama**（无限额度） | `http://127.0.0.1:11434` | 无 | 装了 Ollama + 拉过模型 |

### Kilo 车道

零外部依赖 —— 只改 `config.toml` 就能用。实测该端点：

- `GET /v1/models` → 401 个模型，其中 **18 个 `isFree: true`**（17 个支持 tools）；
- `POST /v1/chat/completions` → 免 Key 直接 200，SSE 正常流式返回。

⚠️ **匿名访问有全局配额**。实测：连续跑若干轮后，端点转
`429 PROMOTION_MODEL_LIMIT_REACHED`（文案：「Sign up for free to continue …
Takes 2 minutes, no credit card required」），**所有**模型 id 都一样 ——
不是单模型限额，是匿名入口的整体配额。L6 把它判为**跳过**。

要长期稳定跑，三选一：注册 Kilo 免费账号、换出口 IP、或改用下面两条车道。

### dsh 网关车道

`dsh-our-free-model` 的本地服务把 OpenCode inference 端点转成 OpenAI 兼容
形态。**运行时零 npm 依赖**（只用 node 内置模块），所以**不需要
`npm install`** 就能起：

```bash
cd /Users/admin/Code/Github/dsh-our-free-model-main
node packages/standalone/cli.mjs --port 18900
# API Key 在 ~/.our-free-model/settings.json 的 forwardKey
```

> 端口被占时会自动顺延（18900 → 18901 …），实际端口看启动日志。
> submodule 侧有封装脚本 `reflect-agent/scripts/ofm_gateway.sh`。

⚠️ OpenCode 车道按**账号**计额度，429 很常见（提示 `Free usage limit
reached`）；地区门按出口 IP 判（`403 REGION_BLOCKED` /「not available in
your country」）。L6 会把它们判为**跳过**而不是失败。

### 本地 Ollama 车道（无限额度、离线）

想要「不被打断、可反复跑」的实践测试，就用本地模型：

```bash
ollama pull qwen2.5:1.5b      # 约 1GB;支持 tools(Qwen2.5 原生工具调用)
ollama pull qwen2.5:7b        # 更大的版本,工具调用更稳
```

```bash
REFLECT_LIVE=1 \
REFLECT_LIVE_PROVIDER=ollama \
REFLECT_LIVE_BASE_URL=http://127.0.0.1:11434 \
REFLECT_LIVE_MODELS=qwen2.5:1.5b \
bash tests/run_all.sh live
```

> Ollama provider 走**原生** `/api/chat`（不是 OpenAI 兼容的
> `/v1/chat/completions`），配置段是 `[ollama]`。因此这一车道**不写
> `model = "free"`**（本地没有「免费」概念，也没有清单端点）—— 直接写
> 具体的模型名。
>
> **这一车道已端到端验证**（2026-10-23，本机 Ollama 0.40.8 +
> `qwen2.5:1.5b`）：主回合用例 PASS —— `model spec = ollama/qwen2.5:1.5b`，
> 正文 6B / token 3885 / 终态 `success`。
>
> **它是跑「完整矩阵」的唯一不受配额限制的选项** —— 匿名免费池的额度是
> 全局共享的，跑满若干轮就会 `429 PROMOTION_MODEL_LIMIT_REACHED`。

---

## 配置模板

### ⚠️ 关键：必须用 `[[openai.credentials]]` **数组形态**

顶层单值 `api_key = ""` **注册不上这个 provider** ——
`reflect-config` 的 `build_openai_pool` 在「credentials 数组为空 **且**
api_key 为空」时直接返回 `None`（该 provider 不注册），于是 `model = "free"`
的清单发现报「provider 未注册任何凭据」。

数组形态则正常：`api_key = ""` 会构造出 client，且 `OpenAIClient` 对空 key
**不发 Authorization 头** —— 这正是免 Key 免费池要的。

### Kilo 车道（免 Key，默认）

```toml
# ~/.reflect/config.toml
[hooks]
enabled = []                      # 演练时关掉内置 hook（只验引擎行为）

[active]
provider = "openai"

[openai]
base_url = "https://api.kilo.ai/api/gateway"
timeout_secs = 300                # ⚠️ 见「已知限制」
model = "free"                    # 运行时从清单里挑

[[openai.credentials]]
label = "kilo-free"
api_key = ""                      # 免 Key —— 空 key 不发 Authorization 头
base_url = "https://api.kilo.ai/api/gateway"

[model_discovery]
enabled = true                    # 关掉则 model = "free" 直接报错
timeout_secs = 30
```

### dsh 网关车道

```toml
[active]
provider = "openai"

[openai]
base_url = "http://127.0.0.1:18900"
timeout_secs = 300
model = "free"

[[openai.credentials]]
label = "dsh-opencode"
api_key = "<forwardKey>"          # ~/.our-free-model/settings.json
base_url = "http://127.0.0.1:18900"

[model_discovery]
enabled = true
```

### 模型发现：从接口获取，不写死

免费模型集合由**上游**决定，随时可能增删 —— 写死模型 id 必然腐烂。
桌面端内置**模型发现能力**：配置写 `model = "free"` → 运行时查 provider
清单 → 按免费规则挑一个 → 写进运行时配置。事件流里看到的是**真实 model
id**，不是占位串。

「免费」的判定走规则（`reflect_llm::FreeModelRules`），三通道：

1. **provider 显式标记** —— Kilo 的 `isFree: true`（权威）；
2. **白名单** —— 不带 free 标记但确实免费的 id（默认三个，可配置）；
3. **id 模式** —— 默认 `["-free", ":free", "/free"]`。

规则**不包含模型清单** —— 模型本身永远来自 provider 的清单端点。

---

## 跑起来

### 门禁层 L6（真 IPC 全链路）

```bash
REFLECT_LIVE=1 bash tests/run_all.sh live
```

这条命令驱动的是**生产同一条链**：

```
reflect_submit → AgentThread → HTTP → SSE 解析 → reflect_event 通道
```

与 GUI 点一次「发送」完全同形（同一个 `generate_handler!` 注册表、同一个
AgentThread、同一个事件通道）。

### 直接跑 Rust 用例

L6 有**两个**测试二进制：

```bash
cd src-tauri
# 主回合:真模型 → 正文 → token → 终态
REFLECT_LIVE=1 cargo test --test ipc_live_free_model -- --ignored --nocapture
# 能力域矩阵:15 个场景跑完其余依赖模型的命令面
REFLECT_LIVE=1 cargo test --test ipc_live_capabilities -- --ignored --nocapture
```

**能力域矩阵**覆盖：工具调用(bubble 自动批准)/ 工具审批(prompt → 批准 → 工具真跑)/
中断 / 压缩 / 回退 / plan 模式(`plan_request` → `plan_ready` →
`plan_approved`)/ goal 模式 / 会话标题生成 / 任务工具 / 子代理 / 追问 /
讨论(断言 `llmBacked === true`,证明走了真模型而非 noop 回落)/ 流水线 /
团队流水线。

**矩阵的纪律**：**模型不配合 ≠ 产品缺陷** —— 模型没发起工具调用 / 没提问 /
没进 plan，判**跳过**（附理由）而不是失败；上游限流 / 地区门 / 配额耗尽
同样判跳过。只有「产品该做的没做」才判失败。

默认**不发起任何网络请求**：用例带 `#[ignore]`，运行期还要 `REFLECT_LIVE=1`
才放行（双保险 —— 手滑 `--ignored` 也不会误打上游）。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `REFLECT_LIVE` | 空 | 设 `1` 才真跑 |
| `REFLECT_LIVE_PROVIDER` | `openai` | provider 名(`openai` / `ollama`) |
| `REFLECT_LIVE_BASE_URL` | `https://api.kilo.ai/api/gateway` | provider 端点 |
| `REFLECT_LIVE_API_KEY` | 空 | 免 Key 端点留空；dsh 网关填 forwardKey |
| `REFLECT_LIVE_MODELS` | 空 | 逗号分隔 model id；空则从清单发现 |
| `REFLECT_LIVE_RETRIES` | `0` | 限流重试次数(默认**不重试**,见下) |
| `REFLECT_LIVE_RETRY_DELAY` | `65` | 重试间隔（秒）—— 必须 ≥ 凭据冷却窗(60s) |
| `REFLECT_LIVE_DRAIN_TIMEOUT` | `180` | 事件流等待预算（秒） |

### 为什么默认不重试

上游 429 会让凭据进入 **60s 冷却**，而冷却表是**进程内**的 —— 同一进程内
重试必然直接撞上冷却，拿到 `ALL_CREDENTIALS_EXHAUSTED(0 tried)`。真要重试，
得让 `REFLECT_LIVE_RETRIES > 0` **且** `REFLECT_LIVE_RETRY_DELAY` 覆盖冷却窗
（默认 65s）。与 submodule `tests/live/`「限流必须换新会话」的结论同源。

### 免 Key 池的额外限制

Kilo 免费池对**匿名**请求有使用上限，触顶后返回
`429 PROMOTION_MODEL_LIMIT_REACHED`（文案提示「注册后可用 / 过几分钟再来」）。
这是配额态，L6 判为**跳过**。要稳定跑，用带 key 的账号或换出口 IP。

### 指定模型

```bash
REFLECT_LIVE=1 REFLECT_LIVE_MODELS="cohere/north-mini-code:free" bash tests/run_all.sh live
```

---

## GUI 里怎么配

设置页的结构化配置表单直接暴露了 `openai.base_url` / `openai.model` /
`openai.api_key`，所以**手工配置免费池是可行的**：

1. `active.provider` 选 `openai`；
2. `openai.base_url` 填 `https://api.kilo.ai/api/gateway`；
3. `openai.model` 填 `free`；
4. `openai.api_key` 留空。

> ⚠️ **已知缺口**：设置页的「获取模型列表」走 `reflect_list_provider_models`，
> 该命令对空 `api_key` 直接报 `api_key is empty` —— **免 Key 的免费池在
> GUI 里拿不到模型清单**（引擎侧的清单发现不受影响，因为它走 provider
> client 而非该命令）。要用 GUI 侧的清单按钮，得先填一个占位 key。

---

## 已知限制

| 限制 | 说明 | 缓解 |
|---|---|---|
| **配额是全局的** | 免费池 429 常见（OpenCode 车道按账号计额度） | 用例自带重试；429 判为**跳过**；模型矩阵**串行**跑 |
| **匿名 Kilo 有整体配额** | 连续跑若干轮后 `429 PROMOTION_MODEL_LIMIT_REACHED` —— **所有**模型 id 都一样，不是单模型限额；文案提示「Sign up for free to continue … Takes 2 minutes」 | 注册免费账号 / 换出口 IP / 改用本地 Ollama 车道 |
| **OpenCode 车道也按账号计** | dsh 网关的 OpenCode tier（`beam-free` / `nemotron-*` / `glm-*` 等）过 v2 指纹门后，命中 `429 Free usage limit reached. Subscribe to OpenCode Go`；另有 `403 This model is not available in your country`（地区门，按出口 IP 判） | 换账号 / 换出口 IP；两者都是**环境态**，L6 判跳过 |
| **两条车道共用同一配额池** | Kilo 免费池与 OpenCode tier 在 dsh 网关侧最终都落到同一批**匿名免费模型**上 —— 实测两条车道的额度一起被同一个 `PROMOTION_MODEL_LIMIT_REACHED` 挡住 | 要跑**完整**矩阵（15 场景 × 多模型）就得有账号额度或本地模型；否则只能分批、串行地跑 |
| **凭据冷却是进程内的** | 429 会把凭据打进 60s 冷却，冷却表在进程内 → 同进程重试必然拿到 `ALL_CREDENTIALS_EXHAUSTED(0 tried)` | 默认**不重试**（判跳过）；要重试得 `REFLECT_LIVE_RETRIES>0` **且** `REFLECT_LIVE_RETRY_DELAY ≥ 65` |
| **地区门 403** | 免费车道按出口 IP 判地区 | 换出口后重跑 |
| **模型集合随时变** | 上游随时下架某个 id | 清单每次实时拉取 |
| **慢首字 / 思考静默** | 实测首字 >30s、思考阶段可静默 60~70s | `timeout_secs` **必须放大到 300** —— reqwest 的 timeout 是「建连→body 读完」的**总**时长，默认 60s 会把流式响应腰斩 |
| **思考过程字段名不一** | 多数端点用 `delta.reasoning_content`，免费池用 `delta.reasoning` | 桌面端两个都认（`reasoning_content` 优先） |
| **部分模型不支持 tools** | provider 直接 400 | L6 识别并**跳过**而不是失败 |
| **prompt 可能被上游记录** | Kilo 模型卡明示 | **只用合成数据**，不要喂真实仓库内容 / 凭据 |
| **免 Key 只在数组形态生效** | 顶层单值 `api_key = ""` → provider 注册不上 | 用 `[[openai.credentials]]` 形态 |

---

## 排障

**`provider 'openai' 未注册任何凭据`**
→ 配置用了顶层单值 `api_key` 且留空。改成 `[[openai.credentials]]` 数组形态。

**`model spec = stub/test`**
→ `model = "free"` 的清单发现失败（端点不可达 / 清单里没免费模型 / 走了付费
模型）。查 `degraded_reason` 与 `[model_discovery] enabled`。

**`RATE_LIMITED` / `ALL_CREDENTIALS_EXHAUSTED`**
→ 上游配额用尽。L6 判为**跳过**；要真跑得等配额恢复或换出口 IP。

**`AUTH_FAILED`**
→ 请求打到了**付费**模型上。确认 `base_url` 指向免费池、`model` 是真免费 id。

**思考过程看不到**
→ 端点用了第三种字段名（`delta.reasoning_details[]`），当前不解析。

**流式响应被腰斩**
→ `timeout_secs` 太小。放大到 300。

**`no model configured for the active provider`**
→ 配置里没写 model。写具体 id，或写 `model = "free"`（需
`[model_discovery] enabled = true`）。
