//! 讨论运行态状态。

use std::collections::HashMap;

use parking_lot::Mutex;

pub(crate) type DiscussionCancellations = Mutex<HashMap<u64, tokio_util::sync::CancellationToken>>;
