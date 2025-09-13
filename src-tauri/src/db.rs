use anyhow::Result;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Pool, Sqlite, SqlitePool, Transaction};
use std::future::Future;
use std::pin::Pin;
use std::str::FromStr;
use tauri::{AppHandle, Manager};

// Boxed future whose lifetime is tied to the borrowed Transaction.
pub type TxFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;

pub async fn with_tx<T, F>(pool: &SqlitePool, f: F) -> Result<T>
where
    T: Send + 'static,
    // For any 'a, take &mut Transaction<'a, Sqlite> and return a future valid for 'a.
    // Tying both lifetimes to 'a allows &mut Transaction to satisfy sqlx::Executor.
    F: for<'a> FnOnce(&'a mut Transaction<'a, Sqlite>) -> TxFuture<'a, T>,
{
    let mut tx = pool.begin().await?;

    let res = f(&mut tx).await;

    match res {
        Ok(out) => {
            tx.commit().await?;
            Ok(out)
        }
        Err(err) => {
            // Drop would roll back, but do it explicitly for clarity.
            let _ = tx.rollback().await;
            Err(err)
        }
    }
}

// TXN: domain=OUT OF SCOPE tables=PRAGMA
pub async fn open_sqlite_pool(app: &AppHandle) -> Result<Pool<Sqlite>> {
    let app_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    std::fs::create_dir_all(&app_dir).map_err(|e| {
        tracing::error!(
            target = "arklowdun",
            error = %e,
            event = "app_data_dir_create_failed",
            path = %app_dir.display()
        );
        e
    })?;
    let db_path = app_dir.join("arklowdun.sqlite3");
    tracing::info!(target = "arklowdun", event = "db_path", path = %db_path.display());

    let opts = SqliteConnectOptions::from_str(db_path.to_str().unwrap())
        .expect("valid DB path")
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
