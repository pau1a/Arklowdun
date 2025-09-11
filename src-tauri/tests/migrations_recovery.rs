use arklowdun::{db, migrate};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

#[tokio::test]
async fn applies_all_migrations() {
    let pool: SqlitePool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    migrate::apply_migrations(&pool).await.unwrap();
    let (exists,): (i64,) =
        sqlx::query_as("SELECT 1 FROM sqlite_master WHERE type='table' AND name='files_index'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(exists, 1);
}

#[tokio::test]
async fn reapplying_is_noop() {
    let pool: SqlitePool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    migrate::apply_migrations(&pool).await.unwrap();
    let (count1,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM schema_migrations")
        .fetch_one(&pool)
        .await
        .unwrap();
    migrate::apply_migrations(&pool).await.unwrap();
    let (count2,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM schema_migrations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count1, count2);
}

#[tokio::test]
async fn checksum_drift_errors() {
    let pool: SqlitePool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    migrate::apply_migrations(&pool).await.unwrap();
    sqlx::query("UPDATE schema_migrations SET checksum = 'bad' WHERE version = ?")
        .bind("202509012006_household.sql")
        .execute(&pool)
        .await
        .unwrap();
    let err = migrate::apply_migrations(&pool).await.unwrap_err();
    assert!(err.to_string().contains("edited"));
}

#[tokio::test]
async fn transaction_rolls_back_on_error() {
    let pool: SqlitePool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    db::with_transaction(&pool, |tx| {
        async move {
            sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)")
                .execute(&mut *tx)
                .await
                .unwrap();
            sqlx::query("INSERT INTO t (id, v) VALUES (1, 10)")
                .execute(&mut *tx)
                .await
                .unwrap();
            anyhow::bail!("boom");
            #[allow(unreachable_code)]
            Ok(())
        }
    })
    .await
    .unwrap_err();
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM t")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}
