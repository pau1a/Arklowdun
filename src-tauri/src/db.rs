use anyhow::Result;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Pool, Sqlite, Transaction};
use std::str::FromStr;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;

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

    let connect_res = SqlitePoolOptions::new()
        .max_connections(8)
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA busy_timeout = 5000;")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("PRAGMA wal_autocheckpoint = 1000;")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("PRAGMA foreign_keys = ON;")
                    .execute(&mut *conn)
                    .await?;
                let (integrity,): (String,) = sqlx::query_as("PRAGMA quick_check;")
                    .fetch_one(&mut *conn)
                    .await?;
                if integrity.to_ascii_lowercase() != "ok" {
                    return Err(sqlx::Error::Protocol(integrity));
                }
                Ok::<_, sqlx::Error>(())
            })
        })
        .connect_with(opts)
        .await;

    let pool = match connect_res {
        Ok(pool) => pool,
        Err(sqlx::Error::Protocol(msg)) => {
            tracing::error!(
                target = "arklowdun",
                event = "integrity_check_failed",
                pragma_msg = %msg
            );
            let open_backup = app
                .dialog()
                .message("Database integrity check failed. Restore from the latest backup.")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Open Backup Folder".to_string(),
                    "Quit".to_string(),
                ))
                .blocking_show();
            if open_backup {
                // Open the app's data directory (where backups live) with the default file manager.
                let _ = app.opener().open_path(&app_dir, None);
            }
            std::process::exit(1);
        }
        Err(e) => return Err(e.into()),
    };

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

pub async fn with_transaction<F, Fut, T>(pool: &Pool<Sqlite>, f: F) -> Result<T>
where
    F: FnOnce(&mut Transaction<'_, Sqlite>) -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    let mut tx = pool.begin().await?;
    match f(&mut tx).await {
        Ok(v) => {
            tx.commit().await?;
            Ok(v)
        }
        Err(e) => {
            tx.rollback().await?;
            Err(e)
        }
    }
}
