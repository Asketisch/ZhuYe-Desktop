//! Reflect-app-core: Tauri 命令层的共享领域服务（UI 无关）。
//!
//! 每个模块对应一组 `reflect_*` Tauri 命令的领域逻辑与数据类型，
//! 由 `src-tauri` 消费；与渲染无关（GUI 渲染状态由前端 TS
//! `src/stores/agent/` 负责）。
//!
//! 关键约束：
//! - 不依赖 ratatui / crossterm / tauri / iced
//! - 仅依赖 UI 无关的 reflect-* crate（protocol / task 等）

#![deny(missing_docs)]
#![warn(unused_extern_crates)]

pub mod activity;
pub mod actor;
pub mod autopilot;
pub mod discussion;
pub mod kms;
pub mod media;
pub mod paths;
pub mod pipeline;
pub mod pricing;
pub mod sandbox;
pub mod side_channel;
pub mod squad;
pub mod stats;
pub mod tailscale;
pub mod traces;

/// 语义版本号（与 workspace 同步）。
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
