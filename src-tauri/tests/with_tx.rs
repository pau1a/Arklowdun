use anyhow::Result;
use arklowdun_lib::db::with_tx;

#[path = "util.rs"]
mod util;

use sqlx::{Executor, Sqlite, Transaction};

async fn insert_ok<'a>(tx: &'a mut Transaction<'a, Sqlite>) -> Result<()> {
    tx.execute(sqlx::query("INSERT INTO t (val) VALUES ('ok');"))
        .await?;
    Ok(())
}

async fn insert_dup<'a>(tx: &'a mut Transaction<'a, Sqlite>) -> Result<()> {
    tx.execute(sqlx::query("INSERT INTO t (val) VALUES ('dup');"))
        .await?;
    tx.execute(sqlx::query("INSERT INTO t (val) VALUES ('dup');"))
        .await?;
    Ok(())
}

async fn insert_then_panic<'a>(tx: &'a mut Transaction<'a, Sqlite>) -> Result<()> {
    tx.execute(sqlx::query("INSERT INTO t (val) VALUES ('p');"))
        .await
        .unwrap();
    panic!("boom");
    #[allow(unreachable_code)]
    Ok(())
}

#[tokio::test]
async fn commit_happy_path() -> Result<()> {
    let pool = util::temp_pool().await;
    sqlx::query("CREATE TABLE t (val TEXT UNIQUE);")
        .execute(&pool)
        .await?;

    with_tx(&pool, |tx| Box::pin(insert_ok(tx))).await?;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM t;")
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 1);
    Ok(())
}

#[tokio::test]
async fn rollback_on_unique_violation() -> Result<()> {
    let pool = util::temp_pool().await;
    sqlx::query("CREATE TABLE t (val TEXT UNIQUE);")
        .execute(&pool)
        .await?;

    let res = with_tx(&pool, |tx| Box::pin(insert_dup(tx))).await;

    assert!(res.is_err());
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM t;")
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 0);
    Ok(())
}

#[tokio::test]
async fn rollback_on_panic() -> Result<()> {
    let pool = util::temp_pool().await;
    sqlx::query("CREATE TABLE t (val TEXT UNIQUE);")
        .execute(&pool)
        .await?;

    // Spawn a task that panics inside the transaction
    let pool2 = pool.clone();
    let j = tokio::spawn(async move {
        let _ = with_tx(&pool2, |tx| Box::pin(insert_then_panic(tx))).await;
    });

    let join_err = j.await.unwrap_err();
    assert!(join_err.is_panic());

    // Ensure the write was rolled back
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM t;")
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 0);
    Ok(())
}
