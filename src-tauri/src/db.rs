use anyhow::{anyhow, Context, Result};
use futures::FutureExt;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::Executor;
use sqlx::{Pool, Sqlite, SqlitePool, Transaction};
use std::fmt;
use std::fs::{self, File};
use std::future::Future;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::str::FromStr;
use tauri::{AppHandle, Manager};

#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};

#[path = "db/health.rs"]
pub mod health;

#[path = "db/manifest.rs"]
pub mod manifest;

#[path = "db/backup.rs"]
pub mod backup;

#[path = "db/repair.rs"]
pub mod repair;

#[path = "db/hard_repair.rs"]
pub mod hard_repair;

#[path = "db/swap.rs"]
pub mod swap;

#[path = "db/schema_rebuild.rs"]
pub mod schema_rebuild;

#[allow(dead_code)]
#[cfg(test)]
pub(super) static WRITE_ATOMIC_CRASH_BEFORE_RENAME: AtomicBool = AtomicBool::new(false);

#[allow(dead_code)]
pub fn write_atomic(path: &Path, data: &[u8]) -> Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| anyhow!("no parent directory"))?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;

    #[cfg(unix)]
    if let Ok(meta) = fs::metadata(path) {
        let perm = meta.permissions();
        let _ = fs::set_permissions(tmp.path(), perm);
    }

    tmp.write_all(data)?;
    tmp.as_file().sync_all()?;
    let tmp_path = tmp.into_temp_path();

    #[cfg(test)]
    if WRITE_ATOMIC_CRASH_BEFORE_RENAME.swap(false, Ordering::SeqCst) {
        return Err(anyhow!("simulated crash before rename"));
    }

    #[cfg(unix)]
    {
        fs::rename(&tmp_path, path)?;
        let dir_file = File::open(dir)?;
        dir_file.sync_all()?;
    }

    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use std::ptr::null_mut;
        use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;

        let dest: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let src: Vec<u16> = tmp_path.as_os_str().encode_wide().chain(Some(0)).collect();
        let res = unsafe {
            ReplaceFileW(
                dest.as_ptr(),
                src.as_ptr(),
                std::ptr::null(),
                0,
                null_mut(),
                null_mut(),
            )
        };
        if res == 0 {
            if path.exists() {
                let err = std::io::Error::last_os_error();
                let _ = fs::remove_file(&tmp_path);
                return Err(err.into());
            } else {
                fs::rename(&tmp_path, path)?;
            }
        }
    }

    Ok(())
}

// A helper trait that ties the future's lifetime to the borrow lifetime using a GAT.
/// Boxed future whose lifetime is tied to the borrowed transaction.
#[allow(dead_code)]
pub type TxFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;

#[allow(dead_code)]
pub async fn with_tx<T, F>(pool: &SqlitePool, f: F) -> Result<T>
where
    T: Send,
    // Tie both the tx borrow and the returned future to the same `'a`.
    F: for<'a> FnOnce(&'a mut Transaction<'a, Sqlite>) -> TxFuture<'a, T>,
{
    let mut tx = pool.begin().await?;
    // Borrow-checker shim: pass &mut tx via a raw pointer and await to completion
    // so the borrow ends before we move `tx` into commit/rollback.
    let tx_ptr: *mut Transaction<'_, Sqlite> = &mut tx;
    let res = unsafe {
        // SAFETY: We create a unique &mut from tx_ptr, hand it to `f`, await to completion,
        // and do not touch `tx` elsewhere until after this await finishes.
        f(&mut *tx_ptr).await
    };
    match res {
        Ok(out) => {
            tx.commit().await?;
            Ok(out)
        }
        Err(err) => {
            // (Drop would roll back; do it explicitly.)
            let _ = tx.rollback().await;
            Err(err)
        }
    }
}

// TXN: domain=OUT OF SCOPE tables=PRAGMA
pub async fn connect_sqlite_pool(db_path: &Path) -> Result<Pool<Sqlite>> {
    let db_path_str = db_path.to_str().ok_or_else(|| {
        anyhow!(
            "Database path is not valid UTF-8: {}",
            db_path.to_string_lossy()
        )
    })?;

    let opts = SqliteConnectOptions::from_str(db_path_str)
        .with_context(|| format!("db_path={db_path_str}"))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA busy_timeout = 5000;")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("PRAGMA wal_autocheckpoint = 1000;")
                    .execute(&mut *conn)
                    .await?;
                Ok::<_, sqlx::Error>(())
            })
        })
        .connect_with(opts)
        .await?;

    log_effective_pragmas(&pool).await;

    Ok(pool)
}

pub async fn open_sqlite_pool(app: &AppHandle) -> Result<(Pool<Sqlite>, PathBuf)> {
    let app_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    std::fs::create_dir_all(&app_dir).map_err(|e| {
        tracing::error!(
            target: "arklowdun",
            error = %e,
            event = "app_data_dir_create_failed",
            path = %app_dir.display()
        );
        e
    })?;
    let db_path = app_dir.join("arklowdun.sqlite3");
    tracing::info!(target: "arklowdun", event = "db_path", path = %db_path.display());

    let pool = connect_sqlite_pool(&db_path).await?;

    Ok((pool, db_path))
}

#[allow(dead_code)]
async fn log_effective_pragmas(pool: &Pool<Sqlite>) {
    use tracing::{info, warn};

    let (sqlite_ver,): (String,) = sqlx::query_as("select sqlite_version()")
        .fetch_one(pool)
        .await
        .unwrap_or((String::from("unknown"),));

    let jm: (String,) = sqlx::query_as("PRAGMA journal_mode;")
        .fetch_one(pool)
        .await
        .unwrap_or((String::from("unknown"),));

    let sync: (i64,) = sqlx::query_as("PRAGMA synchronous;")
        .fetch_one(pool)
        .await
        .unwrap_or((i64::MIN,));

    let fks: (i64,) = sqlx::query_as("PRAGMA foreign_keys;")
        .fetch_one(pool)
        .await
        .unwrap_or((i64::MIN,));

    let busy: (i64,) = sqlx::query_as("PRAGMA busy_timeout;")
        .fetch_one(pool)
        .await
        .unwrap_or((i64::MIN,));

    info!(
        target: "arklowdun",
        event = "db_open",
        sqlite_version = %sqlite_ver,
        journal_mode = %jm.0,
        synchronous = %sync.0,
        foreign_keys = %fks.0,
        busy_timeout_ms = %busy.0
    );

    if !jm.0.eq_ignore_ascii_case("wal") {
        warn!(
            target = "arklowdun",
            event = "db_open_warning",
            msg = "journal_mode != WAL; running with reduced crash safety"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use once_cell::sync::Lazy;
    use std::fs;
    use std::sync::atomic::Ordering;
    use std::sync::Mutex;
    use tempfile::tempdir;

    // Serialize tests that mutate the global crash flag to avoid interleaving.
    static WRITE_ATOMIC_TEST_GUARD: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    #[cfg(unix)]
    #[test]
    fn write_atomic_preserves_existing_permissions() {
        let _g = WRITE_ATOMIC_TEST_GUARD.lock().unwrap();
        // Always start clean and ensure we leave it clean.
        super::WRITE_ATOMIC_CRASH_BEFORE_RENAME.store(false, Ordering::SeqCst);
        struct Reset;
        impl Drop for Reset {
            fn drop(&mut self) {
                super::WRITE_ATOMIC_CRASH_BEFORE_RENAME.store(false, Ordering::SeqCst);
            }
        }
        let _reset = Reset;
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        let path = temp.path().join("data.json");
        fs::write(&path, b"old").unwrap();
        let mut perms = fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o700);
        fs::set_permissions(&path, perms.clone()).unwrap();

        write_atomic(&path, b"new").unwrap();

        let updated = fs::metadata(&path).unwrap().permissions();
        assert_eq!(updated.mode() & 0o777, 0o700);
    }

    #[test]
    fn write_atomic_failure_does_not_corrupt_existing_file() {
        let _g = WRITE_ATOMIC_TEST_GUARD.lock().unwrap();
        super::WRITE_ATOMIC_CRASH_BEFORE_RENAME.store(false, Ordering::SeqCst);
        struct Reset;
        impl Drop for Reset {
            fn drop(&mut self) {
                super::WRITE_ATOMIC_CRASH_BEFORE_RENAME.store(false, Ordering::SeqCst);
            }
        }
        let _reset = Reset;
        let temp = tempdir().unwrap();
        let path = temp.path().join("artifact.txt");
        fs::write(&path, b"stable").unwrap();

        // Successful write establishes baseline content.
        write_atomic(&path, b"baseline").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"baseline");

        // Next invocation simulates a crash prior to rename.
        super::WRITE_ATOMIC_CRASH_BEFORE_RENAME.store(true, Ordering::SeqCst);
        let err = write_atomic(&path, b"corrupted").unwrap_err();
        assert_eq!(err.to_string(), "simulated crash before rename");

        // The final file is untouched and no stray temp files remain.
        assert_eq!(fs::read(&path).unwrap(), b"baseline");
        let entries: Vec<_> = fs::read_dir(temp.path())
            .unwrap()
            .map(|res| res.unwrap().path())
            .collect();
        assert_eq!(entries.len(), 1);
        assert_eq!(fs::read(&entries[0]).unwrap(), b"baseline");

        // (reset handled by Drop guard)
    }
}

#[derive(Debug)]
struct MigrationPanic(String);

impl fmt::Display for MigrationPanic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "migration panicked: {}", self.0)
    }
}

impl std::error::Error for MigrationPanic {}

#[allow(dead_code)]
pub async fn apply_migrations(pool: &SqlitePool) -> Result<()> {
    use std::panic::AssertUnwindSafe;
    use tracing::error;

    log::info!("starting migrations");

    let result = AssertUnwindSafe(crate::migrate::apply_migrations(pool))
        .catch_unwind()
        .await;

    match result {
        Ok(mut res) => {
            if let Err(ref e) = res {
                log::error!("migrations failed: {e}");
            } else if let Err(err) = crate::household::ensure_household_invariants(pool).await {
                log::error!("household invariant repair failed: {err}");
                res = Err(err);
            } else {
                log::info!("migrations succeeded");
            }
            res
        }
        Err(panic) => {
            let _ = pool.execute("ROLLBACK").await;
            let msg = if let Some(s) = panic.downcast_ref::<&str>() {
                (*s).to_string()
            } else if let Some(s) = panic.downcast_ref::<String>() {
                s.clone()
            } else {
                "unknown panic".to_string()
            };
            error!(target: "arklowdun", event = "migration_panic", error = %msg);
            log::error!("migrations panicked: {msg}");
            Err(MigrationPanic(msg).into())
        }
    }
}
