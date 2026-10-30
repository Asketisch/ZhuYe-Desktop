//! 通过真实 IPC 验证 KMS 不跟随指向外部的已有符号链接。
#![cfg(unix)]
mod common;

use serde_json::json;
use std::os::unix::fs::symlink;

#[test]
fn linked_page_is_not_read_or_overwritten() {
    common::invoke_ok(
        "reflect_kms_create",
        json!({"name": "wiki", "description": null}),
    );
    let external = tempfile::tempdir().unwrap();
    let secret = external.path().join("private.md");
    std::fs::write(&secret, "private sentinel").unwrap();
    let link = dirs::home_dir()
        .unwrap()
        .join(".zhuye/kms/wiki/pages/linked.md");
    symlink(&secret, link).unwrap();
    common::invoke_err(
        "reflect_kms_get_page",
        json!({"wiki": "wiki", "page": "linked"}),
    );
    common::invoke_err(
        "reflect_kms_save_page",
        json!({"wiki": "wiki", "page": "linked", "content": "bad", "title": null, "tags": null}),
    );
    assert_eq!(std::fs::read_to_string(secret).unwrap(), "private sentinel");
    let hits = common::invoke_ok("reflect_kms_search", json!({"query": "private sentinel"}));
    assert_eq!(hits, json!([]));
}
