use super::GitStatusEntry;

pub(super) fn parse_status_z(
    output: &[u8],
) -> (
    Option<String>,
    Option<String>,
    u32,
    u32,
    Vec<GitStatusEntry>,
) {
    let mut branch: Option<String> = None;
    let mut upstream: Option<String> = None;
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut entries: Vec<GitStatusEntry> = Vec::new();
    let mut records = output.split(|&b| b == 0);
    while let Some(record) = records.next() {
        let line = String::from_utf8_lossy(record);
        if let Some(rest) = line.strip_prefix("## ") {
            // 分支头行:"## <branch>" 或 "## <branch>...<upstream> [ahead N, behind M]"
            if let Some((b, after)) = rest.split_once("...") {
                branch = Some(b.to_string());
                if let Some((up, ab)) = after.split_once(' ') {
                    upstream = Some(up.to_string());
                    let ab = ab.trim_start_matches('[').trim_end_matches(']');
                    for part in ab.split(", ") {
                        if let Some(n) = part.strip_prefix("ahead ") {
                            ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix("behind ") {
                            behind = n.parse().unwrap_or(0);
                        }
                    }
                } else {
                    upstream = Some(after.to_string());
                }
            } else {
                branch = Some(rest.to_string());
            }
        } else if record.len() >= 3 {
            let status = &line[0..2];
            let path = line[3..].to_string();
            let old_path = if status.contains('R') || status.contains('C') {
                records
                    .next()
                    .map(|old| String::from_utf8_lossy(old).into_owned())
            } else {
                None
            };
            entries.push(GitStatusEntry {
                path,
                status: status.trim().to_string(),
                staged: !is_worktree_only(status),
                old_path,
            });
        }
    }
    (branch, upstream, ahead, behind, entries)
}

/// porcelain v1 两字符码的**第一字符**(index 列)是否为「无暂存变更」:
/// `' '`(仅工作区修改)或 `'?'`(untracked)。第二字符是工作区列,
/// 不参与本判定。
fn is_worktree_only(status: &str) -> bool {
    matches!(status.as_bytes().first(), Some(b' ') | Some(b'?'))
}

#[cfg(test)]
mod tests {
    use super::{is_worktree_only, parse_status_z};

    #[test]
    fn porcelain_z_preserves_paths_and_upstream() {
        let (branch, upstream, ahead, behind, entries) = parse_status_z(
            b"## feature...origin/feature\0R  new -> name\0old\nname\0??  spaced \0",
        );
        assert_eq!(branch.as_deref(), Some("feature"));
        assert_eq!(upstream.as_deref(), Some("origin/feature"));
        assert_eq!((ahead, behind), (0, 0));
        assert_eq!(entries[0].path, "new -> name");
        assert_eq!(entries[0].old_path.as_deref(), Some("old\nname"));
        assert_eq!(entries[1].path, " spaced ");
        assert!(!entries[1].staged);
    }

    /// `"M "`(已暂存)与 `" M"`(仅工作区)经 trim 折叠成同一个 "M",
    /// staged 判定必须吃原始两字符码的 index 列。
    #[test]
    fn porcelain_index_column_drives_staged() {
        assert!(is_worktree_only(" M"));
        assert!(is_worktree_only("??"));
        assert!(!is_worktree_only("M "));
        assert!(!is_worktree_only("MM"));
        assert!(!is_worktree_only("AM"));
        assert!(!is_worktree_only("A "));
        assert!(!is_worktree_only("R "));
    }
}
