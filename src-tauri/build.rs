use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    ensure_ts_bindings_dir();
    sync_diagnostics_doc();
    emit_git_commit();
    emit_chrono_tz_metadata();
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

fn emit_chrono_tz_metadata() {
    println!("cargo:rustc-check-cfg=cfg(chrono_tz_has_iana_version)");
    println!("cargo:rerun-if-env-changed=DEP_CHRONO_TZ_VERSION");
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let manifest_path = PathBuf::from(&manifest_dir);
    let lock_candidates = [
        manifest_path.join("Cargo.lock"),
        manifest_path.join("../Cargo.lock"),
    ];

    let mut version = env::var("DEP_CHRONO_TZ_VERSION").ok();
    if version.as_deref().is_none_or(|value| value.is_empty()) {
        for candidate in &lock_candidates {
            if let Some(lock_version) = chrono_tz_version_from_lock(candidate) {
                println!("cargo:rerun-if-changed={}", candidate.display());
                version = Some(lock_version);
                break;
            }
        }
    }

    let Some(version) = version else {
        return;
    };

    println!("cargo:rustc-env=CHRONO_TZ_CRATE_VERSION={version}");
    if chrono_tz_has_iana_version(&version) {
        println!("cargo:rustc-cfg=chrono_tz_has_iana_version");
    }
}

fn chrono_tz_has_iana_version(version: &str) -> bool {
    let mut parts = version.split('.');
    let major = parts
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let minor = parts
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    if major > 0 {
        return true;
    }
    minor >= 8
}

fn chrono_tz_version_from_lock(path: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(path).ok()?;
    let mut current_name: Option<String> = None;
    let mut current_version: Option<String> = None;

    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("[[package]]") {
            if current_name.as_deref() == Some("chrono-tz") {
                if let Some(version) = current_version {
                    return Some(version);
                }
            }
            current_name = None;
            current_version = None;
            continue;
        }

        if let Some(name) = trimmed
            .strip_prefix("name = \"")
            .and_then(|rest| rest.strip_suffix('"'))
        {
            current_name = Some(name.to_string());
            continue;
        }

        if let Some(version) = trimmed
            .strip_prefix("version = \"")
            .and_then(|rest| rest.strip_suffix('"'))
        {
            current_version = Some(version.to_string());
            continue;
        }
    }

    if current_name.as_deref() == Some("chrono-tz") {
        if let Some(version) = current_version {
            return Some(version);
        }
    }

    None
}
