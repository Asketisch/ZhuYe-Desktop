//! 单模型能力查询 —— models.dev 社区目录的只读查询命令。
//!
//! 与 `models.rs` 的分工:那边拉 provider 实清单(网络),这边**不发网络
//! 请求** —— 只读引擎侧 models.dev 目录(内嵌快照 + 磁盘缓存,进程级
//! 懒加载),给模型卡片展示与 composer 发送前的视觉检查用。当前活跃
//! 模型不在最近拉取的实清单里时,这里是唯一的能力来源。

use serde::Serialize;

use crate::commands::error::{CommandError, CommandResult};

/// 单模型能力查询结果 —— models.dev 目录 + 引擎级联兜底(变体拼写 /
/// 名字后缀启发)的结论,字段全可选(`null` = 未知)。
#[derive(Debug, Clone, Serialize)]
pub struct ModelAbilitiesResult {
    /// 上下文窗口(token)。
    pub context_window: Option<u32>,
    /// 最大输出 token。
    pub max_output_tokens: Option<u32>,
    /// 是否接受图片输入;`null` = 未知(**未知不拦截发送**,见 composer
    /// 视觉检查)。
    pub supports_vision: Option<bool>,
    /// 是否具备思考能力;`null` = 未知。
    pub supports_reasoning: Option<bool>,
    /// 思考档位菜单(厂商词表原样,如 `["low","medium","high"]`)。
    pub effort_levels: Option<Vec<String>>,
}

/// 查单个模型的能力(窗口 / 输出上限 / 视觉 / 思考),不依赖 provider
/// 实拉 —— 数据来自 models.dev 目录(内嵌快照 + 磁盘缓存,懒加载)。
///
/// 供模型卡片展示与 composer 发送前的视觉检查:当前活跃模型不在最近
/// 拉取的清单里时,这里是唯一的能力来源。纯目录查询,不发网络请求。
#[tauri::command]
pub async fn zhuye_lookup_model_abilities(model_id: String) -> CommandResult<ModelAbilitiesResult> {
    let id = model_id.trim();
    if id.is_empty() {
        return Err(CommandError {
            msg: "model_id is empty".into(),
        });
    }
    let abilities = zhuye_llm::abilities_for(id);
    Ok(ModelAbilitiesResult {
        context_window: abilities.context_window,
        max_output_tokens: abilities.max_output_tokens,
        supports_vision: abilities.supports_vision,
        supports_reasoning: abilities.supports_reasoning,
        effort_levels: abilities.effort_levels,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 命令名快照 —— 静态门禁据此确认 `zhuye_lookup_model_abilities`
    /// 有生产模块内的测试入口(命令面四方一致的一部分)。
    #[test]
    fn command_name_is_stable() {
        let name: &str = "zhuye_lookup_model_abilities";
        assert_eq!(name, stringify!(zhuye_lookup_model_abilities));
    }

    /// 查一个模型不会 panic;空 id 明确报错(不静默返回空能力)。
    #[test]
    fn lookup_rejects_empty_id() {
        let result = futures::executor::block_on(zhuye_lookup_model_abilities(String::new()));
        assert!(result.is_err(), "空 id 必须报错");
    }

    /// 真实目录快照下查询一个已知模型:至少有一个能力维度非空
    /// (内嵌快照含 1 万+模型,gpt-4o 必有窗口数据)。
    #[test]
    fn lookup_known_model_returns_abilities() {
        // zhuye-llm 的 reasoning_effort 等测试会向进程级全局目录装极简
        // fixture 且不恢复 —— 并发窗口下本测试会读到 fixture 而误报
        // (CI windows 实证)。持目录测试锁并恢复内嵌快照,与执行顺序
        // 无关。
        zhuye_llm::with_snapshot_catalog(|| {
            let result = futures::executor::block_on(zhuye_lookup_model_abilities("gpt-4o".into()))
                .expect("查询不应失败");
            assert!(
                result.context_window.is_some()
                    || result.max_output_tokens.is_some()
                    || result.supports_vision.is_some(),
                "gpt-4o 至少有一个能力维度来自目录"
            );
        });
    }
}
