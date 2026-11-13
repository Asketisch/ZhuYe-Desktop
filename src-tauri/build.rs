//! Tauri 2 build script —— 仅在 `pnpm tauri dev|build` 或 `cargo build` 时触发,
//! 生成 capability schemas 到 OUT_DIR,供 `tauri::generate_context!` 宏读取。

fn main() {
    tauri_build::build();

    // Tauri 的应用 manifest 只会嵌进主二进制;测试二进制若缺 comctl32
    // v6 依赖,Windows 上会因 TaskDialogIndirect 缺入口而在加载前退出
    // (STATUS_ENTRYPOINT_NOT_FOUND)。这里为所有测试目标嵌入同一 manifest。
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV");
    if target_os == "windows" && target_env.as_deref() == Ok("msvc") {
        let manifest = std::env::current_dir()
            .unwrap()
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}
