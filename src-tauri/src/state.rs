use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use crate::{
    db::health::DbHealthReport, events_tz_backfill::BackfillCoordinator,
    household_active::StoreHandle, vault::Vault, vault_migration::VaultMigrationManager, AppError,
    AppResult,
};

#[derive(Clone)]
pub struct AppState {
    pub pool: Arc<RwLock<SqlitePool>>,
    pub active_household_id: Arc<Mutex<String>>,
    pub store: StoreHandle,
    pub backfill: Arc<Mutex<BackfillCoordinator>>,
    pub db_health: Arc<Mutex<DbHealthReport>>,
    pub db_path: Arc<PathBuf>,
    pub vault: Arc<Vault>,
    pub vault_migration: Arc<VaultMigrationManager>,
    pub maintenance: Arc<AtomicBool>,
}

impl AppState {
    pub fn pool_clone(&self) -> SqlitePool {
        self.pool.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn replace_pool(&self, new_pool: SqlitePool) {
        let mut guard = self.pool.write().unwrap_or_else(|e| e.into_inner());
        *guard = new_pool;
    }

    pub fn begin_maintenance(&self) -> AppResult<MaintenanceGuard> {
        MaintenanceGuard::begin(self.maintenance.clone())
    }

    pub fn maintenance_active(&self) -> bool {
        self.maintenance.load(Ordering::SeqCst)
    }

    pub fn vault(&self) -> Arc<Vault> {
        self.vault.clone()
    }

    pub fn vault_migration(&self) -> Arc<VaultMigrationManager> {
        self.vault_migration.clone()
    }
}

pub struct MaintenanceGuard {
    flag: Arc<AtomicBool>,
}

impl MaintenanceGuard {
    fn begin(flag: Arc<AtomicBool>) -> AppResult<Self> {
        if flag
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(AppError::new(
                "DB_MAINTENANCE_ACTIVE",
                "Database maintenance is already running.",
            ));
        }
        Ok(Self { flag })
    }
}

impl Drop for MaintenanceGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::health::{DbHealthReport, DbHealthStatus};
    use crate::events_tz_backfill::BackfillCoordinator;
    use crate::household_active::StoreHandle;
    use sqlx::sqlite::SqlitePoolOptions;
    use tempfile::tempdir;

    #[test]
    fn attachments_root_is_derived_from_vault() {
        let tmp = tempdir().expect("tempdir");
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_lazy("sqlite::memory:")
            .expect("pool");
        let vault = Arc::new(Vault::new(tmp.path()));
        let state = AppState {
            pool: Arc::new(RwLock::new(pool.clone())),
            active_household_id: Arc::new(Mutex::new(String::new())),
            store: StoreHandle::in_memory(),
            backfill: Arc::new(Mutex::new(BackfillCoordinator::new())),
            db_health: Arc::new(Mutex::new(DbHealthReport {
                status: DbHealthStatus::Ok,
                checks: Vec::new(),
                offenders: Vec::new(),
                schema_hash: String::new(),
                app_version: String::new(),
                generated_at: String::new(),
            })),
            db_path: Arc::new(PathBuf::from("test.sqlite")),
            vault: vault.clone(),
            vault_migration: Arc::new(VaultMigrationManager::new(tmp.path()).expect("manager")),
            maintenance: Arc::new(AtomicBool::new(false)),
        };

        let first = state.vault();
        let second = state.vault();
        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(first.base(), vault.base());
    }
}
