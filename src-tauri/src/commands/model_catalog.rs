//! Provider 模型清单 —— 条目解析 + 免费判定 + 目录补缺。
//!
//! 与 `models.rs` 的分工:那边是 **Tauri 命令**(拉清单 / 测连通 /
//! 单查能力),这边是 **纯逻辑**(把 provider 的 `/models` 响应解析成
//! 条目,按 `reflect_llm::FreeModelRules` 判定免费,再用 models.dev
//! 目录补齐空缺字段)。
//!
//! 字段探测口径与上游 `reflect_llm::providers::openai` 一致:
//! - 上下文窗口:`context_window` → `context_length` → `top_provider.context_length`;
//! - 输出上限:`max_output_tokens` → `top_provider.max_completion_tokens`;
//! - 视觉:`architecture.input_modalities` / `input_modalities` 含 `"image"`
//!   (仅 openai 端口探测;anthropic 官方清单不返回能力,交给目录补);
//! - 免费标记:`isFree` → `pricing` 全零 → `None`(交给规则判)。
//!
//! 判定规则来自**当前生效**的 `[model_discovery]` 段(`always_free` /
//! `free_id_patterns`,留空用内置默认)—— 与引擎跑 `model = "free"` 时
//! 挑的是同一套规则,不会出现「界面说免费、引擎挑不到」。
//!
//! **目录补缺**(`enrich_with_catalog`):live 披露优先,models.dev 目录
//! 只填 `None` 字段(与上游 `enrich_model_info` / magpie Decorate 同
//! 语义)—— Anthropic 官方端口从此也能拿到窗口 / 输出上限 / 视觉 /
//! 思考能力。

use serde::Serialize;
use serde_json::Value;

use reflect_llm::{FreeModelRules, ModelInfo};

use crate::commands::error::CommandError;

/// 单个模型条目。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ProviderModelInfo {
    /// 模型 id(调用方直接作为 model spec 使用)。
    pub id: String,
    /// 展示名(厂商未返回时与 id 相同)。
    pub display_name: String,
    /// 视觉输入能力。`None` = live 与目录都没说,由用户自行判断。
    pub supports_vision: Option<bool>,
    /// 是否免费。`Some(true)` / `Some(false)` = 已判定;`None` = **未知**
    /// (provider 没表态,规则也没命中 —— 此时不能断言它免费)。
    pub is_free: Option<bool>,
    /// 上下文窗口(live / 目录都没披露则 `None`)。
    pub context_window: Option<u32>,
    /// 最大输出 token(live / 目录都没披露则 `None`)。
    pub max_output_tokens: Option<u32>,
    /// 是否具备思考能力(models.dev 目录投票;`None` = 未知)。
    pub supports_reasoning: Option<bool>,
}

/// 模型列表 + 查询端口。
#[derive(Debug, Clone, Serialize)]
pub struct ProviderModelsResult {
    pub endpoint: String,
    pub models: Vec<ProviderModelInfo>,
}

/// 免费判定规则 —— 取自当前生效的 `[model_discovery]` 段;段缺省时用
/// 内置默认(`DEFAULT_ALWAYS_FREE` / `DEFAULT_FREE_ID_PATTERNS`)。
pub(crate) fn free_model_rules(agent: &crate::state::MinimalAgent) -> FreeModelRules {
    agent
        .cfg()
        .read()
        .model_discovery
        .clone()
        .unwrap_or_default()
        .rules()
}

/// 从模型对象提取视觉能力。识别 OpenRouter 风格
/// `architecture.input_modalities` 与顶层 `input_modalities`(字符串数组,
/// 含 "image" 即具备视觉输入);字段缺失 → `None`。
pub(crate) fn detect_vision(item: &Value) -> Option<bool> {
    let modalities = item
        .get("architecture")
        .and_then(|a| a.get("input_modalities"))
        .or_else(|| item.get("input_modalities"))?
        .as_array()?;
    Some(
        modalities
            .iter()
            .filter_map(|v| v.as_str())
            .any(|s| s.eq_ignore_ascii_case("image")),
    )
}

/// 从模型对象提取上下文窗口(三种字段形态依次探测)—— 与上游
/// `reflect_llm::providers::openai::extract_context_window` 同口径。
fn extract_context_window(item: &Value) -> Option<u32> {
    let candidates = [
        item.get("context_window"),
        item.get("context_length"),
        item.get("top_provider")
            .and_then(|tp| tp.get("context_length")),
    ];
    for candidate in candidates.into_iter().flatten() {
        if let Some(v) = candidate.as_u64() {
            if v > 0 && v <= u32::MAX as u64 {
                return Some(v as u32);
            }
        }
    }
    None
}

/// 从模型对象提取最大输出 token —— 与上游
/// `reflect_llm::providers::openai::extract_max_output_tokens` 同口径。
fn extract_max_output_tokens(item: &Value) -> Option<u32> {
    let candidates = [
        item.get("max_output_tokens"),
        item.get("top_provider")
            .and_then(|tp| tp.get("max_completion_tokens")),
    ];
    for candidate in candidates.into_iter().flatten() {
        if let Some(v) = candidate.as_u64() {
            if v > 0 && v <= u32::MAX as u64 {
                return Some(v as u32);
            }
        }
    }
    None
}

/// 从模型对象提取**免费标记**:显式 `isFree` 优先,其次 `pricing` 全零。
///
/// `pricing` 全零是「这条线路不花钱」的另一种表述(免费池常这么标),
/// 与显式标记同等权威 —— 两者冲突时以 `isFree` 为准。都没有 → `None`
/// (交给 `FreeModelRules` 按规则判)。
fn extract_is_free(item: &Value) -> Option<bool> {
    if let Some(flag) = item.get("isFree").and_then(Value::as_bool) {
        return Some(flag);
    }
    let pricing = item.get("pricing")?.as_object()?;
    if pricing.is_empty() {
        return None;
    }
    let all_zero = pricing.values().all(|v| match v {
        Value::Number(n) => n.as_f64().is_some_and(|f| f == 0.0),
        Value::String(s) => s == "0" || s.is_empty(),
        _ => false,
    });
    if all_zero { Some(true) } else { None }
}

/// 解析 /models 响应体。两种端口同为 `{ data: [...] }` 外层;
/// 条目字段按端口取 id / display_name。
///
/// `rules` 是免费判定规则(来自 `[model_discovery]` 段,留空用内置默认)。
pub(crate) fn parse_models_response(
    endpoint: &str,
    body: &[u8],
    rules: &FreeModelRules,
) -> Result<Vec<ProviderModelInfo>, CommandError> {
    let v: Value = serde_json::from_slice(body).map_err(|e| CommandError {
        msg: format!("failed to parse models response: {e}"),
    })?;
    let data = v
        .get("data")
        .and_then(|d| d.as_array())
        .ok_or_else(|| CommandError {
            msg: "models response missing 'data' array".into(),
        })?;
    let mut out = Vec::with_capacity(data.len());
    for item in data {
        let Some(id) = item.get("id").and_then(|i| i.as_str()) else {
            continue;
        };
        let display_name = item
            .get("display_name")
            .and_then(|d| d.as_str())
            .unwrap_or(id);
        // 免费判定:先看 provider 显式标记,再按规则判(与上游同口径)。
        let catalog_entry = ModelInfo {
            id: id.to_string(),
            context_window: extract_context_window(item),
            is_free: extract_is_free(item),
            efforts: None,
            owned_by: item
                .get("owned_by")
                .and_then(|o| o.as_str())
                .map(str::to_string),
            supports_vision: None,
            max_output_tokens: None,
        };
        out.push(ProviderModelInfo {
            id: id.to_string(),
            display_name: display_name.to_string(),
            supports_vision: if endpoint == "openai" {
                detect_vision(item)
            } else {
                None
            },
            is_free: rules.classify(&catalog_entry),
            context_window: catalog_entry.context_window,
            max_output_tokens: extract_max_output_tokens(item),
            supports_reasoning: None,
        });
    }
    // id 去重(部分网关同一 id 返回多条)并保持返回顺序。
    let mut seen = std::collections::HashSet::new();
    out.retain(|m| seen.insert(m.id.clone()));
    Ok(out)
}

/// 用 models.dev 目录补齐条目的空缺字段(live 披露优先,目录只填
/// `None`)。目录数据 = 上游 `reflect_llm::models_dev` 的进程级懒加载
/// (磁盘缓存与内嵌快照取新);空目录 = 全未知,行为与补缺前一致。
///
/// 思考能力(`supports_reasoning`)live 清单不披露,只来自目录。
pub(crate) fn enrich_with_catalog(models: &mut [ProviderModelInfo]) {
    for m in models.iter_mut() {
        let abilities = reflect_llm::abilities_for(&m.id);
        if m.supports_vision.is_none() {
            m.supports_vision = abilities.supports_vision;
        }
        if m.context_window.is_none() {
            m.context_window = abilities.context_window;
        }
        if m.max_output_tokens.is_none() {
            m.max_output_tokens = abilities.max_output_tokens;
        }
        if m.supports_reasoning.is_none() {
            m.supports_reasoning = abilities.supports_reasoning;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 免费判定:provider 显式标记优先,其次白名单 / id 模式(上游
    /// `FreeModelRules` 同口径)。**未知**(都没命中)必须是 `None` ——
    /// 不能断言免费。
    #[test]
    fn parse_classifies_free_models() {
        let body = serde_json::to_vec(&json!({
            "data": [
                // 厂商显式标记免费
                { "id": "vendor-free-model", "isFree": true },
                // id 带 free 标记 → 规则命中
                { "id": "some-model-free" },
                // 白名单例外(id 不带 free 标记)
                { "id": "union-alpha" },
                // 厂商显式标记「不免费」→ 规则不适用
                { "id": "paid-but-free-looking-free", "isFree": false },
                // 都没命中 → 未知
                { "id": "gpt-4o" }
            ]
        }))
        .unwrap();
        let models = parse_models_response("openai", &body, &FreeModelRules::default()).unwrap();
        let free = |id: &str| {
            models
                .iter()
                .find(|m| m.id == id)
                .expect("model present")
                .is_free
        };
        assert_eq!(free("vendor-free-model"), Some(true), "厂商显式标记优先");
        assert_eq!(free("some-model-free"), Some(true), "id 模式命中");
        assert_eq!(free("union-alpha"), Some(true), "白名单例外命中");
        assert_eq!(
            free("paid-but-free-looking-free"),
            Some(false),
            "厂商显式标记不免费 → 规则不覆盖"
        );
        assert_eq!(free("gpt-4o"), None, "都没命中 → 未知,不能断言免费");
    }

    /// `pricing` 全零是「这条线路不花钱」的另一种表述(免费池常这么标)。
    #[test]
    fn parse_detects_zero_pricing_as_free() {
        let body = serde_json::to_vec(&json!({
            "data": [
                { "id": "zero-priced", "pricing": { "prompt": "0", "completion": "0" } },
                { "id": "paid", "pricing": { "prompt": "0.000003", "completion": "0.00001" } }
            ]
        }))
        .unwrap();
        let models = parse_models_response("openai", &body, &FreeModelRules::default()).unwrap();
        assert_eq!(models[0].is_free, Some(true));
        assert_eq!(models[1].is_free, None);
    }

    /// 自定义规则覆盖内置默认(用户配的 `[model_discovery]` 生效)。
    #[test]
    fn parse_uses_custom_free_rules() {
        let body = serde_json::to_vec(&json!({ "data": [{ "id": "my-model" }] })).unwrap();
        let rules = FreeModelRules::new(vec!["my-model".into()], vec![]);
        let models = parse_models_response("openai", &body, &rules).unwrap();
        assert_eq!(models[0].is_free, Some(true));
    }

    #[test]
    fn parse_openai_models_with_vision_hint() {
        let body = serde_json::to_vec(&json!({
            "data": [
                { "id": "gpt-4o", "object": "model",
                  "architecture": { "input_modalities": ["text", "image"] } },
                { "id": "o1", "object": "model",
                  "architecture": { "input_modalities": ["text"] } },
                { "id": "gpt-3.5-turbo", "object": "model" },
                { "id": "gpt-4o", "object": "model" }
            ]
        }))
        .unwrap();
        let models = parse_models_response("openai", &body, &FreeModelRules::default()).unwrap();
        assert_eq!(models.len(), 3, "重复 id 去重");
        assert_eq!(models[0].supports_vision, Some(true));
        assert_eq!(models[1].supports_vision, Some(false));
        assert_eq!(models[2].supports_vision, None, "无字段 → 用户自行判断");
        assert_eq!(models[0].display_name, "gpt-4o");
    }

    #[test]
    fn parse_anthropic_models_with_display_name() {
        let body = serde_json::to_vec(&json!({
            "data": [
                { "type": "model", "id": "claude-sonnet-4-5", "display_name": "Claude Sonnet 4.5" }
            ]
        }))
        .unwrap();
        let models = parse_models_response("anthropic", &body, &FreeModelRules::default()).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].display_name, "Claude Sonnet 4.5");
        // 官方 /v1/models 不返回能力信息。
        assert_eq!(models[0].supports_vision, None);
    }

    #[test]
    fn parse_rejects_missing_data() {
        let body = serde_json::to_vec(&json!({ "error": { "message": "nope" } })).unwrap();
        assert!(parse_models_response("openai", &body, &FreeModelRules::default()).is_err());
    }

    /// 上下文窗口:三种字段形态依次探测(上游同口径)。
    #[test]
    fn parse_extracts_context_window() {
        let body = serde_json::to_vec(&json!({
            "data": [
                { "id": "a", "context_window": 200000 },
                { "id": "b", "context_length": 128000 },
                { "id": "c", "top_provider": { "context_length": 64000 } },
                { "id": "d" }
            ]
        }))
        .unwrap();
        let models = parse_models_response("openai", &body, &FreeModelRules::default()).unwrap();
        assert_eq!(models[0].context_window, Some(200000));
        assert_eq!(models[1].context_window, Some(128000));
        assert_eq!(models[2].context_window, Some(64000));
        assert_eq!(models[3].context_window, None);
    }

    /// 输出上限:两种字段形态依次探测(上游同口径)。
    #[test]
    fn parse_extracts_max_output_tokens() {
        let body = serde_json::to_vec(&json!({
            "data": [
                { "id": "a", "max_output_tokens": 16384 },
                { "id": "b", "top_provider": { "max_completion_tokens": 8192 } },
                { "id": "c" }
            ]
        }))
        .unwrap();
        let models = parse_models_response("openai", &body, &FreeModelRules::default()).unwrap();
        assert_eq!(models[0].max_output_tokens, Some(16384));
        assert_eq!(models[1].max_output_tokens, Some(8192));
        assert_eq!(models[2].max_output_tokens, None);
    }

    /// 目录补缺:live 披露优先,目录只填 `None` 字段;空目录 = 行为
    /// 与补缺前一致。install_catalog 是进程级全局,用全局唯一的假模型
    /// 名避免与其它用例(读真实目录)串扰。
    #[test]
    fn enrich_fills_gaps_from_catalog() {
        // fixture 经持锁钩子安装:与 with_snapshot_catalog / 其他目录
        // 测试互斥,进程级全局不再被并发重置(CI windows 实证竞态)。
        use reflect_llm::{DevCatalog, ModelAbilities, with_test_catalog};
        let fixture = DevCatalog::from_entries([(
            "zzenrich-model".to_string(),
            ModelAbilities {
                context_window: Some(200_000),
                max_output_tokens: Some(32_768),
                supports_vision: Some(true),
                supports_reasoning: Some(true),
                effort_levels: None,
            },
        )]);
        with_test_catalog(fixture, || {
            let mut models = vec![
                // live 已披露窗口与视觉 → 保留;输出与思考由目录补。
                ProviderModelInfo {
                    id: "zzenrich-model".into(),
                    display_name: "zzenrich-model".into(),
                    supports_vision: Some(false),
                    is_free: None,
                    context_window: Some(8_000),
                    max_output_tokens: None,
                    supports_reasoning: None,
                },
                // 目录没有的模型 → 字段原样(全 None)。
                ProviderModelInfo {
                    id: "zzenrich-other".into(),
                    display_name: "zzenrich-other".into(),
                    supports_vision: None,
                    is_free: None,
                    context_window: None,
                    max_output_tokens: None,
                    supports_reasoning: None,
                },
            ];
            enrich_with_catalog(&mut models);
            assert_eq!(models[0].context_window, Some(8_000), "live 窗口优先");
            assert_eq!(models[0].supports_vision, Some(false), "live 视觉优先");
            assert_eq!(models[0].max_output_tokens, Some(32_768), "目录补输出");
            assert_eq!(models[0].supports_reasoning, Some(true), "思考只来自目录");
            assert_eq!(models[1].supports_reasoning, None, "目录没有 → 未知");
        });
    }
}
