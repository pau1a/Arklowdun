use anyhow::Result;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Pool, Sqlite};
use std::str::FromStr;
use tauri::AppHandle;

pub async fn open_sqlite_pool(app: &AppHandle) -> Result<Pool<Sqlite>> {
    let app_dir =
        tauri::api::path::app_data_dir(&app.config()).unwrap_or_else(|| std::env::temp_dir());
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
                    .execute(conn)
                    .await?;
                sqlx::query("PRAGMA wal_autocheckpoint = 1000;")
                    .execute(conn)
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

    if jm.0.to_ascii_lowercase() != "wal" {
        warn!(
            target = "arklowdun",
            event = "db_open_warning",
            msg = "journal_mode != WAL; running with reduced crash safety"
        );
    }
}
