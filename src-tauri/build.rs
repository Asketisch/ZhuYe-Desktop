//! Tauri 2 build script —— 生成 capability schemas 到 OUT_DIR,供 `tauri::generate_context!`
//! 宏读取;并在 Windows MSVC 上为**所有**链接目标嵌入 comctl32 v6 manifest。

fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV");

    // Windows MSVC:tauri-build 默认只把 manifest 资源链进 bin 目标——
    // 底层 embed-resource 3.x 发射的是 cargo:rustc-link-arg-bins,测试二进制
    // (含 lib 单测)因此缺 comctl32 v6 依赖,加载即崩
    // STATUS_ENTRYPOINT_NOT_FOUND(tauri-apps/tauri#14580)。
    //
    // 修法:关闭 tauri-build 的默认 manifest,统一改用 /MANIFEST:EMBED +
    // /MANIFESTINPUT 给所有链接目标嵌入同一份 manifest。必须用
    // cargo:rustc-link-arg(全目标)——实测 cargo:rustc-link-arg-tests
    // 只作用于 [[test]] 集成测试,覆盖不到 lib 单测。
    if target_os == "windows" && target_env.as_deref() == Ok("msvc") {
        let attributes = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        tauri_build::try_build(attributes).expect("failed to run tauri-build");

        let manifest = std::env::current_dir()
            .unwrap()
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    } else {
        tauri_build::build();
    }
}
