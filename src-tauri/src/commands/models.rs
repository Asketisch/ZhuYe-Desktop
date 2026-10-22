//! 模型列表查询:对着 provider 的用量端口拉取可用模型。
//!
//! 两种接入端口(与 plans 的 provider 语义一致):
//! - `openai`   → `GET {base_url}/models`,`Authorization: Bearer <key>`
//! - `anthropic`→ `GET {base_url}/v1/models`,`x-api-key` + `anthropic-version`
//!
//! 条目解析与**免费判定**在 `super::model_catalog`(纯逻辑,可单测);
//! 本模块只负责命令层:拼 URL / 发请求 / 组装响应。

use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

use super::model_catalog::{ProviderModelsResult, free_model_rules, parse_models_response};
use crate::commands::error::{CommandError, CommandResult};

/// 按接入端口施加鉴权头。
///
/// **空 `api_key` = 免 Key 端点** → **不发** Authorization 头。
/// 免 Key 的 OpenAI 兼容端点(免费模型池)对「空 Bearer」宽容、对「非空
/// 无效 token」严格 —— 少发一个头更稳。与 `reflect-llm` 的 `OpenAIClient`
/// 同口径(那边也是空 key 不发头)。
fn apply_auth(
    req: reqwest::RequestBuilder,
    endpoint: &str,
    api_key: &str,
) -> reqwest::RequestBuilder {
    let key = api_key.trim();
    match endpoint {
        // 智谱等兼容端点同样吃 Bearer。
        "openai" => {
            if key.is_empty() {
                req
            } else {
                req.header("Authorization", format!("Bearer {key}"))
            }
        }
        // Anthropic 用 x-api-key + 版本头(协议没有免 Key 形态)。
        "anthropic" => req
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01"),
        _ => req,
    }
}

/// 拼接模型列表 URL。base_url 允许带或不带 `/v1`(Anthropic),
/// 结尾 `/` 一律归一。
pub(crate) fn build_models_url(base_url: &str, endpoint: &str) -> Result<String, CommandError> {
    let base = base_url.trim_end_matches('/');
    if base.is_empty() {
        return Err(CommandError {
            msg: "base_url is empty".into(),
        });
    }
    match endpoint {
        "openai" => Ok(format!("{base}/models")),
        "anthropic" => {
            // 官方约定 https://api.anthropic.com(无 /v1);用户若已填 /v1 不重复追加。
            if base.ends_with("/v1") {
                Ok(format!("{base}/models"))
            } else {
                Ok(format!("{base}/v1/models"))
            }
        }
        other => Err(CommandError {
            msg: format!("unknown endpoint: {other} (expected anthropic | openai)"),
        }),
    }
}

/// 拉取指定 base_url + api_key 下的可用模型列表。
///
/// 与 `reflect_query_plan_quota` 同风格:鉴权失败 / HTTP 错误 / 解析失败
/// 报 `Err` 给前端展示;成功返回模型数组(可能为空)。
///
/// **空 `api_key` = 免 Key 端点**(免费模型池就是这种端点):不发
/// Authorization 头。此前这里直接报 `api_key is empty` —— 免 Key 的
/// OpenAI 兼容端点在 GUI 里**连模型清单都拿不到**,而引擎侧的清单发现
/// (走 provider client)却是支持的 —— 两侧口径不一致,用户被卡在「能跑
/// 但看不见有哪些模型」。
///
/// Anthropic 协议没有免 Key 形态 → 仍要求 key。
///
/// 免费判定规则取自**当前生效的** `[model_discovery]` 段(内存快照,热重载
/// 后即生效)—— 与引擎跑 `model = "free"` 用的是同一套规则。
#[tauri::command]
pub async fn reflect_list_provider_models(
    agent: tauri::State<'_, crate::state::MinimalAgent>,
    base_url: String,
    api_key: String,
    endpoint: String,
) -> CommandResult<ProviderModelsResult> {
    let key = api_key.trim();
    if key.is_empty() && endpoint != "openai" {
        return Err(CommandError {
            msg: "api_key is empty — Anthropic 协议需要 key(OpenAI 兼容端点可留空表示免 Key)"
                .into(),
        });
    }
    let url = build_models_url(&base_url, &endpoint)?;
    let rules = free_model_rules(&agent);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| CommandError {
            msg: format!("http client: {e}"),
        })?;
    let mut req = client.get(&url);
    req = apply_auth(req, &endpoint, key);
    let resp = req
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| CommandError {
            msg: format!("network error: {e}"),
        })?;

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(CommandError {
            msg: format!("authentication failed (HTTP {status}) — check the API key"),
        });
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(CommandError {
            msg: format!("API error (HTTP {status}): {snippet}"),
        });
    }
    // 先读完整 body(读体失败 = 瞬时),再解析(解析失败 = 确定性)。
    let body = resp.bytes().await.map_err(|e| CommandError {
        msg: format!("failed to read response: {e}"),
    })?;
    let models = parse_models_response(&endpoint, &body, &rules)?;
    tracing::info!(endpoint = %endpoint, count = models.len(), "provider models listed");
    Ok(ProviderModelsResult { endpoint, models })
}

// ── 连通性测试(发送测试文字) ─────────────────────────────────────

/// 测试消息:固定「你好」,max_tokens 压到 32 —— 只为验证鉴权/网络/响应
/// 解析链路,把 token 消耗压到最低。
pub(crate) const TEST_PROMPT: &str = "你好";
pub(crate) const TEST_MAX_TOKENS: u32 = 32;

/// 发送测试文字的结果。
#[derive(Debug, Clone, Serialize)]
pub struct ProviderChatTestResult {
    /// 模型返回的文本(可能为空串)。
    pub reply: String,
}

/// 拼接 chat 测试 URL(与 models URL 同一套归一规则)。
pub(crate) fn build_chat_test_url(base_url: &str, endpoint: &str) -> Result<String, CommandError> {
    let base = base_url.trim_end_matches('/');
    if base.is_empty() {
        return Err(CommandError {
            msg: "base_url is empty".into(),
        });
    }
    match endpoint {
        "openai" => Ok(format!("{base}/chat/completions")),
        "anthropic" => {
            if base.ends_with("/v1") {
                Ok(format!("{base}/messages"))
            } else {
                Ok(format!("{base}/v1/messages"))
            }
        }
        other => Err(CommandError {
            msg: format!("unknown endpoint: {other} (expected anthropic | openai)"),
        }),
    }
}

/// 构造测试请求体:单条用户消息,无 system、无 tools —— 避免拉起庞大
/// 提示词造成无效消耗。
pub(crate) fn build_chat_test_body(model: &str) -> Value {
    serde_json::json!({
        "model": model,
        "max_tokens": TEST_MAX_TOKENS,
        "messages": [{ "role": "user", "content": TEST_PROMPT }],
    })
}

/// 从两种端点的响应里提取文本回复。
pub(crate) fn parse_chat_test_reply(endpoint: &str, body: &[u8]) -> Result<String, CommandError> {
    let v: Value = serde_json::from_slice(body).map_err(|e| CommandError {
        msg: format!("failed to parse chat response: {e}"),
    })?;
    let reply = match endpoint {
        // OpenAI:`choices[0].message.content`(可为 null)。
        "openai" => v
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string(),
        // Anthropic:`content[]` 里全部 text 块拼接。
        "anthropic" => v
            .get("content")
            .and_then(|c| c.as_array())
            .map(|blocks| {
                blocks
                    .iter()
                    .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default(),
        other => {
            return Err(CommandError {
                msg: format!("unknown endpoint: {other}"),
            });
        }
    };
    Ok(reply)
}

/// 向 provider 发送一条「你好」测试消息,验证鉴权/网络/推理链路是否可用。
///
/// **刻意不带 system 提示词与 tools 定义** —— 避免把庞大系统提示词发给
/// 厂商造成无效消耗;`max_tokens` 压到 32。只测连通,不用于生产对话。
///
/// **空 `api_key` = 免 Key 端点**:不发 Authorization 头(与
/// `reflect_list_provider_models` 同口径,也与 `reflect-llm` 的 OpenAIClient
/// 一致)。Anthropic 协议仍要求 key。
#[tauri::command]
pub async fn reflect_test_provider_chat(
    base_url: String,
    api_key: String,
    endpoint: String,
    model: String,
) -> CommandResult<ProviderChatTestResult> {
    let key = api_key.trim();
    if key.is_empty() && endpoint != "openai" {
        return Err(CommandError {
            msg: "api_key is empty — Anthropic 协议需要 key(OpenAI 兼容端点可留空表示免 Key)"
                .into(),
        });
    }
    if model.trim().is_empty() {
        return Err(CommandError {
            msg: "model is empty — fetch or enter a model first".into(),
        });
    }
    let url = build_chat_test_url(&base_url, &endpoint)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| CommandError {
            msg: format!("http client: {e}"),
        })?;
    let mut req = client.post(&url).json(&build_chat_test_body(model.trim()));
    req = apply_auth(req, &endpoint, key);
    let resp = req.send().await.map_err(|e| CommandError {
        msg: format!("network error: {e}"),
    })?;

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(CommandError {
            msg: format!("authentication failed (HTTP {status}) — check the API key"),
        });
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(CommandError {
            msg: format!("API error (HTTP {status}): {snippet}"),
        });
    }
    let body = resp.bytes().await.map_err(|e| CommandError {
        msg: format!("failed to read response: {e}"),
    })?;
    let reply = parse_chat_test_reply(&endpoint, &body)?;
    tracing::info!(endpoint = %endpoint, reply_len = reply.len(), "provider chat test ok");
    Ok(ProviderChatTestResult { reply })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn models_url_by_endpoint() {
        assert_eq!(
            build_models_url("https://api.openai.com/v1/", "openai").unwrap(),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            build_models_url("https://api.anthropic.com", "anthropic").unwrap(),
            "https://api.anthropic.com/v1/models"
        );
        // 已带 /v1 的 anthropic base 不重复追加。
        assert_eq!(
            build_models_url("https://api.anthropic.com/v1", "anthropic").unwrap(),
            "https://api.anthropic.com/v1/models"
        );
        assert!(build_models_url("", "openai").is_err());
        assert!(build_models_url("https://x", "ollama").is_err());
    }

    #[test]
    fn chat_test_url_by_endpoint() {
        assert_eq!(
            build_chat_test_url("https://api.openai.com/v1", "openai").unwrap(),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            build_chat_test_url("https://api.anthropic.com", "anthropic").unwrap(),
            "https://api.anthropic.com/v1/messages"
        );
        assert!(build_chat_test_url("", "openai").is_err());
        assert!(build_chat_test_url("https://x", "zenmux").is_err());
    }

    #[test]
    fn chat_test_body_is_minimal_no_system_no_tools() {
        let body = build_chat_test_body("gpt-4o");
        assert_eq!(body["model"], "gpt-4o");
        assert_eq!(body["max_tokens"], TEST_MAX_TOKENS);
        assert!(body.get("system").is_none(), "不得携带 system 提示词");
        assert!(body.get("tools").is_none(), "不得携带 tools 定义");
        let msgs = body["messages"].as_array().unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0]["role"], "user");
        assert_eq!(msgs[0]["content"], TEST_PROMPT);
    }

    #[test]
    fn chat_test_reply_parsing() {
        let openai = serde_json::to_vec(&json!({
            "choices": [{ "message": { "role": "assistant", "content": "你好！有什么可以帮你？" } }]
        }))
        .unwrap();
        assert_eq!(
            parse_chat_test_reply("openai", &openai).unwrap(),
            "你好！有什么可以帮你？"
        );

        let anthropic = serde_json::to_vec(&json!({
            "content": [
                { "type": "text", "text": "你好" },
                { "type": "text", "text": "！" }
            ]
        }))
        .unwrap();
        assert_eq!(
            parse_chat_test_reply("anthropic", &anthropic).unwrap(),
            "你好！"
        );

        // content 为 null / 缺字段 → 空串而非报错。
        let null_content =
            serde_json::to_vec(&json!({ "choices": [{ "message": { "content": null } }] }))
                .unwrap();
        assert_eq!(parse_chat_test_reply("openai", &null_content).unwrap(), "");
    }

    /// 免 Key 端点 → **不发** Authorization 头。
    ///
    /// 免 Key 的 OpenAI 兼容端点(免费模型池)对「空 Bearer」宽容、对
    /// 「非空无效 token」严格 —— 发了反而可能被拒。此前这条路径直接报
    /// `api_key is empty`,GUI 连模型清单都拿不到。
    #[test]
    fn 免key端点不发authorization头() {
        let req = apply_auth(
            reqwest::Client::new().get("https://example.test/v1/models"),
            "openai",
            "",
        )
        .build()
        .unwrap();
        assert!(
            req.headers().get("authorization").is_none(),
            "空 key 不应发 Authorization 头"
        );
    }

    #[test]
    fn 有key时发bearer头() {
        let req = apply_auth(
            reqwest::Client::new().get("https://example.test/v1/models"),
            "openai",
            "sk-test",
        )
        .build()
        .unwrap();
        assert_eq!(
            req.headers()
                .get("authorization")
                .unwrap()
                .to_str()
                .unwrap(),
            "Bearer sk-test"
        );
    }

    /// Anthropic 协议没有免 Key 形态 —— 仍发 x-api-key + 版本头。
    #[test]
    fn anthropic始终发版本头() {
        let req = apply_auth(
            reqwest::Client::new().get("https://example.test/v1/models"),
            "anthropic",
            "sk-ant",
        )
        .build()
        .unwrap();
        assert_eq!(
            req.headers().get("x-api-key").unwrap().to_str().unwrap(),
            "sk-ant"
        );
        assert_eq!(
            req.headers()
                .get("anthropic-version")
                .unwrap()
                .to_str()
                .unwrap(),
            "2023-06-01"
        );
    }
}
