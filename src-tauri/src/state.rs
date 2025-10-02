use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use crate::{
    db::health::DbHealthReport, events_tz_backfill::BackfillCoordinator,
    household_active::StoreHandle, AppError, AppResult,
};

#[derive(Clone)]
pub struct AppState {
    pub pool: Arc<RwLock<SqlitePool>>,
    pub active_household_id: Arc<Mutex<String>>,
    pub store: StoreHandle,
    pub backfill: Arc<Mutex<BackfillCoordinator>>,
    pub db_health: Arc<Mutex<DbHealthReport>>,
    pub db_path: Arc<PathBuf>,
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
