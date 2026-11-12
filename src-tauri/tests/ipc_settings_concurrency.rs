//! 设置并发读改写回归:同一 app 内两个异步配置入口不得互相丢写。
mod common;

use reflect_desktop_lib::commands::{reflect_get_config, reflect_save_config, reflect_set_model};
use reflect_desktop_lib::state::MinimalAgent;
use tauri::Manager;

#[test]
fn concurrent_model_switches_preserve_both_provider_sections() {
    let harness = common::harness();
    let agent = harness.app.state::<MinimalAgent>();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("构建设置并发测试 runtime");

    runtime
        .block_on(reflect_save_config(
            agent.clone(),
            "# 设置并发测试基线\n[hooks]\nenabled = []\n".to_string(),
        ))
        .expect("初始化配置失败");

    let (anthropic, openai) = runtime.block_on(async {
        tokio::join!(
            reflect_set_model(
                agent.clone(),
                "anthropic".to_string(),
                "concurrent-anthropic".to_string(),
                None,
            ),
            reflect_set_model(
                agent.clone(),
                "openai".to_string(),
                "concurrent-openai".to_string(),
                None,
            ),
        )
    });
    assert!(anthropic.is_ok(), "anthropic 设置失败:{anthropic:?}");
    assert!(openai.is_ok(), "openai 设置失败:{openai:?}");

    let config = runtime
        .block_on(reflect_get_config(agent))
        .expect("读取并发写入后的配置失败");
    assert!(
        config.contains("concurrent-anthropic"),
        "anthropic 模型设置被并发写丢失:{config}"
    );
    assert!(
        config.contains("concurrent-openai"),
        "openai 模型设置被并发写丢失:{config}"
    );
}
