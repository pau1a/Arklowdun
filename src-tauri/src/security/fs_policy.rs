use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

#[derive(Debug, Clone, Copy)]
pub enum RootKey {
    AppData,
    Attachments,
}

// Some variants are platform/usage-dependent; silence "never constructed"
// warnings in non-test builds while keeping them available for tests.
#[cfg_attr(not(test), allow(dead_code))]
#[derive(thiserror::Error, Debug)]
pub enum FsPolicyError {
    #[error("UNC paths are not allowed")]
    UncRejected,
    #[error("Parent traversal is not allowed")]
    DotDotRejected,
    #[cfg(target_os = "windows")]
    #[error("Cross-volume paths are not allowed")]
    CrossVolume,
    #[error("Path is outside the allowed root")]
    OutsideRoot,
    #[error("Symlinks are not allowed")]
    Symlink,
    #[error("Invalid path")]
    Invalid,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl FsPolicyError {
    pub fn name(&self) -> &'static str {
        match self {
            FsPolicyError::UncRejected => "UncRejected",
            FsPolicyError::DotDotRejected => "DotDotRejected",
            #[cfg(target_os = "windows")]
            FsPolicyError::CrossVolume => "CrossVolume",
            FsPolicyError::OutsideRoot => "OutsideRoot",
            FsPolicyError::Symlink => "Symlink",
            FsPolicyError::Invalid => "Invalid",
            FsPolicyError::Io(_) => "Io",
        }
    }
}

#[derive(Debug)]
pub struct CanonResult {
    pub real_path: PathBuf,
}

/// Resolve the app's base directory for a given root.
pub fn base_for<R: Runtime>(
    root: RootKey,
    app_handle: &tauri::AppHandle<R>,
) -> Result<PathBuf, FsPolicyError> {
    let base = if let Ok(fake) = std::env::var("ARK_FAKE_APPDATA") {
        PathBuf::from(fake)
    } else {
        app_handle
            .path()
            .app_data_dir()
            .map_err(|_| FsPolicyError::Invalid)?
    };
    let base = match root {
        RootKey::AppData => base,
        RootKey::Attachments => {
            let mut p = base;
            p.push("attachments");
            p
        }
    };
    Ok(base)
}

/// Canonicalize user/provided path against `root`, normalize separators,
/// reject `..`, UNC, cross-volume, and ensure result is **within** base.
/// Do **not** follow symlinks here.
pub fn canonicalize_and_verify<R: Runtime>(
    input: &str,
    root: RootKey,
    app_handle: &tauri::AppHandle<R>,
) -> Result<CanonResult, FsPolicyError> {
    let base = base_for(root, app_handle)?;
    let norm = input.replace('\\', "/");
    if norm.starts_with("//") {
        return Err(FsPolicyError::UncRejected);
    }
    if norm.split('/').any(|seg| seg == "..") {
        return Err(FsPolicyError::DotDotRejected);
    }
    let raw_path = PathBuf::from(input);
    let candidate = if raw_path.is_absolute() {
        #[cfg(target_os = "windows")]
        {
            use std::path::Component;
            let mut base_iter = base.components();
            let mut path_iter = raw_path.components();
            match (base_iter.next(), path_iter.next()) {
                (Some(Component::Prefix(bp)), Some(Component::Prefix(pp))) => {
                    if bp.kind() != pp.kind() {
                        return Err(FsPolicyError::CrossVolume);
                    }
                }
                _ => {}
            }
        }
        raw_path
    } else {
        let mut p = base.clone();
        p.push(raw_path);
        p
    };
    if !candidate.starts_with(&base) {
        return Err(FsPolicyError::OutsideRoot);
    }
    Ok(CanonResult {
        real_path: candidate,
    })
}

/// Walk each segment from base → target and deny if any segment is a symlink.
pub fn reject_symlinks(p: &Path) -> Result<(), FsPolicyError> {
    let mut cur = PathBuf::new();
    for comp in p.components() {
        cur.push(comp.as_os_str());
        let meta = std::fs::symlink_metadata(&cur)?;
        if meta.file_type().is_symlink() {
            return Err(FsPolicyError::Symlink);
        }
    }
    Ok(())
}
