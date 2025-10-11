#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use anyhow::Result;
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageBuffer, ImageEncoder, Rgba};
use sqlx::SqlitePool;
use tauri::{App, Manager};
use tempfile::TempDir;
use tokio::time::sleep;

use arklowdun::{
    db, events_tz_backfill::BackfillCoordinator, files_indexer::FilesIndexer,
    household_active::StoreHandle, migrate, pets::metrics::PetAttachmentMetrics, vault::Vault,
    vault_migration::VaultMigrationManager, AppState, FilesExistsRequest, PetsDiagnosticsCounters,
    ThumbnailsGetOrCreateRequest,
};

fn make_household() -> &'static str {
    "hh-pets"
}

async fn build_state(dir: &TempDir) -> Result<(AppState, SqlitePool, PathBuf)> {
    let db_path = dir.path().join("pets_ipc.sqlite3");
    let pool = SqlitePool::connect(&format!("sqlite://{}", db_path.display())).await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;
    migrate::apply_migrations(&pool).await?;

    let attachments_root = dir.path().join("attachments");
    std::fs::create_dir_all(&attachments_root)?;

    let vault = Arc::new(Vault::new(&attachments_root));
    let files_indexer = Arc::new(FilesIndexer::new(pool.clone(), vault.clone()));
    let health = db::health::run_health_checks(&pool, &db_path).await?;

    let state = AppState {
        pool: Arc::new(RwLock::new(pool.clone())),
        active_household_id: Arc::new(Mutex::new(String::new())),
        store: StoreHandle::in_memory(),
        backfill: Arc::new(Mutex::new(BackfillCoordinator::new())),
        db_health: Arc::new(Mutex::new(health)),
        db_path: Arc::new(db_path.clone()),
        vault,
        vault_migration: Arc::new(VaultMigrationManager::new(&attachments_root)?),
        maintenance: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        files_indexer,
        pet_metrics: Arc::new(PetAttachmentMetrics::new()),
    };

    Ok((state, pool, attachments_root))
}

fn build_app(state: AppState) -> App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build tauri app")
}

fn make_writer(buffer: Arc<Mutex<Vec<u8>>>) -> impl tracing_subscriber::fmt::MakeWriter<'static> {
    struct BufferWriter {
        buf: Arc<Mutex<Vec<u8>>>,
    }

    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for BufferWriter {
        type Writer = BufferGuard;

        fn make_writer(&'a self) -> Self::Writer {
            BufferGuard {
                buf: self.buf.clone(),
            }
        }
    }

    struct BufferGuard {
        buf: Arc<Mutex<Vec<u8>>>,
    }

    impl std::io::Write for BufferGuard {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            let mut guard = self.buf.lock().expect("buffer poisoned");
            guard.extend_from_slice(data);
            Ok(data.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    BufferWriter { buf: buffer }
}

fn read_buffer(buffer: &Arc<Mutex<Vec<u8>>>) -> String {
    let guard = buffer.lock().expect("buffer poisoned");
    String::from_utf8_lossy(&guard).to_string()
}

fn clear_buffer(buffer: &Arc<Mutex<Vec<u8>>>) {
    buffer.lock().expect("buffer poisoned").clear();
}

fn pet_medical_dir(root: &PathBuf) -> PathBuf {
    root.join(make_household()).join("pet_medical")
}

fn write_sample_png(path: &PathBuf, color: [u8; 4]) -> Result<()> {
    let dir = path.parent().expect("parent directory");
    std::fs::create_dir_all(dir)?;
    let image: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_pixel(16, 16, Rgba(color));
    let mut file = std::fs::File::create(path)?;
    PngEncoder::new(&mut file).write_image(
        image.as_raw(),
        image.width(),
        image.height(),
        ExtendedColorType::Rgba8,
    )?;
    file.flush()?;
    Ok(())
}

#[tokio::test]
async fn files_exists_reports_presence_and_missing() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, _pool, attachments_root) = build_state(&dir).await?;
    let app = build_app(state);

    let record_path = pet_medical_dir(&attachments_root).join("scan.png");
    write_sample_png(&record_path, [255, 0, 0, 255])?;

    let exists = arklowdun::files_exists_command(
        app.state(),
        FilesExistsRequest {
            household_id: make_household().into(),
            category: "pet_medical".into(),
            relative_path: "scan.png".into(),
        },
    )
    .await?;
    assert!(exists.exists, "expected files_exists to return true");

    std::fs::remove_file(&record_path)?;

    let missing = arklowdun::files_exists_command(
        app.state(),
        FilesExistsRequest {
            household_id: make_household().into(),
            category: "pet_medical".into(),
            relative_path: "scan.png".into(),
        },
    )
    .await?;
    assert!(!missing.exists, "expected files_exists to return false");

    Ok(())
}

#[tokio::test]
async fn thumbnails_build_cache_and_regenerate() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, _pool, attachments_root) = build_state(&dir).await?;
    let app = build_app(state);

    let record_path = pet_medical_dir(&attachments_root).join("tooth.png");
    write_sample_png(&record_path, [0, 128, 255, 255])?;

    let buffer = Arc::new(Mutex::new(Vec::new()));
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_writer(make_writer(buffer.clone()))
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);

    let request = ThumbnailsGetOrCreateRequest {
        household_id: make_household().into(),
        category: "pet_medical".into(),
        relative_path: "tooth.png".into(),
        max_edge: 160,
    };

    let first = arklowdun::thumbnails_get_or_create_command(app.state(), request.clone()).await?;
    assert!(first.ok, "expected thumbnail build to succeed");
    let first_rel = first
        .relative_thumb_path
        .clone()
        .expect("thumbnail path present");
    assert!(first_rel.starts_with("attachments/"));
    assert_eq!(first.cache_hit, Some(false));
    assert!(first.width.unwrap_or(0) > 0, "width should be recorded");
    assert!(first.height.unwrap_or(0) > 0, "height should be recorded");
    let first_logs = read_buffer(&buffer);
    assert!(
        first_logs.contains("ui.pets.thumbnail_built"),
        "expected thumbnail_built log, got {first_logs}";
    );
    clear_buffer(&buffer);

    let cached = arklowdun::thumbnails_get_or_create_command(app.state(), request.clone()).await?;
    assert!(cached.ok, "cache hit should still be ok");
    assert_eq!(cached.cache_hit, Some(true));
    let cache_logs = read_buffer(&buffer);
    assert!(
        cache_logs.contains("ui.pets.thumbnail_cache_hit"),
        "expected thumbnail_cache_hit log, got {cache_logs}";
    );
    clear_buffer(&buffer);

    sleep(Duration::from_millis(1100)).await;
    write_sample_png(&record_path, [0, 255, 128, 255])?;

    let rebuilt = arklowdun::thumbnails_get_or_create_command(app.state(), request).await?;
    assert!(rebuilt.ok, "expected rebuild to succeed");
    assert_eq!(rebuilt.cache_hit, Some(false));
    let rebuild_logs = read_buffer(&buffer);
    assert!(
        rebuild_logs.contains("ui.pets.thumbnail_built"),
        "expected thumbnail_built after source change, got {rebuild_logs}";
    );

    let relative = rebuilt.relative_thumb_path.expect("thumbnail path present");
    let local_thumb = attachments_root.join(relative.trim_start_matches("attachments/"));
    assert!(local_thumb.exists(), "thumbnail cache file must exist");

    Ok(())
}

#[tokio::test]
async fn diagnostics_counters_track_metrics() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, pool, attachments_root) = build_state(&dir).await?;
    let app = build_app(state);

    sqlx::query(
        "INSERT INTO household (id, name, created_at, updated_at, deleted_at, tz, is_default, color) \
         VALUES (?1, ?2, 0, 0, NULL, 'UTC', 1, '#FFFFFF')",
    )
    .bind(make_household())
    .bind("Pets")
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO pets (id, name, type, household_id, created_at, updated_at, deleted_at, position) \
         VALUES (?1, ?2, ?3, ?4, 0, 0, NULL, 0)",
    )
    .bind("pet-1")
    .bind("Fido")
    .bind("dog")
    .bind(make_household())
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO pet_medical (id, pet_id, date, description, household_id, created_at, updated_at, relative_path, category) \
         VALUES (?1, ?2, 0, ?3, ?4, 0, 0, ?5, 'pet_medical')",
    )
    .bind("med-1")
    .bind("pet-1")
    .bind("Rabies shot")
    .bind(make_household())
    .bind("record.png")
    .execute(&pool)
    .await?;

    let pet_dir = pet_medical_dir(&attachments_root);
    std::fs::create_dir_all(&pet_dir)?;

    let make_exists_request = || FilesExistsRequest {
        household_id: make_household().into(),
        category: "pet_medical".into(),
        relative_path: "record.png".into(),
    };

    let missing = arklowdun::files_exists_command(app.state(), make_exists_request()).await?;
    assert!(
        !missing.exists,
        "expected initial probe to mark attachment missing"
    );

    let counters: PetsDiagnosticsCounters =
        arklowdun::pets_diagnostics_counters_command(app.state()).await?;
    assert_eq!(counters.pet_attachments_total, 1);
    assert_eq!(counters.pet_attachments_missing, 1);
    assert_eq!(counters.pet_thumbnails_built, 0);
    assert_eq!(counters.pet_thumbnails_cache_hits, 0);
    assert_eq!(counters.missing_attachments.len(), 1);

    let record_path = pet_medical_dir(&attachments_root).join("record.png");
    write_sample_png(&record_path, [16, 64, 160, 255])?;

    let present = arklowdun::files_exists_command(app.state(), make_exists_request()).await?;
    assert!(present.exists, "expected probe to succeed after file write");

    let fixed: PetsDiagnosticsCounters =
        arklowdun::pets_diagnostics_counters_command(app.state()).await?;
    assert_eq!(fixed.pet_attachments_missing, 0);

    let make_thumb_request = || ThumbnailsGetOrCreateRequest {
        household_id: make_household().into(),
        category: "pet_medical".into(),
        relative_path: "record.png".into(),
        max_edge: 160,
    };

    let built =
        arklowdun::thumbnails_get_or_create_command(app.state(), make_thumb_request()).await?;
    assert!(built.ok, "thumbnail build should succeed");

    let after_build: PetsDiagnosticsCounters =
        arklowdun::pets_diagnostics_counters_command(app.state()).await?;
    assert_eq!(after_build.pet_thumbnails_built, 1);
    assert_eq!(after_build.pet_thumbnails_cache_hits, 0);
    assert_eq!(after_build.pet_attachments_missing, 0);

    let cached =
        arklowdun::thumbnails_get_or_create_command(app.state(), make_thumb_request()).await?;
    assert!(cached.ok, "thumbnail cache fetch should succeed");

    let after_cache: PetsDiagnosticsCounters =
        arklowdun::pets_diagnostics_counters_command(app.state()).await?;
    assert_eq!(after_cache.pet_thumbnails_built, 1);
    assert_eq!(after_cache.pet_thumbnails_cache_hits, 1);
    assert_eq!(after_cache.pet_attachments_total, 1);
    assert!(after_cache.missing_attachments.is_empty());

    Ok(())
}

#[tokio::test]
async fn thumbnails_report_unsupported_format() -> Result<()> {
    let dir = TempDir::new()?;
    let (state, _pool, attachments_root) = build_state(&dir).await?;
    let app = build_app(state);

    let record_dir = pet_medical_dir(&attachments_root);
    std::fs::create_dir_all(&record_dir)?;
    let doc_path = record_dir.join("notes.txt");
    std::fs::write(&doc_path, b"not an image")?;

    let response = arklowdun::thumbnails_get_or_create_command(
        app.state(),
        ThumbnailsGetOrCreateRequest {
            household_id: make_household().into(),
            category: "pet_medical".into(),
            relative_path: "notes.txt".into(),
            max_edge: 160,
        },
    )
    .await?;

    assert!(!response.ok, "non-image should not produce thumbnail");
    assert_eq!(response.code.as_deref(), Some("UNSUPPORTED"));
    assert!(response.relative_thumb_path.is_none());

    Ok(())
}
