//! 远端 zhuye CLI 一键安装(bootstrap)。
//!
//! 经 ssh 拉起远端 `sh`,把 POSIX 安装脚本经 stdin 送入执行:探测 OS/架构 →
//! 解析上游 latest tag → 下载 `zhuye-<版本>-<triple>.tar.gz`(curl/wget
//! 自适应)→ 装到 `~/.local/bin`(免 sudo)→ 自验 `--version`。
//! 传输与错误文案见 [`super`]。

use std::process::Stdio;
use tokio::io::AsyncWriteExt;

use super::{MinimalAgent, RemoteHost, spawn_error_message, ssh_argv_with_remote_cmd};

/// 上游 ZhuYe 仓库的 GitHub Release 基址(bootstrap 下载源)。
const RELEASE_BASE: &str = "https://github.com/Asketisch/ZhuYe/releases/latest";

/// bootstrap 退出码 → 可行动错误文案(脚本按约定码退出)。
pub fn exit_message(code: Option<i32>, stderr: &str) -> String {
    match code {
        Some(4) => "远端 OS 不支持:zhuye 远端运行时目前支持 Linux / macOS".to_string(),
        Some(5) => {
            "远端架构暂无上游产物:上游 Release 仅提供 x86_64 / aarch64 的 Linux 与 macOS 构建"
                .to_string()
        }
        Some(6) => "无法解析上游最新版本:远端需 curl 且能访问 GitHub Releases(或手动安装后重试)"
            .to_string(),
        Some(7) => "远端缺少 curl / wget,无法下载安装包;请先在远端安装 curl 后重试".to_string(),
        Some(code) => format!(
            "远端安装失败(退出码 {code}):{};可手动执行:curl -fsSL {RELEASE_BASE}/download/latest 后安装 zhuye",
            stderr.lines().last().unwrap_or("")
        ),
        None => format!(
            "远端安装进程异常终止:{}",
            stderr.lines().last().unwrap_or("")
        ),
    }
}

/// 远端 bootstrap 脚本(POSIX sh,经 ssh stdin 送远端 `sh` 执行)。
///
/// 步骤:探测 OS/架构 → 解析上游 latest tag → 下载 `zhuye-<版本>-<triple>.tar.gz`
/// → 解出二进制装到 `~/.local/bin`(免 sudo)→ 自验 `--version`。
/// 退出码约定见 [`bootstrap_exit_message`]。
pub fn script() -> String {
    r#"set -eu
OS=$(uname -s)
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) ARCH=x86_64 ;;
  aarch64|arm64) ARCH=aarch64 ;;
  *) echo "zhuye-bootstrap: unsupported arch: $ARCH" >&2; exit 5 ;;
esac
case "$OS" in
  Linux) TRIPLE="$ARCH-unknown-linux-gnu" ;;
  Darwin) TRIPLE="$ARCH-apple-darwin" ;;
  *) echo "zhuye-bootstrap: unsupported os: $OS" >&2; exit 4 ;;
esac
BASE="https://github.com/Asketisch/ZhuYe/releases/latest"
TAG_URL=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$BASE" 2>/dev/null || true)
TAG=${TAG_URL##*/tag/}
if [ -z "$TAG" ] || [ "$TAG" = "$BASE" ]; then
  echo "zhuye-bootstrap: cannot resolve latest tag (need curl + GitHub access)" >&2
  exit 6
fi
VER=${TAG#v}
ASSET="zhuye-$VER-$TRIPLE.tar.gz"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/zhuye-bootstrap.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$BASE/download/$ASSET" -o "$TMP/pkg.tar.gz"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TMP/pkg.tar.gz" "$BASE/download/$ASSET"
else
  echo "zhuye-bootstrap: need curl or wget on the remote host" >&2
  exit 7
fi
tar xzf "$TMP/pkg.tar.gz" -C "$TMP"
mkdir -p "$HOME/.local/bin"
install -m 0755 "$TMP/zhuye-$VER-$TRIPLE/zhuye" "$HOME/.local/bin/zhuye"
"$HOME/.local/bin/zhuye" --version
"#
    .to_string()
}

/// 远端一键安装 zhuye CLI:ssh 拉起远端 `sh`,脚本经 stdin 送入。
/// 返回安装后的 `zhuye --version` 输出行(成功即已可用,connect 走
/// 登录 shell 能找到它)。
pub async fn run(agent: &MinimalAgent, host: &RemoteHost) -> Result<String, String> {
    let _ = agent; // 预留:进度事件转发(bootstrap 不发事件,参数留位)
    let argv = ssh_argv_with_remote_cmd(host, "exec sh");
    let bin = argv[0].clone();
    let mut command = tokio::process::Command::new(&bin);
    command
        .args(&argv[1..])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| spawn_error_message(&bin, e))?;
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "ssh 子进程无 stdin".to_string())?;
        stdin
            .write_all(script().as_bytes())
            .await
            .map_err(|e| format!("写入安装脚本失败: {e}"))?;
        // drop 关闭 stdin:远端 sh 读到 EOF 才会退出。
    }
    let out = child
        .wait_with_output()
        .await
        .map_err(|e| format!("等待安装进程失败: {e}"))?;
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if !out.status.success() {
        return Err(exit_message(out.status.code(), &stderr));
    }
    let version = String::from_utf8_lossy(&out.stdout)
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("installed")
        .trim()
        .to_string();
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_covers_platform_detect_download_and_install() {
        let script = script();
        // 平台/架构探测与 triple 映射。
        assert!(script.contains("ARCH-unknown-linux-gnu"));
        assert!(script.contains("apple-darwin"));
        assert!(script.contains("unsupported arch"));
        // 下载源与资产命名(上游 build-targz 产物:zhuye-<版本>-<triple>.tar.gz)。
        assert!(script.contains("https://github.com/Asketisch/ZhuYe/releases/latest"));
        assert!(script.contains("zhuye-$VER-$TRIPLE.tar.gz"));
        // 免 sudo 安装位置 + 自验。
        assert!(script.contains("$HOME/.local/bin/zhuye"));
        assert!(script.contains("install -m 0755"));
        assert!(script.contains("--version"));
        // curl 缺失走 wget,再缺失明确报错(exit 7)。
        assert!(script.contains("command -v curl"));
        assert!(script.contains("exit 7"));
    }

    #[test]
    fn exit_messages_are_actionable() {
        assert!(exit_message(Some(4), "").contains("Linux / macOS"));
        assert!(exit_message(Some(5), "").contains("x86_64"));
        assert!(exit_message(Some(6), "").contains("GitHub"));
        assert!(exit_message(Some(7), "").contains("curl"));
        let generic = exit_message(Some(1), "curl: (22) 404");
        assert!(generic.contains("404") && generic.contains("手动"));
        assert!(exit_message(None, "").contains("异常终止"));
    }
}
