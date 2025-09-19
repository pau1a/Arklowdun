use sqlx::SqlitePool;
use std::sync::{Arc, Mutex};

use crate::events_tz_backfill::BackfillCoordinator;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub default_household_id: Arc<Mutex<String>>,
    pub backfill: Arc<Mutex<BackfillCoordinator>>,
}
