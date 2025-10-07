#![allow(clippy::unwrap_used, clippy::expect_used)]

use arklowdun_lib::vault::Vault;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::fs;
use tempfile::TempDir;

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

pub fn temp_vault() -> (TempDir, Vault) {
    let dir = TempDir::new().expect("create temp vault dir");
    let base = dir.path().join("vault");
    fs::create_dir_all(&base).expect("create vault base dir");
    (dir, Vault::new(&base))
}
