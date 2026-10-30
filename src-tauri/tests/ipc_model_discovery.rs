//! 动态模型发现失败后，通过真实 IPC 重新保存配置进行恢复。
mod common;

use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

#[test]
fn unchanged_saved_config_retries_failed_discovery() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    let server = runtime.block_on(MockServer::start());
    let available = Arc::new(AtomicBool::new(false));
    let responder = available.clone();
    runtime.block_on(async {
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(move |_: &wiremock::Request| {
                if responder.load(Ordering::SeqCst) {
                    ResponseTemplate::new(200)
                        .set_body_json(json!({ "data": [{ "id": "test-free" }] }))
                } else {
                    ResponseTemplate::new(500)
                }
            })
            .mount(&server)
            .await;
    });
    common::invoke_ok(
        "reflect_bind_session",
        json!({"id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}),
    );
    let toml = format!(
        "[active]\nprovider = \"openai\"\n[openai]\nmodel = \"free\"\napi_key = \"test\"\nbase_url = \"{}\"\n[model_discovery]\nalways_free = [\"test-free\"]\n",
        server.uri()
    );
    common::invoke_ok("reflect_save_config", json!({"toml": toml}));
    let failed = common::invoke_ok("reflect_agent_status", json!({}));
    assert_eq!(failed["model"], "stub/test");
    assert!(failed["degraded_reason"].is_string(), "{failed}");
    available.store(true, Ordering::SeqCst);
    common::invoke_ok("reflect_save_config", json!({"toml": toml}));
    let recovered = common::invoke_ok("reflect_agent_status", json!({}));
    assert_eq!(recovered["model"], "openai/test-free");
    assert!(recovered["degraded_reason"].is_null(), "{recovered}");
}
