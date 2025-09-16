#![allow(clippy::unwrap_used, clippy::expect_used)]

use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

pub async fn temp_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("connect sqlite::memory:");
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await
        .unwrap();
    pool
}
