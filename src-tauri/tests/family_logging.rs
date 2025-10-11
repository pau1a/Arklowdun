#![allow(clippy::unwrap_used)]

use std::fs;
use std::sync::{Arc, Mutex as StdMutex};

use serde_json::{Map, Value};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use tempfile::TempDir;
use tracing::subscriber::{self, DefaultGuard};
use tracing_subscriber::{fmt, EnvFilter};

use arklowdun_lib::{
    commands,
    db::health::{DbHealthReport, DbHealthStatus},
    events_tz_backfill::BackfillCoordinator,
    family_logging::LogScope,
    files_indexer::FilesIndexer,
    household_active::StoreHandle,
    ipc::guard,
    migrate,
    pets::metrics::PetAttachmentMetrics,
    vault::Vault,
    vault_migration::VaultMigrationManager,
    AppState,
};

struct BufferWriter(Arc<StdMutex<Vec<u8>>>);

impl std::io::Write for BufferWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn init_buffer_subscriber() -> (Arc<StdMutex<Vec<u8>>>, DefaultGuard) {
    let buffer: Arc<StdMutex<Vec<u8>>> = Arc::new(StdMutex::new(Vec::new()));
    let writer = buffer.clone();
    let subscriber = fmt()
        .with_env_filter(EnvFilter::new("arklowdun=debug"))
        .with_writer(move || BufferWriter(writer.clone()))
        .json()
        .finish();
    let guard = subscriber::set_default(subscriber);
    (buffer, guard)
}

fn logs_to_string(buffer: &Arc<StdMutex<Vec<u8>>>) -> String {
    String::from_utf8(buffer.lock().unwrap().clone()).expect("log utf8")
}

fn now_ms_local() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time went backwards")
        .as_millis() as i64
}

async fn seed_family_db() -> (TempDir, SqlitePool) {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("family_logging.sqlite3");
    let pool = SqlitePool::connect(&format!("sqlite://{}", db_path.display()))
        .await
        .expect("open sqlite pool");
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await
        .expect("enable fk");
    migrate::apply_migrations(&pool)
        .await
        .expect("apply migrations");

    sqlx::query(
        "INSERT INTO household (id, name, created_at, updated_at, deleted_at, tz, is_default, color) \
         VALUES (?1, 'Household', 0, 0, NULL, NULL, 1, NULL)",
    )
    .bind("hh-1")
    .execute(&pool)
    .await
    .expect("insert household");

    sqlx::query(
        "INSERT INTO family_members (id, name, household_id, created_at, updated_at, position) \
         VALUES (?1, 'Member', ?2, 0, 0, 0)",
    )
    .bind("mem-1")
    .bind("hh-1")
    .execute(&pool)
    .await
    .expect("insert member");

    (dir, pool)
}

fn unhealthy_state() -> (AppState, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let attachments_root = dir.path().join("attachments");
    fs::create_dir_all(&attachments_root).expect("create attachments root");

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_lazy("sqlite::memory:")
        .expect("create sqlite pool");

    let vault = Arc::new(Vault::new(&attachments_root));
    let files_indexer = Arc::new(FilesIndexer::new(pool.clone(), vault.clone()));
    let report = DbHealthReport {
        status: DbHealthStatus::Error,
        checks: Vec::new(),
        offenders: Vec::new(),
        schema_hash: "hash".into(),
        app_version: "test".into(),
        generated_at: "2024-01-01T00:00:00Z".into(),
    };

    let state = AppState {
        pool: Arc::new(std::sync::RwLock::new(pool.clone())),
        active_household_id: Arc::new(std::sync::Mutex::new(String::new())),
        store: StoreHandle::in_memory(),
        backfill: Arc::new(std::sync::Mutex::new(BackfillCoordinator::new())),
        db_health: Arc::new(std::sync::Mutex::new(report)),
        db_path: Arc::new(dir.path().join("db.sqlite3")),
        vault,
        vault_migration: Arc::new(
            VaultMigrationManager::new(&attachments_root).expect("create vault migration manager"),
        ),
        maintenance: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        files_indexer,
        pet_metrics: Arc::new(PetAttachmentMetrics::new()),
    };

    (state, dir)
}

#[tokio::test]
async fn update_command_emits_family_logs() {
    let (_dir, pool) = seed_family_db().await;
    let (buffer, _guard) = init_buffer_subscriber();

    let mut data = Map::new();
    data.insert("notes".into(), Value::String("updated".into()));
    data.insert("updated_at".into(), Value::from(now_ms_local()));

    commands::update_command(&pool, "family_members", "mem-1", data, Some("hh-1"), None)
        .await
        .expect("update command succeeds");

    let log = logs_to_string(&buffer);
    assert!(
        log.contains("\"cmd\":\"family_members_update\""),
        "missing command: {log}"
    );
    assert!(
        log.contains("\"level\":\"DEBUG\""),
        "missing debug log: {log}"
    );
    assert!(
        log.contains("\"level\":\"INFO\""),
        "missing info log: {log}"
    );
    assert!(
        log.contains("\"details\":{\"rows\":1"),
        "missing success details: {log}"
    );
}

#[tokio::test]
async fn list_command_emits_family_logs() {
    let (_dir, pool) = seed_family_db().await;
    let (buffer, _guard) = init_buffer_subscriber();

    let rows = commands::list_command(
        &pool,
        "family_members",
        "hh-1",
        Some("position, created_at, id"),
        None,
        None,
    )
    .await
    .expect("list command succeeds");
    assert_eq!(rows.len(), 1, "expected one seeded member");

    let log = logs_to_string(&buffer);
    assert!(
        log.contains("\"cmd\":\"family_members_list\""),
        "missing list command log: {log}"
    );
    assert!(
        log.contains("\"level\":\"DEBUG\""),
        "missing debug log: {log}"
    );
    assert!(
        log.contains("\"level\":\"INFO\""),
        "missing info log: {log}"
    );
    assert!(
        log.contains("\"rows\":1"),
        "missing row count detail: {log}"
    );
}

#[tokio::test]
async fn guard_failure_emits_warn_log() {
    let (state, _dir) = unhealthy_state();
    let (buffer, _guard) = init_buffer_subscriber();

    let err = guard::ensure_db_writable(&state).expect_err("guard should block writes");

    let scope = LogScope::new(
        "family_members_update",
        Some("hh-1".to_string()),
        Some("mem-1".to_string()),
    );
    scope.fail(&err);

    let log = logs_to_string(&buffer);
    assert!(
        log.contains("\"cmd\":\"family_members_update\""),
        "missing update command log: {log}"
    );
    assert!(
        log.contains("\"level\":\"WARN\""),
        "missing warn log: {log}"
    );
    assert!(
        log.contains("DB_UNHEALTHY"),
        "missing DB_UNHEALTHY indicator in warn log: {log}"
    );
}
