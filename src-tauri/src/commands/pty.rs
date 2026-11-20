//! 桌面交互终端的伪终端适配。
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{LazyLock, Mutex};

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::{Emitter, State};

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

struct Terminal {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}
static TERMINALS: LazyLock<Mutex<HashMap<String, Terminal>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Serialize)]
struct Output {
    id: String,
    data: Vec<u8>,
}

fn error(e: impl std::fmt::Display) -> CommandError {
    CommandError { msg: e.to_string() }
}

/// Windows 终端 shell 探测：pwsh（PowerShell 7+）→ powershell.exe
/// （Windows 内置，System32 必有）。不引入额外依赖，仅探测 PATH。
#[cfg(windows)]
fn powershell_or_default() -> String {
    let has_pwsh = std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths)
                .map(|dir| dir.join("pwsh.exe"))
                .any(|p| p.is_file())
        })
        .unwrap_or(false);
    if has_pwsh {
        return "pwsh.exe".into();
    }
    "powershell.exe".into()
}

/// 非 Windows 平台的空实现（保持调用点统一）。
#[cfg(not(windows))]
fn powershell_or_default() -> String {
    unreachable!("powershell_or_default 仅在 Windows 分支调用")
}

#[tauri::command]
pub async fn zhuye_pty_start(
    agent: State<'_, MinimalAgent>,
    id: String,
    cols: u16,
    rows: u16,
) -> CommandResult<()> {
    let mut terminals = TERMINALS.lock().map_err(error)?;
    if terminals.contains_key(&id) {
        return Err(error("terminal id already exists"));
    }
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(error)?;
    // 系统级 shell 选择：macOS/Linux 取 $SHELL（默认 zsh/bash）；
    // Windows 优先 PowerShell（用户显式要求），依次回退 pwsh → powershell → COMSPEC。
    let shell = if cfg!(windows) {
        powershell_or_default()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    };
    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(agent.workspace());
    cmd.env("TERM", "xterm-256color");
    let child = pair.slave.spawn_command(cmd).map_err(error)?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(error)?;
    let writer = pair.master.take_writer().map_err(error)?;
    terminals.insert(
        id.clone(),
        Terminal {
            master: pair.master,
            writer,
            child,
        },
    );
    let app = agent.app_handle();
    std::thread::spawn(move || {
        let mut buffer = [0; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if let Some(app) = &app {
                        let _ = app.emit(
                            "zhuye_pty_output",
                            Output {
                                id: id.clone(),
                                data: buffer[..n].to_vec(),
                            },
                        );
                    }
                }
            }
        }
        if let Some(app) = &app {
            let _ = app.emit("zhuye_pty_exit", id);
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn zhuye_pty_write(id: String, data: String) -> CommandResult<()> {
    let mut terminals = TERMINALS.lock().map_err(error)?;
    let terminal = terminals
        .get_mut(&id)
        .ok_or_else(|| error("terminal not found"))?;
    terminal.writer.write_all(data.as_bytes()).map_err(error)
}

#[tauri::command]
pub async fn zhuye_pty_resize(id: String, cols: u16, rows: u16) -> CommandResult<()> {
    let terminals = TERMINALS.lock().map_err(error)?;
    let terminal = terminals
        .get(&id)
        .ok_or_else(|| error("terminal not found"))?;
    terminal
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(error)
}

#[tauri::command]
pub async fn zhuye_pty_close(id: String) -> CommandResult<()> {
    let terminal = TERMINALS.lock().map_err(error)?.remove(&id);
    if let Some(mut terminal) = terminal {
        let _ = terminal.child.kill();
        let _ = terminal.child.wait();
    }
    Ok(())
}
