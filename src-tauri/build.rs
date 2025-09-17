use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    ensure_ts_bindings_dir();
    sync_diagnostics_doc();
    emit_git_commit();
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

fn sync_diagnostics_doc() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| "".into());
    let source = PathBuf::from(&manifest_dir).join("../docs/diagnostics.md");
    println!("cargo:rerun-if-changed={}", source.display());

    if !source.exists() {
        println!(
            "cargo:warning=diagnostics guide not found at {}; skipping resource copy",
            source.display()
        );
        return;
    }

    let target_dir = PathBuf::from(&manifest_dir).join("resources/docs");
    if let Err(err) = std::fs::create_dir_all(&target_dir) {
        println!(
            "cargo:warning=failed to prepare diagnostics resource directory {}: {}",
            target_dir.display(),
            err
        );
        return;
    }

    let target = target_dir.join("diagnostics.md");
    if let Err(err) = std::fs::copy(&source, &target) {
        println!(
            "cargo:warning=failed to copy diagnostics guide to resources: {}",
            err
        );
    }
}

fn emit_git_commit() {
    let output = Command::new("git").args(["rev-parse", "HEAD"]).output();

    let commit = match output {
        Ok(out) if out.status.success() => {
            let raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if raw.is_empty() {
                "unknown".to_string()
            } else {
                raw
            }
        }
        _ => "unknown".to_string(),
    };

    println!("cargo:rustc-env=ARK_GIT_HASH={commit}");
}
