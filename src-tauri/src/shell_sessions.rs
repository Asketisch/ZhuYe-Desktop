//! Shell 会话池 —— 实现已收编进上游 `reflect_shell`(常驻 shell 会话
//! 插件,develop)。上游保留了桌面端的 pump 正确性细节(容错逐行解码 /
//! 50ms try_wait 轮询不持锁 / seq 同锁递增)并补齐 stdin 写入与 MCP
//! server;桌面端只保留类型锚点,消费方 import 路径不变。

pub(crate) use reflect_shell::ShellSessions;
