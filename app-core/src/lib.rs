//! Reflect-app-core: Tauri 命令层的共享领域服务（UI 无关）。
//!
//! 每个模块对应一组 `reflect_*` Tauri 命令的领域逻辑与数据类型，
//! 由 `src-tauri` 消费；与渲染无关（GUI 渲染状态由前端 TS
//! `src/stores/agent/` 负责）。
//!
//! 关键约束：
//! - 不依赖 ratatui / crossterm / tauri / iced
//! - 仅依赖 UI 无关的 reflect-* crate（protocol / task 等）
//!
//! 重叠收敛（v0.2）：上游 develop 把 actor / squad / autopilot /
//! activity / side-channel / pricing / kms / paths / sandbox 解析 /
//! rollout 导出并入框架本体后，本 crate 的对应实现已删除，消费方
//! 直接使用 submodule crate（`reflect_task` / `reflect_stream` /
//! `reflect_telemetry` / `reflect_core` / `reflect_llm` / `reflect_kms` /
//! `reflect_config::paths` / `reflect_sandbox`）。保留的是真正的
//! 桌面侧装配层：media / stats / tailscale / traces / discussion /
//! pipeline。

#![deny(missing_docs)]
#![warn(unused_extern_crates)]

pub mod activity;
pub mod discussion;
pub mod media;
pub mod pipeline;
pub mod sandbox;
pub mod stats;
pub mod tailscale;
pub mod traces;

/// 语义版本号（与 workspace 同步）。
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
