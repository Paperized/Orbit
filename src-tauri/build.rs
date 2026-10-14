fn main() {
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    tauri_build::try_build(attributes).expect("failed to build Tauri resources");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // Tauri embeds its manifest only in app binaries, not library test executables.
        println!("cargo:rerun-if-changed=windows.rc");
        println!("cargo:rerun-if-changed=windows.manifest");
        embed_resource::compile_for_everything("windows.rc", embed_resource::NONE)
            .manifest_required()
            .expect("failed to embed the Windows Common Controls manifest");
    }
}
