use std::env;
use std::path::PathBuf;

fn main() {
    ensure_ts_bindings_dir();
    tauri_build::build();
}

fn ensure_ts_bindings_dir() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| "".into());
    let bindings_dir = PathBuf::from(manifest_dir).join("../src/bindings");
    if let Err(err) = std::fs::create_dir_all(&bindings_dir) {
        println!(
            "cargo:warning=failed to create TS bindings directory {}: {}",
            bindings_dir.display(),
            err
        );
    }
}
