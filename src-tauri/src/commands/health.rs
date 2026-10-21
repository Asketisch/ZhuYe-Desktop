//! 健康探针 —— `ping` 命令。
//!
//! 前端 `src/utils/commands/health.ts` 的存活探针:应用起来后第一个
//! 打的命令,用来确认 IPC 通路在**真实构建**里是通的。发布门禁的能力
//! 覆盖层也用它做首条用例(探针不通 = 整个命令面不可用)。

use serde::Serialize;

/// `ping` 的响应体。
#[derive(Debug, Serialize)]
pub struct PingResp {
    /// 固定为 `"pong"` —— 前端据此判定探针成功。
    pub msg: String,
    /// 应用版本(取自 `CARGO_PKG_VERSION`)。
    pub version: String,
}

/// 存活探针:返回固定 `pong` + 应用版本。
#[tauri::command]
pub fn ping() -> PingResp {
    PingResp {
        msg: "pong".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    }
}
