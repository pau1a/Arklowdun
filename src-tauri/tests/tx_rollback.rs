use anyhow::Result;
use sqlx::{sqlite::SqlitePoolOptions, Row};
use tempfile::tempdir;

use arklowdun_lib::db::run_in_tx;
use futures::FutureExt;

#[tokio::test]
async fn tx_rolls_back_on_error() -> Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("tx.sqlite");
    let url = format!("sqlite://{}", db_path.display());
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA foreign_keys=ON;")
                    .execute(conn)
                    .await?;
                Ok(())
            })
        })
        .connect(&url)
        .await?;

    sqlx::query("CREATE TABLE parents (id TEXT PRIMARY KEY)")
        .execute(&pool)
        .await?;
    sqlx::query(
        "CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents(id))",
    )
    .execute(&pool)
    .await?;
    sqlx::query("INSERT INTO parents (id) VALUES ('p1')")
        .execute(&pool)
        .await?;

    let res = run_in_tx(&pool, |tx| {
        async move {
        sqlx::query("INSERT INTO children (id, parent_id) VALUES ('c1','p1')")
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO children (id, parent_id) VALUES ('c2','nope')")
            .execute(&mut *tx)
            .await?;
        Ok::<_, sqlx::Error>(())
        }
        .boxed()
    })
    .await;

    assert!(res.is_err());
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM children")
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 0);
    Ok(())
}

#[tokio::test]
async fn tx_commits_on_success() -> Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("tx.sqlite");
    let url = format!("sqlite://{}", db_path.display());
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA foreign_keys=ON;")
                    .execute(conn)
                    .await?;
                Ok(())
            })
        })
        .connect(&url)
        .await?;

    sqlx::query("CREATE TABLE parents (id TEXT PRIMARY KEY)")
        .execute(&pool)
        .await?;
    sqlx::query(
        "CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents(id))",
    )
    .execute(&pool)
    .await?;
    sqlx::query("INSERT INTO parents (id) VALUES ('p1')")
        .execute(&pool)
        .await?;

    run_in_tx(&pool, |tx| {
        async move {
        sqlx::query("INSERT INTO children (id, parent_id) VALUES ('c-ok','p1')")
            .execute(&mut *tx)
            .await?;
        Ok::<_, sqlx::Error>(())
        }
        .boxed()
    })
    .await?;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM children")
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 1);
    Ok(())
}
