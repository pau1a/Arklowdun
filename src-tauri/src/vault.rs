use std::path::{Component, Path, PathBuf};

use tracing::{info, warn};
use unicode_normalization::UnicodeNormalization;

use crate::attachment_category::AttachmentCategory;
use crate::security::hash_path;
use crate::AppError;

pub const ERR_INVALID_CATEGORY: &str = "INVALID_CATEGORY";
pub const ERR_INVALID_HOUSEHOLD: &str = "INVALID_HOUSEHOLD";
pub const ERR_PATH_OUT_OF_VAULT: &str = "PATH_OUT_OF_VAULT";
pub const ERR_SYMLINK_DENIED: &str = "SYMLINK_DENIED";
pub const ERR_FILENAME_INVALID: &str = "FILENAME_INVALID";
pub const ERR_NAME_TOO_LONG: &str = "NAME_TOO_LONG";

const MAX_COMPONENT_BYTES: usize = 255;
const MAX_PATH_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone)]
pub struct Vault {
    base: PathBuf,
}

impl Vault {
    pub fn new(base: impl Into<PathBuf>) -> Self {
        Self { base: base.into() }
    }

    pub fn base(&self) -> &Path {
        &self.base
    }

    pub fn resolve(
        &self,
        household_id: &str,
        category: AttachmentCategory,
        relative_path: &str,
    ) -> Result<PathBuf, AppError> {
        self.ensure_household(household_id)?;
        self.ensure_category(category)?;

        let normalized = self.normalize_relative(relative_path)?;
        self.ensure_path_length(&normalized)?;

        let mut full = self.base.clone();
        full.push(household_id);
        full.push(category.as_str());
        full.push(&normalized);

        if !full.starts_with(&self.base) {
            return self.deny(
                relative_path,
                household_id,
                category,
                ERR_PATH_OUT_OF_VAULT,
                "joined path escaped base",
            );
        }

        if let Err(reason) = self.reject_symlinks(&full) {
            return Err(self.guard_error(
                relative_path,
                household_id,
                category,
                ERR_SYMLINK_DENIED,
                reason,
            ));
        }

        info!(
            target: "arklowdun",
            event = "vault_guard_allowed",
            household_id,
            category = category.as_str(),
            relative_hash = %hash_path(Path::new(&normalized)),
            path_hash = %hash_path(&full),
        );

        Ok(full)
    }

    pub fn relative_from_resolved(
        &self,
        resolved: &Path,
        household_id: &str,
        category: AttachmentCategory,
    ) -> Option<String> {
        let mut prefix = self.base.clone();
        prefix.push(household_id);
        prefix.push(category.as_str());
        let remainder = resolved.strip_prefix(prefix).ok()?;
        let mut parts = Vec::new();
        for component in remainder.components() {
            match component {
                Component::Normal(os) => {
                    parts.push(os.to_string_lossy().into_owned());
                }
                Component::CurDir => continue,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                    return None;
                }
            }
        }
        Some(parts.join("/"))
    }

    fn ensure_household(&self, household_id: &str) -> Result<(), AppError> {
        if household_id.trim().is_empty() {
            return Err(AppError::new(
                ERR_INVALID_HOUSEHOLD,
                "A valid household is required for attachments.",
            ));
        }
        if household_id.chars().any(|c| matches!(c, '/' | '\\')) {
            return Err(AppError::new(
                ERR_INVALID_HOUSEHOLD,
                "Household identifiers may not contain path separators.",
            ));
        }
        Ok(())
    }

    fn ensure_category(&self, category: AttachmentCategory) -> Result<(), AppError> {
        if AttachmentCategory::iter().any(|candidate| candidate == category) {
            Ok(())
        } else {
            Err(AppError::new(
                ERR_INVALID_CATEGORY,
                "Attachment category is not supported.",
            ))
        }
    }

    fn normalize_relative(&self, relative: &str) -> Result<PathBuf, AppError> {
        if relative.is_empty() {
            return Err(AppError::new(
                ERR_FILENAME_INVALID,
                "Attachment filename cannot be empty.",
            ));
        }

        if self.is_windows_drive(relative)
            || relative.starts_with('/')
            || relative.starts_with('\\')
        {
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
            self.validate_component(&segment)?;
            buf.push(segment);
        }

        Ok(buf)
    }

    fn validate_component(&self, segment: &str) -> Result<(), AppError> {
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

        if self.is_reserved_windows_name(segment) {
            return Err(AppError::new(
                ERR_FILENAME_INVALID,
                "Attachment names may not use reserved Windows names.",
            ));
        }

        Ok(())
    }

    fn ensure_path_length(&self, path: &Path) -> Result<(), AppError> {
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

    fn reject_symlinks(&self, path: &Path) -> Result<(), &'static str> {
        // We walk each realized component that already exists on disk and check the
        // filesystem metadata for a symlink. This is inherently a best-effort guard:
        // a malicious actor with concurrent filesystem access could introduce a
        // symlink after this check succeeds but before the caller opens the file
        // (classic TOCTOU). That race is acceptable because the vault only ever
        // operates within application-controlled roots and the resolver performs a
        // fresh guard pass on every access.
        let mut cur = self.base.clone();
        for comp in path
            .strip_prefix(&self.base)
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

    fn is_windows_drive(&self, candidate: &str) -> bool {
        let bytes = candidate.as_bytes();
        if bytes.len() < 2 {
            return false;
        }
        let drive = bytes[0] as char;
        bytes[1] == b':' && drive.is_ascii_alphabetic()
    }

    fn is_reserved_windows_name(&self, segment: &str) -> bool {
        const RESERVED: [&str; 22] = [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ];
        RESERVED
            .iter()
            .any(|name| segment.eq_ignore_ascii_case(name))
    }

    fn guard_error(
        &self,
        attempted: &str,
        household_id: &str,
        category: AttachmentCategory,
        code: &'static str,
        reason: &'static str,
    ) -> AppError {
        let hashed = hash_path(Path::new(attempted));
        let message = match code {
            ERR_PATH_OUT_OF_VAULT => "Attachment path must stay inside the vault.",
            ERR_SYMLINK_DENIED => "Attachments cannot traverse through symlinks.",
            ERR_INVALID_HOUSEHOLD => "A valid household is required for attachments.",
            ERR_INVALID_CATEGORY => "Attachment category is not supported.",
            ERR_FILENAME_INVALID => "Attachment name is not allowed.",
            ERR_NAME_TOO_LONG => "Attachment path is too long.",
            _ => "Attachment path was rejected.",
        };
        warn!(
            target: "arklowdun",
            event = "vault_guard_denied",
            reason,
            code,
            household_id,
            category = category.as_str(),
            relative_hash = %hashed,
        );
        AppError::new(code, message)
            .with_context("household_id", household_id.to_string())
            .with_context("category", category.as_str().to_string())
            .with_context("relative_path_hash", hashed)
    }

    fn deny(
        &self,
        attempted: &str,
        household_id: &str,
        category: AttachmentCategory,
        code: &'static str,
        reason: &'static str,
    ) -> Result<PathBuf, AppError> {
        Err(self.guard_error(attempted, household_id, category, code, reason))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::attachment_category::AttachmentCategory;
    use tempfile::tempdir;

    #[test]
    fn resolves_and_normalizes_path() {
        let dir = tempdir().expect("tempdir");
        let vault = Vault::new(dir.path());
        let path = vault
            .resolve(
                "household",
                AttachmentCategory::Notes,
                "cafe\\u{0301}/receipts.txt",
            )
            .expect("resolve path");
        assert!(path.starts_with(dir.path()));
        assert!(path.ends_with(Path::new("household/notes/café/receipts.txt")));
    }

    #[test]
    fn rejects_absolute_path() {
        let dir = tempdir().expect("tempdir");
        let vault = Vault::new(dir.path());
        let err = vault
            .resolve("household", AttachmentCategory::Notes, "/etc/passwd")
            .expect_err("absolute path rejected");
        assert_eq!(err.code(), ERR_PATH_OUT_OF_VAULT);
    }

    #[test]
    fn rejects_traversal() {
        let dir = tempdir().expect("tempdir");
        let vault = Vault::new(dir.path());
        let err = vault
            .resolve("household", AttachmentCategory::Notes, "../escape.txt")
            .expect_err("traversal rejected");
        assert_eq!(err.code(), ERR_PATH_OUT_OF_VAULT);
    }

    #[test]
    fn rejects_reserved_name() {
        let dir = tempdir().expect("tempdir");
        let vault = Vault::new(dir.path());
        let err = vault
            .resolve("household", AttachmentCategory::Notes, "CON/report.txt")
            .expect_err("reserved name rejected");
        assert_eq!(err.code(), ERR_FILENAME_INVALID);
    }

    #[test]
    fn rejects_long_component() {
        let dir = tempdir().expect("tempdir");
        let vault = Vault::new(dir.path());
        let long = "a".repeat(260);
        let err = vault
            .resolve(
                "household",
                AttachmentCategory::Notes,
                &format!("{long}/file.txt"),
            )
            .expect_err("long component rejected");
        assert_eq!(err.code(), ERR_NAME_TOO_LONG);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_segment() {
        use std::os::unix::fs::symlink;

        let dir = tempdir().expect("tempdir");
        let household = dir.path().join("household");
        std::fs::create_dir_all(household.join("notes")).expect("create dir");
        let link_target = dir.path().join("target");
        std::fs::create_dir_all(&link_target).expect("create target");
        let link = household.join("notes").join("alias");
        symlink(&link_target, &link).expect("create symlink");

        let vault = Vault::new(dir.path());
        let err = vault
            .resolve("household", AttachmentCategory::Notes, "alias/file.txt")
            .expect_err("symlink rejected");
        assert_eq!(err.code(), ERR_SYMLINK_DENIED);
    }
}
