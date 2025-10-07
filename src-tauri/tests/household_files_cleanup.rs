use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::Result;
use arklowdun_lib::{
    create_household, delete_household, pending_cascades, resume_household_delete,
    CascadeDeleteOptions, CascadeProgress, CascadeProgressObserver, HouseholdCrudError,
};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use walkdir::WalkDir;

#[path = "util.rs"]
mod util;

async fn memory_pool() -> Result<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;
    arklowdun_lib::migrate::apply_migrations(&pool).await?;
    Ok(pool)
}

fn populate_sample_tree(base: &Path) -> Result<()> {
    fs::create_dir_all(base.join("docs/nested"))?;
    fs::write(base.join("root.txt"), b"root")?;
    fs::write(base.join("docs/doc1.txt"), b"doc")?;
    fs::write(base.join("docs/nested/deep.txt"), b"deep")?;
    Ok(())
}

fn count_cleanup_entries(base: &Path) -> usize {
    if !base.exists() {
        return 0;
    }
    let mut entries: Vec<PathBuf> = Vec::new();
    for item in WalkDir::new(base).contents_first(true) {
        if let Ok(entry) = item {
            entries.push(entry.into_path());
        }
    }
    if !entries.iter().any(|path| path == base) {
        entries.push(base.to_path_buf());
    }
    entries.len()
}

#[tokio::test]
async fn filesystem_cleanup_removes_household_directory() -> Result<()> {
    let pool = memory_pool().await?;
    let (_vault_guard, vault) = util::temp_vault();
    let household = create_household(&pool, "Files", None).await?;
    let household_dir = vault.base().join(&household.id);
    populate_sample_tree(&household_dir)?;

    let outcome = delete_household(
        &pool,
        &vault,
        &household.id,
        None,
        CascadeDeleteOptions::default(),
    )
    .await?;
    assert!(outcome.completed);
    assert!(!household_dir.exists());
    assert!(pending_cascades(&pool).await?.is_empty());
    Ok(())
}

#[tokio::test]
async fn cascade_progress_uses_step_indices() -> Result<()> {
    let pool = memory_pool().await?;
    let (_vault_guard, vault) = util::temp_vault();
    let household = create_household(&pool, "Progress", None).await?;
    let household_dir = vault.base().join(&household.id);
    populate_sample_tree(&household_dir)?;

    sqlx::query(
        "INSERT INTO notes (id, household_id, position, created_at, updated_at, text, color, x, y)\
         VALUES (?1, ?2, 0, 0, 0, 'note', '#fff', 0, 0)",
    )
    .bind("note-1")
    .bind(&household.id)
    .execute(&pool)
    .await?;

    let records: Arc<Mutex<Vec<CascadeProgress>>> = Arc::new(Mutex::new(Vec::new()));
    let observer_records = records.clone();
    let observer: CascadeProgressObserver = Arc::new(move |progress: CascadeProgress| {
        observer_records.lock().unwrap().push(progress);
    });

    let mut options = CascadeDeleteOptions::default();
    options.progress = Some(observer);

    let outcome = delete_household(&pool, &vault, &household.id, None, options).await?;
    assert!(outcome.completed);

    let captured = records.lock().unwrap();
    assert!(captured.iter().any(|p| p.phase == "files_cleanup"));
    let db_indices: HashSet<usize> = captured
        .iter()
        .filter(|p| p.phase != "household" && p.phase != "files_cleanup" && p.phase != "paused")
        .map(|p| p.phase_index)
        .collect();
    if !db_indices.is_empty() {
        assert_eq!(db_indices, HashSet::from([1]));
    }
    for event in captured.iter().filter(|p| p.phase == "household") {
        assert_eq!(event.phase_index, 2);
        assert_eq!(event.phase_total, 3);
    }
    for event in captured.iter().filter(|p| p.phase == "files_cleanup") {
        assert_eq!(event.phase_index, 3);
        assert_eq!(event.phase_total, 3);
    }
    Ok(())
}

#[tokio::test]
async fn cascade_resume_updates_remaining_paths() -> Result<()> {
    let pool = memory_pool().await?;
    let (_vault_guard, vault) = util::temp_vault();
    let household = create_household(&pool, "Resume", None).await?;
    let household_dir = vault.base().join(&household.id);
    populate_sample_tree(&household_dir)?;
    let initial_entries = count_cleanup_entries(&household_dir);

    let cancel_flag = Arc::new(AtomicBool::new(false));
    let observer_flag = cancel_flag.clone();
    let observer: CascadeProgressObserver = Arc::new(move |progress: CascadeProgress| {
        if progress.phase == "files_cleanup" {
            let fs_deleted = progress.deleted.saturating_sub(1);
            if fs_deleted >= 2 {
                observer_flag.store(true, Ordering::Relaxed);
            }
        }
    });

    let mut options = CascadeDeleteOptions::default();
    options.progress = Some(observer);
    options.cancel_flag = Some(cancel_flag);

    let outcome = delete_household(&pool, &vault, &household.id, None, options).await?;
    assert!(!outcome.completed);

    let remaining_paths: i64 = sqlx::query_scalar(
        "SELECT remaining_paths FROM cascade_checkpoints WHERE household_id = ?1",
    )
    .bind(&household.id)
    .fetch_one(&pool)
    .await?;
    assert!(remaining_paths > 0);
    assert!(remaining_paths < initial_entries as i64);

    let resumed = resume_household_delete(
        &pool,
        &vault,
        &household.id,
        None,
        CascadeDeleteOptions::default(),
    )
    .await?;
    assert!(resumed.completed);
    assert!(pending_cascades(&pool).await?.is_empty());
    assert!(!household_dir.exists());
    Ok(())
}

#[tokio::test]
async fn filesystem_guard_blocks_when_db_not_empty() -> Result<()> {
    let pool = memory_pool().await?;
    let (_vault_guard, vault) = util::temp_vault();
    let household = create_household(&pool, "Guard", None).await?;
    let household_dir = vault.base().join(&household.id);
    populate_sample_tree(&household_dir)?;

    let cancel_flag = Arc::new(AtomicBool::new(false));
    let observer_flag = cancel_flag.clone();
    let observer: CascadeProgressObserver = Arc::new(move |progress: CascadeProgress| {
        if progress.phase == "household" {
            observer_flag.store(true, Ordering::Relaxed);
        }
    });
    let mut options = CascadeDeleteOptions::default();
    options.progress = Some(observer);
    options.cancel_flag = Some(cancel_flag);

    let outcome = delete_household(&pool, &vault, &household.id, None, options).await?;
    assert!(!outcome.completed);

    sqlx::query(
        "INSERT INTO household (id, name, created_at, updated_at, deleted_at, tz, is_default, color)\
         VALUES (?1, 'Reborn', 0, 0, NULL, NULL, 0, NULL)",
    )
    .bind(&household.id)
    .execute(&pool)
    .await?;

    let err = resume_household_delete(
        &pool,
        &vault,
        &household.id,
        None,
        CascadeDeleteOptions::default(),
    )
    .await
    .expect_err("db guard should reject resume");
    assert!(matches!(err, HouseholdCrudError::CascadeDbNotEmpty));
    Ok(())
}

#[tokio::test]
async fn symlink_entries_are_logged_but_not_followed() -> Result<()> {
    let pool = memory_pool().await?;
    let (_vault_guard, vault) = util::temp_vault();
    let household = create_household(&pool, "Symlink", None).await?;
    let household_dir = vault.base().join(&household.id);
    populate_sample_tree(&household_dir)?;

    let target = household_dir.parent().unwrap().join("external.txt");
    fs::write(&target, b"external")?;
    let link = household_dir.join("docs/link.txt");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target, &link)?;
    #[cfg(windows)]
    std::os::windows::fs::symlink_file(&target, &link)?;

    let outcome = delete_household(
        &pool,
        &vault,
        &household.id,
        None,
        CascadeDeleteOptions::default(),
    )
    .await?;
    assert!(outcome.completed);
    assert!(!household_dir.exists());
    assert!(target.exists());
    Ok(())
}

#[tokio::test]
async fn permission_errors_retry_and_resume() -> Result<()> {
    let pool = memory_pool().await?;
    let (_vault_guard, vault) = util::temp_vault();
    let household = create_household(&pool, "Permissions", None).await?;
    let household_dir = vault.base().join(&household.id);
    populate_sample_tree(&household_dir)?;

    let mut perms = fs::metadata(&household_dir)?.permissions();
    perms.set_readonly(true);
    fs::set_permissions(&household_dir, perms.clone())?;

    let outcome = delete_household(
        &pool,
        &vault,
        &household.id,
        None,
        CascadeDeleteOptions::default(),
    )
    .await?;
    assert!(!outcome.completed);

    let mut writable = perms;
    writable.set_readonly(false);
    fs::set_permissions(&household_dir, writable)?;

    let resumed = resume_household_delete(
        &pool,
        &vault,
        &household.id,
        None,
        CascadeDeleteOptions::default(),
    )
    .await?;
    assert!(resumed.completed);
    assert!(pending_cascades(&pool).await?.is_empty());
    assert!(!household_dir.exists());
    Ok(())
}
