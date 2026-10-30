//! 烛夜（ZhuYe）Tauri 2 二进制入口。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    reflect_desktop_lib::run();
}
