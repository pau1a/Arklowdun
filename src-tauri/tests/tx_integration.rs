use anyhow::Result;
use arklowdun_lib::db::with_tx;

#[path = "util.rs"]
mod util;

use sqlx::{Executor, SqlitePool};

async fn setup_schema(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE inventory_items (
            id INTEGER PRIMARY KEY,
            name TEXT
        );",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE orders (
            id INTEGER PRIMARY KEY,
            number TEXT UNIQUE
        );",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE order_items (
            order_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            PRIMARY KEY(order_id, item_id),
            FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY(item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
        );",
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[tokio::test]
async fn commit_across_domains() -> Result<()> {
    let pool = util::temp_pool().await;
    setup_schema(&pool).await?;

    with_tx(&pool, |tx| {
        Box::pin(async move {
            tx.execute(sqlx::query(
                "INSERT INTO inventory_items (id, name) VALUES (1, 'widget')",
            ))
            .await?;
            tx.execute(sqlx::query(
                "INSERT INTO orders (id, number) VALUES (1, 'ORD-001')",
            ))
            .await?;
            tx.execute(sqlx::query(
                "INSERT INTO order_items (order_id, item_id) VALUES (1, 1)",
            ))
            .await?;
            Ok(())
        })
    })
    .await?;

    let item_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inventory_items")
        .fetch_one(&pool)
        .await?;
    let order_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders")
        .fetch_one(&pool)
        .await?;
    let line_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM order_items")
        .fetch_one(&pool)
        .await?;
    assert_eq!((item_count, order_count, line_count), (1, 1, 1));
    Ok(())
}

#[tokio::test]
async fn rollback_on_mid_sequence_failure() -> Result<()> {
    let pool = util::temp_pool().await;
    setup_schema(&pool).await?;

    let res = with_tx(&pool, |tx| {
        Box::pin(async move {
            tx.execute(sqlx::query(
                "INSERT INTO inventory_items (id, name) VALUES (1, 'widget')",
            ))
            .await?;
            tx.execute(sqlx::query(
                "INSERT INTO orders (id, number) VALUES (1, 'ORD-001')",
            ))
            .await?;
            tx.execute(sqlx::query(
                "INSERT INTO orders (id, number) VALUES (2, 'ORD-001')",
            ))
            .await?;
            Ok(())
        })
    })
    .await;
    assert!(res.is_err());

    let item_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inventory_items")
        .fetch_one(&pool)
        .await?;
    let order_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders")
        .fetch_one(&pool)
        .await?;
    let line_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM order_items")
        .fetch_one(&pool)
        .await?;
    assert_eq!((item_count, order_count, line_count), (0, 0, 0));
    Ok(())
}

async fn run_idempotent(pool: &SqlitePool) -> Result<()> {
    with_tx(pool, |tx| {
        Box::pin(async move {
            tx.execute(sqlx::query(
                "INSERT OR IGNORE INTO inventory_items (id, name) VALUES (1, 'widget')",
            ))
            .await?;
            tx.execute(sqlx::query(
                "INSERT OR IGNORE INTO orders (id, number) VALUES (1, 'ORD-001')",
            ))
            .await?;
            tx.execute(sqlx::query(
                "INSERT INTO order_items (order_id, item_id) VALUES (1, 1)",
            ))
            .await?;
            Ok(())
        })
    })
    .await
}

#[tokio::test]
async fn idempotent_retry_scenario() -> Result<()> {
    let pool = util::temp_pool().await;
    setup_schema(&pool).await?;

    run_idempotent(&pool).await?;
    let before: (i64, i64, i64) = (
        sqlx::query_scalar("SELECT COUNT(*) FROM inventory_items")
            .fetch_one(&pool)
            .await?,
        sqlx::query_scalar("SELECT COUNT(*) FROM orders")
            .fetch_one(&pool)
            .await?,
        sqlx::query_scalar("SELECT COUNT(*) FROM order_items")
            .fetch_one(&pool)
            .await?,
    );

    // Second attempt: deterministic insert into order_items triggers a PK violation.
    // Full idempotent retry would need UPSERTs for every table involved.
    let res = run_idempotent(&pool).await;
    assert!(res.is_err());

    let after: (i64, i64, i64) = (
        sqlx::query_scalar("SELECT COUNT(*) FROM inventory_items")
            .fetch_one(&pool)
            .await?,
        sqlx::query_scalar("SELECT COUNT(*) FROM orders")
            .fetch_one(&pool)
            .await?,
        sqlx::query_scalar("SELECT COUNT(*) FROM order_items")
            .fetch_one(&pool)
            .await?,
    );
    assert_eq!(before, after);
    Ok(())
}
