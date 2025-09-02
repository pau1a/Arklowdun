use sqlx::SqlitePool;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub default_household_id: Arc<Mutex<String>>,
}
