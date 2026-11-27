//! GUI 附加沙箱可写目录的并入逻辑(纯函数,便于单测绑定语义)。
//!
//! 自 `thread_factory.rs` 拆出:该文件只保留线程装配编排,
//! 目录合并语义与其单测就近放在这里。

use std::path::PathBuf;

/// v1.11 桌面#5:把 GUI 附加目录并入 `[sandbox].writable_dirs`。配置序
/// 在前、附加目录殿后;已在配置里的附加项去重(同一路径写两次在沙箱
/// profile 里是无意义重复)。
pub(crate) fn merged_sandbox_writable(
    configured: Vec<PathBuf>,
    extra: Vec<PathBuf>,
) -> Vec<PathBuf> {
    let mut dirs = configured;
    for dir in extra {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 附加目录并入且保序:配置序在前、附加序殿后。
    #[test]
    fn 附加目录并入且保序() {
        let merged = merged_sandbox_writable(
            vec![PathBuf::from("/cfg/a")],
            vec![PathBuf::from("/extra/1"), PathBuf::from("/extra/2")],
        );
        assert_eq!(
            merged,
            vec![
                PathBuf::from("/cfg/a"),
                PathBuf::from("/extra/1"),
                PathBuf::from("/extra/2"),
            ],
            "配置序在前,附加目录按设置顺序殿后"
        );
    }

    /// 与配置重复的附加项去重;空附加 = 原样返回配置。
    #[test]
    fn 与配置重复的附加项去重() {
        let merged = merged_sandbox_writable(
            vec![PathBuf::from("/cfg/a"), PathBuf::from("/cfg/b")],
            vec![PathBuf::from("/cfg/b"), PathBuf::from("/extra/1")],
        );
        assert_eq!(
            merged,
            vec![
                PathBuf::from("/cfg/a"),
                PathBuf::from("/cfg/b"),
                PathBuf::from("/extra/1")
            ],
            "配置里已有的附加项不得重复出现"
        );
        assert_eq!(
            merged_sandbox_writable(vec![PathBuf::from("/cfg/a")], Vec::new()),
            vec![PathBuf::from("/cfg/a")],
            "空附加目录 = 配置原样"
        );
    }
}
