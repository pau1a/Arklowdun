use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use crate::attachment_category::AttachmentCategory;
use crate::security::hash_path;
use crate::vault_log;
use crate::AppError;

mod guard;
pub mod logging;
pub mod paths;

pub use guard::{
    ensure_path_length, normalize_relative, reject_symlinks, validate_component,
    MAX_COMPONENT_BYTES, MAX_PATH_BYTES,
};

pub const ERR_INVALID_CATEGORY: &str = "INVALID_CATEGORY";
pub const ERR_INVALID_HOUSEHOLD: &str = "INVALID_HOUSEHOLD";
pub const ERR_PATH_OUT_OF_VAULT: &str = "PATH_OUT_OF_VAULT";
pub const ERR_SYMLINK_DENIED: &str = "SYMLINK_DENIED";
pub const ERR_FILENAME_INVALID: &str = "FILENAME_INVALID";
pub const ERR_NAME_TOO_LONG: &str = "NAME_TOO_LONG";
pub const ERR_ROOT_KEY_NOT_SUPPORTED: &str = "ROOT_KEY_NOT_SUPPORTED";

#[derive(Debug, Clone)]
pub struct Vault {
    base: Arc<PathBuf>,
}

impl Vault {
    pub fn new(base: impl Into<PathBuf>) -> Self {
        Self {
            base: Arc::new(base.into()),
        }
    }

    pub fn base(&self) -> &Path {
        self.base.as_path()
    }

    pub fn base_arc(&self) -> Arc<PathBuf> {
        self.base.clone()
    }

    pub fn resolve(
        &self,
        household_id: &str,
        category: AttachmentCategory,
        relative_path: &str,
    ) -> Result<PathBuf, AppError> {
        self.ensure_household(household_id).map_err(|err| {
            self.log_guard_failure(
                err,
                relative_path,
                household_id,
                category,
                "ensure_household",
            )
        })?;
        self.ensure_category(category).map_err(|err| {
            self.log_guard_failure(
                err,
                relative_path,
                household_id,
                category,
                "ensure_category",
            )
        })?;

        let normalized = normalize_relative(relative_path).map_err(|err| {
            self.log_guard_failure(
                err,
                relative_path,
                household_id,
                category,
                "normalize_relative",
            )
        })?;
        let normalized_string = normalized.to_string_lossy().into_owned();
        ensure_path_length(&normalized).map_err(|err| {
            self.log_guard_failure(
                err,
                &normalized_string,
                household_id,
                category,
                "ensure_path_length",
            )
        })?;

        let mut full = self.base.as_ref().clone();
        full.push(household_id);
        full.push(category.as_str());
        full.push(&normalized);

        if !full.starts_with(self.base.as_path()) {
            return self.deny(
                relative_path,
                household_id,
                category,
                ERR_PATH_OUT_OF_VAULT,
                "joined path escaped base",
            );
        }

        if let Err(reason) = reject_symlinks(self.base.as_path(), &full) {
            return Err(self.guard_error(
                relative_path,
                household_id,
                category,
                ERR_SYMLINK_DENIED,
                reason,
            ));
        }

        let relative_hash = hash_path(normalized.as_path());
        vault_log!(
            level: info,
            event: "vault_guard",
            outcome: "allow",
            household_id = household_id,
            category = category.as_str(),
            path = &full,
            stage = "resolve",
            relative_hash = relative_hash.as_str(),
        );

        Ok(full)
    }

    pub fn relative_from_resolved(
        &self,
        resolved: &Path,
        household_id: &str,
        category: AttachmentCategory,
    ) -> Option<String> {
        let mut prefix = self.base.as_ref().clone();
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

    fn guard_error(
        &self,
        attempted: &str,
        household_id: &str,
        category: AttachmentCategory,
        code: &'static str,
        reason: &'static str,
    ) -> AppError {
        let message = match code {
            ERR_PATH_OUT_OF_VAULT => "Attachment path must stay inside the vault.",
            ERR_SYMLINK_DENIED => "Attachments cannot traverse through symlinks.",
            ERR_INVALID_HOUSEHOLD => "A valid household is required for attachments.",
            ERR_INVALID_CATEGORY => "Attachment category is not supported.",
            ERR_FILENAME_INVALID => "Attachment name is not allowed.",
            ERR_NAME_TOO_LONG => "Attachment path is too long.",
            _ => "Attachment path was rejected.",
        };
        let err = AppError::new(code, message);
        self.log_guard_failure(err, attempted, household_id, category, reason)
    }

    fn log_guard_failure(
        &self,
        mut err: AppError,
        attempted: impl AsRef<str>,
        household_id: &str,
        category: AttachmentCategory,
        stage: &'static str,
    ) -> AppError {
        let attempted = attempted.as_ref();
        let hashed = hash_path(Path::new(attempted));
        let code = err.code().to_string();
        vault_log!(
            level: warn,
            event: "vault_guard",
            outcome: "deny",
            household_id = household_id,
            category = category.as_str(),
            path = attempted,
            stage = stage,
            code = code.as_str(),
            relative_hash = hashed.as_str(),
        );
        err = err
            .with_context("household_id", household_id.to_string())
            .with_context("category", category.as_str().to_string())
            .with_context("relative_path_hash", hashed)
            .with_context("guard_stage", stage.to_string());
        err
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
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Barrier, Mutex};
    use std::thread;
    use std::time::Instant;
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

    #[test]
    fn resolve_meets_concurrent_latency_budget() {
        let dir = tempdir().expect("tempdir");
        let vault = Arc::new(Vault::new(dir.path()));
        let concurrency = 100;
        let barrier = Arc::new(Barrier::new(concurrency + 1));
        let durations = Arc::new(Mutex::new(Vec::with_capacity(concurrency)));
        let mut handles = Vec::with_capacity(concurrency);

        for idx in 0..concurrency {
            let vault = Arc::clone(&vault);
            let barrier = Arc::clone(&barrier);
            let durations = Arc::clone(&durations);
            handles.push(thread::spawn(move || {
                let relative = format!("docs/file-{idx}.pdf");
                barrier.wait();
                let start = Instant::now();
                let resolved = vault
                    .resolve("hh1", AttachmentCategory::Notes, &relative)
                    .expect("resolve path");
                let elapsed = start.elapsed();
                assert!(resolved.starts_with(vault.base()));
                let mut expected_suffix = PathBuf::from("hh1");
                expected_suffix.push(AttachmentCategory::Notes.as_str());
                expected_suffix.push(&relative);
                assert!(resolved.ends_with(&expected_suffix));
                durations.lock().expect("lock durations").push(elapsed);
            }));
        }

        let start = Instant::now();
        barrier.wait();
        for handle in handles {
            handle.join().expect("join worker");
        }
        let total_elapsed = start.elapsed();
        let durations = durations.lock().expect("lock durations after");
        assert_eq!(durations.len(), concurrency);
        let avg_ms = durations.iter().map(|d| d.as_secs_f64()).sum::<f64>()
            / durations.len() as f64
            * 1000.0;
        assert!(
            avg_ms <= 5.0,
            "expected <= 5ms average resolve, observed {avg_ms}ms over {:?}",
            total_elapsed
        );
    }
}
