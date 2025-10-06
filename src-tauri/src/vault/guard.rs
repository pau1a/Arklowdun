use std::path::{Component, Path, PathBuf};

use unicode_normalization::UnicodeNormalization;

use crate::AppError;

use super::{ERR_FILENAME_INVALID, ERR_NAME_TOO_LONG, ERR_PATH_OUT_OF_VAULT};

// Database constraints enforce category enumerations and nullability. This guard layer owns
// filesystem hygiene: path shape, normalization, traversal prevention, and byte-length limits.
pub const MAX_COMPONENT_BYTES: usize = 255;
pub const MAX_PATH_BYTES: usize = 32 * 1024;

pub fn normalize_relative(relative: &str) -> Result<PathBuf, AppError> {
    if relative.is_empty() {
        return Err(AppError::new(
            ERR_FILENAME_INVALID,
            "Attachment filename cannot be empty.",
        ));
    }

    if is_windows_drive(relative) || relative.starts_with('/') || relative.starts_with('\\') {
        return Err(AppError::new(
            ERR_PATH_OUT_OF_VAULT,
            "Absolute paths are not allowed for attachments.",
        ));
    }

    let mut buf = PathBuf::new();
    for raw in relative.replace('\\', "/").split('/') {
        if raw.is_empty() {
            return Err(AppError::new(
                ERR_FILENAME_INVALID,
                "Attachment path segments cannot be empty.",
            ));
        }
        if raw == "." || raw == ".." {
            return Err(AppError::new(
                ERR_PATH_OUT_OF_VAULT,
                "Attachment paths may not include traversal segments.",
            ));
        }
        let segment = raw.nfc().collect::<String>();
        validate_component(&segment)?;
        buf.push(segment);
    }

    Ok(buf)
}

pub fn validate_component(segment: &str) -> Result<(), AppError> {
    let bytes = segment.as_bytes();
    if bytes.len() > MAX_COMPONENT_BYTES {
        return Err(AppError::new(
            ERR_NAME_TOO_LONG,
            "Attachment path segment is too long.",
        ));
    }
    if segment.trim_end_matches([' ', '.']).len() != segment.len() {
        return Err(AppError::new(
            ERR_FILENAME_INVALID,
            "Attachment names may not end with spaces or dots.",
        ));
    }
    if segment.chars().any(|c| {
        c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
    }) {
        return Err(AppError::new(
            ERR_FILENAME_INVALID,
            "Attachment names contain unsupported characters.",
        ));
    }

    if is_reserved_windows_name(segment) {
        return Err(AppError::new(
            ERR_FILENAME_INVALID,
            "Attachment names may not use reserved Windows names.",
        ));
    }

    Ok(())
}

pub fn ensure_path_length(path: &Path) -> Result<(), AppError> {
    let bytes = path
        .components()
        .map(|c| c.as_os_str().to_string_lossy().as_bytes().len())
        .sum::<usize>();
    if bytes > MAX_PATH_BYTES {
        return Err(AppError::new(
            ERR_NAME_TOO_LONG,
            "Attachment path is too long.",
        ));
    }
    Ok(())
}

pub fn reject_symlinks(base: &Path, path: &Path) -> Result<(), &'static str> {
    // We walk each realized component that already exists on disk and check the
    // filesystem metadata for a symlink. This is inherently a best-effort guard:
    // a malicious actor with concurrent filesystem access could introduce a
    // symlink after this check succeeds but before the caller opens the file
    // (classic TOCTOU). That race is acceptable because the vault only ever
    // operates within application-controlled roots and the resolver performs a
    // fresh guard pass on every access.
    let mut cur = base.to_path_buf();
    for comp in path
        .strip_prefix(base)
        .unwrap_or(path)
        .components()
        .filter(|c| matches!(c, Component::Normal(_)))
    {
        cur.push(comp.as_os_str());
        match std::fs::symlink_metadata(&cur) {
            Ok(meta) if meta.file_type().is_symlink() => return Err("symlink encountered"),
            Ok(_) => {}
            Err(err) => {
                if err.kind() == std::io::ErrorKind::NotFound {
                    // Future segments do not exist yet. This is normal during create
                    // flows and we deliberately stop here to avoid probing paths that
                    // are still being created in-memory.
                    break;
                }
            }
        }
    }
    Ok(())
}

fn is_windows_drive(candidate: &str) -> bool {
    let bytes = candidate.as_bytes();
    if bytes.len() < 2 {
        return false;
    }
    let drive = bytes[0] as char;
    bytes[1] == b':' && drive.is_ascii_alphabetic()
}

fn is_reserved_windows_name(segment: &str) -> bool {
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    RESERVED
        .iter()
        .any(|name| segment.eq_ignore_ascii_case(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn normalizes_unicode_and_slashes() {
        let normalized =
            normalize_relative("cafe\\u{0301}\\receipts.txt").expect("normalize relative path");
        let mut expected = PathBuf::from("café");
        expected.push("receipts.txt");
        assert_eq!(normalized, expected);
    }

    #[test]
    fn rejects_absolute_path() {
        let err = normalize_relative("/etc/passwd").expect_err("absolute path rejected");
        assert_eq!(err.code(), ERR_PATH_OUT_OF_VAULT);
    }

    #[test]
    fn rejects_traversal_segment() {
        let err = normalize_relative("../escape.txt").expect_err("traversal rejected");
        assert_eq!(err.code(), ERR_PATH_OUT_OF_VAULT);
    }

    #[test]
    fn rejects_reserved_component() {
        let err = normalize_relative("CON/report.txt").expect_err("reserved name rejected");
        assert_eq!(err.code(), ERR_FILENAME_INVALID);
    }

    #[test]
    fn rejects_component_length() {
        let long = "a".repeat(MAX_COMPONENT_BYTES + 1);
        let err =
            normalize_relative(&format!("{long}/file.txt")).expect_err("component length rejected");
        assert_eq!(err.code(), ERR_NAME_TOO_LONG);
    }

    #[test]
    fn ensures_path_length_limit() {
        let mut path = PathBuf::new();
        let segment = "a".repeat(MAX_COMPONENT_BYTES);
        // Build a path slightly above the limit by repeating components.
        for _ in 0..(MAX_PATH_BYTES / MAX_COMPONENT_BYTES + 1) {
            path.push(&segment);
        }
        let err = ensure_path_length(&path).expect_err("path length rejected");
        assert_eq!(err.code(), ERR_NAME_TOO_LONG);
    }

    #[cfg(unix)]
    #[test]
    fn detects_symlink_in_path() {
        use std::os::unix::fs::symlink;

        let dir = tempdir().expect("tempdir");
        let base = dir.path();
        let attachments_root = base.join("household");
        std::fs::create_dir_all(attachments_root.join("notes")).expect("create attachment dirs");
        let target = base.join("target");
        std::fs::create_dir_all(&target).expect("create target");
        let link = attachments_root.join("notes").join("alias");
        symlink(&target, &link).expect("create symlink");

        let resolved = attachments_root
            .join("notes")
            .join("alias")
            .join("file.txt");
        let err = reject_symlinks(base, &resolved).expect_err("symlink rejected");
        assert_eq!(err, "symlink encountered");
    }
}
