//! 模型费率卡 —— 让 GUI 能解释「这笔费用是怎么算出来的」。
//!
//! 核心把静态费率表(`reflect_llm::providers::pricing::PRICING_TABLE`)设为
//! 私有 const,对外只暴露 `price(model, usage)` / `is_priced(model)` /
//! `cumulative_cost_usd(...)`。GUI 要展示单价,就得把「价目表」读出来。
//!
//! ## 做法:用合成用量反解,不复制费率表
//!
//! `price()` 的公式是线性的:
//!
//! ```text
//! non_cached_input = input - cached - cache_write
//! cost = (non_cached_input
//!       + cached        × cache_read_factor
//!       + cache_write  × cache_write_factor
//!       + output       × output_factor) × input_price / 1_000_000
//! ```
//!
//! 令 `A = price(1M input)`、`B = price(1M output)`、`C = price(1M cached)`、
//! `D = price(1M cache_write)`,则:
//!
//! - `A = input_price`
//! - `B = output_factor × input_price` → `output_factor = B / A`
//! - `C = cache_read_factor × input_price` → `cache_read_factor = C / A`
//! - `D = cache_write_factor × input_price` → `cache_write_factor = D / A`
//!
//! 唯一事实源仍是核心的静态表 —— 桌面端只在**读取侧**反解,表更新后 GUI
//! 自动跟随,不存在两份费率表漂移的问题。
//!
//! ## 模型 id 形态
//!
//! 核心计费前会剥掉 provider 前缀(`model.split_once('/')`,见
//! `reflect-core` 的 `model_call` 节点)—— 本模块同样处理,保证
//! `"anthropic/claude-sonnet-4-latest"` 与 `"claude-sonnet-4-latest"`
//! 命中同一条费率。

use reflect_llm::providers::{is_priced, price};
use reflect_protocol::TokenUsage;
use serde::{Deserialize, Serialize};

/// 百万 token 的探针用量(取整到 1M,避免浮点噪声)。
const M: u32 = 1_000_000;

/// 单个模型的费率卡(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateCard {
    /// 完整 model spec(如 `"anthropic/claude-sonnet-4-latest"`)。
    pub model: String,
    /// 核心费率表里是否有该模型(`false` = 本地免费模型 / 未知模型)。
    pub priced: bool,
    /// 每 1M **非缓存**输入 token 的 USD 价格(费率表基准价)。
    pub input_price: Option<f64>,
    /// 输出倍率(相对 `input_price`)。
    pub output_factor: Option<f64>,
    /// 缓存读取(cache_read)倍率。
    pub cache_read_factor: Option<f64>,
    /// 缓存写入(cache_creation)倍率。
    pub cache_write_factor: Option<f64>,
    /// 每 1M 输出 token 的 USD 价格(由倍率换算,便于直接展示)。
    pub output_price: Option<f64>,
    /// 每 1M 缓存读取 token 的 USD 价格。
    pub cache_read_price: Option<f64>,
    /// 每 1M 缓存写入 token 的 USD 价格。
    pub cache_write_price: Option<f64>,
}

/// 剥掉 provider 前缀,与核心计费口径一致。
fn bare_model(model: &str) -> &str {
    model.split_once('/').map(|(_, m)| m).unwrap_or(model)
}

/// 构造只有某个分段为 1M、其余为 0 的探针用量。
fn probe(input: u32, cached: u32, cache_write: u32, output: u32) -> TokenUsage {
    TokenUsage {
        input_tokens: input,
        output_tokens: output,
        cached_tokens: cached,
        cache_write_tokens: cache_write,
        total_tokens: input + output,
    }
}

/// 反解某模型的费率卡。
///
/// 模型不在核心费率表内 → `priced = false`,其余字段为 `None`
/// (与核心「未知模型不编造数字」的口径一致:宁可缺省,不给错数)。
pub fn rate_card(model: &str) -> RateCard {
    let bare = bare_model(model);
    if !is_priced(bare) {
        return RateCard {
            model: model.to_string(),
            priced: false,
            input_price: None,
            output_factor: None,
            cache_read_factor: None,
            cache_write_factor: None,
            output_price: None,
            cache_read_price: None,
            cache_write_price: None,
        };
    }

    let a = price(bare, &probe(M, 0, 0, 0)).unwrap_or(0.0);
    let b = price(bare, &probe(0, 0, 0, M)).unwrap_or(0.0);
    let c = price(bare, &probe(M, M, 0, 0)).unwrap_or(0.0);
    let d = price(bare, &probe(M, 0, M, 0)).unwrap_or(0.0);

    // A = input_price(每 1M)。若为 0(理论上不该出现),倍率无法反解 → 留空。
    if a <= 0.0 {
        return RateCard {
            model: model.to_string(),
            priced: true,
            input_price: Some(a),
            output_factor: None,
            cache_read_factor: None,
            cache_write_factor: None,
            output_price: None,
            cache_read_price: None,
            cache_write_price: None,
        };
    }

    let output_factor = b / a;
    let cache_read_factor = c / a;
    let cache_write_factor = d / a;
    RateCard {
        model: model.to_string(),
        priced: true,
        input_price: Some(a),
        output_factor: Some(output_factor),
        cache_read_factor: Some(cache_read_factor),
        cache_write_factor: Some(cache_write_factor),
        output_price: Some(b),
        cache_read_price: Some(c),
        cache_write_price: Some(d),
    }
}

/// 批量反解多个模型的费率卡(保持输入顺序)。
pub fn rate_cards(models: &[String]) -> Vec<RateCard> {
    models.iter().map(|m| rate_card(m)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_model_is_not_priced() {
        let card = rate_card("openai/some-unknown-model");
        assert!(!card.priced);
        assert_eq!(card.input_price, None);
        assert_eq!(card.model, "openai/some-unknown-model");
    }

    #[test]
    fn priced_model_exposes_input_price_and_factors() {
        // 核心费率表里 anthropic 的 claude 系列：input 3.0、output 5×、
        // cache_read 0.1×、cache_write 1.25×(以 input_price 为基准)。
        let card = rate_card("anthropic/claude-sonnet-4-latest");
        assert!(card.priced, "claude-sonnet-4-latest 应在费率表内");
        let input = card.input_price.expect("应有输入单价");
        assert!((input - 3.0).abs() < 1e-6, "input_price = {input}");
        assert!((card.output_factor.unwrap() - 5.0).abs() < 1e-6);
        assert!((card.cache_read_factor.unwrap() - 0.1).abs() < 1e-6);
        assert!((card.cache_write_factor.unwrap() - 1.25).abs() < 1e-6);
        // 换算价 = 倍率 × input_price。
        assert!((card.output_price.unwrap() - 15.0).abs() < 1e-6);
        assert!((card.cache_read_price.unwrap() - 0.3).abs() < 1e-6);
        assert!((card.cache_write_price.unwrap() - 3.75).abs() < 1e-6);
    }

    #[test]
    fn provider_prefix_is_stripped_like_core() {
        // 核心计费前剥掉 provider 前缀 —— 带不带前缀应命中同一条费率。
        let with = rate_card("anthropic/claude-sonnet-4-latest");
        let without = rate_card("claude-sonnet-4-latest");
        assert_eq!(with.input_price, without.input_price);
        assert_eq!(with.output_factor, without.output_factor);
    }

    #[test]
    fn rate_card_matches_core_price_function() {
        // 反解出的倍率必须能复算出核心 `price()` 的结果 —— 否则说明
        // 反解口径与核心计费口径漂移。
        let card = rate_card("anthropic/claude-sonnet-4-latest");
        let usage = probe(1_200_000, 300_000, 100_000, 50_000);
        let expected = price("claude-sonnet-4-latest", &usage).unwrap();
        let ip = card.input_price.unwrap();
        let non_cached = 1_200_000f64 - 300_000.0 - 100_000.0;
        let manual = (non_cached
            + 300_000.0 * card.cache_read_factor.unwrap()
            + 100_000.0 * card.cache_write_factor.unwrap()
            + 50_000.0 * card.output_factor.unwrap())
            * ip
            / 1_000_000.0;
        assert!((expected - manual).abs() < 1e-9, "{expected} vs {manual}");
    }

    #[test]
    fn rate_cards_preserve_order() {
        let models = vec![
            "anthropic/claude-sonnet-4-latest".to_string(),
            "x/y".to_string(),
        ];
        let cards = rate_cards(&models);
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].model, models[0]);
        assert_eq!(cards[1].model, models[1]);
    }
}
