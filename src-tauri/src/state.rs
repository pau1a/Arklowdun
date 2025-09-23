use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::{db::health::DbHealthReport, events_tz_backfill::BackfillCoordinator};

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub default_household_id: Arc<Mutex<String>>,
    pub backfill: Arc<Mutex<BackfillCoordinator>>,
    pub db_health: Arc<Mutex<DbHealthReport>>,
    pub db_path: Arc<PathBuf>,
}
