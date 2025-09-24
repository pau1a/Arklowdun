use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use arklowdun_lib::db::backup;
use arklowdun_lib::db::manifest::{file_sha256, read_manifest, BackupManifest};
use assert_cmd::Command;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{ConnectOptions, Connection};
use tempfile::tempdir;

async fn prepare_database(db_path: &Path) -> Result<()> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut conn = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true)
        .connect()
        .await?;

    sqlx::query("CREATE TABLE IF NOT EXISTS sample(id INTEGER PRIMARY KEY, value TEXT);")
        .execute(&mut conn)
        .await?;
    sqlx::query("INSERT INTO sample(value) VALUES ('abc');")
        .execute(&mut conn)
        .await?;

    conn.close().await?;
    Ok(())
}

fn list_backup_dirs(root: &Path) -> Result<Vec<PathBuf>> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut dirs = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if entry.path().is_dir() {
            dirs.push(entry.path());
        }
    }
    dirs.sort();
    Ok(dirs)
}

#[tokio::test]
async fn backup_cli_produces_manifest() -> Result<()> {
    let tmp = tempdir()?;
    let appdata = tmp.path().join("appdata");
    let db_path = appdata.join("arklowdun.sqlite3");

    prepare_database(&db_path).await?;

    let output = Command::cargo_bin("arklowdun")?
        .env("ARK_FAKE_APPDATA", &appdata)
        .args(["db", "backup"])
        .output()?;

    assert!(
        output.status.success(),
        "backup failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines: Vec<&str> = stdout.lines().collect();
    assert!(
        lines
            .last()
            .map(|line| line.starts_with("Backup stored at"))
            .unwrap_or(false),
        "unexpected stdout: {stdout}"
    );
    let location = lines.pop().unwrap();
    let location_path = location.trim_start_matches("Backup stored at ").trim();
    let manifest_json = lines.join("\n");
    let manifest: BackupManifest =
        serde_json::from_str(&manifest_json).context("parse manifest json from stdout")?;
    assert_eq!(manifest.app_version, env!("CARGO_PKG_VERSION"));
    assert!(manifest.db_size_bytes > 0);

    let backup_root = appdata.join("backups");
    let dirs = list_backup_dirs(&backup_root)?;
    assert_eq!(dirs.len(), 1);
    let backup_dir = &dirs[0];
    let sqlite_path = backup_dir.join("arklowdun.sqlite3");
    assert_eq!(sqlite_path.to_string_lossy(), location_path);
    assert!(sqlite_path.exists());

    let manifest_path = backup_dir.join("manifest.json");
    let on_disk_manifest = read_manifest(&manifest_path)?;
    assert_eq!(manifest.sha256, on_disk_manifest.sha256);

    let hash = file_sha256(&sqlite_path)?;
    assert_eq!(hash, manifest.sha256);

    Ok(())
}

#[tokio::test]
async fn backup_cli_json_flag_outputs_entry() -> Result<()> {
    let tmp = tempdir()?;
    let appdata = tmp.path().join("appdata");
    let db_path = appdata.join("arklowdun.sqlite3");

    prepare_database(&db_path).await?;

    let output = Command::cargo_bin("arklowdun")?
        .env("ARK_FAKE_APPDATA", &appdata)
        .args(["db", "backup", "--json"])
        .output()?;

    assert!(
        output.status.success(),
        "backup failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout)?;
    let payload: serde_json::Value = serde_json::from_str(stdout.trim())?;
    let entry = payload.get("entry").context("missing entry payload")?;

    assert_eq!(
        payload.get("path").and_then(|value| value.as_str()),
        entry.get("sqlitePath").and_then(|value| value.as_str())
    );
    assert!(
        entry.get("manifest").is_some(),
        "manifest missing in payload"
    );

    Ok(())
}

#[tokio::test]
async fn backup_cli_respects_low_disk() -> Result<()> {
    let tmp = tempdir()?;
    let appdata = tmp.path().join("appdata");
    let db_path = appdata.join("arklowdun.sqlite3");

    prepare_database(&db_path).await?;

    let output = Command::cargo_bin("arklowdun")?
        .env("ARK_FAKE_APPDATA", &appdata)
        .env("ARK_BACKUP_FAKE_FREE_BYTES", "1024")
        .args(["db", "backup"])
        .output()?;

    assert!(!output.status.success(), "expected backup to fail");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("Not enough disk space"), "stderr: {stderr}");
    Ok(())
}

#[tokio::test]
async fn backup_cli_handles_unicode_paths() -> Result<()> {
    let tmp = tempdir()?;
    let appdata = tmp
        .path()
        .join("用户-备份-长路径测试-abcdefghijklmnopqrstuvwx");
    let db_path = appdata.join("arklowdun.sqlite3");

    prepare_database(&db_path).await?;

    let output = Command::cargo_bin("arklowdun")?
        .env("ARK_FAKE_APPDATA", &appdata)
        .args(["db", "backup"])
        .output()?;
    assert!(
        output.status.success(),
        "backup failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let backup_root = appdata.join("backups");
    let dirs = list_backup_dirs(&backup_root)?;
    assert_eq!(dirs.len(), 1);
    Ok(())
}

#[tokio::test]
async fn backup_succeeds_while_db_locked() -> Result<()> {
    let tmp = tempdir()?;
    let db_path = tmp.path().join("arklowdun.sqlite3");
    prepare_database(&db_path).await?;

    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect(&format!("sqlite://{}", db_path.display()))
        .await?;

    let mut locker = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true)
        .connect()
        .await?;

    sqlx::query("BEGIN IMMEDIATE;")
        .execute(&mut locker)
        .await?;
    sqlx::query("INSERT INTO sample(value) VALUES ('locked');")
        .execute(&mut locker)
        .await?;

    let entry = backup::create_backup(&pool, &db_path).await?;
    assert!(entry.total_size_bytes > 0);

    sqlx::query("COMMIT;").execute(&mut locker).await?;

    locker.close().await?;
    pool.close().await;
    Ok(())
}

#[tokio::test]
async fn backup_retention_prunes_old_snapshots() -> Result<()> {
    let tmp = tempdir()?;
    let appdata = tmp.path().join("appdata");
    let db_path = appdata.join("arklowdun.sqlite3");
    prepare_database(&db_path).await?;

    for _ in 0..3 {
        let output = Command::cargo_bin("arklowdun")?
            .env("ARK_FAKE_APPDATA", &appdata)
            .env("ARK_BACKUP_MAX_COUNT", "2")
            .args(["db", "backup"])
            .output()?;
        assert!(
            output.status.success(),
            "backup failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let dirs = list_backup_dirs(&appdata.join("backups"))?;
    assert_eq!(dirs.len(), 2, "expected retention to prune older backups");
    Ok(())
}
