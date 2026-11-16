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

#[tauri::command]
pub async fn reflect_pty_start(
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
    let shell = if cfg!(windows) {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
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
                            "reflect_pty_output",
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
            let _ = app.emit("reflect_pty_exit", id);
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn reflect_pty_write(id: String, data: String) -> CommandResult<()> {
    let mut terminals = TERMINALS.lock().map_err(error)?;
    let terminal = terminals
        .get_mut(&id)
        .ok_or_else(|| error("terminal not found"))?;
    terminal.writer.write_all(data.as_bytes()).map_err(error)
}

#[tauri::command]
pub async fn reflect_pty_resize(id: String, cols: u16, rows: u16) -> CommandResult<()> {
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
pub async fn reflect_pty_close(id: String) -> CommandResult<()> {
    let terminal = TERMINALS.lock().map_err(error)?.remove(&id);
    if let Some(mut terminal) = terminal {
        let _ = terminal.child.kill();
        let _ = terminal.child.wait();
    }
    Ok(())
}
