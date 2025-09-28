use sqlx::sqlite::SqlitePoolOptions;
use std::process::Command;
use tempfile::tempdir;

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_migrate")
}

#[tokio::test]
async fn list_and_status_empty_db() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let db = dir.path().join("empty.sqlite");
    let output = Command::new(bin())
        .args(["--db", db.to_str().unwrap(), "list"])
        .output()?;
    assert!(output.status.success());
    assert!(!db.exists());

    let output = Command::new(bin())
        .args(["--db", db.to_str().unwrap(), "status"])
        .output()?;
    assert!(output.status.success());
    assert!(!db.exists());
    Ok(())
}

#[tokio::test]
async fn up_and_down_roundtrip() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let db = dir.path().join("mig.sqlite");
    let db_arg = db.to_str().unwrap();

    let status = Command::new(bin())
        .args(["--db", db_arg, "up", "--to", "0001"])
        .status()?;
    assert!(status.success());

    {
        let url = format!("sqlite://{}", db.display());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await?;
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schema_migrations")
            .fetch_one(&pool)
            .await?;
        assert_eq!(count, 1);
    }

    let status = Command::new(bin())
        .env("ARKLOWDUN_ALLOW_DOWN", "1")
        .args(["--db", db_arg, "down"])
        .status()?;
    assert!(!status.success());

    Ok(())
}
