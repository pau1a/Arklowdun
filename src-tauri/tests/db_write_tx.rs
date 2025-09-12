use anyhow::Result;
use sqlx::sqlite::SqlitePoolOptions;
use tempfile::tempdir;

use arklowdun::db::{save_note, save_note_twice_fail};

#[tokio::test]
async fn save_note_commits() -> Result<()> {
    let dir = tempdir()?;
    let url = format!("sqlite://{}", dir.path().join("test.sqlite").display());
    let pool = SqlitePoolOptions::new().max_connections(1).connect(&url).await?;
    sqlx::query("PRAGMA foreign_keys=ON;").execute(&pool).await?;
    sqlx::query("CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
        .execute(&pool)
        .await?;

    save_note(&pool, "n1", "hello").await?;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notes")
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 1);
    Ok(())
}

#[tokio::test]
async fn save_note_rolls_back_on_error() -> Result<()> {
    let dir = tempdir()?;
    let url = format!("sqlite://{}", dir.path().join("test.sqlite").display());
    let pool = SqlitePoolOptions::new().max_connections(1).connect(&url).await?;
    sqlx::query("PRAGMA foreign_keys=ON;").execute(&pool).await?;
    sqlx::query("CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
        .execute(&pool)
        .await?;

    let res = save_note_twice_fail(&pool, "dup").await;
    assert!(res.is_err());

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notes")
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 0);
    Ok(())
}
