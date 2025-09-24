use std::ffi::OsString;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use crate::{AppError, AppResult};

fn ensure_same_parent(live: &Path, other: &Path, role: &str) -> AppResult<()> {
    let live_parent = live.parent().ok_or_else(|| {
        AppError::new(
            "DB_SWAP/NO_PARENT",
            "Database path does not have a parent directory",
        )
        .with_context("path", live.display().to_string())
    })?;

    let other_parent = other.parent().ok_or_else(|| {
        AppError::new(
            "DB_SWAP/NO_PARENT",
            format!("{role} path does not have a parent directory"),
        )
        .with_context("path", other.display().to_string())
    })?;

    if live_parent != other_parent {
        return Err(AppError::new(
            "DB_SWAP/DIFFERENT_PARENT",
            "Swap paths must share the same parent directory",
        )
        .with_context("live", live.display().to_string())
        .with_context(role, other.display().to_string()));
    }

    Ok(())
}

fn sync_file(path: &Path) -> io::Result<()> {
    let file = File::open(path)?;
    file.sync_all()
}

fn sync_dir(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

fn remove_sidecar(base: &Path, suffix: &str) -> io::Result<()> {
    let mut os = OsString::from(base.as_os_str());
    os.push(suffix);
    let sidecar = PathBuf::from(os);
    match fs::remove_file(&sidecar) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

fn remove_sidecars(live_path: &Path) -> io::Result<()> {
    remove_sidecar(live_path, "-wal")?;
    remove_sidecar(live_path, "-shm")?;
    Ok(())
}

/// Atomically replace the live database file with a newly rebuilt copy while
/// preserving the original database under the provided archive path.
///
/// The caller is responsible for ensuring the new database has been fully
/// validated before invoking this swap.
pub fn swap_database(live_path: &Path, new_db: &Path, archive_path: &Path) -> AppResult<()> {
    ensure_same_parent(live_path, new_db, "new")?;
    ensure_same_parent(live_path, archive_path, "archive")?;

    let parent = live_path.parent().ok_or_else(|| {
        AppError::new(
            "DB_SWAP/NO_PARENT",
            "Database path does not have a parent directory",
        )
        .with_context("path", live_path.display().to_string())
    })?;

    sync_file(new_db).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "sync_new_db")
            .with_context("path", new_db.display().to_string())
    })?;

    if archive_path.exists() {
        fs::remove_file(archive_path).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "remove_existing_archive")
                .with_context("path", archive_path.display().to_string())
        })?;
    }

    fs::rename(live_path, archive_path).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "archive_live_db")
            .with_context("from", live_path.display().to_string())
            .with_context("to", archive_path.display().to_string())
    })?;

    remove_sidecars(live_path).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "remove_live_sidecars")
            .with_context("path", live_path.display().to_string())
    })?;

    match fs::rename(new_db, live_path) {
        Ok(()) => {
            sync_file(live_path).map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "sync_live_db")
                    .with_context("path", live_path.display().to_string())
            })?;
            sync_dir(parent).map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "sync_parent_dir")
                    .with_context("path", parent.display().to_string())
            })?;
            Ok(())
        }
        Err(err) => {
            let revert_err = err;
            let _ = fs::rename(archive_path, live_path);
            Err(AppError::from(revert_err)
                .with_context("operation", "promote_new_db")
                .with_context("from", new_db.display().to_string())
                .with_context("to", live_path.display().to_string()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write_file(path: &Path, contents: &[u8]) {
        std::fs::write(path, contents).expect("write file");
    }

    #[test]
    fn swap_promotes_new_db_and_archives_old() {
        let dir = tempdir().unwrap();
        let live = dir.path().join("db.sqlite3");
        let new = dir.path().join("new.sqlite3");
        let archive = dir.path().join("pre-repair.sqlite3");

        write_file(&live, b"old");
        write_file(&new, b"new");

        swap_database(&live, &new, &archive).expect("swap succeeds");

        let live_contents = std::fs::read(&live).expect("live readable");
        let archive_contents = std::fs::read(&archive).expect("archive readable");

        assert_eq!(live_contents, b"new".as_slice());
        assert_eq!(archive_contents, b"old".as_slice());

        // After swap the new path should no longer exist.
        assert!(!new.exists());
    }

    #[test]
    fn swap_rejects_different_parents() {
        let dir = tempdir().unwrap();
        let other = tempdir().unwrap();
        let live = dir.path().join("db.sqlite3");
        let new = other.path().join("new.sqlite3");
        let archive = dir.path().join("pre-repair.sqlite3");

        write_file(&live, b"old");
        write_file(&new, b"new");

        let err = swap_database(&live, &new, &archive).expect_err("different parents rejected");
        assert_eq!(err.code(), "DB_SWAP/DIFFERENT_PARENT");
    }
}
