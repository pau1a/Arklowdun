use anyhow::Result as AnyResult;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Pool, Sqlite, Transaction};
use std::future::Future;
use std::str::FromStr;
use tauri::{AppHandle, Manager};

pub async fn open_sqlite_pool(app: &AppHandle) -> AnyResult<Pool<Sqlite>> {
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
        .synchronous(SqliteSynchronous::Full);

    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA foreign_keys=ON;")
                    .execute(&mut *conn)
                    .await?;
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

/// Run work inside a transaction. Commits on success, rolls back on error.
pub async fn run_in_tx<R, E, F, Fut>(pool: &Pool<Sqlite>, f: F) -> Result<R, E>
where
    E: From<sqlx::Error>,
    F: for<'c> FnOnce(&'c mut Transaction<'c, Sqlite>) -> Fut,
    Fut: Future<Output = Result<R, E>>,
{
    use tracing::{error, info, warn};

    let mut tx = pool.begin().await.map_err(E::from)?;
    info!(target = "arklowdun", event = "db_tx_begin");
    match f(&mut tx).await {
        Ok(val) => {
            tx.commit().await.map_err(E::from)?;
            info!(target = "arklowdun", event = "db_tx_commit");
            Ok(val)
        }
        Err(e) => {
            if let Err(rb) = tx.rollback().await {
                error!(target = "arklowdun", event = "db_tx_rollback_failed", error = %rb);
            } else {
                warn!(target = "arklowdun", event = "db_tx_rollback");
            }
            Err(e)
        }
    }
}

/// Save a note within a transaction.
pub async fn save_note(
    pool: &Pool<Sqlite>,
    id: &str,
    body: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    // hi
    sqlx::query("INSERT INTO notes (id, body) VALUES (?, ?)")
        .bind(id)
        .bind(body)
        .execute(&mut tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Update an item inside a transaction.
pub async fn update_item(
    pool: &Pool<Sqlite>,
    id: &str,
    name: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE items SET name = ? WHERE id = ?")
        .bind(name)
        .bind(id)
        .execute(&mut tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Try inserting the same note twice; the second insert fails and the
/// transaction should roll back.
pub async fn save_note_twice_fail(pool: &Pool<Sqlite>, id: &str) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO notes (id, body) VALUES (?, 'first')")
        .bind(id)
        .execute(&mut tx)
        .await?;
    sqlx::query("INSERT INTO notes (id, body) VALUES (?, 'second')")
        .bind(id)
        .execute(&mut tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
